/**
 * 빌라 좌표 매칭 PoC: 네이버 vs 카카오
 *
 * 가설: 우리 (apt-trades) 가 카카오 지오코딩으로 만든 좌표가
 *       네이버 부동산이 보유한 좌표와 충분히 가까운가?
 *       그래야 nearby 매칭이 의미가 있다.
 *
 * 데이터 소스:
 * - 우리: D1 의 villa_trades (lat, lng 채워진 행)
 * - 네이버: C:/_클로드/네이버 부동산 스크래퍼/web/data/villa-results.json (read-only)
 *   → SSoT 원칙: 네이버 데이터는 절대 write 안 함, 분석만.
 *
 * 측정: 우리 거래 좌표마다 같은 sgg_cd 의 네이버 매물 중 최단거리 찾기.
 *      분포(10m / 50m / 100m / 200m / 500m / >500m)로 매칭 가능성 평가.
 */

import { readFileSync } from 'fs';

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;

const NAVER_VILLA_PATH = 'C:/_클로드/네이버 부동산 스크래퍼/web/data/villa-results.json';

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

// ── 네이버 데이터 로드 ────────────────────────────────────────────────────

interface NaverArticle {
  articleNo: string;
  buildingName?: string;
  latitude?: string;
  longitude?: string;
  exclusiveArea?: number;
  floorInfo?: string;
}

interface NaverDong {
  cortarNo: string; // 10자리: sgg_cd(5) + umd 코드(5)
  sgu: string;
  dong: string;
  articles: NaverArticle[];
}

interface NaverVillaFile {
  scannedAt: string;
  region: string;
  dongs: NaverDong[];
}

interface NaverPoint {
  sgg_cd: string;     // cortarNo 앞 5자리
  umd_nm: string;
  lat: number;
  lng: number;
  buildingName: string;
  articleNo: string;
}

function loadNaverPoints(): NaverPoint[] {
  const raw = readFileSync(NAVER_VILLA_PATH, 'utf-8');
  const data = JSON.parse(raw) as NaverVillaFile;
  const points: NaverPoint[] = [];
  for (const dong of data.dongs ?? []) {
    const sgg_cd = (dong.cortarNo ?? '').slice(0, 5);
    if (!sgg_cd) continue;
    for (const a of dong.articles ?? []) {
      const lat = parseFloat(a.latitude ?? '');
      const lng = parseFloat(a.longitude ?? '');
      if (!isFinite(lat) || !isFinite(lng) || lat === 0 || lng === 0) continue;
      points.push({
        sgg_cd,
        umd_nm: dong.dong,
        lat,
        lng,
        buildingName: a.buildingName ?? '',
        articleNo: a.articleNo,
      });
    }
  }
  return points;
}

// ── 우리 카카오 좌표 ──────────────────────────────────────────────────────

interface KakaoPoint {
  sgg_cd: string;
  umd_nm: string;
  jibun: string;
  mhouse_nm: string | null;
  lat: number;
  lng: number;
}

async function loadKakaoPoints(): Promise<KakaoPoint[]> {
  return await d1Query<KakaoPoint>(
    `SELECT DISTINCT sgg_cd, umd_nm, jibun, mhouse_nm, lat, lng
     FROM villa_trades
     WHERE lat IS NOT NULL`
  );
}

// ── 메인 비교 ──────────────────────────────────────────────────────────────

interface CompareResult {
  k: KakaoPoint;
  nearestDist: number;
  nearestNaver: NaverPoint | null;
}

function nearestForEach(kakaoPoints: KakaoPoint[], naverPoints: NaverPoint[]): CompareResult[] {
  // sgg_cd 별 인덱스로 빠르게
  const naverBySgg = new Map<string, NaverPoint[]>();
  for (const n of naverPoints) {
    if (!naverBySgg.has(n.sgg_cd)) naverBySgg.set(n.sgg_cd, []);
    naverBySgg.get(n.sgg_cd)!.push(n);
  }

  const out: CompareResult[] = [];
  for (const k of kakaoPoints) {
    const candidates = naverBySgg.get(k.sgg_cd) ?? [];
    let best = Infinity;
    let bestN: NaverPoint | null = null;
    for (const n of candidates) {
      const d = haversineM(k.lat, k.lng, n.lat, n.lng);
      if (d < best) { best = d; bestN = n; }
    }
    out.push({ k, nearestDist: best === Infinity ? -1 : best, nearestNaver: bestN });
  }
  return out;
}

function distribution(results: CompareResult[]) {
  const buckets = { '<=10m': 0, '10-50m': 0, '50-100m': 0, '100-200m': 0, '200-500m': 0, '500m-1km': 0, '1km+': 0, 'no_naver': 0 };
  for (const r of results) {
    if (r.nearestDist < 0) buckets['no_naver']++;
    else if (r.nearestDist <= 10) buckets['<=10m']++;
    else if (r.nearestDist <= 50) buckets['10-50m']++;
    else if (r.nearestDist <= 100) buckets['50-100m']++;
    else if (r.nearestDist <= 200) buckets['100-200m']++;
    else if (r.nearestDist <= 500) buckets['200-500m']++;
    else if (r.nearestDist <= 1000) buckets['500m-1km']++;
    else buckets['1km+']++;
  }
  return buckets;
}

async function main() {
  console.log('=== 빌라 좌표 매칭 PoC: 네이버 vs 카카오 ===\n');

  console.log('네이버 villa-results.json 로드...');
  const naver = loadNaverPoints();
  console.log(`  네이버 매물 좌표: ${naver.length}건 (sgg_cd ${new Set(naver.map(n => n.sgg_cd)).size}개)`);

  console.log('우리 카카오 좌표 로드...');
  const kakao = await loadKakaoPoints();
  console.log(`  카카오 좌표 매핑된 거래: ${kakao.length}건`);

  if (kakao.length === 0) {
    console.error('\n❌ villa_trades 에 좌표 채워진 행 없음. 지오코딩 먼저 실행.');
    process.exit(1);
  }

  console.log('\n각 카카오 좌표마다 같은 sgg_cd 안의 네이버 최근접 매물 찾는 중...');
  const cmp = nearestForEach(kakao, naver);

  const dist = distribution(cmp);
  const total = cmp.length;
  console.log('\n━━━━━ 거리 분포 ━━━━━');
  for (const [band, n] of Object.entries(dist)) {
    const pct = ((n / total) * 100).toFixed(1);
    console.log(`  ${band.padEnd(12)} ${String(n).padStart(5)} (${pct}%)`);
  }

  // 통계
  const valid = cmp.filter(r => r.nearestDist >= 0);
  const sorted = valid.map(r => r.nearestDist).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const mean = Math.round(sorted.reduce((s, x) => s + x, 0) / sorted.length);

  console.log('\n━━━━━ 통계 ━━━━━');
  console.log(`  유효 비교 ${valid.length} / 전체 ${total}`);
  console.log(`  평균 ${mean}m  ·  중앙값 ${median}m  ·  P25 ${p25}m  ·  P75 ${p75}m`);

  // 50m 이내 비율 = "매칭 잘 됨" 지표
  const within50 = valid.filter(r => r.nearestDist <= 50).length;
  const within100 = valid.filter(r => r.nearestDist <= 100).length;
  console.log(`  50m 이내 매칭률: ${((within50 / valid.length) * 100).toFixed(1)}%`);
  console.log(`  100m 이내 매칭률: ${((within100 / valid.length) * 100).toFixed(1)}%`);

  // 가까운 케이스 샘플 5건
  console.log('\n━━━━━ 매칭 양호 샘플 (5건) ━━━━━');
  const closest = valid.slice().sort((a, b) => a.nearestDist - b.nearestDist).slice(0, 5);
  for (const r of closest) {
    console.log(
      `  ${r.nearestDist}m  ${r.k.sgg_cd} ${r.k.umd_nm} ${r.k.jibun} (${r.k.mhouse_nm ?? '?'}) ↔ 네이버 ${r.nearestNaver?.buildingName ?? '?'} (${r.nearestNaver?.articleNo})`
    );
  }

  // 먼 케이스 5건
  console.log('\n━━━━━ 매칭 우려 샘플 (5건) ━━━━━');
  const farthest = valid.slice().sort((a, b) => b.nearestDist - a.nearestDist).slice(0, 5);
  for (const r of farthest) {
    console.log(
      `  ${r.nearestDist}m  ${r.k.sgg_cd} ${r.k.umd_nm} ${r.k.jibun} (${r.k.mhouse_nm ?? '?'}) ↔ 가장 가까운 네이버 ${r.nearestNaver?.articleNo ?? '없음'}`
    );
  }

  console.log('\n━━━━━ 해석 가이드 ━━━━━');
  console.log('  • 50m 이내 매칭률 ≥ 70% : 두 좌표 시스템 매우 잘 맞음. nearby 검색 의미 있음.');
  console.log('  • 50m 이내 매칭률 30~70% : 부분 일치. radius 200m 이상으로 검색해야 안전.');
  console.log('  • 50m 이내 매칭률 < 30% : 좌표 체계 어긋남. 다른 매칭 키 필요 (단지명 등)');
  console.log('  • 일부 카카오 좌표는 동일 빌라 매물이 네이버에 없을 수도 (매물 화면에 안 올라온 경우). 이건 좌표 문제 아님.');
}

main().catch(e => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
