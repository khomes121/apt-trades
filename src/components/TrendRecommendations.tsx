'use client';

import type { SggTrendSummary } from '@/types';

interface RecommendGroup {
  sido_nm: string;
  hot: SggTrendSummary[];      // 상승 상위
  watch: SggTrendSummary[];    // 아직 덜 오른 인근
}

function calcRecommendations(summaries: SggTrendSummary[]): RecommendGroup[] {
  // 시도별 그룹핑
  const sidoMap: Record<string, SggTrendSummary[]> = {};
  for (const s of summaries) {
    if (!sidoMap[s.sido_nm]) sidoMap[s.sido_nm] = [];
    sidoMap[s.sido_nm].push(s);
  }

  const result: RecommendGroup[] = [];

  for (const [sido_nm, rows] of Object.entries(sidoMap)) {
    if (rows.length < 3) continue; // 구/군이 너무 적으면 skip

    const sorted = [...rows].sort((a, b) => b.change_rate - a.change_rate);
    const avg = rows.reduce((s, r) => s + r.change_rate, 0) / rows.length;

    // HOT: 시도 평균보다 2%p 이상 높고, 상위 1/3 이내
    const topN   = Math.max(1, Math.ceil(sorted.length / 3));
    const hot    = sorted.slice(0, topN).filter(r => r.change_rate > avg + 2);
    if (hot.length === 0) continue;

    // WATCH: 상승 중이지만 HOT 기준의 절반 이하 & 아직 하락은 아닌 곳
    const hotAvgRate = hot.reduce((s, r) => s + r.change_rate, 0) / hot.length;
    const watch = sorted
      .filter(r => !hot.includes(r))
      .filter(r => r.change_rate >= 0 && r.change_rate < hotAvgRate * 0.5)
      .slice(0, 3);

    if (watch.length === 0) continue;

    result.push({ sido_nm, hot, watch });
  }

  // HOT 상승률 내림차순 정렬
  return result.sort(
    (a, b) =>
      Math.max(...b.hot.map(r => r.change_rate)) -
      Math.max(...a.hot.map(r => r.change_rate))
  );
}

interface Props {
  summaries: SggTrendSummary[];
  compareMonths: number;
}

export default function TrendRecommendations({ summaries, compareMonths }: Props) {
  const groups = calcRecommendations(summaries);

  if (groups.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        추천 지역을 산출하기에 데이터가 부족합니다. 전국 조회로 다시 시도해보세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        시도 내 평균 대비 급등 지역(🔥) 인근에서 아직 덜 오른 지역(👀)을 시도별로 표시합니다.
        단순 참고용이며 투자 판단은 본인 책임입니다.
      </p>
      {groups.map(g => (
        <div key={g.sido_nm} className="border rounded-xl p-4 bg-gray-50/50">
          <div className="font-semibold text-gray-700 mb-3 text-sm">{g.sido_nm}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* HOT 지역 */}
            <div>
              <div className="text-xs text-gray-500 mb-1.5">🔥 급등 지역</div>
              <div className="space-y-1">
                {g.hot.map(r => (
                  <div key={r.sgg_cd} className="flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">
                    <span className="font-medium text-gray-800 text-sm">{r.sgg_nm}</span>
                    <div className="text-right">
                      <span className="font-bold text-red-600 text-sm">+{r.change_rate}%</span>
                      <span className="text-xs text-gray-400 ml-1.5">{r.trade_count}건</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* WATCH 지역 */}
            <div>
              <div className="text-xs text-gray-500 mb-1.5">👀 주목 지역 <span className="text-gray-400">(인근·덜 오름)</span></div>
              <div className="space-y-1">
                {g.watch.map(r => (
                  <div key={r.sgg_cd} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5">
                    <span className="font-medium text-gray-800 text-sm">{r.sgg_nm}</span>
                    <div className="text-right">
                      <span className={`font-bold text-sm ${r.change_rate > 0 ? 'text-blue-600' : 'text-gray-500'}`}>
                        {r.change_rate > 0 ? '+' : ''}{r.change_rate}%
                      </span>
                      <span className="text-xs text-gray-400 ml-1.5">{r.trade_count}건</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
