/**
 * 국토부 아파트 실거래 증분 수집 스크립트
 * - 전월 + 당월 수집 (뒤늦은 신고 건 반영)
 * - wrangler d1 execute 방식 (D1 REST API 불필요)
 * - 실행: npx tsx scripts/collect.ts
 * - 특정 월만: COLLECT_YMD=202503 npx tsx scripts/collect.ts
 */

import { XMLParser } from 'fast-xml-parser';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const API_BASE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const API_KEY  = process.env.MOLIT_API_KEY!;
const DB_NAME  = 'apt-trades';
const DELAY_MS = 80;
const NUM_OF_ROWS = 1000; // API 최대값

const parser = new XMLParser({ ignoreAttributes: false });

// ── 유틸 ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTargetMonths(): string[] {
  if (process.env.COLLECT_YMD) return [process.env.COLLECT_YMD];
  const now = new Date();
  const months: string[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months; // [전전월, 전월, 당월]
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

// ── wrangler D1 실행 ──────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === 'win32';
const WRANGLER = IS_WINDOWS
  ? `node "C:\\Users\\HOMES\\AppData\\Local\\npm-cache\\_npx\\32026684e21afda6\\node_modules\\wrangler\\bin\\wrangler.js"`
  : `npx wrangler`;

// wrangler가 JSON 앞뒤에 진행 메시지를 섞어 출력하므로 JSON 부분만 추출
function extractJSON(raw: string): string {
  const start = raw.indexOf('[');
  const end   = raw.lastIndexOf(']');
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1);
  throw new Error(`JSON을 찾을 수 없음: ${raw.slice(0, 200)}`);
}

function executeSQLFile(sql: string): number {
  const tmpFile = join(tmpdir(), `collect_${Date.now()}.sql`);
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

function executeCommand(command: string): string {
  const raw = execSync(
    `${WRANGLER} d1 execute ${DB_NAME} --remote --command="${command}" --json 2>&1`,
    { encoding: 'utf-8' }
  );
  return extractJSON(raw);
}

// ── 지역 코드 조회 ────────────────────────────────────────────────────────

async function getAllSggCodes(): Promise<string[]> {
  const out  = executeCommand('SELECT sgg_cd FROM regions ORDER BY sgg_cd');
  const json = JSON.parse(out);
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
    const res    = await fetch(url);
    const xml    = await res.text();
    const parsed = parser.parse(xml);
    const body   = parsed?.response?.body;
    const raw    = body?.items?.item;

    if (!raw) break;

    const pageItems: TradeItem[] = Array.isArray(raw) ? raw : [raw];
    allItems.push(...pageItems);

    const totalCount = Number(body?.totalCount ?? 0);
    // 더 가져올 게 없으면 종료
    if (allItems.length >= totalCount || pageItems.length < NUM_OF_ROWS) break;

    pageNo++;
    await sleep(DELAY_MS); // 페이지 간 딜레이
  }

  return allItems;
}

// ── 거래 데이터 → UPSERT ──────────────────────────────────────────────────

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

// ── 로그 기록 ─────────────────────────────────────────────────────────────

function writeLog(runType: string, sggCd: string, dealYmd: string, count: number, status: string) {
  try {
    const sql = `INSERT INTO collect_logs (run_type,sgg_cd,deal_ymd,count,status) VALUES ('${runType}','${sggCd}','${dealYmd}',${count},'${status}');`;
    executeSQLFile(sql);
  } catch { /* 로그 실패는 무시 */ }
}

// ── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 국토부 실거래 증분 수집 시작 ===');

  const months   = getTargetMonths();
  console.log(`대상 월: ${months.join(', ')}`);

  const sggCodes = await getAllSggCodes();
  console.log(`지역 수: ${sggCodes.length}개\n`);

  let totalCount = 0;
  let errorCount = 0;
  const failedCombos: string[] = [];

  // 재시도 포함 수집 함수 (최대 3회)
  async function collectWithRetry(sggCd: string, dealYmd: string): Promise<number> {
    const MAX_RETRY = 3;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        const items = await fetchTrades(sggCd, dealYmd);
        if (items.length === 0) return 0;
        const count = executeBatched(items, sggCd);
        writeLog('incremental', sggCd, dealYmd, count, 'success');
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
  }
}

main().catch(e => { console.error('치명적 오류:', e); process.exit(1); });
