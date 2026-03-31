import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

async function queryD1(sql: string, params: unknown[] = []) {
  const accountId = process.env.CF_ACCOUNT_ID!;
  const dbId      = process.env.CF_D1_DATABASE_ID!;
  const token     = process.env.CF_API_TOKEN!;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    }
  );
  const json = await res.json() as { success: boolean; result?: { results: Record<string, unknown>[] }[] };
  if (!json.success) throw new Error('DB 조회 실패');
  return json.result?.[0]?.results ?? [];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date'); // YYYY-MM-DD

    if (!date) {
      // 날짜 미지정 시 가장 최근 거래일 반환
      const rows = await queryD1(
        `SELECT deal_date FROM apt_trades ORDER BY deal_date DESC LIMIT 1`
      );
      const latestDate = rows[0]?.deal_date as string ?? null;
      return NextResponse.json({ latestDate });
    }

    // 지역별 요약 (구/군 단위)
    const summary = await queryD1(
      `SELECT
         t.sgg_cd,
         r.sgg_nm,
         COUNT(*) as trade_count,
         ROUND(AVG(t.deal_amount) / 10000.0, 1) as avg_eok,
         ROUND(MIN(t.deal_amount) / 10000.0, 1) as min_eok,
         ROUND(MAX(t.deal_amount) / 10000.0, 1) as max_eok
       FROM apt_trades t
       LEFT JOIN regions r ON t.sgg_cd = r.sgg_cd
       WHERE t.deal_date = ?
       GROUP BY t.sgg_cd, r.sgg_nm
       ORDER BY trade_count DESC`,
      [date]
    );

    // 거래 목록
    const trades = await queryD1(
      `SELECT
         t.apt_nm, t.apt_dong, t.umd_nm,
         t.sgg_cd, r.sgg_nm,
         t.exclu_use_ar, t.area_group,
         t.floor, t.deal_amount,
         t.dealing_gbn, t.build_year
       FROM apt_trades t
       LEFT JOIN regions r ON t.sgg_cd = r.sgg_cd
       WHERE t.deal_date = ?
       ORDER BY t.deal_amount DESC`,
      [date]
    );

    return NextResponse.json({ date, summary, trades, total: trades.length });

  } catch (e) {
    const msg = e instanceof Error ? e.message : '알 수 없는 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
