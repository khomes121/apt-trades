'use client';

import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SggMonthlyStat, UmdMonthlyStat } from '@/types';
import { Button, Chip, EmptyState, ErrorBox, Segmented, Skeleton, TableWrap, cx } from '@/components/ui';
import { formatRate, trendColor } from '@/lib/format';
import {
  RateCell, SortTh, Sparkline, formatM2Price, formatPyeongPrice, nextSort, rateScale, toneOf, ymLabel,
} from '@/components/SggTrendTable';
import type { SortState } from '@/components/SggTrendTable';

interface Props {
  sggCd: string;
  sggNm: string;
  sidoNm: string;
  /** 서버에 요청할 개월 수 */
  months: number;
  onClose: () => void;
  /** 최근 N개월 vs 직전 N개월 — 안 주면 months 에서 거꾸로 계산한다 */
  compareMonths?: number;
  /** 이 구/군의 월별 평균 (구/군 표에서 이미 받아 둔 것) — 차트의 기준선이 된다 */
  sggMonthly?: SggMonthlyStat[];
}

/** 동 선 색 — 기준선이 브랜드색을 쓰므로 디자인 시스템 계열색의 2번째부터 */
const SERIES_COLORS = ['#12996b', '#8b5cf6', '#e08a00', '#e0393e', '#0ea5b7', '#d9480f', '#5c7cfa'];
const SGG_KEY = '__sgg__';
const MIN_TRADE_OPTIONS = [5, 10, 20, 50];
const DEFAULT_PICKS = 3;

interface UmdSummary {
  umd_nm: string;
  total: number;                // 조회 기간 거래 합계
  prev: number | null;
  curr: number | null;
  rate: number | null;
  series: number[];             // 추이선용 (있는 달만)
  byYm: Record<string, number>; // ym → 만원/㎡
}

type SortKey = 'name' | 'prev' | 'curr' | 'rate' | 'trades';

/** 거래량을 가중치로 한 평균 단가 — 동은 거래가 드물어 단순 평균이면 한두 건에 휘둘린다 */
function weighted(rows: UmdMonthlyStat[]): number | null {
  const n = rows.reduce((s, r) => s + r.trade_count, 0);
  if (n === 0) return null;
  return rows.reduce((s, r) => s + r.avg_m2_price * r.trade_count, 0) / n;
}

interface TipItem { dataKey?: string | number; name?: string | number; value?: number | string; color?: string }

function ChartTip({ active, payload, label }: { active?: boolean; payload?: TipItem[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  const items = payload
    .filter((p): p is TipItem & { value: number } => typeof p.value === 'number')
    .sort((a, b) => b.value - a.value);
  return (
    <div className="bg-surface border border-line rounded-xl shadow-pop px-3 py-2.5 text-xs min-w-44">
      <div className="font-semibold text-ink">20{String(label).replace('.', '년 ')}월</div>
      <ul className="mt-1.5 space-y-1">
        {items.map(p => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="truncate">{p.name}</span>
            </span>
            <span className="num shrink-0 text-right">
              <span className="font-semibold text-ink">{formatM2Price(p.value)}</span>
              <span className="text-ink-3">만/㎡ · 평당 {formatPyeongPrice(p.value)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function UmdDrilldown({ sggCd, sggNm, sidoNm, months, onClose, compareMonths, sggMonthly }: Props) {
  const [stats, setStats]     = useState<UmdMonthlyStat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [minTrade, setMinTrade] = useState(10);
  const [view, setView]       = useState<'summary' | 'monthly'>('summary');
  const [sort, setSort]       = useState<SortState<SortKey>>({ key: 'trades', dir: 'desc' });
  /** 차트에 올린 동 → 색 자리. 다른 동을 빼도 남은 동의 색이 바뀌지 않게 자리 번호를 기억한다 */
  const [picked, setPicked]   = useState<Record<string, number>>({});

  const n = Math.max(1, compareMonths ?? Math.floor((months - 1) / 2));

  // 부모가 key 로 다시 마운트하므로 초기값(loading=true)에서 시작한다
  useEffect(() => {
    let alive = true;
    fetch('/api/trend/umd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sgg_cd: sggCd, months }),
    })
      .then(r => r.json())
      .then((json: { results?: UmdMonthlyStat[]; error?: string }) => {
        if (!alive) return;
        if (json.error) throw new Error(json.error);
        const rows = json.results ?? [];
        // 거래가 많은 동 몇 곳을 처음부터 차트에 올려 둔다
        const totals: Record<string, number> = {};
        for (const s of rows) totals[s.umd_nm] = (totals[s.umd_nm] ?? 0) + s.trade_count;
        const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, DEFAULT_PICKS);
        setPicked(Object.fromEntries(top.map(([nm], i) => [nm, i])));
        setStats(rows);
      })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : '동별 데이터를 불러오지 못했습니다.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sggCd, months]);

  // Esc 로 닫기 + 뒤 화면 스크롤 잠금
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const sggSorted = useMemo(
    () => [...(sggMonthly ?? [])].sort((a, b) => a.ym.localeCompare(b.ym)),
    [sggMonthly],
  );

  const { yms, currYms, umds } = useMemo(() => {
    const ymSet = new Set<string>(sggSorted.map(s => s.ym));
    for (const s of stats ?? []) ymSet.add(s.ym);
    const yms = [...ymSet].sort();
    const currYms = yms.slice(-n);
    const prevYms = yms.slice(-n * 2, -n);

    const grouped: Record<string, UmdMonthlyStat[]> = {};
    for (const s of stats ?? []) (grouped[s.umd_nm] ??= []).push(s);

    const umds: UmdSummary[] = Object.entries(grouped).map(([umd_nm, rows]) => {
      const ordered = [...rows].sort((a, b) => a.ym.localeCompare(b.ym));
      const curr = weighted(ordered.filter(r => currYms.includes(r.ym)));
      const prev = weighted(ordered.filter(r => prevYms.includes(r.ym)));
      return {
        umd_nm,
        total: ordered.reduce((s, r) => s + r.trade_count, 0),
        prev, curr,
        rate: curr != null && prev != null && prev > 0 ? Math.round((curr - prev) / prev * 1000) / 10 : null,
        series: ordered.map(r => r.avg_m2_price),
        byYm: Object.fromEntries(ordered.map(r => [r.ym, Math.round(r.avg_m2_price * 10) / 10])),
      };
    });
    return { yms, currYms, umds };
  }, [stats, sggSorted, n]);

  const visible = useMemo(() => {
    const sign = sort.dir === 'asc' ? 1 : -1;
    const val = (u: UmdSummary): number | null =>
      sort.key === 'prev' ? u.prev : sort.key === 'curr' ? u.curr : sort.key === 'rate' ? u.rate : u.total;
    return umds.filter(u => u.total >= minTrade).sort((a, b) => {
      if (sort.key === 'name') return sign * a.umd_nm.localeCompare(b.umd_nm, 'ko');
      const av = val(a), bv = val(b);
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1; // 값 없는 동은 늘 아래로
      return sign * (av - bv);
    });
  }, [umds, minTrade, sort]);

  // 차트에 올라간 동 (자리 번호순 = 범례 순서)
  const lines = useMemo(
    () => Object.entries(picked).sort((a, b) => a[1] - b[1])
      .map(([nm, slot]) => ({ nm, color: SERIES_COLORS[slot] }))
      .filter(l => umds.some(u => u.umd_nm === l.nm)),
    [picked, umds],
  );

  const chartData = useMemo(() => {
    const sggBy = Object.fromEntries(sggSorted.map(s => [s.ym, Math.round(s.avg_m2_price * 10) / 10]));
    const umdBy = Object.fromEntries(umds.map(u => [u.umd_nm, u.byYm]));
    return yms.map(ym => {
      const row: Record<string, string | number> = { ym: ymLabel(ym) };
      if (sggBy[ym] != null) row[SGG_KEY] = sggBy[ym];
      for (const l of lines) {
        const v = umdBy[l.nm]?.[ym];
        if (v != null) row[l.nm] = v;
      }
      return row;
    });
  }, [yms, sggSorted, umds, lines]);

  const full = Object.keys(picked).length >= SERIES_COLORS.length;

  function toggle(nm: string) {
    setPicked(cur => {
      if (nm in cur) {
        const next = { ...cur };
        delete next[nm];
        return next;
      }
      const used = new Set(Object.values(cur));
      const slot = SERIES_COLORS.findIndex((_, i) => !used.has(i));
      return slot < 0 ? cur : { ...cur, [nm]: slot };
    });
  }

  const onSort = (k: SortKey) => setSort(s => nextSort(s, k, k === 'name' ? 'asc' : 'desc'));
  const scale = rateScale(visible.map(u => u.rate));

  // 구/군 요약 (머리 숫자)
  const sggCurrRows = sggSorted.slice(-n);
  const sggPrevRows = sggSorted.slice(-n * 2, -n);
  const mean = (rows: SggMonthlyStat[]) => (rows.length ? rows.reduce((s, r) => s + r.avg_m2_price, 0) / rows.length : null);
  const sggCurr = mean(sggCurrRows);
  const sggPrev = mean(sggPrevRows);
  const sggRate = sggCurr != null && sggPrev ? Math.round((sggCurr - sggPrev) / sggPrev * 1000) / 10 : null;
  const hasChart = chartData.length >= 2 && (sggSorted.length > 0 || lines.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgb(0 0 0 / 0.55)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={`${sidoNm} ${sggNm} 동별 시세 동향`}
        className="rise bg-bg w-full sm:max-w-4xl h-dvh sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden sm:rounded-2xl sm:border sm:border-line shadow-pop"
      >
        {/* 머리 */}
        <div className="flex items-start justify-between gap-3 border-b border-line bg-surface px-4 sm:px-6 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wide text-brand">{sidoNm}</div>
            <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight text-ink">{sggNm} 동별 시세</h2>
            <p className="mt-0.5 text-xs text-ink-3">㎡당 평균 단가 · 최근 {n}개월과 직전 {n}개월 비교</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="닫기" className="shrink-0 -mr-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            닫기
          </Button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 sm:py-5 space-y-4">
          {/* 구/군 요약 */}
          {sggCurr != null && (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="min-w-0 rounded-xl border border-line bg-surface p-3">
                <div className="text-xs text-ink-3">최근 단가</div>
                <div className="mt-1 num text-base sm:text-lg font-bold text-ink leading-tight">
                  {formatM2Price(sggCurr)}<span className="ml-0.5 text-xs font-medium text-ink-3">만/㎡</span>
                </div>
              </div>
              <div className="min-w-0 rounded-xl border border-line bg-surface p-3">
                <div className="text-xs text-ink-3">평당가</div>
                <div className="mt-1 num text-base sm:text-lg font-bold text-ink leading-tight">{formatPyeongPrice(sggCurr)}</div>
              </div>
              <div className="min-w-0 rounded-xl border border-line bg-surface p-3">
                <div className="text-xs text-ink-3">변동률</div>
                <div className={cx('mt-1 num text-base sm:text-lg font-bold leading-tight', trendColor(sggRate))}>{formatRate(sggRate)}</div>
              </div>
            </div>
          )}

          {loading && (
            <>
              <Skeleton className="h-72 !rounded-2xl" />
              <Skeleton className="h-64 !rounded-2xl" />
            </>
          )}

          {!loading && error && <ErrorBox>{error}</ErrorBox>}

          {!loading && !error && stats && (
            <>
              {/* 차트 */}
              <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h3 className="text-sm font-semibold text-ink">월별 ㎡당 단가</h3>
                  <span className="text-xs text-ink-3">단위 만원/㎡ · 옅은 띠가 최근 {n}개월</span>
                </div>

                {/* 범례 — 동 이름을 누르면 차트에서 뺀다 */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {sggSorted.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink">
                      <span className="h-[3px] w-3.5 rounded-full bg-brand" />{sggNm} 평균
                    </span>
                  )}
                  {lines.map(l => (
                    <button key={l.nm} type="button" onClick={() => toggle(l.nm)} title="차트에서 빼기"
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink cursor-pointer">
                      <span className="h-0.5 w-3.5 rounded-full" style={{ background: l.color }} />
                      {l.nm}
                      <span className="text-ink-3" aria-hidden>×</span>
                    </button>
                  ))}
                </div>

                {!hasChart ? (
                  <EmptyState icon="📉" title="그릴 수 있는 월별 데이터가 부족합니다" desc="두 달 이상 거래가 있어야 흐름을 그릴 수 있습니다." />
                ) : (
                  <div className="mt-2 h-64 sm:h-72 -ml-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--line)" />
                        {currYms.length > 1 && (
                          <ReferenceArea x1={ymLabel(currYms[0])} x2={ymLabel(currYms[currYms.length - 1])}
                            fill="var(--brand)" fillOpacity={0.07} stroke="none" ifOverflow="hidden" />
                        )}
                        <XAxis dataKey="ym" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false}
                          minTickGap={16} padding={{ left: 8, right: 8 }} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} width={48}
                          domain={['auto', 'auto']} tickFormatter={(v: number) => Math.round(v).toLocaleString()} />
                        <Tooltip content={<ChartTip />} cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }} />
                        {lines.map(l => (
                          <Line key={l.nm} type="monotone" dataKey={l.nm} name={l.nm} stroke={l.color} strokeWidth={2}
                            dot={{ r: 2.5, strokeWidth: 0, fill: l.color }}
                            activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
                            connectNulls isAnimationActive={false} />
                        ))}
                        {sggSorted.length > 0 && (
                          <Line type="monotone" dataKey={SGG_KEY} name={`${sggNm} 평균`} stroke="var(--brand)" strokeWidth={3}
                            dot={{ r: 3, strokeWidth: 0, fill: 'var(--brand)' }}
                            activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
                            connectNulls isAnimationActive={false} />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <p className="mt-2 text-xs text-ink-3">이번 달은 신고가 아직 덜 들어와 값이 달라질 수 있습니다.</p>
              </section>

              {/* 동 표 */}
              <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-ink">
                      동별 비교 <span className="num ml-1 text-xs font-medium text-ink-3">{visible.length}곳</span>
                    </h3>
                    <p className="mt-0.5 text-xs text-ink-3">
                      동을 누르면 위 차트에 선이 추가됩니다{full ? ` · 최대 ${SERIES_COLORS.length}곳까지 올릴 수 있습니다` : ''}
                    </p>
                  </div>
                  <Segmented size="sm" value={view} onChange={setView}
                    options={[{ value: 'summary', label: '요약' }, { value: 'monthly', label: '월별 단가' }]} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-ink-3">기간 내 거래</span>
                  {MIN_TRADE_OPTIONS.map(v => (
                    <Chip key={v} size="sm" active={minTrade === v} onClick={() => setMinTrade(v)}>{v}건 이상</Chip>
                  ))}
                </div>

                <div className="mt-3">
                  {visible.length === 0 ? (
                    <EmptyState title={`거래가 ${minTrade}건 이상인 동이 없습니다`} desc="기준 건수를 낮추면 거래가 적은 동도 볼 수 있습니다." />
                  ) : (
                    <TableWrap maxH="26rem">
                      <table className="data-table">
                        <thead>
                          {view === 'summary' ? (
                            <tr>
                              <SortTh k="name" sort={sort} onSort={onSort}>동</SortTh>
                              <th>월별 추이</th>
                              <SortTh k="prev" sort={sort} onSort={onSort} right className="hidden sm:table-cell">이전 단가</SortTh>
                              <SortTh k="curr" sort={sort} onSort={onSort} right>최근 단가</SortTh>
                              <SortTh k="rate" sort={sort} onSort={onSort} right>변동률</SortTh>
                              <SortTh k="trades" sort={sort} onSort={onSort} right>거래</SortTh>
                            </tr>
                          ) : (
                            <tr>
                              <SortTh k="name" sort={sort} onSort={onSort}>동</SortTh>
                              {yms.map(ym => <th key={ym} className="!text-right num">{ymLabel(ym)}</th>)}
                            </tr>
                          )}
                        </thead>
                        <tbody>
                          {visible.map(u => {
                            const slot = picked[u.umd_nm];
                            const on = slot != null;
                            const nameCell = (
                              <td>
                                <span className="inline-flex items-center gap-2">
                                  <span
                                    className={cx('h-2.5 w-2.5 shrink-0 rounded-full border', !on && 'border-line-strong')}
                                    style={on ? { background: SERIES_COLORS[slot], borderColor: SERIES_COLORS[slot] } : undefined}
                                    aria-hidden
                                  />
                                  <span className={cx('font-semibold', on ? 'text-ink' : 'text-ink-2')}>{u.umd_nm}</span>
                                </span>
                              </td>
                            );
                            return (
                              <tr
                                key={u.umd_nm}
                                tabIndex={0}
                                aria-selected={on}
                                className={cx('cursor-pointer', !on && full && 'opacity-60')}
                                onClick={() => toggle(u.umd_nm)}
                                onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
                                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(u.umd_nm); }
                                }}
                              >
                                {nameCell}
                                {view === 'summary' ? (
                                  <>
                                    <td><Sparkline values={u.series} tone={toneOf(u.rate)} label={`${u.umd_nm} 월별 ㎡당 단가 추이`} /></td>
                                    <td className="num !text-right text-ink-2 hidden sm:table-cell">{formatM2Price(u.prev)}</td>
                                    <td className="!text-right">
                                      <div className="num font-bold text-ink">
                                        {formatM2Price(u.curr)}{u.curr != null && <span className="ml-0.5 text-xs font-medium text-ink-3">만/㎡</span>}
                                      </div>
                                      {u.curr != null && <div className="num text-xs text-ink-3">평당 {formatPyeongPrice(u.curr)}</div>}
                                    </td>
                                    <td className="!text-right"><RateCell value={u.rate} max={scale} /></td>
                                    <td className="num !text-right text-ink-2">{u.total.toLocaleString()}<span className="ml-0.5 text-xs text-ink-3">건</span></td>
                                  </>
                                ) : (
                                  yms.map(ym => (
                                    <td key={ym} className={cx('num !text-right', currYms.includes(ym) ? 'text-ink font-medium' : 'text-ink-2')}>
                                      {u.byYm[ym] != null ? formatM2Price(u.byYm[ym]) : <span className="text-ink-3">-</span>}
                                    </td>
                                  ))
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </TableWrap>
                  )}
                </div>
                <p className="mt-3 text-xs text-ink-3">
                  동별 단가는 거래량을 가중치로 한 평균입니다. 비교할 달에 거래가 없으면 변동률을 비워 둡니다.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
