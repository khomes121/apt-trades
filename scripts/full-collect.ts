/**
 * 최초 풀 수집 스크립트 (1회만 실행)
 * - 전국 × 과거 2년치 수집
 * - wrangler d1 execute 방식으로 DB 삽입
 * - 실행: npx tsx scripts/full-collect.ts
 */

import { XMLParser } from 'fast-xml-parser';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const API_BASE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const API_KEY  = process.env.MOLIT_API_KEY!;
const DELAY_MS = 100;
const DB_NAME  = 'apt-trades';
const NUM_OF_ROWS = 1000;

const parser = new XMLParser({ ignoreAttributes: false });

const WRANGLER = `node "C:\\Users\\HOMES\\AppData\\Local\\npm-cache\\_npx\\32026684e21afda6\\node_modules\\wrangler\\bin\\wrangler.js"`;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getPastMonths(months: number): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = months; i >= 0; i--) {  // i=0 포함 → 당월까지 수집
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

// ── wrangler D1 실행 ──────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  const start = raw.indexOf('[');
  const end   = raw.lastIndexOf(']');
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1);
  throw new Error(`JSON을 찾을 수 없음: ${raw.slice(0, 200)}`);
}

function executeSQLFile(sql: string): number {
  const tmpFile = join(tmpdir(), `apt_${Date.now()}.sql`);
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
    const msg    = (e as Error).message ?? String(e);
    throw new Error(`wrangler 오류:\n${msg}\n--- stdout ---\n${stdout.slice(0, 500)}`);
  } finally {
    unlinkSync(tmpFile);
  }
}

// items → chunkSize 단위로 배치 INSERT (D1 SQL 크기 제한 대응)
function executeBatched(items: TradeItem[], sggCd: string, chunkSize = 200): number {
  let total = 0;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const sql = buildUpsertSQL(chunk, sggCd);
    if (sql) total += executeSQLFile(sql);
  }
  return total;
}

// ── 지역 코드 조회 ────────────────────────────────────────────────────────

async function getAllSggCodes(): Promise<string[]> {
  const raw  = execSync(
    `${WRANGLER} d1 execute ${DB_NAME} --remote --command "SELECT sgg_cd FROM regions ORDER BY sgg_cd" --json 2>&1`,
    { encoding: 'utf-8' }
  );
  const json = JSON.parse(extractJSON(raw));
  return (json[0]?.results ?? []).map((r: { sgg_cd: string }) => r.sgg_cd);
}

// ── 국토부 API 호출 (페이지네이션 대응) ──────────────────────────────────

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
    // PowerShell(Invoke-WebRequest)로 호출 - .NET TLS가 WAF를 통과함
    const xml = execSync(
      `powershell -Command "Invoke-WebRequest -Uri '${url}' -UseBasicParsing | Select-Object -ExpandProperty Content"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
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

// ── 거래 데이터 → UPSERT ──────────────────────────────────────────────────

function escape(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return 'NULL';
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
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
        escape(String(item.aptNm     ?? '').trim()),
        escape(String(item.aptDong   ?? '').trim() || null),
        escape(sggCd),
        escape(String(item.umdNm    ?? '').trim() || null),
        escape(String(item.umdCd    ?? '').trim() || null),
        escape(String(item.roadNm   ?? '').trim() || null),
        escape(String(item.bonbun   ?? '').trim() || null),
        escape(String(item.bubun    ?? '').trim() || null),
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
  // ON CONFLICT: 변경 가능한 필드(동·취소여부·등기일 등)는 신규 데이터로 덮어씀
  return `INSERT INTO apt_trades (
    apt_seq,apt_nm,apt_dong,sgg_cd,umd_nm,umd_cd,road_nm,bonbun,bubun,
    build_year,exclu_use_ar,area_group,floor,deal_amount,deal_date,
    dealing_gbn,sler_gbn,buyer_gbn,cdeal_type,cdeal_day,rgst_date,land_leasehold
  ) VALUES ${rows.join(',\n')}
  ON CONFLICT(apt_seq,deal_date,floor,exclu_use_ar,deal_amount)
  DO UPDATE SET
    apt_dong      = excluded.apt_dong,
    dealing_gbn   = excluded.dealing_gbn,
    sler_gbn      = excluded.sler_gbn,
    buyer_gbn     = excluded.buyer_gbn,
    cdeal_type    = excluded.cdeal_type,
    cdeal_day     = excluded.cdeal_day,
    rgst_date     = excluded.rgst_date,
    land_leasehold= excluded.land_leasehold,
    collected_at  = datetime('now');`;
}

// ── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 최초 풀 수집 시작 (전국 × 과거 24개월) ===');
  console.log('※ 약 6,000회 API 호출, 완료까지 10~20분 소요됩니다\n');

  const months   = getPastMonths(24);
  const sggCodes = await getAllSggCodes();
  console.log(`지역: ${sggCodes.length}개 × 월: ${months.length}개\n`);

  let totalCount = 0;
  let callCount  = 0;
  let errorCount = 0;

  for (const sggCd of sggCodes) {
    for (const dealYmd of months) {
      callCount++;
      try {
        const items = await fetchTrades(sggCd, dealYmd);
        if (items.length > 0) {
          const count = executeBatched(items, sggCd);
          totalCount += count;
          if (count > 0) console.log(`[${callCount}] ${sggCd}/${dealYmd}: ${count}건 (API ${items.length}건)`);
        } else {
          process.stdout.write('.');
        }
      } catch (e) {
        console.error(`\n오류 ${sggCd}/${dealYmd}:`, e instanceof Error ? e.message : e);
        errorCount++;
      }
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n\n=== 풀 수집 완료 ===`);
  console.log(`총 수집: ${totalCount}건, 오류: ${errorCount}건`);
}

main().catch(e => { console.error('치명적 오류:', e); process.exit(1); });
