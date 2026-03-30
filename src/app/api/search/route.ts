import { NextRequest, NextResponse } from 'next/server';
import { buildSearchQuery, toTradeResults } from '@/lib/queries';
import type { SearchParams } from '@/types';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as SearchParams;
    const { sql, params } = buildSearchQuery(body);

    const accountId = process.env.CF_ACCOUNT_ID!;
    const dbId = process.env.CF_D1_DATABASE_ID!;
    const token = process.env.CF_API_TOKEN!;

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
      }
    );

    const json = await res.json() as { success: boolean; result?: { results: Record<string, unknown>[] }[]; errors?: unknown[] };
    if (!json.success) {
      return NextResponse.json({ error: 'DB 조회 실패', detail: json.errors }, { status: 500 });
    }

    const rows = json.result?.[0]?.results ?? [];
    const results = toTradeResults(rows);
    return NextResponse.json({ results, count: results.length });

  } catch (e) {
    const msg = e instanceof Error ? e.message : '알 수 없는 오류';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
