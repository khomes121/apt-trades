'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Region, SggMonthlyStat, SggTrendSummary } from '@/types';
import RegionSelector from '@/components/RegionSelector';
import SggTrendTable, { formatM2Price, formatPyeongPrice, rateScale } from '@/components/SggTrendTable';
import UmdDrilldown from '@/components/UmdDrilldown';
import TrendRecommendations from '@/components/TrendRecommendations';
import {
  Badge, Button, Card, CardTitle, Chip, EmptyState, ErrorBox, Label, Page, PageHeader, Segmented, Skeleton, Spinner, Stat,
} from '@/components/ui';
import { formatRate, trendColor } from '@/lib/format';

const MONTH_OPTIONS = [
  { label: '1개월', value: '1' },
  { label: '3개월', value: '3' },
  { label: '6개월', value: '6' },
];

const MIN_TRADE_OPTIONS = [10, 30, 100, 200, 500];

/**
 * 서버에 요청하는 개월 수. 서버는 months+1 개월치를 돌려주므로 12 면 13개월 —
 * 가장 긴 비교(6개월 vs 6개월)에 필요한 양이고, 추이선도 1년치를 그릴 수 있다.
 * 비교 기간을 바꿔도 다시 조회할 필요가 없다.
 */
const HISTORY_MONTHS = 12;

/** 빈 화면에서 한 번에 조회하는 지역 묶음 (시·도 코드) */
const QUICK_PRESETS: Array<{ label: string; sido_cds: string[] | null }> = [
  { label: '부산', sido_cds: ['26'] },
  { label: '수도권', sido_cds: ['11', '41', '28'] },
  { label: '5대광역시', sido_cds: ['26', '27', '29', '30', '31'] },
  { label: '전국', sido_cds: null },
];

type Direction = 'all' | 'up' | 'down';

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

const codesKey = (codes: string[]) => [...codes].sort().join(',');

export default function TrendPage() {
  const [regions, setRegions]           = useState<Region[]>([]);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [compareMonths, setCompareMonths] = useState(1);
  const [minTrade, setMinTrade]         = useState(100);
  const [stats, setStats]               = useState<SggMonthlyStat[] | null>(null);
  const [queriedKey, setQueriedKey]     = useState<string | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [drilldown, setDrilldown]       = useState<SggTrendSummary | null>(null);
  const [regionOpen, setRegionOpen]     = useState(true);
  const [direction, setDirection]       = useState<Direction>('all');
  const [nameQuery, setNameQuery]       = useState('');
  const reqSeq = useRef(0);

  useEffect(() => {
    fetch('/api/regions')
      .then(r => r.json())
      .then(setRegions)
      .catch(() => setError('지역 정보를 불러오지 못했습니다.'));
  }, []);

  const handleSearch = useCallback(async (codesOverride?: string[]) => {
    const codes = codesOverride ?? selectedCodes;
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    setStats(null);
    setRegionOpen(false);
    try {
      const res  = await fetch('/api/trend/sgg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sgg_codes: codes.length > 0 ? codes : undefined, // 비우면 전국
          months: HISTORY_MONTHS,
        }),
      });
      const json = await res.json() as { results?: SggMonthlyStat[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? '조회하지 못했습니다.');
      if (seq !== reqSeq.current) return;
      setStats(json.results ?? []);
      setQueriedKey(codesKey(codes));
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [selectedCodes]);

  function runPreset(sido_cds: string[] | null) {
    const codes = sido_cds ? regions.filter(r => sido_cds.includes(r.sido_cd)).map(r => r.sgg_cd) : [];
    setSelectedCodes(codes);
    handleSearch(codes);
  }

  const closeDrilldown = useCallback(() => setDrilldown(null), []);

  // 거래건수로 거르기 전 전체
  const allSummaries = useMemo(
    () => (stats ? calcTrend(stats, compareMonths) : null),
    [stats, compareMonths],
  );

  const summaries = useMemo(() => {
    if (!allSummaries) return null;
    return allSummaries
      .filter(s => s.trade_count >= minTrade)
      .sort((a, b) => b.change_rate - a.change_rate);
  }, [allSummaries, minTrade]);

  const kpi = useMemo(() => {
    if (!summaries || summaries.length === 0) return null;
    const rates = summaries.map(s => s.change_rate);
    const sortedRates = [...rates].sort((a, b) => a - b);
    const mid = Math.floor(sortedRates.length / 2);
    const median = sortedRates.length % 2 ? sortedRates[mid] : (sortedRates[mid - 1] + sortedRates[mid]) / 2;
    const top = summaries[0];
    const bottom = summaries[summaries.length - 1];
    return {
      count: summaries.length,
      up: rates.filter(r => r > 0).length,
      down: rates.filter(r => r < 0).length,
      avg: rates.reduce((s, r) => s + r, 0) / rates.length,
      median,
      trades: summaries.reduce((s, r) => s + r.trade_count, 0),
      top: top.change_rate > 0 ? top : null,
      bottom: bottom.change_rate < 0 ? bottom : null,
      scale: rateScale(rates),
    };
  }, [summaries]);

  const tableRows = useMemo(() => {
    if (!summaries) return [];
    const q = nameQuery.trim();
    return summaries.filter(s =>
      (direction === 'all' || (direction === 'up' ? s.change_rate > 0 : s.change_rate < 0)) &&
      (!q || `${s.sido_nm} ${s.sgg_nm}`.includes(q)),
    );
  }, [summaries, direction, nameQuery]);

  // 선택한 지역을 시·도별로 간추린 한 줄
  const regionSummary = useMemo(() => {
    if (selectedCodes.length === 0) return '전국';
    const set = new Set(selectedCodes);
    const bySido = new Map<string, number>();
    for (const r of regions) if (set.has(r.sgg_cd)) bySido.set(r.sido_nm, (bySido.get(r.sido_nm) ?? 0) + 1);
    const parts = [...bySido.entries()].map(([nm, n]) => `${nm} ${n}곳`);
    if (parts.length === 0) return `${selectedCodes.length}개 구·군`;
    return parts.length > 3 ? `${parts.slice(0, 3).join(' · ')} 외 ${parts.length - 3}개 시·도` : parts.join(' · ');
  }, [selectedCodes, regions]);

  const stale = stats !== null && !loading && queriedKey !== codesKey(selectedCodes);
  const excluded = allSummaries && summaries ? allSummaries.length - summaries.length : 0;

  return (
    <>
    <Page>
      <PageHeader
        eyebrow="지역"
        title="시세 동향"
        desc="구·군별 ㎡당 평균 단가가 최근 얼마나 움직였는지 비교하고, 동 단위까지 들여다봅니다."
      />

      {/* 조회 조건 */}
      <Card>
        <div className="flex flex-wrap gap-x-10 gap-y-5">
          <div>
            <Label hint={`최근 ${compareMonths}개월과 직전 ${compareMonths}개월`}>비교 기간</Label>
            <Segmented
              value={String(compareMonths)}
              options={MONTH_OPTIONS}
              onChange={v => setCompareMonths(Number(v))}
            />
          </div>

          <div className="min-w-0">
            <Label hint="최근 기간 합계 기준">최소 거래건수</Label>
            <div className="flex flex-wrap gap-1.5">
              {MIN_TRADE_OPTIONS.map(v => (
                <Chip key={v} active={minTrade === v} onClick={() => setMinTrade(v)}>
                  <span className="num">{v}</span>건
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <Label hint="고르지 않으면 전국을 조회합니다">지역</Label>
              <div className="-mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                <Badge tone={selectedCodes.length === 0 ? 'neutral' : 'brand'}>
                  {selectedCodes.length === 0 ? '전국' : `${selectedCodes.length}개 구·군`}
                </Badge>
                {selectedCodes.length > 0 && <span className="min-w-0 truncate">{regionSummary}</span>}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setRegionOpen(o => !o)} aria-expanded={regionOpen}>
              {regionOpen ? '지역 접기' : '지역 고르기'}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden className={regionOpen ? 'rotate-180' : undefined}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </Button>
          </div>
          {regionOpen && (
            <div className="mt-3">
              <RegionSelector
                regions={regions}
                selectedCodes={selectedCodes}
                onChange={setSelectedCodes}
              />
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="min-w-0 text-xs text-ink-3">
            {stale
              ? <span className="font-medium text-warn">지역을 바꾸셨습니다. 다시 조회하면 결과에 반영됩니다.</span>
              : '비교 기간과 최소 거래건수는 조회한 뒤에 바꿔도 바로 반영됩니다.'}
          </p>
          <Button variant="primary" size="lg" onClick={() => handleSearch()} disabled={loading} className="w-full sm:w-auto">
            {loading && <Spinner />}
            {loading ? '조회하는 중' : '동향 조회'}
          </Button>
        </div>
      </Card>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/* 조회 전 */}
      {!loading && !error && summaries === null && (
        <Card>
          <EmptyState
            icon="📈"
            title="어느 지역의 흐름을 볼까요?"
            desc="위에서 지역을 고른 뒤 ‘동향 조회’를 누르거나, 아래 묶음을 눌러 바로 조회해 보세요."
          />
          <div className="-mt-6 flex flex-wrap justify-center gap-2 pb-6">
            {QUICK_PRESETS.map(p => (
              <Chip key={p.label} onClick={() => runPreset(p.sido_cds)} disabled={p.sido_cds !== null && regions.length === 0}>
                {p.label}
              </Chip>
            ))}
          </div>
        </Card>
      )}

      {/* 조회 중 */}
      {loading && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[6.5rem] !rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <Skeleton className="h-80 !rounded-2xl" />
            <Skeleton className="h-80 !rounded-2xl" />
          </div>
          <Skeleton className="h-96 !rounded-2xl" />
        </>
      )}

      {/* 결과 0건 */}
      {summaries !== null && summaries.length === 0 && (
        <Card>
          <EmptyState
            title="조건에 맞는 지역이 없습니다"
            desc={excluded > 0
              ? `거래가 ${minTrade}건에 못 미쳐 ${excluded}곳이 빠졌습니다. 최소 거래건수를 낮추거나 비교 기간을 늘려 보세요.`
              : '이 지역에는 비교할 만큼의 월별 데이터가 아직 없습니다. 지역을 넓혀 다시 조회해 보세요.'}
          />
          {excluded > 0 && minTrade > MIN_TRADE_OPTIONS[0] && (
            <div className="-mt-6 flex justify-center pb-6">
              <Button size="sm" onClick={() => setMinTrade(MIN_TRADE_OPTIONS[0])}>최소 {MIN_TRADE_OPTIONS[0]}건으로 낮추기</Button>
            </div>
          )}
        </Card>
      )}

      {/* 결과 */}
      {summaries !== null && summaries.length > 0 && kpi && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 rise">
            <Stat
              label="분석 지역"
              value={kpi.count.toLocaleString()}
              unit="곳"
              hint={`상승 ${kpi.up} · 하락 ${kpi.down}${excluded > 0 ? ` · 거래 부족 ${excluded}곳 제외` : ''}`}
            />
            <Stat
              label={`평균 변동률 (${compareMonths}개월)`}
              value={<span className={trendColor(kpi.avg)}>{formatRate(kpi.avg)}</span>}
              hint={`중앙값 ${formatRate(kpi.median)} · 거래 ${kpi.trades.toLocaleString()}건`}
            />
            <Stat
              label="가장 많이 오른 곳"
              value={<span className="text-xl sm:text-2xl leading-tight break-keep">{kpi.top?.sgg_nm ?? '-'}</span>}
              delta={kpi.top && <span className="num text-up">{formatRate(kpi.top.change_rate)}</span>}
              hint={kpi.top
                ? `${kpi.top.sido_nm} · ${formatM2Price(kpi.top.curr_price)}만/㎡ · 평당 ${formatPyeongPrice(kpi.top.curr_price)}`
                : '오른 지역이 없습니다'}
            />
            <Stat
              label="가장 많이 내린 곳"
              value={<span className="text-xl sm:text-2xl leading-tight break-keep">{kpi.bottom?.sgg_nm ?? '-'}</span>}
              delta={kpi.bottom && <span className="num text-down">{formatRate(kpi.bottom.change_rate)}</span>}
              hint={kpi.bottom
                ? `${kpi.bottom.sido_nm} · ${formatM2Price(kpi.bottom.curr_price)}만/㎡ · 평당 ${formatPyeongPrice(kpi.bottom.curr_price)}`
                : '내린 지역이 없습니다'}
            />
          </div>

          <TrendRecommendations summaries={summaries} compareMonths={compareMonths} onSelect={setDrilldown} />

          <Card>
            <CardTitle
              sub="행을 누르면 그 구·군의 동별 동향이 열립니다. 머리글을 누르면 정렬됩니다."
              right={
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <input
                    value={nameQuery}
                    onChange={e => setNameQuery(e.target.value)}
                    placeholder="지역 이름으로 찾기"
                    aria-label="지역 이름으로 찾기"
                    className="field !w-full sm:!w-44"
                  />
                  <Segmented<Direction>
                    size="sm"
                    value={direction}
                    onChange={setDirection}
                    options={[
                      { value: 'all', label: <>전체 <span className="num">{kpi.count}</span></> },
                      { value: 'up', label: <>상승 <span className="num">{kpi.up}</span></> },
                      { value: 'down', label: <>하락 <span className="num">{kpi.down}</span></> },
                    ]}
                  />
                </div>
              }
            >
              구·군별 시세 동향
            </CardTitle>
            <SggTrendTable
              rows={tableRows}
              onRowClick={setDrilldown}
              scaleMax={kpi.scale}
              activeCd={drilldown?.sgg_cd}
            />
            <p className="mt-3 text-xs text-ink-3">
              단가는 월별 ㎡당 평균 거래가(만원)의 기간 평균이며, 평당가는 ㎡당 단가에 3.3058 을 곱한 값입니다.
              이번 달은 신고가 아직 덜 들어와 값이 달라질 수 있습니다.
            </p>
          </Card>
        </>
      )}

    </Page>

      {/* 동별 드릴다운 — Page 의 세로 간격에 끼지 않게 밖에 둔다 */}
      {drilldown && (
        <UmdDrilldown
          key={drilldown.sgg_cd}
          sggCd={drilldown.sgg_cd}
          sggNm={drilldown.sgg_nm}
          sidoNm={drilldown.sido_nm}
          months={HISTORY_MONTHS}
          compareMonths={compareMonths}
          sggMonthly={drilldown.monthly}
          onClose={closeDrilldown}
        />
      )}
    </>
  );
}
