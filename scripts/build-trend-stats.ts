/**
 * 지역 동향 집계 테이블 빌드 스크립트
 * - sgg_monthly_stats: 구/군 단위 월별 평균 ㎡당 단가
 * - umd_monthly_stats: 동 단위 월별 평균 ㎡당 단가
 *
 * 실행 (기본 = 따라잡기): npx tsx scripts/build-trend-stats.ts
 *   → 통계가 멈춘 달부터 이번 달까지 다시 계산한다. 최소 최근 3개월은 항상 포함(신고 지연분 반영).
 *   → 매일 새벽 collect-daily.yml 이 수집 뒤에 이걸 돌린다. (2026-09: 자동 실행이 없어 3월에서 멈춰 있었다)
 * 특정 월만:  REBUILD_YM=202603 npx tsx scripts/build-trend-stats.ts
 * 전체 재계산: REBUILD_ALL=1 npx tsx scripts/build-trend-stats.ts
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const WRANGLER = process.platform === 'win32'
  ? `node "C:\\Users\\HOMES\\AppData\\Local\\npm-cache\\_npx\\32026684e21afda6\\node_modules\\wrangler\\bin\\wrangler.js"`
  : `npx wrangler`;
const EXEC_TIMEOUT_MS = 300_000;
const DB_NAME  = 'apt-trades';

function extractJSON(raw: string): string {
  const start = raw.indexOf('[');
  const end   = raw.lastIndexOf(']');
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1);
  throw new Error(`JSON을 찾을 수 없음: ${raw.slice(0, 300)}`);
}

function executeSQLFile(sql: string): void {
  const tmpFile = join(tmpdir(), `trend_${Date.now()}.sql`);
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    const raw = execSync(
      `${WRANGLER} d1 execute ${DB_NAME} --remote --file="${tmpFile}" --json 2>&1`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: EXEC_TIMEOUT_MS }
    );
    const json = JSON.parse(extractJSON(raw));
    const changes = json[0]?.meta?.changes ?? 0;
    console.log(`  → ${changes}건 반영`);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? String(e);
    throw new Error(`wrangler 오류: ${msg.slice(0, 300)}`);
  } finally {
    unlinkSync(tmpFile);
  }
}

function executeCommand(cmd: string): unknown[] {
  const raw  = execSync(
    `${WRANGLER} d1 execute ${DB_NAME} --remote --command="${cmd}" --json 2>&1`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: EXEC_TIMEOUT_MS }
  );
  const json = JSON.parse(extractJSON(raw));
  return json[0]?.results ?? [];
}

// 특정 월(들)의 집계 재계산
function rebuildMonths(yms: string[]): void {
  for (const ym of yms) {
    const year  = ym.slice(0, 4);
    const month = ym.slice(4, 6);
    // LIKE 'YYYY-MM-%' 는 인덱스를 못 타서 달마다 테이블 전체(수백만 행)를 훑는다 → 날짜 범위로 바꿔 deal_date 인덱스를 탄다
    const dateFrom = `${year}-${month}-01`;
    const next     = new Date(Date.UTC(Number(year), Number(month), 1));
    const dateTo   = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;

    console.log(`\n[${ym}] 집계 계산 중...`);

    // sgg 단위
    console.log('  sgg_monthly_stats...');
    executeSQLFile(`
INSERT OR REPLACE INTO sgg_monthly_stats (sgg_cd, ym, avg_m2_price, trade_count, updated_at)
SELECT
  sgg_cd,
  '${ym}' AS ym,
  ROUND(AVG(CAST(deal_amount AS REAL) / area_group), 4) AS avg_m2_price,
  COUNT(*) AS trade_count,
  datetime('now') AS updated_at
FROM apt_trades
WHERE deal_date >= '${dateFrom}' AND deal_date < '${dateTo}'
  AND area_group > 0
  AND deal_amount > 0
  AND (cdeal_type IS NULL OR cdeal_type <> 'Y')
GROUP BY sgg_cd;
    `.trim());

    // umd 단위
    console.log('  umd_monthly_stats...');
    executeSQLFile(`
INSERT OR REPLACE INTO umd_monthly_stats (sgg_cd, umd_nm, ym, avg_m2_price, trade_count, updated_at)
SELECT
  sgg_cd,
  umd_nm,
  '${ym}' AS ym,
  ROUND(AVG(CAST(deal_amount AS REAL) / area_group), 4) AS avg_m2_price,
  COUNT(*) AS trade_count,
  datetime('now') AS updated_at
FROM apt_trades
WHERE deal_date >= '${dateFrom}' AND deal_date < '${dateTo}'
  AND area_group > 0
  AND deal_amount > 0
  AND (cdeal_type IS NULL OR cdeal_type <> 'Y')
GROUP BY sgg_cd, umd_nm;
    `.trim());
  }
}

// 전체 월 목록 조회
function getAllMonths(): string[] {
  const rows = executeCommand(
    "SELECT DISTINCT REPLACE(SUBSTR(deal_date,1,7),'-','') AS ym FROM apt_trades WHERE area_group > 0 ORDER BY ym"
  ) as { ym: string }[];
  return rows.map(r => r.ym);
}

// ── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  const rebuildYm = process.env.REBUILD_YM;

  let targetMonths: string[];

  if (rebuildYm) {
    // 특정 월만
    targetMonths = [rebuildYm];
    console.log(`특정 월 재계산: ${rebuildYm}`);
  } else if (!process.env.REBUILD_ALL) {
    // 따라잡기: 통계가 멈춘 달 ~ 이번 달 (최소 최근 3개월)
    const now = new Date(Date.now() + 9 * 3600e3); // KST
    const ymOf = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const floor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    const last  = (executeCommand('SELECT MAX(ym) AS ym FROM sgg_monthly_stats') as { ym: string | null }[])[0]?.ym;
    let start = floor;
    if (last && last < ymOf(floor)) start = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(4, 6)) - 1, 1));
    targetMonths = [];
    for (let d = start; ymOf(d) <= ymOf(now); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      targetMonths.push(ymOf(d));
    }
    console.log(`따라잡기: ${targetMonths[0]} ~ ${targetMonths[targetMonths.length - 1]} (${targetMonths.length}개월, 기존 마지막 ${last ?? '없음'})`);
  } else {
    // 전체 월 목록 조회 후 전부 계산
    console.log('전체 월 목록 조회 중...');
    targetMonths = getAllMonths();
    console.log(`총 ${targetMonths.length}개월 계산 예정: ${targetMonths[0]} ~ ${targetMonths[targetMonths.length - 1]}`);
  }

  rebuildMonths(targetMonths);

  console.log('\n=== 완료 ===');

  // 결과 확인
  const sggCount  = executeCommand('SELECT COUNT(*) as cnt FROM sgg_monthly_stats')  as { cnt: number }[];
  const umdCount  = executeCommand('SELECT COUNT(*) as cnt FROM umd_monthly_stats')  as { cnt: number }[];
  console.log(`sgg_monthly_stats: ${sggCount[0]?.cnt}행`);
  console.log(`umd_monthly_stats: ${umdCount[0]?.cnt}행`);
}

main().catch(e => { console.error(e); process.exit(1); });
