/**
 * 빌라(연립다세대) 일별 자동수집 스크립트
 *
 * - 전월 + 당월 수집 (뒤늦은 신고 건 반영)
 * - 부산(시도코드 26)만 수집. 전국 확장 시 COLLECT_VILLA_SIDO 안 주면 전국.
 * - 적재 후 좌표 백필 (jibun_coords 캐시 hit 시 카카오 호출 0)
 * - 실행: npx tsx scripts/collect-villa-daily.ts
 *
 * 작업 스케줄러 등록: scripts/run-villa-daily.bat 참고
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const API_BASE = 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade';
const API_KEY = process.env.MOLIT_API_KEY!;
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY!;
// GitHub Actions(CLOUDFLARE_*) / 로컬(.env.local 의 CF_*) 둘 다 지원
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID!;
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID ?? 'e60d3a7f-2ae9-4058-af50-f4f2b34d209d';
const CF_API_TOKEN = process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN!;
const DB_NAME = 'apt-trades';
const DELAY_MS = 80;
const NUM_OF_ROWS = 1000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// 기본: 전국. COLLECT_VILLA_SIDO=26 주면 부산만 등 시도 단위 필터.
const TARGET_SIDO_CD = process.env.COLLECT_VILLA_SIDO ?? '';

// ── 유틸 ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTargetMonths(): string[] {
  if (process.env.COLLECT_VILLA_YMD) return [process.env.COLLECT_VILLA_YMD];
  const now = new Date();
  const months: string[] = [];
  for (let i = 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months; // [전월, 당월]
}

function escape(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return 'NULL';
  const s = String(val).trim();
  if (s === '' || s === ' ') return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

function parseAmount(val: string | undefined): number {
  if (!val) return 0;
  return parseInt(String(val).replace(/,/g, '').trim(), 10) || 0;
}

function parseNum(val: string | number | undefined): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function nullIfBlank(val: string | undefined): string | null {
  if (!val) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
}

// ── wrangler D1 (대량 INSERT) ────────────────────────────────────────────

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
  const tmpFile = join(tmpdir(), `villa_d_${Date.now()}.sql`);
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

// ── D1 REST API (SELECT/UPDATE 결과 받기) ─────────────────────────────────

interface D1Response<T = Record<string, unknown>> {
  success: boolean;
  result?: Array<{ results?: T[]; meta?: { changes?: number } }>;
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
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    }
  );
  const json = (await res.json()) as D1Response<T>;
  if (!json.success) throw new Error(`D1: ${JSON.stringify(json.errors).slice(0, 300)}`);
  const first = json.result?.[0];
  return { results: first?.results ?? [], changes: first?.meta?.changes ?? 0 };
}

// ── 시군구 조회 ───────────────────────────────────────────────────────────

async function getTargetSggCodes(): Promise<string[]> {
  const sql = TARGET_SIDO_CD
    ? `SELECT sgg_cd FROM regions WHERE sido_cd = ? ORDER BY sgg_cd`
    : `SELECT sgg_cd FROM regions ORDER BY sgg_cd`;
  const params: string[] = TARGET_SIDO_CD ? [TARGET_SIDO_CD] : [];
  const { results } = await d1Query<{ sgg_cd: string }>(sql, params);
  return results.map(r => r.sgg_cd);
}

// ── 빌라 API ──────────────────────────────────────────────────────────────

interface VillaItem {
  mhouseNm?: string; sggCd?: string | number; umdNm?: string; jibun?: string;
  buildYear?: number; houseType?: string; excluUseAr?: number; landAr?: number; floor?: number;
  dealAmount?: string; dealYear?: number; dealMonth?: number; dealDay?: number;
  dealingGbn?: string; cdealType?: string; cdealDay?: string; rgstDate?: string;
}

async function fetchTrades(sggCd: string, dealYmd: string): Promise<VillaItem[]> {
  const allItems: VillaItem[] = [];
  let pageNo = 1;
  while (true) {
    const url = `${API_BASE}?serviceKey=${API_KEY}&LAWD_CD=${sggCd}&DEAL_YMD=${dealYmd}&numOfRows=${NUM_OF_ROWS}&pageNo=${pageNo}&_type=json`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    const json = (await res.json()) as { response?: { body?: { items?: { item?: VillaItem | VillaItem[] }; totalCount?: number } } };
    const body = json?.response?.body;
    const raw = body?.items?.item;
    if (!raw) break;
    const pageItems: VillaItem[] = Array.isArray(raw) ? raw : [raw];
    allItems.push(...pageItems);
    const totalCount = Number(body?.totalCount ?? 0);
    if (allItems.length >= totalCount || pageItems.length < NUM_OF_ROWS) break;
    pageNo++;
    await sleep(DELAY_MS);
  }
  return allItems;
}

function buildUpsertSQL(items: VillaItem[], sggCd: string): string {
  const rows: string[] = [];
  for (const item of items) {
    try {
      const dealAmount = parseAmount(item.dealAmount);
      const year = String(item.dealYear ?? '').trim();
      const month = String(item.dealMonth ?? '').trim().padStart(2, '0');
      const day = String(item.dealDay ?? '').trim().padStart(2, '0');
      const dealDate = `${year}-${month}-${day}`;
      const excluUseAr = parseNum(item.excluUseAr) ?? 0;
      const areaGroup = Math.round(excluUseAr);
      const floor = parseNum(item.floor);
      const landAr = parseNum(item.landAr);
      const mhouseNm = nullIfBlank(item.mhouseNm) ?? '';
      const jibun = nullIfBlank(item.jibun) ?? '';
      const umdNm = nullIfBlank(item.umdNm);
      rows.push(
        `(${[
          escape(mhouseNm || null),
          escape(sggCd),
          escape(umdNm),
          escape(jibun || null),
          'NULL',
          parseNum(item.buildYear) ?? 'NULL',
          escape(nullIfBlank(item.houseType)),
          excluUseAr, areaGroup,
          landAr ?? 'NULL',
          floor ?? 'NULL',
          dealAmount, escape(dealDate),
          escape(nullIfBlank(item.dealingGbn)),
          escape(nullIfBlank(item.cdealType)),
          escape(nullIfBlank(item.cdealDay)),
          escape(nullIfBlank(item.rgstDate)),
        ].join(',')})`
      );
    } catch { /* skip */ }
  }
  if (rows.length === 0) return '';
  return `INSERT INTO villa_trades (
    mhouse_nm,sgg_cd,umd_nm,jibun,road_nm,
    build_year,house_type,exclu_use_ar,area_group,land_ar,floor,
    deal_amount,deal_date,
    dealing_gbn,cdeal_type,cdeal_day,rgst_date
  ) VALUES ${rows.join(',\n')}
  ON CONFLICT(sgg_cd,jibun,mhouse_nm,deal_date,floor,exclu_use_ar,deal_amount)
  DO UPDATE SET
    dealing_gbn  = excluded.dealing_gbn,
    cdeal_type   = excluded.cdeal_type,
    cdeal_day    = excluded.cdeal_day,
    rgst_date    = excluded.rgst_date,
    collected_at = datetime('now');`;
}

function executeBatched(items: VillaItem[], sggCd: string, chunkSize = 200): number {
  let total = 0;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const sql = buildUpsertSQL(chunk, sggCd);
    if (sql) total += executeSQLFile(sql);
  }
  return total;
}

function writeLog(runType: string, sggCd: string, dealYmd: string, count: number, status: string) {
  try {
    const sql = `INSERT INTO collect_logs (run_type,sgg_cd,deal_ymd,count,status) VALUES ('${runType}','${sggCd}','${dealYmd}',${count},'${status}');`;
    executeSQLFile(sql);
  } catch { /* ignore */ }
}

function saveFailedLog(failedCombos: string[], label: string) {
  if (failedCombos.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  const dir = join(process.cwd(), 'logs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `failed-${label}-${date}.txt`);
  writeFileSync(file, [`수집 실패 (${label} / ${date})`, `총 ${failedCombos.length}건`, '', ...failedCombos].join('\n'), 'utf-8');
  console.log(`실패 로그: ${file}`);
}

// ── 좌표 백필 (geocode-villa.ts 의 핵심 통합) ─────────────────────────────

interface PendingTrade {
  sgg_cd: string; umd_nm: string; jibun: string; sido_nm: string; sgg_nm: string;
}

async function geocodeKakao(sidoNm: string, sggNm: string, umdNm: string, jibun: string)
  : Promise<{ lat: number; lng: number; raw: string } | null> {
  const raw = `${sidoNm} ${sggNm} ${umdNm} ${jibun}`;
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(raw)}`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  if (!res.ok) throw new Error(`카카오 ${res.status}`);
  const json = (await res.json()) as { documents?: Array<{ address?: { x: string; y: string }; road_address?: { x: string; y: string } | null; x?: string; y?: string }> };
  const doc = json.documents?.[0];
  if (!doc) return null;
  const x = doc.address?.x ?? doc.road_address?.x ?? doc.x;
  const y = doc.address?.y ?? doc.road_address?.y ?? doc.y;
  if (!x || !y) return null;
  return { lng: parseFloat(x), lat: parseFloat(y), raw };
}

async function backfillCoords(): Promise<void> {
  console.log('\n=== 좌표 백필 ===');

  const { results: pending } = await d1Query<PendingTrade>(
    `SELECT DISTINCT v.sgg_cd, v.umd_nm, v.jibun, r.sido_nm, r.sgg_nm
     FROM villa_trades v
     JOIN regions r ON v.sgg_cd = r.sgg_cd
     WHERE v.lat IS NULL
       AND v.jibun IS NOT NULL AND v.jibun != ''
       AND v.umd_nm IS NOT NULL AND v.umd_nm != ''
     LIMIT 1000`
  );
  console.log(`좌표 미할당 지번: ${pending.length}개`);
  if (pending.length === 0) return;

  // 캐시 lookup (25개씩)
  const cacheMap = new Map<string, { lat: number; lng: number }>();
  for (let i = 0; i < pending.length; i += 25) {
    const chunk = pending.slice(i, i + 25);
    const placeholders = chunk.map(() => '(? || ? || ?)').join(',');
    const params: string[] = [];
    for (const it of chunk) params.push(it.sgg_cd, it.umd_nm, it.jibun);
    const { results } = await d1Query<{ sgg_cd: string; umd_nm: string; jibun: string; lat: number; lng: number }>(
      `SELECT sgg_cd, umd_nm, jibun, lat, lng FROM jibun_coords WHERE (sgg_cd || umd_nm || jibun) IN (${placeholders})`,
      params
    );
    for (const r of results) cacheMap.set(`${r.sgg_cd}|${r.umd_nm}|${r.jibun}`, { lat: r.lat, lng: r.lng });
  }
  console.log(`캐시 hit: ${cacheMap.size}개 / 신규 카카오 호출: ${pending.length - cacheMap.size}개`);

  // 신규 지오코딩
  let geocoded = 0, notFound = 0;
  const newCoords: Array<{ sgg_cd: string; umd_nm: string; jibun: string; lat: number; lng: number; raw: string }> = [];
  for (const item of pending) {
    const key = `${item.sgg_cd}|${item.umd_nm}|${item.jibun}`;
    if (cacheMap.has(key)) continue;
    try {
      const r = await geocodeKakao(item.sido_nm, item.sgg_nm, item.umd_nm, item.jibun);
      if (r) {
        cacheMap.set(key, { lat: r.lat, lng: r.lng });
        newCoords.push({ sgg_cd: item.sgg_cd, umd_nm: item.umd_nm, jibun: item.jibun, lat: r.lat, lng: r.lng, raw: r.raw });
        geocoded++;
      } else notFound++;
      await sleep(100);
    } catch (e) {
      console.error(`지오코딩 오류 ${item.jibun}: ${e instanceof Error ? e.message : e}`);
      await sleep(500);
    }
  }
  console.log(`지오코딩: 성공 ${geocoded} / 못찾음 ${notFound}`);

  // jibun_coords UPSERT
  if (newCoords.length > 0) {
    for (let i = 0; i < newCoords.length; i += 200) {
      const chunk = newCoords.slice(i, i + 200);
      const values = chunk.map(c => `(${escape(c.sgg_cd)},${escape(c.umd_nm)},${escape(c.jibun)},${c.lat},${c.lng},'kakao',${escape(c.raw)})`).join(',\n');
      executeSQLFile(`INSERT INTO jibun_coords (sgg_cd,umd_nm,jibun,lat,lng,source,raw_address) VALUES ${values}
        ON CONFLICT(sgg_cd,umd_nm,jibun) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, geocoded_at=datetime('now');`);
    }
  }

  // villa_trades UPDATE
  const allCoords = Array.from(cacheMap.entries()).map(([k, v]) => {
    const [sgg_cd, umd_nm, jibun] = k.split('|');
    return { sgg_cd, umd_nm, jibun, lat: v.lat, lng: v.lng };
  });
  let updated = 0;
  for (let i = 0; i < allCoords.length; i += 50) {
    const chunk = allCoords.slice(i, i + 50);
    const sqls = chunk.map(c =>
      `UPDATE villa_trades SET lat=${c.lat}, lng=${c.lng}
       WHERE sgg_cd=${escape(c.sgg_cd)} AND umd_nm=${escape(c.umd_nm)} AND jibun=${escape(c.jibun)} AND lat IS NULL;`
    ).join('\n');
    updated += executeSQLFile(sqls);
  }
  console.log(`villa_trades 좌표 업데이트: ${updated}건`);
}

// ── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 빌라 일별 자동수집 시작 ===');
  console.log(`시도코드: ${TARGET_SIDO_CD || '전국'}`);

  if (!API_KEY) { console.error('❌ MOLIT_API_KEY 없음'); process.exit(1); }
  if (!CF_API_TOKEN) { console.error('❌ CF_API_TOKEN 없음'); process.exit(1); }

  const months = getTargetMonths();
  console.log(`대상 월: ${months.join(', ')}`);

  const sggCodes = await getTargetSggCodes();
  console.log(`대상 시군구: ${sggCodes.length}개\n`);

  let totalCount = 0, errorCount = 0;
  const failedCombos: string[] = [];

  async function collectWithRetry(sggCd: string, dealYmd: string): Promise<number> {
    const MAX_RETRY = 3;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        const items = await fetchTrades(sggCd, dealYmd);
        if (items.length === 0) return 0;
        const count = executeBatched(items, sggCd);
        writeLog('villa-daily', sggCd, dealYmd, count, 'success');
        return count;
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 100) : String(e);
        if (attempt < MAX_RETRY) {
          console.error(`  재시도 ${attempt} ${sggCd}/${dealYmd}: ${msg}`);
          await sleep(3000 * attempt);
        } else {
          console.error(`  최종 실패 ${sggCd}/${dealYmd}: ${msg}`);
          failedCombos.push(`${sggCd}/${dealYmd}`);
          errorCount++;
        }
      }
    }
    return 0;
  }

  for (const sggCd of sggCodes) {
    for (const dealYmd of months) {
      const count = await collectWithRetry(sggCd, dealYmd);
      totalCount += count;
      if (count > 0) console.log(`  ${sggCd}/${dealYmd}: ${count}건`);
      else process.stdout.write('.');
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n=== 수집 완료: ${totalCount}건, 오류 ${errorCount}건 ===`);
  if (failedCombos.length > 0) {
    saveFailedLog(failedCombos, 'villa-daily');
  }

  // 좌표 백필
  if (KAKAO_KEY) {
    await backfillCoords();
  } else {
    console.log('\n⚠️ KAKAO_REST_API_KEY 없어 좌표 백필 생략');
  }
}

main().catch(e => { console.error('치명적 오류:', e); process.exit(1); });
