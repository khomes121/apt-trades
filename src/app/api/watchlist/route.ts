import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

async function queryD1(sql: string, params: unknown[] = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/d1/database/${process.env.CF_D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    }
  );
  const json = await res.json() as { success: boolean; result?: { results: Record<string, unknown>[] }[] };
  if (!json.success) throw new Error('DB 오류');
  return json.result?.[0]?.results ?? [];
}

// GET: 관심단지 목록 조회
export async function GET() {
  try {
    const rows = await queryD1(`
      SELECT w.*, r.sgg_nm
      FROM watchlist w
      LEFT JOIN regions r ON w.sgg_cd = r.sgg_cd
      ORDER BY w.added_at DESC
    `);
    return NextResponse.json({ watchlist: rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST: 관심단지 추가
export async function POST(req: NextRequest) {
  try {
    const { apt_nm, sgg_cd, umd_nm, complex_no, criteria } = await req.json();
    await queryD1(
      `INSERT INTO watchlist (apt_nm, sgg_cd, umd_nm, complex_no, criteria)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(apt_nm, sgg_cd) DO UPDATE SET
         umd_nm     = excluded.umd_nm,
         complex_no = COALESCE(excluded.complex_no, complex_no),
         criteria   = COALESCE(excluded.criteria, criteria)`,
      [apt_nm, sgg_cd, umd_nm ?? null, complex_no ?? null, criteria ? JSON.stringify(criteria) : null]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE: 관심단지 삭제
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await queryD1(`DELETE FROM watchlist WHERE id = ?`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PATCH: complexNo / criteria 업데이트
export async function PATCH(req: NextRequest) {
  try {
    const { id, complex_no, criteria } = await req.json();
    await queryD1(
      `UPDATE watchlist SET complex_no = ?, criteria = ? WHERE id = ?`,
      [complex_no ?? null, criteria ? JSON.stringify(criteria) : null, id]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
