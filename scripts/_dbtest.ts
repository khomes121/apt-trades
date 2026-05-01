import { execSync } from 'child_process';
const W = `node "C:\\Users\\HOMES\\AppData\\Local\\npm-cache\\_npx\\32026684e21afda6\\node_modules\\wrangler\\bin\\wrangler.js"`;
function q(sql: string) {
  const r = execSync(`${W} d1 execute apt-trades --remote --command="${sql}" --json 2>&1`, { encoding: 'utf-8' });
  const s = r.indexOf('['), e = r.lastIndexOf(']');
  return JSON.parse(r.slice(s, e + 1))[0]?.results ?? [];
}

// 1. 취소 포함 신평동 현대 10~11층 전체
const r1 = q("SELECT deal_date, exclu_use_ar, deal_amount, floor, cdeal_type, cdeal_day FROM apt_trades WHERE sgg_cd='26380' AND apt_nm='현대' AND umd_nm='신평동' AND floor IN (10,11) ORDER BY deal_date DESC");
console.log('신평동 현대 10~11층 (취소포함):');
r1.forEach((x: Record<string,string>) => console.log(`  ${x.deal_date} ${x.exclu_use_ar}㎡ ${x.deal_amount}만 ${x.floor}층 cdeal=${x.cdeal_type??'-'} cdealDay=${x.cdeal_day??'-'}`));

// 2. 신평동 현대 19800만 근처 (±500만) 모든 층
const r2 = q("SELECT deal_date, exclu_use_ar, deal_amount, floor, cdeal_type FROM apt_trades WHERE sgg_cd='26380' AND apt_nm='현대' AND umd_nm='신평동' AND deal_amount BETWEEN 19300 AND 20300 ORDER BY deal_date DESC");
console.log('\n신평동 현대 19300~20300만 전체:');
r2.forEach((x: Record<string,string>) => console.log(`  ${x.deal_date} ${x.exclu_use_ar}㎡ ${x.deal_amount}만 ${x.floor}층 cdeal=${x.cdeal_type??'-'}`));
