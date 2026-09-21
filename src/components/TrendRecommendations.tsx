'use client';

import { useMemo } from 'react';
import type { SggTrendSummary } from '@/types';
import { Badge, Card, CardTitle, cx } from '@/components/ui';
import { formatRate, trendColor } from '@/lib/format';
import { Sparkline, formatM2Price, formatPyeongPrice, toneOf } from '@/components/SggTrendTable';

interface RecommendGroup {
  sido_nm: string;
  hot: SggTrendSummary[];      // 상승 상위
  watch: SggTrendSummary[];    // 아직 덜 오른 인근
}

function calcRecommendations(summaries: SggTrendSummary[]): RecommendGroup[] {
  // 시도별 그룹핑
  const sidoMap: Record<string, SggTrendSummary[]> = {};
  for (const s of summaries) {
    if (!sidoMap[s.sido_nm]) sidoMap[s.sido_nm] = [];
    sidoMap[s.sido_nm].push(s);
  }

  const result: RecommendGroup[] = [];

  for (const [sido_nm, rows] of Object.entries(sidoMap)) {
    if (rows.length < 3) continue; // 구/군이 너무 적으면 skip

    const sorted = [...rows].sort((a, b) => b.change_rate - a.change_rate);
    const avg = rows.reduce((s, r) => s + r.change_rate, 0) / rows.length;

    // HOT: 시도 평균보다 2%p 이상 높고, 상위 1/3 이내
    const topN   = Math.max(1, Math.ceil(sorted.length / 3));
    const hot    = sorted.slice(0, topN).filter(r => r.change_rate > avg + 2);
    if (hot.length === 0) continue;

    // WATCH: 상승 중이지만 HOT 기준의 절반 이하 & 아직 하락은 아닌 곳
    const hotAvgRate = hot.reduce((s, r) => s + r.change_rate, 0) / hot.length;
    const watch = sorted
      .filter(r => !hot.includes(r))
      .filter(r => r.change_rate >= 0 && r.change_rate < hotAvgRate * 0.5)
      .slice(0, 3);

    if (watch.length === 0) continue;

    result.push({ sido_nm, hot, watch });
  }

  // HOT 상승률 내림차순 정렬
  return result.sort(
    (a, b) =>
      Math.max(...b.hot.map(r => r.change_rate)) -
      Math.max(...a.hot.map(r => r.change_rate))
  );
}

const TOP_N = 5;

interface Props {
  summaries: SggTrendSummary[];
  compareMonths: number;
  /** 지역을 누르면 동별 동향을 연다 */
  onSelect?: (row: SggTrendSummary) => void;
}

/** 순위 한 줄 — 순위 · 지역 · 작은 추이선 · 최근 단가 · 변동률 */
function RankRow({ rank, row, onSelect }: { rank: number; row: SggTrendSummary; onSelect?: (r: SggTrendSummary) => void }) {
  const tone = toneOf(row.change_rate);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(row)}
        className="w-full flex items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-surface-2 cursor-pointer"
      >
        <span className={cx(
          'num h-6 w-6 shrink-0 rounded-lg text-xs font-bold inline-flex items-center justify-center',
          rank === 1 ? (tone === 'down' ? 'bg-down-soft text-down' : 'bg-up-soft text-up') : 'bg-surface-3 text-ink-2',
        )}>{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{row.sgg_nm}</span>
          <span className="block truncate text-xs text-ink-3">
            {row.sido_nm} · <span className="num">{row.trade_count.toLocaleString()}</span>건
          </span>
        </span>
        <Sparkline values={row.monthly.map(m => m.avg_m2_price)} tone={tone} width={64} height={24}
          label={`${row.sgg_nm} 월별 ㎡당 단가 추이`} />
        <span className="hidden min-[420px]:block w-24 shrink-0 text-right">
          <span className="num block text-sm font-semibold text-ink">
            {formatM2Price(row.curr_price)}<span className="ml-0.5 text-xs font-medium text-ink-3">만/㎡</span>
          </span>
          <span className="num block text-xs text-ink-3">평당 {formatPyeongPrice(row.curr_price)}</span>
        </span>
        <Badge tone={tone === 'flat' ? 'neutral' : tone} className="num w-[4.25rem] shrink-0 justify-center">
          {formatRate(row.change_rate)}
        </Badge>
      </button>
    </li>
  );
}

function RankCard({ title, sub, rows, emptyText, onSelect }: {
  title: string; sub: string; rows: SggTrendSummary[]; emptyText: string; onSelect?: (r: SggTrendSummary) => void;
}) {
  return (
    <Card>
      <CardTitle sub={sub}>{title}</CardTitle>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-3">{emptyText}</p>
      ) : (
        <ol className="-mx-2 divide-y divide-line">
          {rows.map((r, i) => <RankRow key={r.sgg_cd} rank={i + 1} row={r} onSelect={onSelect} />)}
        </ol>
      )}
    </Card>
  );
}

function PlaceRow({ row, kind, onSelect }: { row: SggTrendSummary; kind: 'hot' | 'watch'; onSelect?: (r: SggTrendSummary) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(row)}
        className="w-full flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-brand cursor-pointer"
      >
        <span className="min-w-0 truncate text-sm font-medium text-ink">{row.sgg_nm}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="num text-xs text-ink-3">{row.trade_count.toLocaleString()}건</span>
          {kind === 'hot'
            ? <Badge tone="up" className="num">{formatRate(row.change_rate)}</Badge>
            : <span className={cx('num text-sm font-bold', trendColor(row.change_rate))}>{formatRate(row.change_rate)}</span>}
        </span>
      </button>
    </li>
  );
}

export default function TrendRecommendations({ summaries, compareMonths, onSelect }: Props) {
  const { risers, fallers, groups } = useMemo(() => {
    const byRate = [...summaries].sort((a, b) => b.change_rate - a.change_rate);
    return {
      risers: byRate.filter(s => s.change_rate > 0).slice(0, TOP_N),
      fallers: byRate.filter(s => s.change_rate < 0).reverse().slice(0, TOP_N),
      groups: calcRecommendations(summaries),
    };
  }, [summaries]);

  const basis = `최근 ${compareMonths}개월과 직전 ${compareMonths}개월의 ㎡당 평균 단가 비교`;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <RankCard title="많이 오른 곳" sub={basis} rows={risers} onSelect={onSelect}
          emptyText="이 조건에서 오른 지역이 없습니다." />
        <RankCard title="많이 내린 곳" sub={basis} rows={fallers} onSelect={onSelect}
          emptyText="이 조건에서 내린 지역이 없습니다." />
      </div>

      <Card>
        <CardTitle sub="같은 시·도 안에서 평균보다 크게 오른 곳과, 그 옆에서 아직 덜 오른 곳을 나란히 보여 줍니다.">
          눈여겨볼 지역
        </CardTitle>
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-3">
            추천 지역을 뽑기에는 데이터가 부족합니다. 지역을 넓히거나 전국으로 다시 조회해 보세요.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              {groups.map(g => (
                <div key={g.sido_nm} className="rounded-xl border border-line bg-surface-2 p-4">
                  <div className="mb-3 text-sm font-semibold text-ink">{g.sido_nm}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <div className="mb-1.5 text-xs font-medium text-ink-2">크게 오른 곳</div>
                      <ul className="space-y-1.5">
                        {g.hot.map(r => <PlaceRow key={r.sgg_cd} row={r} kind="hot" onSelect={onSelect} />)}
                      </ul>
                    </div>
                    <div className="min-w-0">
                      <div className="mb-1.5 text-xs font-medium text-ink-2">
                        아직 덜 오른 곳 <span className="font-normal text-ink-3">(같은 시·도)</span>
                      </div>
                      <ul className="space-y-1.5">
                        {g.watch.map(r => <PlaceRow key={r.sgg_cd} row={r} kind="watch" onSelect={onSelect} />)}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-3">
              기준: 시·도 평균보다 2%p 넘게 오른 상위 3분의 1을 &lsquo;크게 오른 곳&rsquo;으로, 하락하지 않았지만 그 절반에 못 미치는 곳을
              &lsquo;아직 덜 오른 곳&rsquo;으로 봅니다. 참고용 지표이며 투자 판단은 본인 책임입니다.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
