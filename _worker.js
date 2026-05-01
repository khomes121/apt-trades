/**
 * Cloudflare Pages _worker.js
 * Handles /api/regions and /api/search using D1 binding directly.
 * All other requests are served as static assets.
 */

function buildSearchQuery(p) {
  const params = [];
  const where = [];

  if ((!p.sgg_codes || p.sgg_codes.length === 0) && !p.apt_nm?.trim()) {
    throw new Error('지역을 선택하거나 단지명을 입력해주세요');
  }
  if (p.sgg_codes && p.sgg_codes.length > 0) {
    const placeholders = p.sgg_codes.map(() => '?').join(',');
    where.push(`t.sgg_cd IN (${placeholders})`);
    params.push(...p.sgg_codes);
  }

  where.push('t.deal_date >= ?');
  params.push(p.date_from);
  where.push('t.deal_date <= ?');
  params.push(p.date_to);

  if (p.price_min != null) { where.push('t.deal_amount >= ?'); params.push(p.price_min); }
  if (p.price_max != null) { where.push('t.deal_amount <= ?'); params.push(p.price_max); }

  if (p.apt_nm && p.apt_nm.trim()) {
    // 공백으로 토큰 분리 → 각 토큰을 apt_nm OR umd_nm 에서 AND 매칭
    // 예: "신평 현대" → 신평(동명) AND 현대(단지명) 동시 검색
    const tokens = p.apt_nm.trim().split(/\s+/).filter(t => t.length > 0);
    for (const token of tokens) {
      where.push("(t.apt_nm LIKE ? OR t.umd_nm LIKE ?)");
      params.push(`%${token}%`, `%${token}%`);
    }
  }

  if (p.exclude_cancelled) {
    where.push("(t.cdeal_type IS NULL OR t.cdeal_type != 'Y')");
  }

  if (p.exclude_direct) {
    where.push("(t.dealing_gbn IS NULL OR t.dealing_gbn != '직거래')");
  }

  if (p.dealing_gbn) { where.push('t.dealing_gbn = ?'); params.push(p.dealing_gbn); }

  if (p.buyer_gbn === '개인') {
    where.push("(t.buyer_gbn IS NULL OR t.buyer_gbn != '법인')");
  } else if (p.buyer_gbn === '법인') {
    where.push("t.buyer_gbn = '법인'");
  }

  if (p.build_year_from != null) { where.push('t.build_year >= ?'); params.push(p.build_year_from); }
  if (p.build_year_to != null) { where.push('t.build_year <= ?'); params.push(p.build_year_to); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const having = [];
  having.push('COUNT(*) >= ?');
  params.push(p.min_trade_count ?? 1);

  if (p.diff_amount != null || p.diff_rate != null) {
    const diffConds = [];
    if (p.diff_amount != null) {
      diffConds.push('(MAX(t.deal_amount) - MIN(t.deal_amount)) >= ?');
      params.push(p.diff_amount);
    }
    if (p.diff_rate != null) {
      diffConds.push('ROUND(CAST(MAX(t.deal_amount) - MIN(t.deal_amount) AS REAL) / MIN(t.deal_amount) * 100, 1) >= ?');
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
      ROUND(t.area_group / 5.0) * 5 AS area_group,
      t.build_year,
      COUNT(*) AS trade_count,
      MIN(t.deal_amount) AS min_price,
      MAX(t.deal_amount) AS max_price,
      (MAX(t.deal_amount) - MIN(t.deal_amount)) AS diff_amount,
      ROUND(CAST(MAX(t.deal_amount) - MIN(t.deal_amount) AS REAL) / MIN(t.deal_amount) * 100, 1) AS diff_rate
    FROM apt_trades t
    ${whereClause}
    GROUP BY t.apt_nm, t.sgg_cd, t.umd_nm, ROUND(t.area_group / 5.0) * 5, t.build_year
    ${havingClause}
    ORDER BY diff_amount DESC
    LIMIT 500
  `.trim();

  return { sql, params };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/regions') {
      try {
        const { results } = await env.DB.prepare(
          'SELECT sgg_cd, sido_nm, sido_cd, sgg_nm FROM regions ORDER BY sido_cd, sgg_cd'
        ).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/search' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { sql, params } = buildSearchQuery(body);
        const { results } = await env.DB.prepare(sql).bind(...params).all();
        return new Response(JSON.stringify({ results, count: results.length }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/trades' && request.method === 'POST') {
      try {
        const { apt_nm, sgg_cd } = await request.json();
        const { results } = await env.DB.prepare(
          `SELECT deal_date, deal_amount, floor, area_group, exclu_use_ar, apt_dong,
                  ROUND(area_group / 3.305785) AS pyeong,
                  dealing_gbn, cdeal_type
           FROM apt_trades
           WHERE apt_nm = ? AND sgg_cd = ?
             AND (cdeal_type IS NULL OR cdeal_type != 'Y')
           ORDER BY deal_date, area_group`
        ).bind(apt_nm, sgg_cd).all();
        return new Response(JSON.stringify({ results }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
      }
    }

    // ── 지역 동향: 구/군 단위 월별 통계 ──────────────────────────────────
    if (url.pathname === '/api/trend/sgg' && request.method === 'POST') {
      try {
        const { sgg_codes, months = 6 } = await request.json();

        // 최근 months+1개월치 데이터 조회 (비교 계산을 위해 +1)
        const now = new Date();
        const ymList = [];
        for (let i = months; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          ymList.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        const ymMin = ymList[0];
        const ymMax = ymList[ymList.length - 1];

        let sql = `
          SELECT s.sgg_cd, r.sido_nm, r.sgg_nm, s.ym, s.avg_m2_price, s.trade_count
          FROM sgg_monthly_stats s
          JOIN regions r ON s.sgg_cd = r.sgg_cd
          WHERE s.ym >= ? AND s.ym <= ?
        `;
        const params = [ymMin, ymMax];

        if (sgg_codes && sgg_codes.length > 0) {
          sql += ` AND s.sgg_cd IN (${sgg_codes.map(() => '?').join(',')})`;
          params.push(...sgg_codes);
        }
        sql += ' ORDER BY s.sgg_cd, s.ym';

        const { results } = await env.DB.prepare(sql).bind(...params).all();
        return new Response(JSON.stringify({ results }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
      }
    }

    // ── 지역 동향: 동 단위 월별 통계 (드릴다운) ──────────────────────────
    if (url.pathname === '/api/trend/umd' && request.method === 'POST') {
      try {
        const { sgg_cd, months = 6 } = await request.json();
        if (!sgg_cd) throw new Error('sgg_cd 필요');

        const now = new Date();
        const ymList = [];
        for (let i = months; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          ymList.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
        }

        const { results } = await env.DB.prepare(`
          SELECT umd_nm, ym, avg_m2_price, trade_count
          FROM umd_monthly_stats
          WHERE sgg_cd = ? AND ym >= ? AND ym <= ?
          ORDER BY umd_nm, ym
        `).bind(sgg_cd, ymList[0], ymList[ymList.length - 1]).all();

        return new Response(JSON.stringify({ results }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
      }
    }

    // ── 빌라(연립다세대) 검색 ──────────────────────────────────────────
    if (url.pathname === '/api/villa/search' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { sgg_codes, date_from, date_to, exclude_cancelled = true, exclude_direct = false,
                house_type, q, price_min, price_max,
                build_year_from, build_year_to,
                area_min, area_max, limit = 500 } = body || {};

        const where = [];
        const params = [];

        if (sgg_codes && sgg_codes.length > 0) {
          where.push(`v.sgg_cd IN (${sgg_codes.map(() => '?').join(',')})`);
          params.push(...sgg_codes);
        }
        if (date_from) { where.push('v.deal_date >= ?'); params.push(date_from); }
        if (date_to)   { where.push('v.deal_date <= ?'); params.push(date_to); }
        if (price_min != null) { where.push('v.deal_amount >= ?'); params.push(price_min); }
        if (price_max != null) { where.push('v.deal_amount <= ?'); params.push(price_max); }
        if (build_year_from != null) { where.push('v.build_year >= ?'); params.push(build_year_from); }
        if (build_year_to   != null) { where.push('v.build_year <= ?'); params.push(build_year_to); }
        if (area_min != null) { where.push('v.exclu_use_ar >= ?'); params.push(area_min); }
        if (area_max != null) { where.push('v.exclu_use_ar <= ?'); params.push(area_max); }
        if (exclude_cancelled) where.push("(v.cdeal_type IS NULL OR v.cdeal_type != 'Y')");
        if (exclude_direct)    where.push("(v.dealing_gbn IS NULL OR v.dealing_gbn != '직거래')");
        if (house_type === '연립' || house_type === '다세대') {
          where.push('v.house_type = ?'); params.push(house_type);
        }
        if (q && q.trim()) {
          const tokens = q.trim().split(/\s+/).filter(t => t.length > 0);
          for (const t of tokens) {
            where.push('(v.mhouse_nm LIKE ? OR v.umd_nm LIKE ? OR v.jibun LIKE ?)');
            params.push(`%${t}%`, `%${t}%`, `%${t}%`);
          }
        }
        if ((!sgg_codes || sgg_codes.length === 0) && !(q && q.trim())) {
          throw new Error('지역을 선택하거나 검색어를 입력해주세요');
        }

        const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
        const lim = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 2000);

        const sql = `
          SELECT v.id, v.mhouse_nm, v.sgg_cd, r.sgg_nm, r.sido_nm,
                 v.umd_nm, v.jibun, v.house_type,
                 v.build_year, v.exclu_use_ar, v.land_ar, v.floor,
                 v.deal_amount, v.deal_date,
                 v.dealing_gbn, v.cdeal_type,
                 v.lat, v.lng
          FROM villa_trades v
          LEFT JOIN regions r ON v.sgg_cd = r.sgg_cd
          ${whereClause}
          ORDER BY v.deal_date DESC, v.deal_amount DESC
          LIMIT ${lim}
        `;
        const { results } = await env.DB.prepare(sql).bind(...params).all();
        return new Response(JSON.stringify({ results, count: results.length }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
      }
    }

    // ── 빌라 좌표 기반 인근 검색 (외부 시스템용 read-only) ─────────────
    if (url.pathname === '/api/villa/nearby' && request.method === 'GET') {
      try {
        const lat = parseFloat(url.searchParams.get('lat') || '');
        const lng = parseFloat(url.searchParams.get('lng') || '');
        const radius_m = Math.min(Math.max(parseInt(url.searchParams.get('radius_m') || '200', 10), 10), 2000);
        const months   = Math.min(Math.max(parseInt(url.searchParams.get('months')   || '12', 10), 1), 60);
        if (!isFinite(lat) || !isFinite(lng)) throw new Error('lat, lng 필요');

        // BBOX 1차 필터 (위도 1° ≈ 111km, 경도 1° ≈ 88.8km @ 한국)
        const dLat = radius_m / 111000;
        const dLng = radius_m / 88800;
        const latMin = lat - dLat, latMax = lat + dLat;
        const lngMin = lng - dLng, lngMax = lng + dLng;

        const dateFrom = (() => {
          const d = new Date(); d.setMonth(d.getMonth() - months);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })();

        const sql = `
          SELECT v.mhouse_nm, v.jibun, v.sgg_cd, r.sgg_nm, v.umd_nm,
                 v.lat, v.lng, v.deal_amount, v.deal_date,
                 v.exclu_use_ar, v.floor, v.build_year, v.house_type,
                 v.dealing_gbn, v.cdeal_type
          FROM villa_trades v
          LEFT JOIN regions r ON v.sgg_cd = r.sgg_cd
          WHERE v.lat BETWEEN ? AND ?
            AND v.lng BETWEEN ? AND ?
            AND v.deal_date >= ?
            AND (v.cdeal_type IS NULL OR v.cdeal_type != 'Y')
          LIMIT 2000
        `;
        const { results } = await env.DB.prepare(sql)
          .bind(latMin, latMax, lngMin, lngMax, dateFrom).all();

        // Haversine 후처리
        const R = 6371000;
        const toRad = d => d * Math.PI / 180;
        const trades = [];
        for (const r of results) {
          const dLatR = toRad(r.lat - lat);
          const dLngR = toRad(r.lng - lng);
          const a = Math.sin(dLatR/2)**2 +
                    Math.cos(toRad(lat)) * Math.cos(toRad(r.lat)) *
                    Math.sin(dLngR/2)**2;
          const distance_m = Math.round(2 * R * Math.asin(Math.sqrt(a)));
          if (distance_m <= radius_m) {
            trades.push({ ...r, distance_m });
          }
        }
        trades.sort((a, b) => a.distance_m - b.distance_m);
        return new Response(JSON.stringify({ count: trades.length, trades }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
      }
    }

    // Serve static assets
    return env.ASSETS.fetch(request);
  },
};
