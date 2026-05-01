'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { formatPrice } from '@/lib/queries';

interface Trade {
  deal_date: string;
  deal_amount: number;
  floor: number;
  area_group: number;
  exclu_use_ar: number;
  apt_dong: string | null;
  pyeong: number;
  dealing_gbn: string | null;
  cdeal_type: string | null;
}

interface Props {
  aptNm: string;
  sggCd: string;
  sggName: string;
  umdNm: string;
  onClose: () => void;
}

const AREA_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-teal-500',
];
const AREA_TEXT_COLORS = [
  'text-blue-600', 'text-emerald-600', 'text-violet-600', 'text-amber-600',
  'text-rose-600', 'text-cyan-600', 'text-orange-600', 'text-teal-600',
];

type DealingFilter = '전체' | '중개' | '직거래';
type FloorFilter = '전체' | '1층제외';
type DongTab = 'all' | number;

function pyeong(m2: number) { return Math.round(m2 / 3.305785); }
function floorAreaKey(t: Trade): number { return Math.floor(t.exclu_use_ar ?? t.area_group); }

function normalizeDong(dong: string | null): string | null {
  if (!dong || !dong.trim()) return null;
  const d = dong.trim();
  return d.endsWith('동') ? d : `${d}동`;
}

function dongFloor(dong: string | null, floor: number): string {
  if (!dong || !dong.trim()) return `${floor}층`;
  const d = dong.trim();
  // 이미 "동"으로 끝나면 그대로, 아니면 "동" 붙임 (예: "5" → "5동", "101" → "101동", "가동" → "가동")
  const label = d.endsWith('동') ? d : `${d}동`;
  return `${label} ${floor}층`;
}

function axisPrice(v: number): string {
  if (v >= 10000) {
    const val = v / 10000;
    return val % 1 === 0 ? `${val}억` : `${val.toFixed(1)}억`;
  }
  return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}천만`;
}

// 차트 Y축 "nice number" 계산 — 1억, 1.5억, 2억 같은 깔끔한 구간
function niceAxisValues(min: number, max: number): number[] {
  if (min === max) return [min];
  const range = max - min;
  const roughStep = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const niceFactors = [1, 2, 2.5, 5, 10];
  const factor = niceFactors.find(f => f * mag >= roughStep) ?? 10;
  const step = factor * mag;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const vals: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.01; v += step) {
    vals.push(Math.round(v));
  }
  return vals;
}

export default function TradeDetailModal({ aptNm, sggCd, sggName, umdNm, onClose }: Props) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedAreas, setSelectedAreas] = useState<Set<number>>(new Set());
  const [dealingFilter, setDealingFilter] = useState<DealingFilter>('전체');
  const [floorFilter, setFloorFilter] = useState<FloorFilter>('전체');
  const [dongTab, setDongTab] = useState<DongTab>('all');
  const [periodMonths, setPeriodMonths] = useState<number | null>(12);
  const [tradeListLimit, setTradeListLimit] = useState(50); // 기본 50건 표시

  useEffect(() => {
    fetch('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apt_nm: aptNm, sgg_cd: sggCd }),
    })
      .then(r => r.json())
      .then((d: { results: Trade[] }) => { setTrades(d.results); setLoading(false); })
      .catch(() => { setError('데이터를 불러오지 못했습니다.'); setLoading(false); });
  }, [aptNm, sggCd]);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  /* ── 파생 데이터 ── */

  // 기간 필터
  const periodFilteredTrades = useMemo(() => {
    if (periodMonths === null) return trades;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - periodMonths);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return trades.filter(t => t.deal_date >= cutoffStr);
  }, [trades, periodMonths]);

  // 기간 + 거래유형 필터 (평형 필터 제외) — 통계·차트 기준
  const dealingFilteredTrades = useMemo(() => {
    let t = periodFilteredTrades;
    if (dealingFilter === '중개')   t = t.filter(x => x.dealing_gbn !== '직거래');
    if (dealingFilter === '직거래') t = t.filter(x => x.dealing_gbn === '직거래');
    return t;
  }, [periodFilteredTrades, dealingFilter]);

  const areaGroups = useMemo(() =>
    [...new Set(dealingFilteredTrades.map(t => floorAreaKey(t)))].sort((a, b) => a - b),
    [dealingFilteredTrades]
  );


  const areaColorMap = useMemo(() => {
    const m: Record<number, string> = {};
    areaGroups.forEach((a, i) => { m[a] = AREA_COLORS[i % AREA_COLORS.length]; });
    return m;
  }, [areaGroups]);

  const areaTextColorMap = useMemo(() => {
    const m: Record<number, string> = {};
    areaGroups.forEach((a, i) => { m[a] = AREA_TEXT_COLORS[i % AREA_TEXT_COLORS.length]; });
    return m;
  }, [areaGroups]);

  // 평형별 통계 (기간 + 거래유형 필터 기준)
  const areaStats = useMemo(() =>
    areaGroups.map(area => {
      const t = dealingFilteredTrades.filter(x => floorAreaKey(x) === area);
      const amounts = t.map(x => x.deal_amount);
      const avg = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
      const latest = [...t].sort((a, b) => b.deal_date.localeCompare(a.deal_date))[0]?.deal_date ?? '';
      // 변동폭용: 1층제외 옵션 적용
      const tForRange = floorFilter === '1층제외' ? t.filter(x => x.floor !== 1) : t;
      const rangeAmounts = tForRange.length > 0 ? tForRange.map(x => x.deal_amount) : amounts;
      return {
        area, count: t.length,
        min: Math.min(...amounts), max: Math.max(...amounts), avg, latest,
        rangeMin: Math.min(...rangeAmounts), rangeMax: Math.max(...rangeAmounts),
        rangeCount: tForRange.length,
      };
    }),
    [dealingFilteredTrades, areaGroups, floorFilter]
  );

  // 동별 분석 (항상 전체 기간 · 중개거래만 · 동 정보 있는 거래만)
  const dongAnalysis = useMemo(() => {
    const withDong = trades
      .filter(t => t.dealing_gbn !== '직거래')
      .map(t => ({ ...t, dongLabel: normalizeDong(t.apt_dong) }))
      .filter(t => t.dongLabel !== null) as (Trade & { dongLabel: string })[];

    if (withDong.length === 0) return null;

    const dongs = [...new Set(withDong.map(t => t.dongLabel))].sort((a, b) => {
      // 숫자 앞부분 기준 자연 정렬
      const na = parseInt(a); const nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b, 'ko');
    });
    const types = [...new Set(withDong.map(t => floorAreaKey(t)))].sort((a, b) => a - b);

    // 동별 ㎡단가 계산 공통 함수
    function calcDongRows(subset: (Trade & { dongLabel: string })[]) {
      return dongs.map(dong => {
        const t = subset.filter(x => x.dongLabel === dong);
        if (t.length === 0) return null;
        const unitPrices = t.map(x => x.deal_amount / x.area_group);
        const avg = unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length;
        return { dong, count: t.length, avgUnitPrice: Math.round(avg * 10) / 10 };
      }).filter(Boolean) as { dong: string; count: number; avgUnitPrice: number }[];
    }

    const overallRows = calcDongRows(withDong).sort((a, b) => b.avgUnitPrice - a.avgUnitPrice);
    const typeRows = types.map(type => {
      const subset = withDong.filter(t => floorAreaKey(t) === type);
      const rows = calcDongRows(subset).sort((a, b) => b.avgUnitPrice - a.avgUnitPrice);
      return { type, rows };
    }).filter(t => t.rows.length > 0);

    return { dongs, types, overallRows, typeRows, totalWithDong: withDong.length };
  }, [trades]);

  // 표시용 거래 목록 (기간 + 거래유형 필터 후 평형 필터)
  const displayTrades = useMemo(() => {
    if (selectedAreas.size === 0) return dealingFilteredTrades;
    return dealingFilteredTrades.filter(x => selectedAreas.has(floorAreaKey(x)));
  }, [dealingFilteredTrades, selectedAreas]);

  // 차트 계산 (실제 날짜 기반 + nice Y축)
  const { minDateMs, dateRangeMs, minPrice, maxPrice, axisValues, chartMin, chartMax, chartRange } = useMemo(() => {
    if (!displayTrades.length) return {
      minDateMs: 0, dateRangeMs: 1, minPrice: 0, maxPrice: 1,
      axisValues: [0, 1], chartMin: 0, chartMax: 1, chartRange: 1,
    };
    const dates = displayTrades.map(t => new Date(t.deal_date).getTime());
    const minD = Math.min(...dates);
    const maxD = Math.max(...dates);
    const prices = displayTrades.map(t => t.deal_amount);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const axis = niceAxisValues(minP, maxP);
    const cMin = axis[0];
    const cMax = axis[axis.length - 1];
    return {
      minDateMs: minD, dateRangeMs: maxD - minD || 1,
      minPrice: minP, maxPrice: maxP,
      axisValues: axis, chartMin: cMin, chartMax: cMax, chartRange: cMax - cMin || 1,
    };
  }, [displayTrades]);

  const directCount = useMemo(() => periodFilteredTrades.filter(t => t.dealing_gbn === '직거래').length, [periodFilteredTrades]);
  const hasFilter = selectedAreas.size > 0;

  function toggleArea(area: number) {
    setSelectedAreas(prev => {
      const next = new Set(prev);
      next.has(area) ? next.delete(area) : next.add(area);
      return next;
    });
  }

  const naverSearchUrl = `https://search.naver.com/search.naver?query=${encodeURIComponent(umdNm + ' ' + aptNm)}`;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] flex flex-col">

        {/* 헤더 */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold text-gray-900">{aptNm}</h2>
              <a
                href={naverSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-600 border border-green-400 rounded px-1.5 py-0.5 hover:bg-green-50 shrink-0"
                onClick={e => e.stopPropagation()}
              >N</a>
            </div>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">{sggName} {umdNm}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0">✕</button>
        </div>

        {/* 본문 */}
        <div className="overflow-y-auto flex-1 px-4 sm:px-6 py-4">
          {loading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}
          {error   && <div className="text-center py-12 text-red-500">{error}</div>}

          {!loading && !error && trades.length > 0 && (
            <div className="space-y-4">

              {/* ① 로얄동 분석 — 항상 전체 기간·중개거래 기준 */}
              {dongAnalysis && (() => {
                const activeRows = dongTab === 'all'
                  ? dongAnalysis.overallRows
                  : (dongAnalysis.typeRows.find(t => t.type === dongTab)?.rows ?? []);
                const maxUnitPrice = Math.max(...activeRows.map(r => r.avgUnitPrice), 1);
                return (
                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-xs font-semibold text-gray-700 shrink-0">🏆 로얄동 분석</span>
                      <button
                        onClick={() => setDongTab('all')}
                        className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
                          dongTab === 'all' ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}
                      >전체{dongTab === 'all' ? ' ⚠' : ''}</button>
                      {dongAnalysis.typeRows.map(({ type }) => (
                        <button
                          key={type}
                          onClick={() => setDongTab(type)}
                          className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
                            dongTab === type ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >{type}㎡</button>
                      ))}
                      <span className="text-xs text-gray-400 ml-auto shrink-0">
                        중개 {dongAnalysis.totalWithDong}건 · 전체 기간
                      </span>
                    </div>
                    {dongTab === 'all' && (
                      <p className="text-xs text-amber-600 mb-2">⚠ 전체 탭은 평형 구성 차이로 왜곡 가능 — 타입별 탭이 더 정확합니다</p>
                    )}
                    {activeRows.length === 0 ? (
                      <p className="text-xs text-gray-400 py-1">해당 타입의 동별 데이터가 없습니다.</p>
                    ) : (
                      <div className="space-y-1">
                        {activeRows.map((r, i) => {
                          const barPct = (r.avgUnitPrice / maxUnitPrice) * 100;
                          const lowSample = r.count < 5;
                          const rankColor = i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-700' : 'text-gray-400';
                          const barColor  = lowSample ? 'bg-gray-300' : 'bg-yellow-400';
                          return (
                            <div key={r.dong} className="flex items-center gap-2">
                              <span className={`text-xs font-bold w-5 text-right shrink-0 ${rankColor}`}>{i + 1}</span>
                              <span className="text-xs font-medium w-12 shrink-0 text-gray-700">{r.dong}</span>
                              <div className="flex-1 relative h-4 bg-white rounded-full overflow-hidden">
                                <div className={`absolute left-0 top-0 h-full rounded-full transition-all ${barColor}`} style={{ width: `${barPct}%` }} />
                              </div>
                              <span className="text-xs font-semibold w-16 text-right shrink-0 text-gray-800">
                                {Math.round(r.avgUnitPrice).toLocaleString()}만/㎡
                              </span>
                              <span className="text-xs text-gray-400 w-8 text-right shrink-0">{r.count}건</span>
                              <span className="text-xs text-orange-400 w-8 shrink-0">{lowSample ? '표본↓' : ''}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ② 기간 필터 */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-600 shrink-0">기간</span>
                {([
                  { label: '전체', value: null },
                  { label: '1년', value: 12 },
                  { label: '2년', value: 24 },
                  { label: '3년', value: 36 },
                  { label: '5년', value: 60 },
                ] as { label: string; value: number | null }[]).map(o => (
                  <button
                    key={o.label}
                    onClick={() => setPeriodMonths(o.value)}
                    className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
                      periodMonths === o.value
                        ? 'bg-indigo-500 text-white border-indigo-500'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >{o.label}</button>
                ))}
                <span className="text-xs text-gray-400">
                  {periodMonths === null
                    ? `전체 ${trades.length}건`
                    : `최근 ${periodMonths}개월 ${periodFilteredTrades.length}건`}
                </span>
              </div>

              {/* ③ 거래유형 필터 */}
              <div className="flex items-center gap-2 flex-wrap -mt-2">
                <span className="text-xs font-semibold text-gray-600 shrink-0">유형</span>
                {(['전체', '중개', '직거래'] as DealingFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setDealingFilter(f)}
                    className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
                      dealingFilter === f
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >{f}</button>
                ))}
                {directCount > 0 && dealingFilter === '전체' && (
                  <span className="text-xs text-gray-400">직거래 {directCount}건 포함</span>
                )}
                {hasFilter && (
                  <button
                    onClick={() => setSelectedAreas(new Set())}
                    className="ml-auto text-xs text-blue-500 hover:underline shrink-0"
                  >평형 필터 초기화</button>
                )}
              </div>

              {/* ③-2 변동폭 필터 */}
              <div className="flex items-center gap-2 flex-wrap -mt-2">
                <span className="text-xs font-semibold text-gray-600 shrink-0">변동폭</span>
                {(['전체', '1층제외'] as FloorFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFloorFilter(f)}
                    className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
                      floorFilter === f
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >{f}</button>
                ))}
                {floorFilter === '1층제외' && (
                  <span className="text-xs text-gray-400">최저·최고·변동폭에서 1층 거래 제외</span>
                )}
              </div>

              {/* ④ 평형별 통계 — 행 클릭으로 필터 */}
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500">
                        <th className="px-2 py-1.5 border text-left font-medium whitespace-nowrap">평형</th>
                        <th className="px-2 py-1.5 border text-right font-medium whitespace-nowrap">건수</th>
                        <th className="px-2 py-1.5 border text-right font-medium whitespace-nowrap">최저</th>
                        <th className="px-2 py-1.5 border text-right font-medium whitespace-nowrap">평균</th>
                        <th className="px-2 py-1.5 border text-right font-medium whitespace-nowrap">최고</th>
                        <th className="px-2 py-1.5 border text-right font-medium whitespace-nowrap">변동폭</th>
                        <th className="px-2 py-1.5 border text-right font-medium whitespace-nowrap">최근거래</th>
                      </tr>
                    </thead>
                    <tbody>
                      {areaStats.map(s => {
                        const isSelected = selectedAreas.has(s.area);
                        const isDimmed  = selectedAreas.size > 0 && !isSelected;
                        return (
                          <tr
                            key={s.area}
                            onClick={() => toggleArea(s.area)}
                            className={`cursor-pointer transition-all ${
                              isSelected ? 'bg-blue-50' :
                              isDimmed   ? 'opacity-35 hover:opacity-60' :
                                           'hover:bg-gray-50'
                            }`}
                          >
                            <td className="px-2 py-1.5 border">
                              <span className="flex items-center gap-1.5">
                                <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${areaColorMap[s.area]}`} />
                                <span className={`font-medium ${areaTextColorMap[s.area]}`}>
                                  {s.area}㎡ <span className="text-gray-400 font-normal">({pyeong(s.area)}평)</span>
                                </span>
                              </span>
                            </td>
                            <td className="px-2 py-1.5 border text-right font-medium">{s.count}</td>
                            <td className="px-2 py-1.5 border text-right text-emerald-700">{formatPrice(s.rangeMin)}</td>
                            <td className="px-2 py-1.5 border text-right text-blue-700 font-semibold">{formatPrice(s.avg)}</td>
                            <td className="px-2 py-1.5 border text-right text-red-700">{formatPrice(s.rangeMax)}</td>
                            <td className="px-2 py-1.5 border text-right text-orange-600 font-medium">
                              {formatPrice(s.rangeMax - s.rangeMin)}
                            </td>
                            <td className="px-2 py-1.5 border text-right text-gray-500 whitespace-nowrap">{s.latest.slice(0, 7)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {areaGroups.length > 1 && (
                  <p className="text-xs text-gray-400 mt-1">↑ 행 클릭으로 평형 필터 (복수 선택 가능)</p>
                )}
              </div>

              {/* ⑤ 요약 */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-blue-50 rounded-xl p-2.5">
                  <div className="text-lg sm:text-xl font-bold text-blue-700">{displayTrades.length}건</div>
                  <div className="text-xs text-gray-500 mt-0.5">{hasFilter ? '필터 결과' : '총 거래'}</div>
                </div>
                <div className="bg-emerald-50 rounded-xl p-2.5">
                  <div className="text-lg sm:text-xl font-bold text-emerald-700">{formatPrice(minPrice)}</div>
                  <div className="text-xs text-gray-500 mt-0.5">최저가</div>
                </div>
                <div className="bg-red-50 rounded-xl p-2.5">
                  <div className="text-lg sm:text-xl font-bold text-red-700">{formatPrice(maxPrice)}</div>
                  <div className="text-xs text-gray-500 mt-0.5">최고가</div>
                </div>
              </div>

              {/* ⑤ 차트 (실제 날짜 기반 X축) */}
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-2">거래가 추이 · 색상 = 평형 · ○테두리 = 직거래</div>
                <div className="flex gap-1 items-start">
                  {/* 스크롤 가능한 점 차트 */}
                  <div className="overflow-x-auto flex-1 min-w-0">
                    <div className="relative" style={{ height: '140px', minWidth: '240px' }}>
                      {axisValues.map(v => {
                        const yPct = ((v - chartMin) / chartRange) * 100;
                        return (
                          <div
                            key={v}
                            className="absolute left-0 right-0 border-t border-gray-200"
                            style={{ bottom: `${yPct}%` }}
                          />
                        );
                      })}
                      {displayTrades.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                          해당 조건의 거래 없음
                        </div>
                      )}
                      {displayTrades.map((t, i) => {
                        const x = ((new Date(t.deal_date).getTime() - minDateMs) / dateRangeMs) * 92 + 4;
                        const y = ((t.deal_amount - chartMin) / chartRange) * 100;
                        const isDirect = t.dealing_gbn === '직거래';
                        return (
                          <div
                            key={i}
                            className={`absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 hover:scale-150 transition-transform cursor-default ${areaColorMap[floorAreaKey(t)] ?? 'bg-gray-400'} ${isDirect ? 'ring-2 ring-offset-1 ring-gray-500' : ''}`}
                            style={{ left: `${x}%`, bottom: `${y}%` }}
                            title={`${t.deal_date} | ${floorAreaKey(t)}㎡(${pyeong(t.exclu_use_ar ?? t.area_group)}평) | ${t.floor}층 | ${formatPrice(t.deal_amount)}${isDirect ? ' [직거래]' : ''}`}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mt-1" style={{ minWidth: '240px' }}>
                      <span>{displayTrades[0]?.deal_date?.slice(0, 7) ?? ''}</span>
                      <span>{displayTrades[displayTrades.length - 1]?.deal_date?.slice(0, 7) ?? ''}</span>
                    </div>
                  </div>
                  {/* Y축 레이블 — 차트 바깥 고정 열 */}
                  <div className="relative shrink-0 w-12" style={{ height: '140px' }}>
                    {axisValues.map(v => {
                      const yPct = ((v - chartMin) / chartRange) * 100;
                      return (
                        <span
                          key={v}
                          className="absolute right-0 text-[10px] text-gray-500 leading-none whitespace-nowrap -translate-y-1/2"
                          style={{ bottom: `${yPct}%` }}
                        >
                          {axisPrice(v)}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* ⑥ 상세 거래 목록 (50개씩 더보기) */}
              {(() => {
                const reversed = [...displayTrades].reverse();
                const showing = tradeListLimit > 0 ? reversed.slice(0, tradeListLimit) : [];
                const remaining = reversed.length - showing.length;
                return (
                  <div>
                    {tradeListLimit === 0 ? (
                      <button
                        onClick={() => setTradeListLimit(50)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg border text-xs text-gray-600 transition-colors"
                      >
                        <span className="font-semibold">거래 목록 {displayTrades.length}건</span>
                        <span>▼ 펼치기</span>
                      </button>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-gray-600">
                            거래 목록 — {showing.length}/{reversed.length}건 표시
                          </span>
                          <button
                            onClick={() => setTradeListLimit(0)}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >▲ 접기</button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs sm:text-sm border-collapse">
                            <thead>
                              <tr className="bg-gray-50 text-gray-600">
                                <th className="px-2 sm:px-3 py-2 border text-left font-semibold whitespace-nowrap">거래일</th>
                                <th className="px-2 sm:px-3 py-2 border text-right font-semibold whitespace-nowrap">면적</th>
                                <th className="px-2 sm:px-3 py-2 border text-right font-semibold whitespace-nowrap">동·층</th>
                                <th className="px-2 sm:px-3 py-2 border text-right font-semibold whitespace-nowrap">거래가</th>
                                <th className="px-2 sm:px-3 py-2 border text-center font-semibold">구분</th>
                              </tr>
                            </thead>
                            <tbody>
                              {showing.map((t, i) => (
                                <tr key={i} className={`hover:bg-blue-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                                  <td className="px-2 sm:px-3 py-1.5 border text-gray-700 whitespace-nowrap">{t.deal_date}</td>
                                  <td className="px-2 sm:px-3 py-1.5 border text-right whitespace-nowrap">
                                    <span className="flex items-center justify-end gap-1">
                                      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${areaColorMap[floorAreaKey(t)]}`} />
                                      {floorAreaKey(t)}㎡ ({pyeong(t.exclu_use_ar ?? t.area_group)}평)
                                    </span>
                                  </td>
                                  <td className="px-2 sm:px-3 py-1.5 border text-right text-gray-600 whitespace-nowrap">
                                    {dongFloor(t.apt_dong, t.floor)}
                                  </td>
                                  <td className="px-2 sm:px-3 py-1.5 border text-right font-semibold whitespace-nowrap">{formatPrice(t.deal_amount)}</td>
                                  <td className="px-2 sm:px-3 py-1.5 border text-center">
                                    {t.dealing_gbn === '직거래'
                                      ? <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap">직거래</span>
                                      : <span className="text-xs text-gray-400">중개</span>
                                    }
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {remaining > 0 && (
                          <button
                            onClick={() => setTradeListLimit(v => v + 50)}
                            className="mt-2 w-full py-2 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                          >
                            {remaining}건 더 보기 (50건씩)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>
          )}

          {!loading && !error && trades.length === 0 && (
            <div className="text-center py-12 text-gray-400">거래 내역이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}
