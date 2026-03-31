/**
 * 부산시 실거래 과거 데이터 수집 스크립트
 * 대상: 2020-01 ~ 2024-02 (800 조합)
 * 실행: npx tsx scripts/collect-busan-history.ts
 */

import { XMLParser } from 'fast-xml-parser';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const API_BASE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const API_KEY  = process.env.MOLIT_API_KEY!;
const DB_NAME  = 'apt-trades';
const DELAY_MS = 100;
const NUM_OF_ROWS = 1000;
const LOG_FILE = join(process.cwd(), 'busan-history.log');

const START_YM = process.env.COLLECT_START_YM ?? '202001';
const END_YM   = process.env.COLLECT_END_YM   ?? '202402';

const parser = new XMLParser({ ignoreAttributes: false });

const IS_WINDOWS = process.platform === 'win32';
const WRANGLER = IS_WINDOWS
  ? `node "C:\\Users\\HOMES\\AppData\\Local\\npm-cache\\_npx\\32026684e21afda6\\node_modules\\wrangler\\bin\\wrangler.js"`
  : `npx wrangler`;

// ── 유틸 ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

/** 2020-01 ~ 2024-02 월 목록 생성 */
function getMonthRange(startYm: string, endYm: string): string[] {
  const months: string[] = [];
  let year  = parseInt(startYm.slice(0, 4));
  let month = parseInt(startYm.slice(4, 6));
  const endYear  = parseInt(endYm.slice(0, 4));
  const endMonth = parseInt(endYm.slice(4, 6));

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return months;
}

function escape(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function parseAmount(val: string | undefined): number {
  if (!val) return 0;
  return parseInt(val.replace(/,/g, '').trim(), 10) || 0;
}

function parseNum(val: string | number | undefined): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ── wrangler ──────────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  const start = raw.indexOf('[');
  const end   = raw.lastIndexOf(']');
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1);
  throw new Error(`JSON을 찾을 수 없음: ${raw.slice(0, 200)}`);
}

function executeSQLFile(sql: string): number {
  const tmpFile = join(tmpdir(), `busan_${Date.now()}.sql`);
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    const raw = execSync(
      `${WRANGLER} d1 execute ${DB_NAME} --remote --file="${tmpFile}" --json 2>&1`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const json = JSON.parse(extractJSON(raw));
    return json[0]?.meta?.changes ?? 0;
  } catch (e: unknown) {
    const msg = (e as Error).message ?? String(e);
    throw new Error(`wrangler 오류: ${msg.slice(0, 300)}`);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function executeBatched(items: TradeItem[], sggCd: string, chunkSize = 200): number {
  let total = 0;
  for (let i = 0; i < items.length; i += chunkSize) {
    const sql = buildUpsertSQL(items.slice(i, i + chunkSize), sggCd);
    if (sql) total += executeSQLFile(sql);
  }
  return total;
}


// ── 지역 코드 ──────────────────────────────────────────────────────────────

// 부산시 구/군 코드 (16개) — DB 조회 없이 하드코딩
function getBusanSggCodes(): string[] {
  return [
    '26110', // 중구
    '26140', // 서구
    '26170', // 동구
    '26200', // 영도구
    '26230', // 부산진구
    '26260', // 동래구
    '26290', // 남구
    '26320', // 북구
    '26350', // 해운대구
    '26380', // 사하구
    '26410', // 금정구
    '26440', // 강서구
    '26470', // 연제구
    '26500', // 수영구
    '26530', // 사상구
    '26710', // 기장군
  ];
}

// ── API 호출 ──────────────────────────────────────────────────────────────

interface TradeItem {
  aptNm?: string; aptSeq?: string; aptDong?: string;
  sggCd?: string; umdNm?: string; umdCd?: string;
  roadNm?: string; bonbun?: string; bubun?: string;
  buildYear?: string | number; excluUseAr?: string | number;
  floor?: string | number; dealAmount?: string;
  dealYear?: string | number; dealMonth?: string | number; dealDay?: string | number;
  dealingGbn?: string; slerGbn?: string; buyerGbn?: string;
  cdealType?: string; cdealDay?: string; rgstDate?: string; landLeasehold?: string;
}

async function fetchTrades(sggCd: string, dealYmd: string): Promise<TradeItem[]> {
  const allItems: TradeItem[] = [];
  let pageNo = 1;
  while (true) {
    const url = `${API_BASE}?serviceKey=${API_KEY}&LAWD_CD=${sggCd}&DEAL_YMD=${dealYmd}&numOfRows=${NUM_OF_ROWS}&pageNo=${pageNo}`;
    const res    = await fetch(url);
    const xml    = await res.text();
    const parsed = parser.parse(xml);
    const body   = parsed?.response?.body;
    const raw    = body?.items?.item;
    if (!raw) break;
    const pageItems: TradeItem[] = Array.isArray(raw) ? raw : [raw];
    allItems.push(...pageItems);
    const totalCount = Number(body?.totalCount ?? 0);
    if (allItems.length >= totalCount || pageItems.length < NUM_OF_ROWS) break;
    pageNo++;
    await sleep(DELAY_MS);
  }
  return allItems;
}

// ── UPSERT SQL ─────────────────────────────────────────────────────────────

function buildUpsertSQL(items: TradeItem[], sggCd: string): string {
  const rows: string[] = [];
  for (const item of items) {
    try {
      const dealAmount = parseAmount(item.dealAmount);
      const year  = String(item.dealYear  ?? '').trim();
      const month = String(item.dealMonth ?? '').trim().padStart(2, '0');
      const day   = String(item.dealDay   ?? '').trim().padStart(2, '0');
      const dealDate   = `${year}-${month}-${day}`;
      const excluUseAr = parseNum(item.excluUseAr) ?? 0;
      const areaGroup  = Math.round(excluUseAr);
      const aptSeq     = String(item.aptSeq ?? '').trim() || null;
      const floor      = parseNum(item.floor);
      rows.push(`(${[
        escape(aptSeq),
        escape(String(item.aptNm    ?? '').trim()),
        escape(String(item.aptDong  ?? '').trim() || null),
        escape(sggCd),
        escape(String(item.umdNm   ?? '').trim() || null),
        escape(String(item.umdCd   ?? '').trim() || null),
        escape(String(item.roadNm  ?? '').trim() || null),
        escape(String(item.bonbun  ?? '').trim() || null),
        escape(String(item.bubun   ?? '').trim() || null),
        parseNum(item.buildYear) ?? 'NULL',
        excluUseAr, areaGroup,
        floor ?? 'NULL',
        dealAmount,
        escape(dealDate),
        escape(String(item.dealingGbn  ?? '').trim() || null),
        escape(String(item.slerGbn     ?? '').trim() || null),
        escape(String(item.buyerGbn    ?? '').trim() || null),
        escape(String(item.cdealType   ?? '').trim() || null),
        escape(String(item.cdealDay    ?? '').trim() || null),
        escape(String(item.rgstDate    ?? '').trim() || null),
        escape(String(item.landLeasehold ?? '').trim() || null),
      ].join(',')})`);
    } catch { /* skip */ }
  }
  if (rows.length === 0) return '';
  return `INSERT INTO apt_trades (
    apt_seq,apt_nm,apt_dong,sgg_cd,umd_nm,umd_cd,road_nm,bonbun,bubun,
    build_year,exclu_use_ar,area_group,floor,deal_amount,deal_date,
    dealing_gbn,sler_gbn,buyer_gbn,cdeal_type,cdeal_day,rgst_date,land_leasehold
  ) VALUES ${rows.join(',\n')}
  ON CONFLICT(apt_seq,deal_date,floor,exclu_use_ar,deal_amount)
  DO UPDATE SET
    apt_dong       = excluded.apt_dong,
    dealing_gbn    = excluded.dealing_gbn,
    sler_gbn       = excluded.sler_gbn,
    buyer_gbn      = excluded.buyer_gbn,
    cdeal_type     = excluded.cdeal_type,
    cdeal_day      = excluded.cdeal_day,
    rgst_date      = excluded.rgst_date,
    land_leasehold = excluded.land_leasehold,
    collected_at   = datetime('now');`;
}

// ── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  log('=== 부산시 과거 데이터 수집 시작 ===');

  const months   = getMonthRange(START_YM, END_YM);
  const sggCodes = getBusanSggCodes();

  const total = months.length * sggCodes.length;
  log(`대상: ${months[0]} ~ ${months[months.length - 1]} (${months.length}개월)`);
  log(`구/군: ${sggCodes.length}개 | 총 조합: ${total}개`);

  let done = 0;
  let totalInserted = 0;
  let errorCount = 0;

  for (const dealYmd of months) {
    let monthInserted = 0;
    for (const sggCd of sggCodes) {
      done++;
      try {
        const items = await fetchTrades(sggCd, dealYmd);
        if (items.length > 0) {
          const count = executeBatched(items, sggCd);
          monthInserted += count;
          totalInserted += count;
        }
      } catch (e) {
        errorCount++;
        log(`오류 ${sggCd}/${dealYmd}: ${e instanceof Error ? e.message : e}`);
      }
      await sleep(DELAY_MS);

      // 진행률 10%마다 로그
      if (done % Math.ceil(total / 10) === 0) {
        const pct = Math.round(done / total * 100);
        log(`진행: ${pct}% (${done}/${total}) | 누적 수집: ${totalInserted}건 | 오류: ${errorCount}`);
      }
    }
    if (monthInserted > 0) {
      log(`${dealYmd}: ${monthInserted}건 수집`);
    }
  }

  log(`\n=== 완료 ===`);
  log(`총 수집: ${totalInserted}건 | 오류: ${errorCount}건`);
}

main().catch(e => { log(`치명적 오류: ${e}`); process.exit(1); });
