/**
 * 빌라 거래의 지번 → 좌표 백필 (지오코딩)
 *
 * 흐름:
 * 1) villa_trades 에서 lat IS NULL 인 행의 (sgg_cd, umd_nm, jibun) 추출
 * 2) jibun_coords 에 hit 하면 그 좌표 사용
 * 3) miss 하면 카카오 로컬 API 호출 → jibun_coords UPSERT
 * 4) villa_trades 의 lat/lng 업데이트
 *
 * - 실행: npx tsx scripts/geocode-villa.ts
 * - 옵션: GEOCODE_LIMIT=500 (한 번에 처리할 미좌표 빌라 거래 수)
 *
 * SSoT: 이 시스템(apt-trades)이 jibun_coords / villa_trades 의 owner.
 * 외부는 read-only API 만 호출.
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY!;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;
const DB_NAME = 'apt-trades';
const DELAY_MS = 100;
const LIMIT = parseInt(process.env.GEOCODE_LIMIT ?? '500', 10);

// ── D1 REST API (SELECT 결과 받기 위해 wrangler CLI 우회) ────────────────

interface D1Response<T = Record<string, unknown>> {
  success: boolean;
  result?: Array<{
    results?: T[];
    meta?: { changes?: number; rows_read?: number; rows_written?: number };
  }>;
  errors?: unknown[];
}

async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
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
    }
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
  const tmpFile = join(tmpdir(), `geo_${Date.now()}.sql`);
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    const raw = execSync(
      `${WRANGLER} d1 execute ${DB_NAME} --remote --file="${tmpFile}" --json 2>&1`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
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

function executeCommand(command: string): string {
  const raw = execSync(
    `${WRANGLER} d1 execute ${DB_NAME} --remote --command="${command}" --json 2>&1`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );
  return extractJSON(raw);
}

/** SELECT 같은 쿼리를 파일로 실행해 결과를 받음 (cmd quoting 회피) */
function querySQLFile<T = unknown>(sql: string): T[] {
  const tmpFile = join(tmpdir(), `geo_q_${Date.now()}.sql`);
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    const raw = execSync(
      `${WRANGLER} d1 execute ${DB_NAME} --remote --file="${tmpFile}" --json 2>&1`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );
    const json = JSON.parse(extractJSON(raw));
    return json[0]?.results ?? [];
  } finally {
    unlinkSync(tmpFile);
  }
}

function escape(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 카카오 로컬 API ───────────────────────────────────────────────────────

interface KakaoAddress {
  x: string;  // 경도 (lng)
  y: string;  // 위도 (lat)
}

interface KakaoResponse {
  documents?: Array<{
    address?: KakaoAddress;
    road_address?: KakaoAddress | null;
    x?: string;
    y?: string;
  }>;
  meta?: { total_count?: number };
}

/**
 * 지번 주소 → 좌표
 * @param sidoNm 시도명 (예: "부산광역시")
 * @param sggNm 시군구명 (예: "해운대구")
 * @param umdNm 법정동명 (예: "우동")
 * @param jibun 지번 (예: "1413" 또는 "115-36")
 */
async function geocodeKakao(
  sidoNm: string,
  sggNm: string,
  umdNm: string,
  jibun: string
): Promise<{ lat: number; lng: number; raw: string } | null> {
  const raw = `${sidoNm} ${sggNm} ${umdNm} ${jibun}`;
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(raw)}`;

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
  });

  if (!res.ok) {
    throw new Error(`카카오 API ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  }

  const json = (await res.json()) as KakaoResponse;
  const doc = json.documents?.[0];
  if (!doc) return null;

  // address 우선, 없으면 road_address, 없으면 doc 자체의 x/y
  const x = doc.address?.x ?? doc.road_address?.x ?? doc.x;
  const y = doc.address?.y ?? doc.road_address?.y ?? doc.y;
  if (!x || !y) return null;

  return { lng: parseFloat(x), lat: parseFloat(y), raw };
}

// ── 메인 ──────────────────────────────────────────────────────────────────

interface PendingTrade {
  sgg_cd: string;
  umd_nm: string;
  jibun: string;
  sido_nm: string;
  sgg_nm: string;
}

async function getPendingTrades(): Promise<PendingTrade[]> {
  const sql = `SELECT DISTINCT v.sgg_cd, v.umd_nm, v.jibun, r.sido_nm, r.sgg_nm
               FROM villa_trades v
               JOIN regions r ON v.sgg_cd = r.sgg_cd
               WHERE v.lat IS NULL
                 AND v.jibun IS NOT NULL AND v.jibun != ''
                 AND v.umd_nm IS NOT NULL AND v.umd_nm != ''
               LIMIT ?`;
  const { results } = await d1Query<PendingTrade>(sql, [LIMIT]);
  return results;
}

async function lookupCacheBatch(items: PendingTrade[]): Promise<Map<string, { lat: number; lng: number }>> {
  if (items.length === 0) return new Map();
  // 파라미터 바인딩 — (sgg_cd, umd_nm, jibun) IN (...) 패턴
  const placeholders = items.map(() => '(? || ? || ?)').join(',');
  const params: string[] = [];
  for (const i of items) params.push(i.sgg_cd, i.umd_nm, i.jibun);
  const sql = `SELECT sgg_cd, umd_nm, jibun, lat, lng
               FROM jibun_coords
               WHERE (sgg_cd || umd_nm || jibun) IN (${placeholders})`;
  const { results } = await d1Query<{ sgg_cd: string; umd_nm: string; jibun: string; lat: number; lng: number }>(sql, params);
  const m = new Map<string, { lat: number; lng: number }>();
  for (const r of results) {
    m.set(`${r.sgg_cd}|${r.umd_nm}|${r.jibun}`, { lat: r.lat, lng: r.lng });
  }
  return m;
}

async function main() {
  console.log('=== 빌라 좌표 백필 시작 ===');
  if (!KAKAO_KEY) {
    console.error('❌ KAKAO_REST_API_KEY 환경변수 없음. .env.local 또는 keys.md 확인');
    process.exit(1);
  }

  const pending = await getPendingTrades();
  console.log(`좌표 미할당 지번 조합: ${pending.length}개`);
  if (pending.length === 0) {
    console.log('처리할 거래 없음. 종료.');
    return;
  }

  // 1차: 캐시 일괄 조회 (D1 변수 한도 ~100 → 25개씩 = 75변수)
  const cacheMap = new Map<string, { lat: number; lng: number }>();
  for (let i = 0; i < pending.length; i += 25) {
    const chunk = pending.slice(i, i + 25);
    const m = await lookupCacheBatch(chunk);
    for (const [k, v] of m) cacheMap.set(k, v);
  }
  console.log(`캐시 hit: ${cacheMap.size}개 / 카카오 호출 필요: ${pending.length - cacheMap.size}개`);

  let geocoded = 0;
  let notFound = 0;
  let errors = 0;
  const newCoords: Array<{ sgg_cd: string; umd_nm: string; jibun: string; lat: number; lng: number; raw: string }> = [];

  for (const item of pending) {
    const key = `${item.sgg_cd}|${item.umd_nm}|${item.jibun}`;
    if (cacheMap.has(key)) continue;

    try {
      const result = await geocodeKakao(item.sido_nm, item.sgg_nm, item.umd_nm, item.jibun);
      if (result) {
        cacheMap.set(key, { lat: result.lat, lng: result.lng });
        newCoords.push({
          sgg_cd: item.sgg_cd,
          umd_nm: item.umd_nm,
          jibun: item.jibun,
          lat: result.lat,
          lng: result.lng,
          raw: result.raw,
        });
        geocoded++;
        if (geocoded % 50 === 0) console.log(`  지오코딩 ${geocoded}건...`);
      } else {
        notFound++;
      }
      await sleep(DELAY_MS);
    } catch (e) {
      errors++;
      console.error(`  오류 ${item.sgg_cd}/${item.umd_nm}/${item.jibun}: ${e instanceof Error ? e.message : e}`);
      await sleep(500);
    }
  }

  console.log(`\n지오코딩 결과: 성공 ${geocoded}, 못찾음 ${notFound}, 오류 ${errors}`);

  // 2) jibun_coords 일괄 UPSERT
  if (newCoords.length > 0) {
    console.log('jibun_coords 캐시 저장 중...');
    const chunkSize = 200;
    for (let i = 0; i < newCoords.length; i += chunkSize) {
      const chunk = newCoords.slice(i, i + chunkSize);
      const values = chunk
        .map(
          c =>
            `(${escape(c.sgg_cd)},${escape(c.umd_nm)},${escape(c.jibun)},${c.lat},${c.lng},'kakao',${escape(c.raw)})`
        )
        .join(',\n');
      const sql = `INSERT INTO jibun_coords (sgg_cd, umd_nm, jibun, lat, lng, source, raw_address)
                   VALUES ${values}
                   ON CONFLICT(sgg_cd, umd_nm, jibun) DO UPDATE SET
                     lat = excluded.lat, lng = excluded.lng,
                     source = excluded.source, raw_address = excluded.raw_address,
                     geocoded_at = datetime('now');`;
      executeSQLFile(sql);
    }
  }

  // 3) villa_trades.lat/lng 업데이트 — cacheMap 의 모든 좌표를 적용
  console.log('villa_trades 좌표 업데이트 중...');
  const allCoords = Array.from(cacheMap.entries()).map(([k, v]) => {
    const [sgg_cd, umd_nm, jibun] = k.split('|');
    return { sgg_cd, umd_nm, jibun, lat: v.lat, lng: v.lng };
  });

  let updated = 0;
  const chunkSize = 50;
  for (let i = 0; i < allCoords.length; i += chunkSize) {
    const chunk = allCoords.slice(i, i + chunkSize);
    const sqls = chunk
      .map(
        c =>
          `UPDATE villa_trades SET lat=${c.lat}, lng=${c.lng}
           WHERE sgg_cd=${escape(c.sgg_cd)} AND umd_nm=${escape(c.umd_nm)} AND jibun=${escape(c.jibun)} AND lat IS NULL;`
      )
      .join('\n');
    updated += executeSQLFile(sqls);
  }

  console.log(`\n=== 완료 ===`);
  console.log(`villa_trades lat/lng 업데이트: ${updated}건`);
  console.log(`jibun_coords 신규 추가: ${newCoords.length}개`);
}

main().catch(e => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
