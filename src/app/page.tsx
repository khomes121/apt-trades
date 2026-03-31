'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
import Link from 'next/link';
import RegionSelector from '@/components/RegionSelector';
import FilterPanel from '@/components/FilterPanel';
import ResultTable from '@/components/ResultTable';
import type { Region, SearchParams, TradeResult } from '@/types';

function defaultParams(): SearchParams {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateTo = `${yyyy}-${mm}-${dd}`;
  const from = new Date(today);
  from.setFullYear(from.getFullYear() - 1);
  const dateFrom = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  return {
    sgg_codes: [],
    date_from: dateFrom,
    date_to: dateTo,
    diff_operator: 'AND',
    exclude_cancelled: true,
    exclude_direct: true,
    min_trade_count: 1,
  };
}

type Action = Partial<SearchParams> & { _reset?: boolean };

function reducer(state: SearchParams, action: Action): SearchParams {
  if (action._reset) {
    const { _reset, ...next } = action;
    return next as SearchParams;
  }
  return { ...state, ...action };
}

export default function HomePage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [params, dispatch] = useReducer(reducer, undefined, defaultParams);
  const [results, setResults] = useState<TradeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regionsLoading, setRegionsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/regions')
      .then(r => r.json())
      .then((data: Region[]) => setRegions(data))
      .catch(() => setError('지역 정보를 불러오지 못했습니다.'))
      .finally(() => setRegionsLoading(false));
  }, []);

  const regionMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of regions) map[r.sgg_cd] = `${r.sido_nm} ${r.sgg_nm}`;
    return map;
  }, [regions]);

  async function handleSearch() {
    if (params.sgg_codes.length === 0 && !params.apt_nm?.trim()) {
      setError('지역을 선택하거나 단지명을 입력해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const json = await res.json() as { results?: TradeResult[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? '검색 실패');
      setResults(json.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '검색 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-gray-800">아파트 실거래가 변동 분석</h1>
          <p className="text-sm text-gray-500 mt-0.5">국토부 실거래 DB 기반 · 동일 단지/평형 내 가격 변동 탐지</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/trend" className="text-sm text-blue-600 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors">
            지역 시세 동향
          </Link>
          <Link href="/daily" className="text-sm text-blue-600 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors">
            날짜별 실거래
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-3">지역 선택</h2>
            {regionsLoading ? (
              <div className="text-sm text-gray-400">지역 정보 로딩 중...</div>
            ) : (
              <RegionSelector
                regions={regions}
                selectedCodes={params.sgg_codes}
                onChange={codes => dispatch({ sgg_codes: codes })}
              />
            )}
          </div>

          <div className="md:col-span-1 lg:col-span-2 bg-white rounded-xl border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-700">검색 조건</h2>
              <button
                onClick={() => dispatch({ ...defaultParams(), _reset: true })}
                className="px-2.5 py-1 text-xs border border-gray-300 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors"
              >초기화</button>
            </div>
            <FilterPanel params={params} onChange={p => dispatch(p)} />
          </div>
        </div>

        <div className="flex justify-center">
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-10 py-3 bg-blue-600 text-white text-base font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow"
          >
            {loading ? '검색 중...' : '검색'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {results !== null && (
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-4">검색 결과</h2>
            <ResultTable results={results} regions={regionMap} />
          </div>
        )}
      </main>
    </div>
  );
}
