'use client';

import type { SggTrendSummary } from '@/types';

interface Props {
  rows: SggTrendSummary[];
  onRowClick: (info: { sgg_cd: string; sgg_nm: string; sido_nm: string }) => void;
  isDown?: boolean;
}

export default function SggTrendTable({ rows, onRowClick, isDown = false }: Props) {
  if (rows.length === 0) {
    return <div className="text-center py-8 text-gray-400 text-sm">해당 없음</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-gray-600 text-xs">
            <th className="px-3 py-2 border text-left">지역</th>
            <th className="px-3 py-2 border text-right">이전 단가</th>
            <th className="px-3 py-2 border text-right">최근 단가</th>
            <th className="px-3 py-2 border text-right">변동률</th>
            <th className="px-3 py-2 border text-right">거래수</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const rateColor = r.change_rate > 0
              ? 'text-red-600'
              : r.change_rate < 0 ? 'text-blue-600' : 'text-gray-500';
            return (
              <tr
                key={r.sgg_cd}
                className={`cursor-pointer hover:bg-blue-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                onClick={() => onRowClick({ sgg_cd: r.sgg_cd, sgg_nm: r.sgg_nm, sido_nm: r.sido_nm })}
              >
                <td className="px-3 py-2 border">
                  <div className="font-medium text-blue-700">{r.sgg_nm}</div>
                  <div className="text-xs text-gray-400">{r.sido_nm}</div>
                </td>
                <td className="px-3 py-2 border text-right text-gray-500">
                  {r.prev_price.toFixed(1)}<span className="text-xs">만/㎡</span>
                </td>
                <td className="px-3 py-2 border text-right font-medium">
                  {r.curr_price.toFixed(1)}<span className="text-xs">만/㎡</span>
                </td>
                <td className={`px-3 py-2 border text-right font-bold ${rateColor}`}>
                  {r.change_rate > 0 ? '+' : ''}{r.change_rate}%
                </td>
                <td className="px-3 py-2 border text-right text-gray-500 text-xs">
                  {r.trade_count}건
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
