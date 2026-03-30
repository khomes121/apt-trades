import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
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
      body: JSON.stringify({ sql: 'SELECT sgg_cd, sido_nm, sido_cd, sgg_nm FROM regions ORDER BY sido_cd, sgg_cd' }),
    }
  );

  const json = await res.json() as { success: boolean; result?: { results: unknown[] }[] };
  if (!json.success) {
    return NextResponse.json({ error: 'DB 조회 실패' }, { status: 500 });
  }

  const rows = json.result?.[0]?.results ?? [];
  return NextResponse.json(rows);
}
