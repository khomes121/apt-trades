/**
 * 빌라 좌표 매칭 검증 PoC
 *
 * 검증 1 (자동) — 카카오 좌표 자체 일관성:
 *   같은 단지(mhouse_nm, sgg_cd)의 여러 거래가 비슷한 좌표를 갖는지 확인.
 *   단지명이 같은데 지번이 다른 케이스의 좌표 거리 측정.
 *
 * 검증 2 (자동) — 시군구 경계 합치 여부:
 *   카카오가 반환한 좌표가 해당 sgg_cd 의 BBOX 안에 들어오는지 확인.
 *
 * 검증 3 (수동) — 네이버 좌표 비교:
 *   사용자가 네이버 부동산에서 같은 단지 좌표 표본을 제공하면 출력에 비교 추가.
 *   (네이버 데이터 없으면 검증 1, 2만 출력)
 *
 * - 실행: npx tsx scripts/verify-villa-coords.ts
 */

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;

interface D1Response<T> {
  success: boolean;
  result?: Array<{ results?: T[] }>;
  errors?: unknown[];
}

async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    }
  );
  const json = (await res.json()) as D1Response<T>;
  if (!json.success) throw new Error(`D1 오류: ${JSON.stringify(json.errors)}`);
  return json.result?.[0]?.results ?? [];
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

async function check1_GeocodingCoverage() {
  console.log('\n━━━━━ 검증 1. 지오코딩 커버리지 ━━━━━');
  const rows = await d1Query<{ total: number; with_coord: number; no_jibun: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN lat IS NOT NULL THEN 1 ELSE 0 END) AS with_coord,
            SUM(CASE WHEN jibun IS NULL OR jibun = '' THEN 1 ELSE 0 END) AS no_jibun
     FROM villa_trades`
  );
  const r = rows[0];
  const rate = ((r.with_coord / r.total) * 100).toFixed(1);
  console.log(`  전체 거래: ${r.total}`);
  console.log(`  좌표 매칭: ${r.with_coord} (${rate}%)`);
  console.log(`  지번 없음: ${r.no_jibun}`);
  console.log(`  → ${rate}% 가 50% 이상이면 합격, 90% 이상이면 우수`);
}

async function check2_CoordsInSggBbox() {
  console.log('\n━━━━━ 검증 2. 좌표가 시군구 BBOX 안에 있는지 ━━━━━');
  // 각 sgg_cd 의 거래 좌표 평균과 분산 → 분산 큰 sgg_cd 는 의심
  const rows = await d1Query<{
    sgg_cd: string;
    sgg_nm: string;
    n: number;
    lat_min: number;
    lat_max: number;
    lng_min: number;
    lng_max: number;
  }>(
    `SELECT v.sgg_cd, r.sgg_nm,
            COUNT(*) AS n,
            MIN(v.lat) AS lat_min, MAX(v.lat) AS lat_max,
            MIN(v.lng) AS lng_min, MAX(v.lng) AS lng_max
     FROM villa_trades v
     JOIN regions r ON v.sgg_cd = r.sgg_cd
     WHERE v.lat IS NOT NULL
     GROUP BY v.sgg_cd, r.sgg_nm
     ORDER BY v.sgg_cd`
  );
  console.log(`  sgg_cd | sgg_nm | n | lat범위 | lng범위 | 대각선거리(m)`);
  for (const r of rows) {
    const diag = haversineM(r.lat_min, r.lng_min, r.lat_max, r.lng_max);
    console.log(
      `  ${r.sgg_cd} | ${r.sgg_nm} | ${r.n} | ${r.lat_min.toFixed(4)}~${r.lat_max.toFixed(4)} | ${r.lng_min.toFixed(4)}~${r.lng_max.toFixed(4)} | ${diag}m`
    );
  }
  console.log(`  → 대각선거리 > 30km 면 sgg 경계 넘어 의심 좌표 섞임`);
}

async function check3_SameMhouseConsistency() {
  console.log('\n━━━━━ 검증 3. 같은 단지명 거래의 좌표 일관성 ━━━━━');
  // 동일 (sgg_cd, mhouse_nm) 의 거래들 좌표 분산 → 단지명 매칭의 지번 다양성 확인
  const rows = await d1Query<{
    sgg_cd: string;
    sgg_nm: string;
    mhouse_nm: string;
    n: number;
    lat_min: number;
    lat_max: number;
    lng_min: number;
    lng_max: number;
  }>(
    `SELECT v.sgg_cd, r.sgg_nm, v.mhouse_nm,
            COUNT(*) AS n,
            MIN(v.lat) AS lat_min, MAX(v.lat) AS lat_max,
            MIN(v.lng) AS lng_min, MAX(v.lng) AS lng_max
     FROM villa_trades v
     JOIN regions r ON v.sgg_cd = r.sgg_cd
     WHERE v.lat IS NOT NULL
       AND v.mhouse_nm IS NOT NULL AND v.mhouse_nm != ''
     GROUP BY v.sgg_cd, r.sgg_nm, v.mhouse_nm
     HAVING COUNT(*) >= 3
     ORDER BY n DESC
     LIMIT 30`
  );

  console.log(`  단지명별 거래수 ≥ 3 인 단지 ${rows.length}개 (상위)`);
  let ok = 0, warn = 0, fail = 0;
  for (const r of rows) {
    const diag = haversineM(r.lat_min, r.lng_min, r.lat_max, r.lng_max);
    let mark = '✅';
    if (diag > 200) { mark = '❌'; fail++; }
    else if (diag > 50) { mark = '⚠️'; warn++; }
    else ok++;
    console.log(`  ${mark} ${r.sgg_nm} ${r.mhouse_nm} (n=${r.n}, 분산 ${diag}m)`);
  }
  console.log(`\n  ✅ 50m 이하 ${ok}개 / ⚠️ 50~200m ${warn}개 / ❌ 200m 초과 ${fail}개`);
  console.log(`  → 200m 초과는 단지명 동음이의어 (서로 다른 빌라가 같은 이름) 가능성 큼`);
}

async function check4_SampleAddresses() {
  console.log('\n━━━━━ 검증 4. 샘플 주소 ↔ 좌표 (시각 검수용) ━━━━━');
  const rows = await d1Query<{
    sgg_nm: string;
    umd_nm: string;
    jibun: string;
    mhouse_nm: string;
    lat: number;
    lng: number;
  }>(
    `SELECT r.sgg_nm, v.umd_nm, v.jibun, v.mhouse_nm, v.lat, v.lng
     FROM villa_trades v
     JOIN regions r ON v.sgg_cd = r.sgg_cd
     WHERE v.lat IS NOT NULL AND v.mhouse_nm IS NOT NULL AND v.mhouse_nm != ''
     ORDER BY v.deal_amount DESC
     LIMIT 10`
  );
  for (const r of rows) {
    console.log(
      `  ${r.sgg_nm} ${r.umd_nm} ${r.jibun} (${r.mhouse_nm})\n      → ${r.lat}, ${r.lng}\n      🗺 https://map.kakao.com/link/map/${encodeURIComponent(r.mhouse_nm)},${r.lat},${r.lng}`
    );
  }
  console.log(`  → 위 카카오맵 링크 클릭해서 실제 위치 확인. 이상하면 데이터 의심.`);
}

async function main() {
  console.log('=== 빌라 좌표 매칭 검증 PoC ===');
  if (!CF_API_TOKEN) {
    console.error('❌ CF_API_TOKEN 등 환경변수 필요. .env.local 로드 필요');
    process.exit(1);
  }

  await check1_GeocodingCoverage();
  await check2_CoordsInSggBbox();
  await check3_SameMhouseConsistency();
  await check4_SampleAddresses();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('네이버 부동산 좌표와의 비교는 별도 절차 필요:');
  console.log('1. 네이버 부동산 스크래퍼에서 같은 단지(mhouse_nm + 지번) 좌표 5~10개 추출');
  console.log('2. 추출한 좌표를 이 스크립트의 NAVER_SAMPLES 변수에 입력 후 재실행');
  console.log('   (검증 3 의 ⚠️ ❌ 표시된 단지를 우선 비교 권장)');
}

main().catch(e => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
