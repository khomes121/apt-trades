/**
 * 국토부 연립다세대(빌라) 매매 실거래 수집 스크립트
 *
 * - API: RTMSDataSvcRHTrade (_type=json)
 * - User-Agent 헤더 필수 (curl 기본 UA 차단됨)
 * - 좌표(lat/lng)는 NULL 로 적재 → 별도 geocode-villa.ts 가 backfill
 * - 실행: npx tsx scripts/collect-villa.ts
 * - 기본: 부산(시도코드 26) 시군구 × 최근 12개월
 * - 옵션: COLLECT_VILLA_MONTHS=3, COLLECT_VILLA_SIDO=26, COLLECT_VILLA_YMD=202601
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── 설정 ──────────────────────────────────────────────────────────────────

const API_BASE = 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade';
const API_KEY = process.env.MOLIT_API_KEY!;
const DB_NAME = 'apt-trades';
const DELAY_MS = 80;
const NUM_OF_ROWS = 1000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// 기본: 부산만 (시도코드 26)
const TARGET_SIDO_CD = process.env.COLLECT_VILLA_SIDO ?? '26';
// 기본: 12개월
const MONTHS_BACK = parseInt(process.env.COLLECT_VILLA_MONTHS ?? '12', 10);

// ── 유틸 ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTargetMonths(): string[] {
  if (process.env.COLLECT_VILLA_YMD) return [process.env.COLLECT_VILLA_YMD];
  const now = new Date();
  const months: string[] = [];
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
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

// ── wrangler D1 실행 (collect.ts 와 동일 패턴) ─────────────────────────────

const IS_WINDOWS = process.platform === 'win32';
const WRANGLER = IS_WINDOWS
  ? `node "C:\\Users\\HOMES\\AppData\\Local\\npm-cache\\_npx\\32026684e21afda6\\node_modules\\wrangler\\bin\\wrangler.js"`
  : `npx wrangler`;

function extractJSON(raw: string): string {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1);
  throw new Error(`JSON을 찾을 수 없음: ${raw.slice(0, 200)}`);
}

function executeSQLFile(sql: string): number {
  const tmpFile = join(tmpdir(), `villa_${Date.now()}.sql`);
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

function executeBatched(items: VillaItem[], sggCd: string, chunkSize = 200): number {
  let total = 0;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const sql = buildUpsertSQL(chunk, sggCd);
    if (sql) total += executeSQLFile(sql);
  }
  return total;
}

function executeCommand(command: string): string {
  const raw = execSync(
    `${WRANGLER} d1 execute ${DB_NAME} --remote --command="${command}" --json 2>&1`,
    { encoding: 'utf-8' }
  );
  return extractJSON(raw);
}

// ── 지역 코드 조회 (시도 필터) ─────────────────────────────────────────────

async function getTargetSggCodes(): Promise<string[]> {
  const out = executeCommand(
    `SELECT sgg_cd FROM regions WHERE sido_cd = '${TARGET_SIDO_CD}' ORDER BY sgg_cd`
  );
  const json = JSON.parse(out);
  return (json[0]?.results ?? []).map((r: { sgg_cd: string }) => r.sgg_cd);
}

// ── 국토부 빌라 API ───────────────────────────────────────────────────────

interface VillaItem {
  mhouseNm?: string;
  sggCd?: string | number;
  umdNm?: string;
  jibun?: string;
  buildYear?: number;
  houseType?: string;
  excluUseAr?: number;
  landAr?: number;
  floor?: number;
  dealAmount?: string;
  dealYear?: number;
  dealMonth?: number;
  dealDay?: number;
  dealingGbn?: string;
  cdealType?: string;
  cdealDay?: string;
  rgstDate?: string;
}

interface ApiResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      items?: { item?: VillaItem | VillaItem[] };
      numOfRows?: number;
      pageNo?: number;
      totalCount?: number;
    };
  };
}

async function fetchTrades(sggCd: string, dealYmd: string): Promise<VillaItem[]> {
  const allItems: VillaItem[] = [];
  let pageNo = 1;

  while (true) {
    const url =
      `${API_BASE}?serviceKey=${API_KEY}` +
      `&LAWD_CD=${sggCd}&DEAL_YMD=${dealYmd}` +
      `&numOfRows=${NUM_OF_ROWS}&pageNo=${pageNo}&_type=json`;

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    const json = (await res.json()) as ApiResponse;

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

// ── UPSERT SQL ────────────────────────────────────────────────────────────

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

      // 지번 누락 시 좌표 매칭 불가 → 그래도 거래 데이터는 적재 (jibun = '')
      rows.push(
        `(${[
          escape(mhouseNm || null),
          escape(sggCd),
          escape(umdNm),
          escape(jibun || null),
          'NULL',                             // road_nm (API 없음)
          parseNum(item.buildYear) ?? 'NULL',
          escape(nullIfBlank(item.houseType)),
          excluUseAr,
          areaGroup,
          landAr ?? 'NULL',
          floor ?? 'NULL',
          dealAmount,
          escape(dealDate),
          escape(nullIfBlank(item.dealingGbn)),
          escape(nullIfBlank(item.cdealType)),
          escape(nullIfBlank(item.cdealDay)),
          escape(nullIfBlank(item.rgstDate)),
        ].join(',')})`
      );
    } catch {
      /* skip */
    }
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

// ── 로그 ──────────────────────────────────────────────────────────────────

function writeLog(runType: string, sggCd: string, dealYmd: string, count: number, status: string) {
  try {
    const sql = `INSERT INTO collect_logs (run_type,sgg_cd,deal_ymd,count,status) VALUES ('${runType}','${sggCd}','${dealYmd}',${count},'${status}');`;
    executeSQLFile(sql);
  } catch {
    /* ignore */
  }
}

function saveFailedLog(failedCombos: string[], label: string) {
  if (failedCombos.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  const dir = join(process.cwd(), 'logs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `failed-${label}-${date}.txt`);
  const content = [
    `수집 실패 목록 (${label} / ${date})`,
    `총 ${failedCombos.length}건`,
    '',
    ...failedCombos,
  ].join('\n');
  writeFileSync(file, content, 'utf-8');
  console.log(`\n실패 로그 저장: ${file}`);
}

// ── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 국토부 빌라(연립다세대) 실거래 수집 시작 ===');
  console.log(`시도코드: ${TARGET_SIDO_CD} / 개월수: ${MONTHS_BACK}`);

  if (!API_KEY) {
    console.error('❌ MOLIT_API_KEY 환경변수 없음. .env.local 확인');
    process.exit(1);
  }

  const months = getTargetMonths();
  console.log(`대상 월: ${months.join(', ')}`);

  const sggCodes = await getTargetSggCodes();
  console.log(`대상 시군구: ${sggCodes.length}개\n`);
  if (sggCodes.length === 0) {
    console.error(`❌ 시도코드 ${TARGET_SIDO_CD} 에 해당하는 시군구 없음`);
    process.exit(1);
  }

  let totalCount = 0;
  let errorCount = 0;
  const failedCombos: string[] = [];

  async function collectWithRetry(sggCd: string, dealYmd: string): Promise<number> {
    const MAX_RETRY = 3;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        const items = await fetchTrades(sggCd, dealYmd);
        if (items.length === 0) return 0;
        const count = executeBatched(items, sggCd);
        writeLog('villa', sggCd, dealYmd, count, 'success');
        return count;
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 100) : String(e);
        if (attempt < MAX_RETRY) {
          console.error(`\n  재시도 ${attempt}/${MAX_RETRY - 1} ${sggCd}/${dealYmd}: ${msg}`);
          await sleep(3000 * attempt);
        } else {
          console.error(`\n  최종 실패 ${sggCd}/${dealYmd}: ${msg}`);
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

  console.log(`\n\n=== 완료 ===`);
  console.log(`총 수집: ${totalCount}건, 오류: ${errorCount}건`);
  if (failedCombos.length > 0) {
    console.log(`\n⚠️ 최종 실패 목록 (수동 재실행 필요):`);
    failedCombos.forEach(c => console.log(`  - ${c}`));
    saveFailedLog(failedCombos, 'villa');
  }
}

main().catch(e => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
