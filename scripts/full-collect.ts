/**
 * 최초 풀 수집 스크립트 (1회만 실행)
 * - 전국 × 과거 2년치 수집
 * - 로컬에서 직접 실행: npx tsx scripts/full-collect.ts
 * - 환경변수: .env.local 에 설정
 */

import { XMLParser } from 'fast-xml-parser';

const API_BASE = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const API_KEY = process.env.MOLIT_API_KEY!;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;

const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`;
const DELAY_MS = 100;

const parser = new XMLParser({ ignoreAttributes: false });

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 과거 N개월치 YYYYMM 목록 생성
function getPastMonths(months: number): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = months; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    result.push(`${yyyy}${mm}`);
  }
  return result;
}

async function d1Query(sql: string, params: unknown[] = []) {
  const res = await fetch(D1_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json() as { success: boolean; errors?: unknown[] };
  if (!json.success) throw new Error(`D1 error: ${JSON.stringify(json.errors)}`);
  return json;
}

async function getAllSggCodes(): Promise<string[]> {
  const result = await d1Query('SELECT sgg_cd FROM regions ORDER BY sgg_cd') as unknown as { result: { results: { sgg_cd: string }[] }[] };
  return result.result[0]?.results.map((r: { sgg_cd: string }) => r.sgg_cd) ?? [];
}

async function fetchTrades(sggCd: string, dealYmd: string) {
  const url = `${API_BASE}?serviceKey=${API_KEY}&LAWD_CD=${sggCd}&DEAL_YMD=${dealYmd}&numOfRows=1000&pageNo=1`;
  const res = await fetch(url);
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = parsed?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertTrades(items: any[], sggCd: string): Promise<number> {
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
        parseNum(item.floor),
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

async function main() {
  console.log('=== 최초 풀 수집 시작 (전국 × 과거 24개월) ===');
  console.log('※ 약 6,000회 API 호출, 완료까지 10~20분 소요됩니다\n');

  const months = getPastMonths(24);
  const sggCodes = await getAllSggCodes();
  console.log(`지역: ${sggCodes.length}개 × 월: ${months.length}개 = ${sggCodes.length * months.length}회 호출\n`);

  let totalCount = 0;
  let callCount = 0;

  for (const sggCd of sggCodes) {
    for (const dealYmd of months) {
      callCount++;
      try {
        const items = await fetchTrades(sggCd, dealYmd);
        if (items.length > 0) {
          const count = await upsertTrades(items, sggCd);
          totalCount += count;
          if (count > 0) process.stdout.write(`[${callCount}] ${sggCd}/${dealYmd}: ${count}건\n`);
        } else {
          process.stdout.write('.');
        }
      } catch (e) {
        console.error(`\n오류 ${sggCd}/${dealYmd}:`, e);
      }
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n\n=== 풀 수집 완료 ===`);
  console.log(`총 수집: ${totalCount}건`);
}

main().catch(e => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
