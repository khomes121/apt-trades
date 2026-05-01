'use client';

import { useEffect, useMemo, useState } from 'react';
import RegionSelector from '@/components/RegionSelector';
import type { Region } from '@/types';

interface VillaTrade {
  id: number;
  mhouse_nm: string | null;
  sgg_cd: string;
  sgg_nm: string | null;
  sido_nm: string | null;
  umd_nm: string | null;
  jibun: string | null;
  house_type: string | null;
  build_year: number | null;
  exclu_use_ar: number;
  land_ar: number | null;
  floor: number | null;
  deal_amount: number;
  deal_date: string;
  dealing_gbn: string | null;
  cdeal_type: string | null;
  lat: number | null;
  lng: number | null;
}

const PERIOD_PRESETS = [
  { label: '3개월', months: 3 },
  { label: '6개월', months: 6 },
  { label: '1년', months: 12 },
  { label: '2년', months: 24 },
  { label: '3년', months: 36 },
  { label: '전체', months: 0 },
];

const PRICE_PRESETS = [3000, 5000, 7000, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 100000, 150000, 200000];

const AREA_PRESETS = [10, 20, 30, 40, 50, 60, 70, 85, 100, 120];

const BUILD_YEAR_PRESETS = [1970, 1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025];
const RECENT_YEAR_PRESETS = [5, 10, 15, 20, 30, 40];

function yearLabel(y: number): string {
  return `${String(y).slice(2)}년`;
}

const PAGE_SIZE = 50;

function priceLabel(v: number): string {
  return v >= 10000 ? `${v / 10000}억` : `${v / 1000}천`;
}

function formatPrice(won: number): string {
  if (won >= 10000) {
    const uk = Math.floor(won / 10000);
    const remainder = won % 10000;
    return remainder > 0 ? `${uk}억 ${remainder.toLocaleString()}만` : `${uk}억`;
  }
  return `${won.toLocaleString()}만`;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDateRange(months: number) {
  const today = new Date();
  if (months === 0) {
    return { date_from: '2006-01-01', date_to: fmtDate(today) };
  }
  const from = new Date(today);
  from.setMonth(from.getMonth() - months);
  return { date_from: fmtDate(from), date_to: fmtDate(today) };
}

export default function VillaPage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);

  // ── 검색 조건 ───────────────────────────────────────────────────────
  const initial = useMemo(() => getDateRange(12), []);

  const [sggCodes, setSggCodes] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState(initial.date_from);
  const [dateTo, setDateTo] = useState(initial.date_to);
  const [houseType, setHouseType] = useState<'' | '연립' | '다세대'>('');
  const [q, setQ] = useState('');
  const [priceMin, setPriceMin] = useState<number | undefined>(undefined);
  const [priceMax, setPriceMax] = useState<number | undefined>(undefined);
  const [buildYearFrom, setBuildYearFrom] = useState<number | undefined>(undefined);
  const [buildYearTo, setBuildYearTo] = useState<number | undefined>(undefined);
  const [areaMin, setAreaMin] = useState<number | undefined>(undefined);
  const [areaMax, setAreaMax] = useState<number | undefined>(undefined);
  const [excludeCancelled, setExcludeCancelled] = useState(true);
  const [excludeDirect, setExcludeDirect] = useState(false);

  const [results, setResults] = useState<VillaTrade[] | null>(null);
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function applyPeriod(months: number) {
    const r = getDateRange(months);
    setDateFrom(r.date_from);
    setDateTo(r.date_to);
  }

  function reset() {
    const r = getDateRange(12);
    setDateFrom(r.date_from); setDateTo(r.date_to);
    setHouseType(''); setQ('');
    setPriceMin(undefined); setPriceMax(undefined);
    setBuildYearFrom(undefined); setBuildYearTo(undefined);
    setAreaMin(undefined); setAreaMax(undefined);
    setExcludeCancelled(true); setExcludeDirect(false);
  }

  async function handleSearch() {
    if (sggCodes.length === 0 && !q.trim()) {
      setError('지역을 선택하거나 검색어를 입력해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    setDisplayLimit(PAGE_SIZE);
    try {
      const res = await fetch('/api/villa/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sgg_codes: sggCodes,
          date_from: dateFrom,
          date_to: dateTo,
          house_type: houseType || undefined,
          q: q.trim() || undefined,
          price_min: priceMin,
          price_max: priceMax,
          build_year_from: buildYearFrom,
          build_year_to: buildYearTo,
          area_min: areaMin,
          area_max: areaMax,
          exclude_cancelled: excludeCancelled,
          exclude_direct: excludeDirect,
          limit: 2000,
        }),
      });
      const json = await res.json() as { results?: VillaTrade[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? '검색 실패');
      setResults(json.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '검색 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  const summary = useMemo(() => {
    if (!results || results.length === 0) return null;
    const totalAmount = results.reduce((s, r) => s + r.deal_amount, 0);
    return {
      total: results.length,
      avgAmount: Math.round(totalAmount / results.length),
    };
  }, [results]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-gray-800">빌라/다세대 실거래가</h1>
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
                selectedCodes={sggCodes}
                onChange={setSggCodes}
              />
            )}
          </div>

          <div className="md:col-span-1 lg:col-span-2 bg-white rounded-xl border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-700">검색 조건</h2>
              <button
                onClick={reset}
                className="px-2.5 py-1 text-xs border border-gray-300 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors"
              >초기화</button>
            </div>

            <div className="space-y-5">

              {/* 단지명·지번 검색 */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">단지명 / 동 / 지번</label>
                <input
                  type="text"
                  placeholder="예: 우동 또는 청운빌라"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  className="border rounded-lg px-3 py-1.5 text-sm w-full"
                />
              </div>

              {/* 조회 기간 */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">조회 기간</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {PERIOD_PRESETS.map(p => (
                    <button
                      key={p.months}
                      onClick={() => applyPeriod(p.months)}
                      className="px-3 py-1 text-sm rounded-full border border-blue-400 text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[130px]"
                  />
                  <span className="text-gray-400">~</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[130px]"
                  />
                </div>
              </div>

              {/* 매매가 범위 */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  매매가 범위
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {priceMin ? priceLabel(priceMin) : '하한없음'} ~{' '}
                    {priceMax ? priceLabel(priceMax) : '상한없음'}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">최소 이상</div>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {PRICE_PRESETS.map(v => (
                        <button
                          key={v}
                          onClick={() => setPriceMin(v)}
                          className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                            priceMin === v
                              ? 'bg-blue-500 text-white border-blue-500'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >{priceLabel(v)}</button>
                      ))}
                      <button
                        onClick={() => setPriceMin(undefined)}
                        className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
                      >없음</button>
                    </div>
                    <input
                      type="number"
                      placeholder="직접입력 (만원)"
                      value={priceMin ?? ''}
                      step={1000}
                      onChange={e => setPriceMin(e.target.value ? Number(e.target.value) : undefined)}
                      className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">최대 이하</div>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {PRICE_PRESETS.map(v => (
                        <button
                          key={v}
                          onClick={() => setPriceMax(v)}
                          className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                            priceMax === v
                              ? 'bg-blue-500 text-white border-blue-500'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >{priceLabel(v)}</button>
                      ))}
                      <button
                        onClick={() => setPriceMax(undefined)}
                        className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
                      >없음</button>
                    </div>
                    <input
                      type="number"
                      placeholder="직접입력 (만원)"
                      value={priceMax ?? ''}
                      step={1000}
                      onChange={e => setPriceMax(e.target.value ? Number(e.target.value) : undefined)}
                      className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
                    />
                  </div>
                </div>
              </div>

              {/* 전용면적 범위 */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  전용면적 범위
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {areaMin ? `${areaMin}㎡` : '하한없음'} ~{' '}
                    {areaMax ? `${areaMax}㎡` : '상한없음'}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">최소 이상</div>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {AREA_PRESETS.map(v => (
                        <button
                          key={v}
                          onClick={() => setAreaMin(v)}
                          className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                            areaMin === v
                              ? 'bg-blue-500 text-white border-blue-500'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >{v}㎡</button>
                      ))}
                      <button
                        onClick={() => setAreaMin(undefined)}
                        className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
                      >없음</button>
                    </div>
                    <input
                      type="number"
                      placeholder="직접입력 (㎡)"
                      value={areaMin ?? ''}
                      step={1}
                      onChange={e => setAreaMin(e.target.value ? Number(e.target.value) : undefined)}
                      className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">최대 이하</div>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {AREA_PRESETS.map(v => (
                        <button
                          key={v}
                          onClick={() => setAreaMax(v)}
                          className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                            areaMax === v
                              ? 'bg-blue-500 text-white border-blue-500'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >{v}㎡</button>
                      ))}
                      <button
                        onClick={() => setAreaMax(undefined)}
                        className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
                      >없음</button>
                    </div>
                    <input
                      type="number"
                      placeholder="직접입력 (㎡)"
                      value={areaMax ?? ''}
                      step={1}
                      onChange={e => setAreaMax(e.target.value ? Number(e.target.value) : undefined)}
                      className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
                    />
                  </div>
                </div>
              </div>

              {/* 건축년도 */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  건축년도
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {buildYearFrom ?? '하한없음'} ~ {buildYearTo ?? '상한없음'}
                  </span>
                </label>
                {/* 최근 N년 이내 빠른 프리셋 */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="text-xs text-gray-500 self-center mr-1">최근</span>
                  {RECENT_YEAR_PRESETS.map(y => {
                    const fromYear = new Date().getFullYear() - y;
                    const active = buildYearFrom === fromYear && buildYearTo == null;
                    return (
                      <button
                        key={y}
                        onClick={() => { setBuildYearFrom(fromYear); setBuildYearTo(undefined); }}
                        className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                          active
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'border-blue-300 text-blue-600 hover:bg-blue-50'
                        }`}
                      >{`${y}년 이내`}</button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">시작 (이후)</div>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {BUILD_YEAR_PRESETS.map(y => (
                        <button
                          key={y}
                          onClick={() => setBuildYearFrom(y)}
                          className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                            buildYearFrom === y
                              ? 'bg-blue-500 text-white border-blue-500'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >{yearLabel(y)}</button>
                      ))}
                      <button
                        onClick={() => setBuildYearFrom(undefined)}
                        className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
                      >없음</button>
                    </div>
                    <input
                      type="number"
                      placeholder="직접입력 (연도)"
                      value={buildYearFrom ?? ''}
                      onChange={e => setBuildYearFrom(e.target.value ? Number(e.target.value) : undefined)}
                      className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">종료 (이전)</div>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {BUILD_YEAR_PRESETS.map(y => (
                        <button
                          key={y}
                          onClick={() => setBuildYearTo(y)}
                          className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                            buildYearTo === y
                              ? 'bg-blue-500 text-white border-blue-500'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >{yearLabel(y)}</button>
                      ))}
                      <button
                        onClick={() => setBuildYearTo(undefined)}
                        className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
                      >없음</button>
                    </div>
                    <input
                      type="number"
                      placeholder="직접입력 (연도)"
                      value={buildYearTo ?? ''}
                      onChange={e => setBuildYearTo(e.target.value ? Number(e.target.value) : undefined)}
                      className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
                    />
                  </div>
                </div>
              </div>

              {/* 유형 + 옵션 */}
              <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">유형</label>
                  <select
                    value={houseType}
                    onChange={e => setHouseType(e.target.value as '' | '연립' | '다세대')}
                    className="border rounded-lg px-3 py-1.5 text-sm bg-white"
                  >
                    <option value="">전체</option>
                    <option value="연립">연립</option>
                    <option value="다세대">다세대</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={excludeCancelled}
                    onChange={e => setExcludeCancelled(e.target.checked)}
                    className="w-4 h-4 accent-blue-500"
                  />
                  <span className="text-sm text-gray-700">해제거래 제외 (권장)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={excludeDirect}
                    onChange={e => setExcludeDirect(e.target.checked)}
                    className="w-4 h-4 accent-blue-500"
                  />
                  <span className="text-sm text-gray-700">직거래 제외</span>
                </label>
              </div>

            </div>
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
          <div className="bg-white rounded-xl border p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-700">
                검색 결과 ({results.length.toLocaleString()}건)
                {results.length > displayLimit && (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {Math.min(displayLimit, results.length).toLocaleString()}건 표시 중
                  </span>
                )}
              </h2>
              {summary && (
                <div className="text-xs text-gray-500">
                  평균 거래가 {formatPrice(summary.avgAmount)}
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">계약일</th>
                    <th className="px-3 py-2 text-left">지역</th>
                    <th className="px-3 py-2 text-left">단지/지번</th>
                    <th className="px-3 py-2 text-left">유형</th>
                    <th className="px-3 py-2 text-right">전용면적</th>
                    <th className="px-3 py-2 text-right">층</th>
                    <th className="px-3 py-2 text-right">건축년도</th>
                    <th className="px-3 py-2 text-right">거래가</th>
                    <th className="px-3 py-2 text-center">지도</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.slice(0, displayLimit).map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">{r.deal_date}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {regionMap[r.sgg_cd] ?? r.sgg_cd} {r.umd_nm ?? ''}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">{r.mhouse_nm || '(단지명 없음)'}</div>
                        <div className="text-xs text-gray-500">{r.jibun || ''}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{r.house_type ?? ''}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.exclu_use_ar.toFixed(1)}㎡</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.floor ?? '-'}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.build_year ?? '-'}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">{formatPrice(r.deal_amount)}</td>
                      <td className="px-3 py-2 text-center">
                        {r.lat != null && r.lng != null ? (
                          <a
                            href={`https://map.naver.com/p/search/${encodeURIComponent(`${regionMap[r.sgg_cd] ?? ''} ${r.umd_nm ?? ''} ${r.jibun ?? ''}`.trim())}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-green-600 hover:underline text-xs"
                          >🗺</a>
                        ) : (
                          <span className="text-gray-300 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {results.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">결과 없음</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {results.length > displayLimit && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setDisplayLimit(n => n + PAGE_SIZE)}
                  className="px-6 py-2 text-sm border border-blue-400 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  다음 {Math.min(PAGE_SIZE, results.length - displayLimit)}건 더보기
                  <span className="ml-2 text-xs text-gray-500">
                    (남은 {(results.length - displayLimit).toLocaleString()}건)
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
