'use client';

import { formatPrice } from '@/lib/queries';
import type { TradeResult } from '@/types';

interface Props {
  results: TradeResult[];
  regions: Record<string, string>; // sgg_cd → 시군구명
}

function areaLabel(m2: number): string {
  const py = Math.round(m2 / 3.305785);
  return `${m2}㎡ (${py}평)`;
}

export default function ResultTable({ results, regions }: Props) {
  if (results.length === 0) {
    return <div className="text-center py-12 text-gray-400">검색 결과가 없습니다.</div>;
  }

  function downloadCsv() {
    const header = ['아파트명', '지역', '법정동', '전용면적', '건축년도', '거래건수', '최저가', '최고가', '변동폭', '변동률(%)'];
    const rows = results.map(r => [
      r.apt_nm,
      regions[r.sgg_cd] ?? r.sgg_cd,
      r.umd_nm,
      `${r.area_group}㎡`,
      r.build_year ?? '-',
      r.trade_count,
      r.min_price,
      r.max_price,
      r.diff_amount,
      r.diff_rate,
    ]);
    const csv = [header, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `실거래가분석_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-600">총 <strong>{results.length}</strong>건 (변동폭 내림차순)</span>
        <button
          onClick={downloadCsv}
          className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
        >
          CSV 다운로드
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-3 py-2 border font-medium">아파트명</th>
              <th className="px-3 py-2 border font-medium">지역</th>
              <th className="px-3 py-2 border font-medium">법정동</th>
              <th className="px-3 py-2 border font-medium text-right">전용면적</th>
              <th className="px-3 py-2 border font-medium text-right">건축년도</th>
              <th className="px-3 py-2 border font-medium text-right">거래수</th>
              <th className="px-3 py-2 border font-medium text-right">최저가</th>
              <th className="px-3 py-2 border font-medium text-right">최고가</th>
              <th className="px-3 py-2 border font-medium text-right">변동폭</th>
              <th className="px-3 py-2 border font-medium text-right">변동률</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="hover:bg-blue-50 transition-colors">
                <td className="px-3 py-2 border font-medium">{r.apt_nm}</td>
                <td className="px-3 py-2 border text-gray-600">{regions[r.sgg_cd] ?? r.sgg_cd}</td>
                <td className="px-3 py-2 border text-gray-600">{r.umd_nm}</td>
                <td className="px-3 py-2 border text-right">{areaLabel(r.area_group)}</td>
                <td className="px-3 py-2 border text-right text-gray-600">{r.build_year ?? '-'}</td>
                <td className="px-3 py-2 border text-right">{r.trade_count}</td>
                <td className="px-3 py-2 border text-right">{formatPrice(r.min_price)}</td>
                <td className="px-3 py-2 border text-right">{formatPrice(r.max_price)}</td>
                <td className="px-3 py-2 border text-right font-semibold text-blue-700">
                  +{formatPrice(r.diff_amount)}
                </td>
                <td className="px-3 py-2 border text-right font-semibold text-red-600">
                  {r.diff_rate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
