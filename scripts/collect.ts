/**
 * 국토부 아파트 실거래 증분 수집 스크립트
 * - 전월 + 당월 수집 (뒤늦은 신고 건 반영)
 * - Cloudflare D1 REST API로 UPSERT
 * - GitHub Actions에서 실행: npx tsx scripts/collect.ts
 */

import { XMLParser } from 'fast-xml-parser';

const API_BASE = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const API_KEY = process.env.MOLIT_API_KEY!;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;

const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`;
const DELAY_MS = 80;

const parser = new XMLParser({ ignoreAttributes: false });

// ── 유틸 ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTargetMonths(): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${yyyy}${mm}`);
  }
  return months; // [전월, 당월]
}

// ── Cloudflare D1 ─────────────────────────────────────────────────────────

async function d1Query(sql: string, params: unknown[] = []) {
  const res = await fetch(D1_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json() as { success: boolean; errors?: unknown[]; result?: { meta: { changes: number } }[] };
  if (!json.success) throw new Error(`D1 error: ${JSON.stringify(json.errors)}`);
  return json.result;
}

// ── 지역 코드 조회 ────────────────────────────────────────────────────────

async function getAllSggCodes(): Promise<string[]> {
  const result = await d1Query('SELECT sgg_cd FROM regions ORDER BY sgg_cd');
  const rows = (result as unknown as { results: { sgg_cd: string }[] }[])[0]?.results ?? [];
  return rows.map(r => r.sgg_cd);
}

// ── 국토부 API 호출 ───────────────────────────────────────────────────────

interface TradeItem {
  aptNm?: string;
  aptSeq?: string;
  aptDong?: string;
  sggCd?: string;
  umdNm?: string;
  umdCd?: string;
  roadNm?: string;
  bonbun?: string;
  bubun?: string;
  buildYear?: string | number;
  excluUseAr?: string | number;
  floor?: string | number;
  dealAmount?: string;
  dealYear?: string | number;
  dealMonth?: string | number;
  dealDay?: string | number;
  dealingGbn?: string;
  slerGbn?: string;
  buyerGbn?: string;
  cdealType?: string;
  cdealDay?: string;
  rgstDate?: string;
  landLeasehold?: string;
}

async function fetchTrades(sggCd: string, dealYmd: string): Promise<TradeItem[]> {
  const url = `${API_BASE}?serviceKey=${API_KEY}&LAWD_CD=${sggCd}&DEAL_YMD=${dealYmd}&numOfRows=1000&pageNo=1`;
  const res = await fetch(url);
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = parsed?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// ── 거래 데이터 → UPSERT ──────────────────────────────────────────────────

function parseAmount(val: string | undefined): number {
  if (!val) return 0;
  return parseInt(val.replace(/,/g, '').trim(), 10) || 0;
}

function parseNum(val: string | number | undefined): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

async function upsertTrades(items: TradeItem[], sggCd: string): Promise<number> {
  let count = 0;
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
      const aptSeq = String(item.aptSeq ?? '').trim() || null;

      await d1Query(`
        INSERT INTO apt_trades (
          apt_seq, apt_nm, apt_dong,
          sgg_cd, umd_nm, umd_cd, road_nm, bonbun, bubun,
          build_year, exclu_use_ar, area_group, floor,
          deal_amount, deal_date, dealing_gbn, sler_gbn, buyer_gbn,
          cdeal_type, cdeal_day, rgst_date, land_leasehold
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (apt_seq, deal_date, floor, exclu_use_ar, deal_amount)
        DO UPDATE SET collected_at = datetime('now')
      `, [
        aptSeq,
        String(item.aptNm ?? '').trim(),
        String(item.aptDong ?? '').trim() || null,
        sggCd,
        String(item.umdNm ?? '').trim() || null,
        String(item.umdCd ?? '').trim() || null,
        String(item.roadNm ?? '').trim() || null,
        String(item.bonbun ?? '').trim() || null,
        String(item.bubun ?? '').trim() || null,
        parseNum(item.buildYear),
        excluUseAr,
        areaGroup,
        floor,
        dealAmount,
        dealDate,
        String(item.dealingGbn ?? '').trim() || null,
        String(item.slerGbn ?? '').trim() || null,
        String(item.buyerGbn ?? '').trim() || null,
        String(item.cdealType ?? '').trim() || null,
        String(item.cdealDay ?? '').trim() || null,
        String(item.rgstDate ?? '').trim() || null,
        String(item.landLeasehold ?? '').trim() || null,
      ]);
      count++;
    } catch (e) {
      console.error(`  UPSERT 실패 (${item.aptNm}):`, e);
    }
  }
  return count;
}

// ── 로그 기록 ─────────────────────────────────────────────────────────────

async function writeLog(runType: string, sggCd: string, dealYmd: string, count: number, status: string, errorMsg?: string) {
  await d1Query(
    `INSERT INTO collect_logs (run_type, sgg_cd, deal_ymd, count, status, error_msg) VALUES (?,?,?,?,?,?)`,
    [runType, sggCd, dealYmd, count, status, errorMsg ?? null]
  );
}

// ── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 국토부 실거래 증분 수집 시작 ===');

  const months = getTargetMonths();
  console.log(`대상 월: ${months.join(', ')}`);

  const sggCodes = await getAllSggCodes();
  console.log(`지역 수: ${sggCodes.length}개`);

  let totalCount = 0;
  let errorCount = 0;

  for (const sggCd of sggCodes) {
    for (const dealYmd of months) {
      try {
        const items = await fetchTrades(sggCd, dealYmd);
        if (items.length > 0) {
          const count = await upsertTrades(items, sggCd);
          await writeLog('incremental', sggCd, dealYmd, count, 'success');
          totalCount += count;
          console.log(`  ${sggCd} / ${dealYmd}: ${count}건`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  오류 ${sggCd}/${dealYmd}:`, msg);
        await writeLog('incremental', sggCd, dealYmd, 0, 'error', msg).catch(() => {});
        errorCount++;
      }
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n=== 완료 ===`);
  console.log(`총 수집: ${totalCount}건, 오류: ${errorCount}건`);
}

main().catch(e => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
