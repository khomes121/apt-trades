'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, EmptyState, Stat, TableWrap, cx } from '@/components/ui';
import { formatEok, formatPrice, formatRate, toPyeong } from '@/lib/format';
import { useFavorites } from '@/lib/favorites';
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
type SortDir = 'asc' | 'desc';

const SORT_LABEL: Record<SortKey, string> = {
  apt_nm: '아파트명', sgg_cd: '지역', umd_nm: '법정동', area_group: '면적', build_year: '건축년도',
  trade_count: '거래수', min_price: '최저가', max_price: '최고가',
  diff_amount: '변동폭', diff_rate: '변동률',
};

/** API 가 한 번에 돌려주는 최대 행 수 — 꽉 차면 잘렸을 수 있다고 알린다 */
const API_ROW_LIMIT = 500;
const MOBILE_PAGE = 40;

function sortValue(r: TradeResult, key: SortKey, regions: Record<string, string>): string | number {
  if (key === 'apt_nm') return r.apt_nm;
  if (key === 'sgg_cd') return regions[r.sgg_cd] ?? r.sgg_cd;
  if (key === 'umd_nm') return r.umd_nm;
  return r[key] ?? 0;
}

function naverSearchUrl(r: TradeResult) {
  const q = encodeURIComponent(`${r.umd_nm} ${r.apt_nm}`);
  return `https://search.naver.com/search.naver?query=${q}`;
}

function csvCell(v: string | number): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function AreaText({ m2 }: { m2: number }) {
  return (
    <span className="num">
      {m2}㎡ <span className="text-ink-3">({toPyeong(m2)}평)</span>
    </span>
  );
}

function SortTh({ label, col, right, sortKey, sortDir, onSort }: {
  label: string; col: SortKey; right?: boolean; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th className={right ? '!text-right' : undefined} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cx('inline-flex items-center gap-1 cursor-pointer select-none font-semibold transition-colors',
          active ? 'text-brand' : 'hover:text-ink')}
      >
        {label}
        <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden className="shrink-0">
          <path d="M4 0l3.5 4.5h-7z" fill="currentColor" opacity={active && sortDir === 'asc' ? 1 : 0.28} />
          <path d="M4 12L.5 7.5h7z" fill="currentColor" opacity={active && sortDir === 'desc' ? 1 : 0.28} />
        </svg>
      </button>
    </th>
  );
}

function StarButton({ on, onToggle, name }: { on: boolean; onToggle: () => void; name: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `${name} 관심단지에서 빼기` : `${name} 관심단지에 담기`}
      title={on ? '관심단지에서 빼기' : '관심단지에 담기'}
      onClick={e => { e.stopPropagation(); onToggle(); }}
      className={cx('h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer hover:bg-surface-3',
        on ? 'text-warn' : 'text-ink-3 hover:text-ink-2')}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor"
        strokeWidth="1.9" strokeLinejoin="round" aria-hidden>
        <path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.75-5.2 2.75 1-5.8-4.2-4.1 5.8-.85z" />
      </svg>
    </button>
  );
}

function NaverLink({ r }: { r: TradeResult }) {
  return (
    <a
      href={naverSearchUrl(r)}
      target="_blank"
      rel="noopener noreferrer"
      title="네이버에서 이 단지 찾아보기"
      onClick={e => e.stopPropagation()}
      className="inline-flex items-center rounded-md border border-ok/30 text-ok text-xs font-semibold px-1.5 py-0.5 hover:bg-ok-soft transition-colors whitespace-nowrap"
    >
      네이버
    </a>
  );
}

export default function ResultTable({ results, regions }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('diff_amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [modal, setModal] = useState<ModalTarget | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [mobileLimit, setMobileLimit] = useState(MOBILE_PAGE);
  const fav = useFavorites();

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setMobileLimit(MOBILE_PAGE);
  }

  const filtered = useMemo(() => {
    const kw = nameFilter.trim().toLowerCase();
    if (!kw) return results;
    return results.filter(r => r.apt_nm.toLowerCase().includes(kw));
  }, [results, nameFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey, regions);
      const bv = sortValue(b, sortKey, regions);
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv, 'ko') : bv.localeCompare(av, 'ko');
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filtered, sortKey, sortDir, regions]);

  // 요약 — 지금 보이는(단지명으로 거른) 행 기준
  const summary = useMemo(() => {
    if (filtered.length === 0) return null;
    let topAmt = filtered[0], topRate = filtered[0], sumAmt = 0;
    const complexes = new Set<string>();
    for (const r of filtered) {
      if (r.diff_amount > topAmt.diff_amount) topAmt = r;
      if (r.diff_rate > topRate.diff_rate) topRate = r;
      sumAmt += r.diff_amount;
      complexes.add(`${r.sgg_cd}|${r.umd_nm}|${r.apt_nm}`);
    }
    return { topAmt, topRate, avgAmt: sumAmt / filtered.length, complexCount: complexes.size };
  }, [filtered]);

  if (results.length === 0) {
    return (
      <Card>
        <EmptyState
          title="조건에 맞는 단지가 없습니다"
          desc="변동폭·변동률 기준을 낮추거나 조회 기간을 늘려 보세요. 최소 거래건수가 높아도 결과가 줄어듭니다."
        />
      </Card>
    );
  }

  function downloadCsv() {
    const header = ['아파트명', '지역', '법정동', '전용면적(㎡)', '평', '건축년도', '거래건수', '최저가(만원)', '최고가(만원)', '변동폭(만원)', '변동률(%)'];
    const rows = sorted.map(r => [
      r.apt_nm,
      regions[r.sgg_cd] ?? r.sgg_cd,
      r.umd_nm,
      r.area_group,
      toPyeong(r.area_group) ?? '',
      r.build_year ?? '',
      r.trade_count,
      r.min_price,
      r.max_price,
      r.diff_amount,
      r.diff_rate,
    ]);
    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `실거래가_변동분석_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openModal(r: TradeResult) {
    setModal({ aptNm: r.apt_nm, sggCd: r.sgg_cd, sggName: regions[r.sgg_cd] ?? r.sgg_cd, umdNm: r.umd_nm });
  }

  function toggleFav(r: TradeResult) {
    fav.toggle({ apt_nm: r.apt_nm, sgg_cd: r.sgg_cd, umd_nm: r.umd_nm, region: regions[r.sgg_cd] });
  }

  const rowKey = (r: TradeResult, i: number) => `${r.sgg_cd}|${r.umd_nm}|${r.apt_nm}|${r.area_group}|${i}`;
  const countText = nameFilter.trim()
    ? <><b className="num text-ink">{sorted.length.toLocaleString()}</b><span className="num text-ink-3"> / {results.length.toLocaleString()}</span>건</>
    : <><b className="num text-ink">{results.length.toLocaleString()}</b>건</>;

  return (
    <div className="space-y-4 sm:space-y-6">
      {modal && (
        <TradeDetailModal
          aptNm={modal.aptNm}
          sggCd={modal.sggCd}
          sggName={modal.sggName}
          umdNm={modal.umdNm}
          onClose={() => setModal(null)}
        />
      )}

      {/* 요약 */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 rise">
          <Stat label="찾은 단지·평형" value={filtered.length.toLocaleString()} unit="건"
            hint={<>단지 <span className="num">{summary.complexCount.toLocaleString()}</span>곳</>} />
          <Stat label="가장 크게 벌어진 곳" value={<span className="text-up">+{formatEok(summary.topAmt.diff_amount, 2)}</span>}
            hint={`${summary.topAmt.apt_nm} · ${toPyeong(summary.topAmt.area_group)}평`} />
          <Stat label="가장 높은 변동률" value={<span className="text-up">{formatRate(summary.topRate.diff_rate)}</span>}
            hint={`${summary.topRate.apt_nm} · ${toPyeong(summary.topRate.area_group)}평`} />
          <Stat label="평균 변동폭" value={formatEok(summary.avgAmt, 2)} hint="보이는 결과 전체 평균" />
        </div>
      )}

      <Card className="rise">
        {/* 도구 줄 */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="min-w-0 mr-auto">
            <h2 className="text-base font-semibold text-ink">검색 결과</h2>
            <p className="text-xs text-ink-2 mt-0.5">
              {countText}
              <span className="ml-1.5 text-ink-3">· {SORT_LABEL[sortKey]} {sortDir === 'desc' ? '내림차순' : '오름차순'}</span>
            </p>
          </div>
          {fav.list.length > 0 && (
            <Link href="/favorites" className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
              관심단지 <span className="num">{fav.list.length}</span>곳 보기
            </Link>
          )}
          <Button size="sm" onClick={downloadCsv} disabled={sorted.length === 0}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
            </svg>
            CSV 내려받기
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            type="search"
            placeholder="결과 안에서 단지명 찾기"
            aria-label="결과 안에서 단지명 찾기"
            value={nameFilter}
            onChange={e => { setNameFilter(e.target.value); setMobileLimit(MOBILE_PAGE); }}
            className="field !w-full sm:!w-64"
          />
          {/* 모바일 전용 정렬 */}
          <div className="flex md:hidden items-center gap-2 w-full">
            <select
              aria-label="정렬 기준"
              value={sortKey}
              onChange={e => { setSortKey(e.target.value as SortKey); setSortDir('desc'); setMobileLimit(MOBILE_PAGE); }}
              className="field flex-1"
            >
              {(Object.entries(SORT_LABEL) as [SortKey, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v} 순</option>
              ))}
            </select>
            <Button onClick={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))} className="shrink-0 whitespace-nowrap">
              {sortDir === 'desc' ? '내림차순' : '오름차순'}
            </Button>
          </div>
          <span className="hidden md:inline text-xs text-ink-3">행을 누르면 그 단지의 거래 내역과 시세 그래프가 열립니다.</span>
        </div>

        {results.length >= API_ROW_LIMIT && (
          <div className="mb-4 rounded-xl bg-warn-soft text-warn text-xs font-medium px-3.5 py-2.5">
            결과가 많아 변동폭이 큰 순서로 <span className="num">{API_ROW_LIMIT}</span>건까지만 가져왔습니다. 지역이나 조건을 좁히면 빠짐없이 볼 수 있습니다.
          </div>
        )}

        {sorted.length === 0 ? (
          <EmptyState title={`“${nameFilter.trim()}”이(가) 들어간 단지가 없습니다`} desc="결과 안 찾기 칸을 비우면 전체 결과가 다시 보입니다." />
        ) : (
          <>
            {/* 모바일: 카드 */}
            <ul className="md:hidden space-y-2.5">
              {sorted.slice(0, mobileLimit).map((r, i) => {
                const on = fav.has(r.apt_nm, r.sgg_cd);
                return (
                  <li key={rowKey(r, i)}
                    onClick={() => openModal(r)}
                    className="rounded-2xl border border-line bg-surface-2 p-3.5 cursor-pointer active:bg-surface-3 transition-colors">
                    <div className="flex items-start gap-1.5">
                      <div className="min-w-0 flex-1">
                        <button type="button" className="block max-w-full text-left text-[0.9375rem] font-semibold text-ink truncate cursor-pointer">
                          {r.apt_nm}
                        </button>
                        <div className="mt-0.5 text-xs text-ink-3 truncate">{regions[r.sgg_cd] ?? r.sgg_cd} · {r.umd_nm}</div>
                      </div>
                      <StarButton on={on} onToggle={() => toggleFav(r)} name={r.apt_nm} />
                    </div>

                    <div className="mt-2.5 flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[0.6875rem] text-ink-3">변동폭</div>
                        <div className="num text-lg font-bold text-up leading-tight">+{formatPrice(r.diff_amount)}</div>
                      </div>
                      <Badge tone="up" className="num !text-sm">{formatRate(r.diff_rate)}</Badge>
                    </div>

                    <div className="mt-3 pt-3 border-t border-line grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div className="min-w-0">
                        <div className="text-ink-3">최저가</div>
                        <div className="num font-semibold text-ink">{formatPrice(r.min_price)}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-ink-3">최고가</div>
                        <div className="num font-semibold text-ink">{formatPrice(r.max_price)}</div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-2">
                      <AreaText m2={r.area_group} />
                      <span className="text-line-strong">|</span>
                      <span className="num">{r.build_year ? `${r.build_year}년` : '건축년도 미상'}</span>
                      <span className="text-line-strong">|</span>
                      <span className="num">거래 {r.trade_count.toLocaleString()}건</span>
                      <span className="ml-auto"><NaverLink r={r} /></span>
                    </div>
                  </li>
                );
              })}
              {sorted.length > mobileLimit && (
                <li>
                  <Button className="w-full" onClick={() => setMobileLimit(n => n + MOBILE_PAGE)}>
                    더 보기 <span className="num text-ink-3">({Math.min(mobileLimit, sorted.length)} / {sorted.length})</span>
                  </Button>
                </li>
              )}
            </ul>

            {/* 데스크톱: 표 */}
            <div className="hidden md:block">
              <TableWrap maxH="min(72vh, 52rem)">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-10" aria-label="관심단지" />
                      <SortTh label="아파트명" col="apt_nm" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="지역" col="sgg_cd" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="법정동" col="umd_nm" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="전용면적" col="area_group" right sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="건축" col="build_year" right sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="거래수" col="trade_count" right sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="최저가" col="min_price" right sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="최고가" col="max_price" right sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="변동폭" col="diff_amount" right sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="변동률" col="diff_rate" right sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <th className="!text-center">링크</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r, i) => {
                      const on = fav.has(r.apt_nm, r.sgg_cd);
                      return (
                        <tr key={rowKey(r, i)} className="cursor-pointer group" onClick={() => openModal(r)}>
                          <td className="!py-1 !pr-0">
                            <StarButton on={on} onToggle={() => toggleFav(r)} name={r.apt_nm} />
                          </td>
                          <td>
                            <button type="button" className="font-semibold text-ink group-hover:text-brand transition-colors cursor-pointer text-left">
                              {r.apt_nm}
                            </button>
                          </td>
                          <td className="text-ink-2">{regions[r.sgg_cd] ?? r.sgg_cd}</td>
                          <td className="text-ink-2">{r.umd_nm}</td>
                          <td className="!text-right text-ink-2"><AreaText m2={r.area_group} /></td>
                          <td className="num !text-right text-ink-2">{r.build_year ?? '-'}</td>
                          <td className="num !text-right text-ink-2">{r.trade_count.toLocaleString()}</td>
                          <td className="num !text-right text-ink">{formatPrice(r.min_price)}</td>
                          <td className="num !text-right text-ink">{formatPrice(r.max_price)}</td>
                          <td className="num !text-right font-bold text-up">+{formatPrice(r.diff_amount)}</td>
                          <td className="num !text-right font-semibold text-up">{formatRate(r.diff_rate)}</td>
                          <td className="!text-center"><NaverLink r={r} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
