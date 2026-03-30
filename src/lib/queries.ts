import type { SearchParams, TradeResult } from '@/types';

export interface QueryResult {
  sql: string;
  params: (string | number | null)[];
}

export function buildSearchQuery(p: SearchParams): QueryResult {
  const params: (string | number | null)[] = [];
  const where: string[] = [];

  // 지역
  if (p.sgg_codes.length === 0) throw new Error('지역을 선택해주세요');
  const placeholders = p.sgg_codes.map(() => '?').join(',');
  where.push(`t.sgg_cd IN (${placeholders})`);
  params.push(...p.sgg_codes);

  // 기간
  where.push('t.deal_date >= ?');
  params.push(p.date_from);
  where.push('t.deal_date <= ?');
  params.push(p.date_to);

  // 가격
  if (p.price_min != null) { where.push('t.deal_amount >= ?'); params.push(p.price_min); }
  if (p.price_max != null) { where.push('t.deal_amount <= ?'); params.push(p.price_max); }

  // 해제거래 제외
  if (p.exclude_cancelled) {
    where.push("(t.cdeal_type IS NULL OR t.cdeal_type != 'Y')");
  }

  // 거래유형
  if (p.dealing_gbn) { where.push('t.dealing_gbn = ?'); params.push(p.dealing_gbn); }

  // 매수자 유형
  if (p.buyer_gbn === '개인') {
    where.push("(t.buyer_gbn IS NULL OR t.buyer_gbn != '법인')");
  } else if (p.buyer_gbn === '법인') {
    where.push("t.buyer_gbn = '법인'");
  }

  // 건축년도
  if (p.build_year_from != null) { where.push('t.build_year >= ?'); params.push(p.build_year_from); }
  if (p.build_year_to != null) { where.push('t.build_year <= ?'); params.push(p.build_year_to); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  // HAVING 조건
  const having: string[] = [];
  having.push(`COUNT(*) >= ?`);
  params.push(p.min_trade_count);

  if (p.diff_amount != null || p.diff_rate != null) {
    const diffConds: string[] = [];
    if (p.diff_amount != null) {
      diffConds.push(`(MAX(t.deal_amount) - MIN(t.deal_amount)) >= ?`);
      params.push(p.diff_amount);
    }
    if (p.diff_rate != null) {
      diffConds.push(`ROUND(CAST(MAX(t.deal_amount) - MIN(t.deal_amount) AS REAL) / MIN(t.deal_amount) * 100, 1) >= ?`);
      params.push(p.diff_rate);
    }
    if (diffConds.length === 2) {
      having.push(`(${diffConds.join(p.diff_operator === 'AND' ? ' AND ' : ' OR ')})`);
    } else {
      having.push(...diffConds);
    }
  }

  const havingClause = `HAVING ${having.join(' AND ')}`;

  const sql = `
    SELECT
      t.apt_nm,
      t.sgg_cd,
      t.umd_nm,
      t.area_group,
      t.build_year,
      COUNT(*) AS trade_count,
      MIN(t.deal_amount) AS min_price,
      MAX(t.deal_amount) AS max_price,
      (MAX(t.deal_amount) - MIN(t.deal_amount)) AS diff_amount,
      ROUND(CAST(MAX(t.deal_amount) - MIN(t.deal_amount) AS REAL) / MIN(t.deal_amount) * 100, 1) AS diff_rate
    FROM apt_trades t
    ${whereClause}
    GROUP BY t.apt_nm, t.sgg_cd, t.umd_nm, t.area_group, t.build_year
    ${havingClause}
    ORDER BY diff_amount DESC
    LIMIT 500
  `.trim();

  return { sql, params };
}

export function formatPrice(won: number): string {
  if (won >= 10000) {
    const uk = Math.floor(won / 10000);
    const remainder = won % 10000;
    return remainder > 0 ? `${uk}억 ${remainder.toLocaleString()}만` : `${uk}억`;
  }
  return `${won.toLocaleString()}만`;
}

export function toTradeResults(rows: Record<string, unknown>[]): TradeResult[] {
  return rows.map(r => ({
    apt_nm: String(r.apt_nm ?? ''),
    sgg_cd: String(r.sgg_cd ?? ''),
    umd_nm: String(r.umd_nm ?? ''),
    area_group: Number(r.area_group ?? 0),
    build_year: r.build_year != null ? Number(r.build_year) : null,
    trade_count: Number(r.trade_count ?? 0),
    min_price: Number(r.min_price ?? 0),
    max_price: Number(r.max_price ?? 0),
    diff_amount: Number(r.diff_amount ?? 0),
    diff_rate: Number(r.diff_rate ?? 0),
  }));
}
