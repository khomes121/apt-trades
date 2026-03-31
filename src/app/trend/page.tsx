'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import type { Region, SggMonthlyStat, SggTrendSummary } from '@/types';
import RegionSelector from '@/components/RegionSelector';
import SggTrendTable from '@/components/SggTrendTable';
import UmdDrilldown from '@/components/UmdDrilldown';
import TrendRecommendations from '@/components/TrendRecommendations';
import Link from 'next/link';

const MONTH_OPTIONS = [
  { label: '1개월', value: 1 },
  { label: '3개월', value: 3 },
  { label: '6개월', value: 6 },
];

const MIN_TRADE_OPTIONS = [10, 30, 100, 200, 500];

// 월별 데이터 → 구 단위 트렌드 요약 계산
function calcTrend(
  stats: SggMonthlyStat[],
  compareMonths: number,
): SggTrendSummary[] {
  // sgg_cd별로 그룹핑
  const grouped: Record<string, SggMonthlyStat[]> = {};
  for (const s of stats) {
    if (!grouped[s.sgg_cd]) grouped[s.sgg_cd] = [];
    grouped[s.sgg_cd].push(s);
  }

  const result: SggTrendSummary[] = [];

  for (const [sgg_cd, rows] of Object.entries(grouped)) {
    const sorted = [...rows].sort((a, b) => a.ym.localeCompare(b.ym));
    const total  = sorted.length;
    if (total < 2) continue;

    // 최근 N개월 vs 이전 N개월
    const currRows = sorted.slice(-compareMonths);
    const prevRows = sorted.slice(-compareMonths * 2, -compareMonths);

    if (currRows.length === 0 || prevRows.length === 0) continue;

    const currPrice = currRows.reduce((s, r) => s + r.avg_m2_price, 0) / currRows.length;
    const prevPrice = prevRows.reduce((s, r) => s + r.avg_m2_price, 0) / prevRows.length;
    const tradeCount = currRows.reduce((s, r) => s + r.trade_count, 0);

    result.push({
      sgg_cd,
      sido_nm: rows[0].sido_nm,
      sgg_nm:  rows[0].sgg_nm,
      prev_price:    Math.round(prevPrice * 100) / 100,
      curr_price:    Math.round(currPrice * 100) / 100,
      change_rate:   Math.round((currPrice - prevPrice) / prevPrice * 1000) / 10,
      change_amount: Math.round((currPrice - prevPrice) * 100) / 100,
      trade_count:   tradeCount,
      monthly:       sorted,
    });
  }

  return result;
}

export default function TrendPage() {
  const [regions, setRegions]           = useState<Region[]>([]);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [compareMonths, setCompareMonths] = useState(1);
  const [minTrade, setMinTrade]         = useState(100);
  const [stats, setStats]               = useState<SggMonthlyStat[] | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [drilldown, setDrilldown]       = useState<{ sgg_cd: string; sgg_nm: string; sido_nm: string } | null>(null);

  useEffect(() => {
    fetch('/api/regions')
      .then(r => r.json())
      .then(setRegions)
      .catch(() => setError('지역 정보를 불러오지 못했습니다.'));
  }, []);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStats(null);
    try {
      const res  = await fetch('/api/trend/sgg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sgg_codes: selectedCodes.length > 0 ? selectedCodes : undefined,
          months: compareMonths * 2 + 1, // 비교 기간 * 2 + 여유 1개월
        }),
      });
      const json = await res.json() as { results?: SggMonthlyStat[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? '조회 실패');
      setStats(json.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [selectedCodes, compareMonths]);

  const summaries = useMemo(() => {
    if (!stats) return null;
    return calcTrend(stats, compareMonths)
      .filter(s => s.trade_count >= minTrade)
      .sort((a, b) => b.change_rate - a.change_rate);
  }, [stats, compareMonths, minTrade]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-800">지역 시세 동향</h1>
            <p className="text-sm text-gray-500 mt-0.5">구/군 단위 ㎡당 평균 단가 변동 · 시세 이동 지역 탐지</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" className="text-sm text-blue-600 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors">
              변동 분석
            </Link>
            <Link href="/daily" className="text-sm text-blue-600 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors">
              날짜별 실거래
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* 검색 조건 */}
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <div className="flex flex-wrap gap-6 items-start">
            {/* 비교기간 */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">비교 기간</label>
              <div className="flex rounded-lg border overflow-hidden text-sm">
                {MONTH_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => setCompareMonths(o.value)}
                    className={`px-4 py-1.5 ${compareMonths === o.value ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >{o.label}</button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                최근 {compareMonths}개월 vs 직전 {compareMonths}개월 비교
              </p>
            </div>

            {/* 최소 거래건수 */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                최소 거래건수 <span className="text-xs font-normal text-gray-400">(비교기간 합산)</span>
              </label>
              <div className="flex rounded-lg border overflow-hidden text-sm">
                {MIN_TRADE_OPTIONS.map(v => (
                  <button
                    key={v}
                    onClick={() => setMinTrade(v)}
                    className={`px-3 py-1.5 ${minTrade === v ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >{v}건</button>
                ))}
              </div>
            </div>

            {/* 지역 필터 */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                지역 필터 <span className="text-xs font-normal text-gray-400">(선택 안하면 전국)</span>
              </label>
              <RegionSelector
                regions={regions}
                selectedCodes={selectedCodes}
                onChange={setSelectedCodes}
              />
            </div>
          </div>

          <div className="mt-4 flex justify-center">
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-10 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow"
            >
              {loading ? '조회 중...' : '동향 조회'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        {/* 결과 */}
        {summaries !== null && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 상승 TOP */}
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h2 className="font-semibold text-gray-700 mb-3">
                🔴 상승 지역 TOP
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {compareMonths}개월 비교 · {summaries.filter(s => s.change_rate > 0).length}개 지역
                </span>
              </h2>
              <SggTrendTable
                rows={summaries.filter(s => s.change_rate > 0)}
                onRowClick={setDrilldown}
              />
            </div>

            {/* 하락 TOP */}
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h2 className="font-semibold text-gray-700 mb-3">
                🔵 하락 지역 TOP
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {summaries.filter(s => s.change_rate < 0).length}개 지역
                </span>
              </h2>
              <SggTrendTable
                rows={[...summaries.filter(s => s.change_rate < 0)].reverse()}
                onRowClick={setDrilldown}
                isDown
              />
            </div>
          </div>
        )}

        {/* 추천 지역 */}
        {summaries !== null && summaries.length > 0 && (
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-1">📍 주목 추천 지역</h2>
            <p className="text-xs text-gray-400 mb-4">
              급등 지역과 같은 시도 내에서 아직 덜 오른 지역 · {compareMonths}개월 비교 기준
            </p>
            <TrendRecommendations summaries={summaries} compareMonths={compareMonths} />
          </div>
        )}

        {/* 드릴다운 모달 */}
        {drilldown && (
          <UmdDrilldown
            sggCd={drilldown.sgg_cd}
            sggNm={drilldown.sgg_nm}
            sidoNm={drilldown.sido_nm}
            months={compareMonths * 2 + 1}
            onClose={() => setDrilldown(null)}
          />
        )}
      </main>
    </div>
  );
}
