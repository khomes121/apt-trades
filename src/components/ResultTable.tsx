'use client';

import { useState, useMemo } from 'react';
import { formatPrice } from '@/lib/queries';
import type { TradeResult } from '@/types';
import TradeDetailModal from './TradeDetailModal';

interface Props {
  results: TradeResult[];
  regions: Record<string, string>;
}

interface ModalTarget {
  aptNm: string;
  sggCd: string;
  sggName: string;
  umdNm: string;
}

type SortKey = 'apt_nm' | 'sgg_cd' | 'umd_nm' | 'area_group' | 'build_year' | 'trade_count' | 'min_price' | 'max_price' | 'diff_amount' | 'diff_rate';

function areaLabel(m2: number): string {
  const py = Math.round(m2 / 3.305785);
  return `${m2}㎡ (${py}평)`;
}
type SortDir = 'asc' | 'desc';

export default function ResultTable({ results, regions }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('diff_amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [modal, setModal] = useState<ModalTarget | null>(null);
  const [nameFilter, setNameFilter] = useState('');

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const filtered = useMemo(() => {
    const kw = nameFilter.trim().toLowerCase();
    if (!kw) return results;
    return results.filter(r => r.apt_nm.toLowerCase().includes(kw));
  }, [results, nameFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av: string | number = sortKey === 'apt_nm' ? a.apt_nm
               : sortKey === 'sgg_cd' ? (regions[a.sgg_cd] ?? a.sgg_cd)
               : sortKey === 'umd_nm' ? a.umd_nm
               : (a[sortKey] ?? 0) as number;
      const bv: string | number = sortKey === 'apt_nm' ? b.apt_nm
               : sortKey === 'sgg_cd' ? (regions[b.sgg_cd] ?? b.sgg_cd)
               : sortKey === 'umd_nm' ? b.umd_nm
               : (b[sortKey] ?? 0) as number;
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv, 'ko') : bv.localeCompare(av, 'ko');
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filtered, sortKey, sortDir, regions]);

  if (results.length === 0) {
    return <div className="text-center py-12 text-gray-400">검색 결과가 없습니다.</div>;
  }

  function naverSearchUrl(r: TradeResult) {
    const q = encodeURIComponent(`${r.umd_nm} ${r.apt_nm}`);
    return `https://search.naver.com/search.naver?query=${q}`;
  }

  function downloadCsv() {
    const header = ['아파트명', '지역', '법정동', '전용면적', '건축년도', '거래건수', '최저가', '최고가', '변동폭', '변동률(%)'];
    const rows = sorted.map(r => [
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

  function SortTh({ label, col, right }: { label: string; col: SortKey; right?: boolean }) {
    const active = sortKey === col;
    const arrow = active ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ' ⇅';
    return (
      <th
        onClick={() => handleSort(col)}
        className={`px-3 py-2.5 border font-semibold cursor-pointer select-none whitespace-nowrap transition-colors
          ${active ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}
          ${right ? 'text-right' : 'text-left'}`}
      >
        {label}<span className="text-xs opacity-60">{arrow}</span>
      </th>
    );
  }

  const sortLabel: Record<SortKey, string> = {
    apt_nm: '아파트명', sgg_cd: '지역', umd_nm: '법정동', area_group: '면적', build_year: '건축년도',
    trade_count: '거래수', min_price: '최저가', max_price: '최고가',
    diff_amount: '변동폭', diff_rate: '변동률',
  };

  function openModal(r: TradeResult) {
    setModal({ aptNm: r.apt_nm, sggCd: r.sgg_cd, sggName: regions[r.sgg_cd] ?? r.sgg_cd, umdNm: r.umd_nm });
  }

  return (
    <div>
      {modal && (
        <TradeDetailModal
          aptNm={modal.aptNm}
          sggCd={modal.sggCd}
          sggName={modal.sggName}
          umdNm={modal.umdNm}
          onClose={() => setModal(null)}
        />
      )}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="단지명 검색..."
          value={nameFilter}
          onChange={e => setNameFilter(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        {/* 모바일 전용 정렬 셀렉터 */}
        <div className="flex md:hidden items-center gap-1.5 flex-1 min-w-0">
          <select
            value={sortKey}
            onChange={e => { setSortKey(e.target.value as SortKey); setSortDir('desc'); }}
            className="border rounded-lg px-2 py-1.5 text-sm flex-1 min-w-0 bg-white"
          >
            {(Object.entries(sortLabel) as [SortKey, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="border rounded-lg px-2.5 py-1.5 text-sm bg-white shrink-0 whitespace-nowrap text-gray-600"
          >
            {sortDir === 'desc' ? '내림차순 ▼' : '오름차순 ▲'}
          </button>
        </div>
        <span className="hidden md:inline text-sm text-gray-600 flex-1">
          {nameFilter ? (
            <><strong>{sorted.length}</strong><span className="text-gray-400 text-xs"> / {results.length}건</span></>
          ) : (
            <strong>{results.length}</strong>
          )}건
          <span className="ml-2 text-gray-400 text-xs">
            ({sortLabel[sortKey]} {sortDir === 'desc' ? '내림차순' : '오름차순'})
          </span>
        </span>
        <button
          onClick={downloadCsv}
          className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          CSV 다운로드
        </button>
      </div>
      {/* 모바일 건수 표시 */}
      <div className="flex md:hidden text-sm text-gray-600 mb-2">
        {nameFilter ? (
          <><strong>{sorted.length}</strong><span className="text-gray-400 text-xs"> / {results.length}건</span></>
        ) : (
          <strong>{results.length}</strong>
        )}건
        <span className="ml-2 text-gray-400 text-xs">
          ({sortLabel[sortKey]} {sortDir === 'desc' ? '내림차순' : '오름차순'})
        </span>
      </div>

      {/* 모바일: 카드형 */}
      <div className="block md:hidden space-y-3">
        {sorted.map((r, i) => (
          <div key={i} className="border rounded-xl p-4 bg-white shadow-sm">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="font-semibold text-blue-700 cursor-pointer hover:underline"
                    onClick={() => openModal(r)}
                  >{r.apt_nm}</span>
                  <a
                    href={naverSearchUrl(r)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-green-600 border border-green-400 rounded px-1.5 py-0.5 hover:bg-green-50 whitespace-nowrap"
                    onClick={e => e.stopPropagation()}
                  >N</a>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{regions[r.sgg_cd] ?? r.sgg_cd} · {r.umd_nm}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-red-600">+{r.diff_rate}%</div>
                <div className="text-xs font-semibold text-blue-700">+{formatPrice(r.diff_amount)}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 mt-3 pt-3 border-t">
              <div><span className="text-gray-400 block">면적</span>{areaLabel(r.area_group)}</div>
              <div><span className="text-gray-400 block">건축</span>{r.build_year ?? '-'}년</div>
              <div><span className="text-gray-400 block">거래수</span>{r.trade_count}건</div>
              <div><span className="text-gray-400 block">최저가</span>{formatPrice(r.min_price)}</div>
              <div><span className="text-gray-400 block">최고가</span>{formatPrice(r.max_price)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 데스크탑: 테이블 */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <SortTh label="아파트명" col="apt_nm" />
              <SortTh label="지역" col="sgg_cd" />
              <SortTh label="법정동" col="umd_nm" />
              <SortTh label="전용면적" col="area_group" right />
              <SortTh label="건축년도" col="build_year" right />
              <SortTh label="거래수" col="trade_count" right />
              <SortTh label="최저가" col="min_price" right />
              <SortTh label="최고가" col="max_price" right />
              <SortTh label="변동폭" col="diff_amount" right />
              <SortTh label="변동률" col="diff_rate" right />
              <th className="px-3 py-2.5 border font-semibold text-gray-600 bg-gray-50 text-center whitespace-nowrap">링크</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i} className={`hover:bg-blue-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                <td
                  className="px-3 py-2 border font-medium text-blue-700 cursor-pointer hover:underline hover:bg-blue-50"
                  onClick={() => openModal(r)}
                >{r.apt_nm}</td>
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
                  +{r.diff_rate}%
                </td>
                <td className="px-3 py-2 border text-center">
                  <a
                    href={naverSearchUrl(r)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-green-600 border border-green-400 rounded px-1.5 py-0.5 hover:bg-green-50"
                  >N</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
