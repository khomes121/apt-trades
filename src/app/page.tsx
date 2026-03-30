'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
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
    min_trade_count: 2,
  };
}

type Action = Partial<SearchParams> & { sgg_codes?: string[] };

function reducer(state: SearchParams, action: Action): SearchParams {
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
    if (params.sgg_codes.length === 0) {
      setError('지역을 선택해주세요.');
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
        <h1 className="text-xl font-bold text-gray-800">아파트 실거래가 변동 분석</h1>
        <p className="text-sm text-gray-500 mt-0.5">국토부 실거래 DB 기반 · 동일 단지/평형 내 가격 변동 탐지</p>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

          <div className="lg:col-span-2 bg-white rounded-xl border p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-3">검색 조건</h2>
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
