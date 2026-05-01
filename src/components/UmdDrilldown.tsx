'use client';

import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { UmdMonthlyStat } from '@/types';

interface Props {
  sggCd: string;
  sggNm: string;
  sidoNm: string;
  months: number;
  onClose: () => void;
}

function ymLabel(ym: string): string {
  return `${ym.slice(0, 4)}.${ym.slice(4, 6)}`;
}

const COLORS = [
  '#2563eb','#dc2626','#16a34a','#d97706','#7c3aed','#0891b2',
  '#db2777','#65a30d','#ea580c','#6366f1','#14b8a6','#f43f5e',
];

export default function UmdDrilldown({ sggCd, sggNm, sidoNm, months, onClose }: Props) {
  const [stats, setStats]     = useState<UmdMonthlyStat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [minTrade, setMinTrade] = useState(5);

  useEffect(() => {
    setLoading(true);
    fetch('/api/trend/umd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sgg_cd: sggCd, months }),
    })
      .then(r => r.json())
      .then((json: { results?: UmdMonthlyStat[]; error?: string }) => {
        if (json.error) throw new Error(json.error);
        setStats(json.results ?? []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sggCd, months]);

  // 동별로 그룹핑 → 차트 데이터 변환
  const { chartData, umdNames } = (() => {
    if (!stats) return { chartData: [], umdNames: [] };

    // 거래건수 필터 + 동 목록
    const umdTrades: Record<string, number> = {};
    for (const s of stats) {
      umdTrades[s.umd_nm] = (umdTrades[s.umd_nm] ?? 0) + s.trade_count;
    }
    const validUmds = Object.entries(umdTrades)
      .filter(([, cnt]) => cnt >= minTrade)
      .sort((a, b) => b[1] - a[1])
      .map(([nm]) => nm);

    // ym 목록
    const ymSet = new Set(stats.map(s => s.ym));
    const yms   = [...ymSet].sort();

    // 차트 데이터 (ym별 행)
    const rowMap: Record<string, Record<string, number>> = {};
    for (const s of stats) {
      if (!validUmds.includes(s.umd_nm)) continue;
      if (!rowMap[s.ym]) rowMap[s.ym] = {};
      rowMap[s.ym][s.umd_nm] = Math.round(s.avg_m2_price * 10) / 10;
    }
    const chartData = yms.map(ym => ({ ym: ymLabel(ym), ...rowMap[ym] }));

    return { chartData, umdNames: validUmds };
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-800">{sidoNm} {sggNm} — 동별 시세 동향</h2>
            <p className="text-xs text-gray-400 mt-0.5">㎡당 평균 단가 (만원)</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-sm text-gray-600">
              <span>최소</span>
              <select
                value={minTrade}
                onChange={e => setMinTrade(Number(e.target.value))}
                className="border rounded px-2 py-0.5 text-sm"
              >
                {[3, 5, 10, 20].map(v => <option key={v} value={v}>{v}건</option>)}
              </select>
              <span>이상</span>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >×</button>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && <div className="text-center py-12 text-gray-400">로딩 중...</div>}
          {error   && <div className="text-center py-12 text-red-500">{error}</div>}
          {!loading && !error && stats && (
            <>
              {umdNames.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  거래건수 {minTrade}건 이상인 동이 없습니다.
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="ym" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} unit="만" width={55} />
                      <Tooltip
                        formatter={(v, name) => [`${v}만/㎡`, name]}
                        labelStyle={{ fontWeight: 'bold' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {umdNames.map((nm, i) => (
                        <Line
                          key={nm}
                          type="monotone"
                          dataKey={nm}
                          stroke={COLORS[i % COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>

                  {/* 동별 최근 단가 테이블 */}
                  <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-600">
                          <th className="px-3 py-2 border text-left">동</th>
                          {chartData.map(d => (
                            <th key={d.ym} className="px-3 py-2 border text-right">{d.ym}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {umdNames.map((nm, i) => (
                          <tr key={nm} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                            <td className="px-3 py-2 border font-medium" style={{ color: COLORS[i % COLORS.length] }}>
                              {nm}
                            </td>
                            {chartData.map(d => (
                              <td key={d.ym} className="px-3 py-2 border text-right text-gray-600">
                                {(d as Record<string, number | string>)[nm] != null
                                  ? `${(d as Record<string, number | string>)[nm]}만`
                                  : '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
