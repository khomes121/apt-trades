/**
 * 아파트 단지 좌표 백필 (apt-trades 측, apt_coords 테이블)
 *
 * 흐름 (geocode-villa.ts 패턴 그대로):
 * 1) apt_trades 에서 unique apt_seq 중 apt_coords 에 없는 단지 추출
 * 2) 각 단지의 첫 거래 주소 (도로명 우선, 없으면 지번) 기반 카카오 지오코딩
 * 3) apt_coords 에 UPSERT
 *
 * - 실행: npx tsx scripts/geocode-apt.ts
 * - 옵션:
 *     GEOCODE_LIMIT=5000        한 번에 처리할 단지 수
 *     GEOCODE_SGG_PREFIX=26     시군구 코드 prefix (예: 26 = 부산만)
 *
 * SSoT: 이 시스템(apt-trades)이 apt_coords 의 owner. 외부는 read-only.
 * idempotent: 이미 채워진 apt_seq 는 자동 스킵.
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY!;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID!;
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID ?? 'e60d3a7f-2ae9-4058-af50-f4f2b34d209d';
const CF_API_TOKEN = process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN!;
const DB_NAME = 'apt-trades';
const DELAY_MS = 100;
const LIMIT = parseInt(process.env.GEOCODE_LIMIT ?? '5000', 10);
const SGG_PREFIX = process.env.GEOCODE_SGG_PREFIX ?? '';   // '' = 전체

// ── D1 REST API (SELECT 결과 받기 위해) ──────────────────────────────────

interface D1Response<T = Record<string, unknown>> {
  success: boolean;
  result?: Array<{
    results?: T[];
    meta?: { changes?: number; rows_read?: number };
  }>;
  errors?: unknown[];
}

async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<{ results: T[]; changes: number }> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const json = (await res.json()) as D1Response<T>;
  if (!json.success) {
    throw new Error(`D1 오류: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  const first = json.result?.[0];
  return {
    results: first?.results ?? [],
    changes: first?.meta?.changes ?? 0,
  };
}

// ── wrangler ──────────────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === 'win32';
const WRANGLER = IS_WINDOWS
  ? `node "C:\\Users\\HOMES\\AppData\\Local\\npm-cache\\_npx\\32026684e21afda6\\node_modules\\wrangler\\bin\\wrangler.js"`
  : `npx wrangler`;

function extractJSON(raw: string): string {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1);
  throw new Error(`JSON not found: ${raw.slice(0, 200)}`);
}

function executeSQLFile(sql: string): number {
  const tmpFile = join(tmpdir(), `geo_apt_${Date.now()}.sql`);
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    const raw = execSync(
      `${WRANGLER} d1 execute ${DB_NAME} --remote --file="${tmpFile}" --json 2>&1`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    );
    const json = JSON.parse(extractJSON(raw));
    return json[0]?.meta?.changes ?? 0;
  } catch (e: unknown) {
    const stdout = (e as NodeJS.ErrnoException & { stdout?: string }).stdout ?? '';
    const msg = (e as Error).message ?? String(e);
    throw new Error(`wrangler 오류:\n${msg}\n--- stdout ---\n${stdout.slice(0, 500)}`);
  } finally {
    unlinkSync(tmpFile);
  }
}

function escape(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 카카오 로컬 API ───────────────────────────────────────────────────────

interface KakaoAddress {
  x: string;  // 경도
  y: string;  // 위도
}

interface KakaoResp {
  documents?: Array<{
    address?: KakaoAddress;
    road_address?: KakaoAddress | null;
    x?: string;
    y?: string;
  }>;
}

async function geocodeKakao(query: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`카카오 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as KakaoResp;
  const doc = json.documents?.[0];
  if (!doc) return null;
  const x = doc.address?.x ?? doc.road_address?.x ?? doc.x;
  const y = doc.address?.y ?? doc.road_address?.y ?? doc.y;
  if (!x || !y) return null;
  return { lng: parseFloat(x), lat: parseFloat(y) };
}

// ── 메인 ──────────────────────────────────────────────────────────────────

interface PendingApt {
  apt_seq: string;
  sido_nm: string;
  sgg_nm: string;
  umd_nm: string;
  road_nm: string | null;
  bonbun: string;
  bubun: string;
}

async function getPendingApts(): Promise<PendingApt[]> {
  // apt_coords 에 없는 unique apt_seq 만, 단지의 대표 주소 1개
  const where = SGG_PREFIX ? `AND a.sgg_cd LIKE '${SGG_PREFIX}%'` : '';
  const sql = `
    SELECT a.apt_seq,
           r.sido_nm, r.sgg_nm,
           MAX(a.umd_nm)  AS umd_nm,
           MAX(a.road_nm) AS road_nm,
           MAX(a.bonbun)  AS bonbun,
           MAX(a.bubun)   AS bubun
    FROM apt_trades a
    JOIN regions r ON a.sgg_cd = r.sgg_cd
    LEFT JOIN apt_coords c ON a.apt_seq = c.apt_seq
    WHERE c.apt_seq IS NULL
      AND a.apt_seq IS NOT NULL AND a.apt_seq != ''
      ${where}
    GROUP BY a.apt_seq
    LIMIT ${LIMIT}
  `;
  const { results } = await d1Query<PendingApt>(sql);
  return results;
}

function buildAddress(it: PendingApt): string {
  // 도로명 있으면 우선 (정확도 높음). 없으면 지번.
  if (it.road_nm) {
    return `${it.sido_nm} ${it.sgg_nm} ${it.umd_nm} ${it.road_nm}`;
  }
  const bonbun = it.bonbun.replace(/^0+/, '') || '0';
  const bubun = (it.bubun ?? '').replace(/^0+/, '');
  const jibun = bubun ? `${bonbun}-${bubun}` : bonbun;
  return `${it.sido_nm} ${it.sgg_nm} ${it.umd_nm} ${jibun}`;
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' 아파트 단지 좌표 백필 (apt_coords)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (!KAKAO_KEY) {
    console.error('❌ KAKAO_REST_API_KEY 없음. .env.local 확인');
    process.exit(1);
  }
  console.log(`region prefix: ${SGG_PREFIX || '(전체)'}, LIMIT ${LIMIT}\n`);

  const pending = await getPendingApts();
  console.log(`apt_coords 미적재 단지: ${pending.length}개`);
  if (pending.length === 0) {
    console.log('처리할 단지 없음. 종료.');
    return;
  }

  let geocoded = 0;
  let notFound = 0;
  let errors = 0;
  const newCoords: Array<{ apt_seq: string; lat: number; lng: number; raw: string }> = [];

  for (const it of pending) {
    const raw = buildAddress(it);
    try {
      const result = await geocodeKakao(raw);
      if (result) {
        newCoords.push({ apt_seq: it.apt_seq, lat: result.lat, lng: result.lng, raw });
        geocoded++;
        if (geocoded % 50 === 0) console.log(`  ${geocoded}건 진행...`);
      } else {
        notFound++;
        if (notFound <= 5) console.log(`  못찾음: ${it.apt_seq} | ${raw}`);
      }
      await sleep(DELAY_MS);
    } catch (e) {
      errors++;
      console.error(`  오류 ${it.apt_seq}: ${e instanceof Error ? e.message : e}`);
      await sleep(500);
    }
  }

  console.log(`\n지오코딩: 성공 ${geocoded}, 못찾음 ${notFound}, 오류 ${errors}`);

  if (newCoords.length === 0) {
    console.log('적재할 좌표 없음. 종료.');
    return;
  }

  // apt_coords UPSERT (200개씩 배치)
  console.log(`apt_coords UPSERT 중... (${newCoords.length}건)`);
  let upserted = 0;
  const chunkSize = 200;
  for (let i = 0; i < newCoords.length; i += chunkSize) {
    const chunk = newCoords.slice(i, i + chunkSize);
    const values = chunk
      .map(
        (c) =>
          `(${escape(c.apt_seq)},${c.lat},${c.lng},'kakao',${escape(c.raw)})`,
      )
      .join(',\n');
    const sql = `INSERT INTO apt_coords (apt_seq, lat, lng, source, raw_address)
                 VALUES ${values}
                 ON CONFLICT(apt_seq) DO UPDATE SET
                   lat = excluded.lat, lng = excluded.lng,
                   source = excluded.source, raw_address = excluded.raw_address,
                   geocoded_at = datetime('now');`;
    upserted += executeSQLFile(sql);
  }

  console.log(`\n=== 완료 ===`);
  console.log(`apt_coords 신규 적재: ${newCoords.length}건 (changes ${upserted})`);
}

main().catch((e) => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
