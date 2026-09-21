'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Card, CardTitle, EmptyState, Page, Skeleton, Stat, TableWrap } from '@/components/ui';
import { formatArea, formatEok, formatKDate, formatPrice, formatRate, formatShortDate, formatUtcToKst, trendColor } from '@/lib/format';

interface DailyRow { deal_date: string; trade_count: number; avg_amount: number }
interface TopTrade {
  apt_nm: string; sgg_cd: string; sido_nm: string | null; sgg_nm: string | null; umd_nm: string | null;
  exclu_use_ar: number; floor: number | null; deal_amount: number; deal_date: string; build_year: number | null;
}
interface SidoRow { sido_cd: string; sido_nm: string; trade_count: number; avg_amount: number }
interface HomeData {
  latestDate: string | null; daily: DailyRow[]; topTrades: TopTrade[]; bySido: SidoRow[];
}
interface Health {
  apt?: { lastCollectedAt?: string; changed24h?: number; latestDealDate?: string };
  villa?: { lastCollectedAt?: string; changed24h?: number; latestDealDate?: string };
}

const TOOLS = [
  { href: '/search', title: '변동 분석', desc: '같은 단지·같은 평형 안에서 최저가와 최고가가 얼마나 벌어졌는지 찾습니다.', icon: 'M3 17l5-5 4 3 8-9M15 6h5v5' },
  { href: '/daily', title: '날짜별 실거래', desc: '하루치 거래를 지역별로 묶어 봅니다. 어제 어디서 얼마에 팔렸는지.', icon: 'M8 2v4M16 2v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z' },
  { href: '/trend', title: '시세 동향', desc: '구·군과 동 단위로 ㎡당 평균가가 오르는 곳과 내리는 곳을 비교합니다.', icon: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-7' },
  { href: '/villa', title: '빌라·다세대', desc: '연립·다세대 실거래를 지번 단위로 검색하고 지도에서 확인합니다.', icon: 'M3 21h18M5 21V8l7-5 7 5v13M10 21v-6h4v6' },
];

function sum(rows: DailyRow[], key: 'trade_count') { return rows.reduce((s, r) => s + r[key], 0); }
function weightedAvg(rows: DailyRow[]) {
  const n = sum(rows, 'trade_count');
  return n ? rows.reduce((s, r) => s + r.avg_amount * r.trade_count, 0) / n : 0;
}
function pct(cur: number, prev: number) { return prev ? ((cur - prev) / prev) * 100 : null; }

function ChartTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DailyRow }> }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="bg-surface border border-line rounded-xl shadow-pop px-3 py-2 text-xs">
      <div className="font-semibold text-ink">{formatKDate(r.deal_date)}</div>
      <div className="mt-1 text-ink-2">거래 <span className="num font-semibold text-ink">{r.trade_count.toLocaleString()}</span>건</div>
      <div className="text-ink-2">평균 <span className="num font-semibold text-ink">{formatPrice(r.avg_amount)}</span></div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/home').then(r => r.json()).then((d: HomeData & { error?: string }) => {
      if (d.error) throw new Error(d.error);
      setData(d);
    }).catch(() => setFailed(true));
    fetch('/api/health').then(r => (r.ok ? r.json() : null)).then(setHealth).catch(() => null);
  }, []);

  const view = useMemo(() => {
    if (!data?.daily?.length) return null;
    const last30 = data.daily.slice(-30);
    const prev30 = data.daily.slice(0, Math.max(0, data.daily.length - 30));
    // 가장 최근 며칠은 신고가 덜 들어와 있어 비교에서 뺀다 → '신고가 거의 끝난' 8~14일 전 vs 15~21일 전
    const d = data.daily;
    const settled = d.slice(-14, -7), before = d.slice(-21, -14);
    return {
      last30, prev30,
      total30: sum(last30, 'trade_count'),
      totalDelta: pct(sum(settled, 'trade_count'), sum(before, 'trade_count')),
      avg30: weightedAvg(last30),
      avgDelta: pct(weightedAvg(last30), weightedAvg(prev30)),
      maxCount: Math.max(...last30.map(r => r.trade_count)),
    };
  }, [data]);

  const top = data?.topTrades ?? [];
  const sidoMax = Math.max(1, ...(data?.bySido ?? []).map(s => s.trade_count));

  function go(e: React.FormEvent) {
    e.preventDefault();
    const s = q.trim();
    router.push(s ? `/search?q=${encodeURIComponent(s)}` : '/search');
  }

  return (
    <>
      {/* 히어로 */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10 sm:py-14">
          <div className="max-w-2xl rise">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-brand bg-brand-soft rounded-full px-3 py-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-brand opacity-60 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
              </span>
              {data?.latestDate ? `${formatKDate(data.latestDate)} 거래분까지 반영` : '국토교통부 실거래가 · 매일 새벽 갱신'}
            </div>
            <h1 className="mt-4 text-3xl sm:text-[2.6rem] font-extrabold tracking-tight leading-[1.15] text-ink">
              어제 팔린 가격부터<br className="sm:hidden" /> <span className="text-brand">단지별 변동</span>까지
            </h1>
            <p className="mt-3 text-sm sm:text-base text-ink-2">
              전국 아파트·빌라 실거래가를 매일 새벽 모아, 같은 단지 같은 평형의 가격 차이와 지역 시세 흐름을 바로 보여 줍니다.
            </p>
            <form onSubmit={go} className="mt-6 flex gap-2 max-w-xl">
              <div className="relative flex-1">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  value={q} onChange={e => setQ(e.target.value)}
                  placeholder="단지명 또는 동 이름 — 예: 신평 현대"
                  className="field !pl-10 !py-3 !text-base !rounded-xl"
                  aria-label="단지명 검색"
                />
              </div>
              <button type="submit" className="px-5 sm:px-7 rounded-xl bg-brand text-brand-ink font-semibold hover:bg-brand-strong transition-colors cursor-pointer shadow-sm">
                검색
              </button>
            </form>
          </div>
        </div>
      </div>

      <Page>
        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {!view ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[6.5rem] !rounded-2xl" />)
          ) : (
            <>
              <Stat label="최근 30일 아파트 거래" value={view.total30.toLocaleString()} unit="건"
                delta={view.totalDelta != null && <span className={trendColor(view.totalDelta)}>{formatRate(view.totalDelta)}</span>}
                hint="증감은 신고가 끝난 2주 전 주간 기준" />
              <Stat label="평균 거래가 (30일)" value={formatEok(view.avg30, 2)}
                delta={view.avgDelta != null && <span className={trendColor(view.avgDelta)}>{formatRate(view.avgDelta)}</span>}
                hint="직전 30일 대비" />
              <Stat label="7일 내 최고가" value={top[0] ? formatEok(top[0].deal_amount) : '-'}
                hint={top[0] ? `${top[0].apt_nm} · ${top[0].sgg_nm ?? ''}` : undefined} />
              <Stat label="마지막 데이터 적재"
                value={health?.apt?.lastCollectedAt ? formatUtcToKst(health.apt.lastCollectedAt).split(' ').slice(0, 2).join(' ') : '-'}
                hint={health?.apt?.lastCollectedAt
                  ? `${formatUtcToKst(health.apt.lastCollectedAt).split(' ')[2]} · 24시간 신규·변경 ${(health.apt.changed24h ?? 0).toLocaleString()}건`
                  : '매일 새벽 자동 수집'} />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* 일별 거래량 */}
          <Card className="lg:col-span-2">
            <CardTitle sub="막대를 누르면 그날의 거래 목록으로 이동합니다. 최근 며칠은 신고가 덜 들어와 낮게 보입니다."
              right={<Link href="/daily" className="text-xs font-semibold text-brand hover:underline">날짜별 실거래 →</Link>}>
              일별 거래량 · 최근 30일
            </CardTitle>
            {!view ? <Skeleton className="h-64" /> : (
              <div className="h-64 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={view.last30} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                    onClick={(s: unknown) => {
                      const d = (s as { activePayload?: Array<{ payload: DailyRow }> })?.activePayload?.[0]?.payload;
                      if (d) router.push(`/daily?date=${d.deal_date}`);
                    }}>
                    <CartesianGrid vertical={false} stroke="var(--line)" />
                    <XAxis dataKey="deal_date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
                      axisLine={false} tickLine={false} interval={4} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} width={44}
                      tickFormatter={(v: number) => v.toLocaleString()} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--surface-3)' }} />
                    <Bar dataKey="trade_count" radius={[4, 4, 0, 0]} cursor="pointer">
                      {view.last30.map(r => {
                        const dow = new Date(`${r.deal_date}T00:00:00`).getDay();
                        return <Cell key={r.deal_date} fill={dow === 0 || dow === 6 ? 'var(--line-strong)' : 'var(--brand)'} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* 시도별 */}
          <Card>
            <CardTitle sub="최근 30일 · 해제거래 제외">시·도별 거래량</CardTitle>
            {!data ? <Skeleton className="h-64" /> : (
              <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {data.bySido.map(s => (
                  <li key={s.sido_cd} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-ink truncate">{s.sido_nm}</span>
                      <span className="num text-ink-2 shrink-0">
                        {s.trade_count.toLocaleString()}건 <span className="text-ink-3">· 평균 {formatEok(s.avg_amount)}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${(s.trade_count / sidoMax) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* 최고가 거래 */}
        <Card>
          <CardTitle sub="최근 7일 안에 계약된 거래 가운데 금액이 큰 순서 · 단지를 누르면 그 단지의 변동 분석으로 이동합니다">
            이번 주 최고가 거래
          </CardTitle>
          {failed ? (
            <EmptyState icon="⚠️" title="요약 데이터를 불러오지 못했습니다" desc="잠시 뒤 새로고침해 주세요. 검색과 다른 메뉴는 그대로 쓸 수 있습니다." />
          ) : !data ? <Skeleton className="h-72" /> : top.length === 0 ? (
            <EmptyState title="최근 7일 거래가 아직 없습니다" />
          ) : (
            <>
            {/* 모바일: 가격이 화면 밖으로 밀리지 않게 목록형으로 */}
            <ul className="sm:hidden divide-y divide-line -my-2">
              {top.map((t, i) => (
                <li key={`m-${t.apt_nm}-${t.deal_date}-${t.floor}-${i}`}>
                  <Link href={`/search?q=${encodeURIComponent(t.apt_nm)}&sgg=${t.sgg_cd}`} className="flex items-center gap-3 py-3">
                    <span className="num w-5 shrink-0 text-xs text-ink-3">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink truncate">{t.apt_nm}</span>
                      <span className="block text-xs text-ink-3 truncate">
                        {[t.sgg_nm, t.umd_nm].filter(Boolean).join(' ')} · {formatArea(t.exclu_use_ar)} · {t.floor ?? '-'}층
                      </span>
                    </span>
                    <span className="num shrink-0 font-bold text-ink">{formatPrice(t.deal_amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
            <TableWrap>
              <table className="data-table">
                <thead>
                  <tr><th className="w-10">#</th><th>단지</th><th>지역</th><th>전용면적</th><th>층</th><th>계약일</th><th className="!text-right">거래가</th></tr>
                </thead>
                <tbody>
                  {top.map((t, i) => (
                    <tr key={`${t.apt_nm}-${t.deal_date}-${t.floor}-${i}`} className="cursor-pointer"
                      onClick={() => router.push(`/search?q=${encodeURIComponent(t.apt_nm)}&sgg=${t.sgg_cd}`)}>
                      <td className="num text-ink-3">{i + 1}</td>
                      <td>
                        <span className="font-semibold text-ink">{t.apt_nm}</span>
                        {t.build_year && <span className="ml-2 text-xs text-ink-3">{t.build_year}년</span>}
                      </td>
                      <td className="text-ink-2">{[t.sido_nm, t.sgg_nm, t.umd_nm].filter(Boolean).join(' ')}</td>
                      <td className="num text-ink-2">{formatArea(t.exclu_use_ar)}</td>
                      <td className="num text-ink-2">{t.floor ?? '-'}</td>
                      <td className="num text-ink-2">{formatShortDate(t.deal_date)}</td>
                      <td className="num !text-right font-bold text-ink">{formatPrice(t.deal_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            </div>
            </>
          )}
        </Card>

        {/* 도구 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {TOOLS.map(t => (
            <Link key={t.href} href={t.href}
              className="group bg-surface border border-line rounded-2xl shadow-card p-5 hover:border-brand hover:-translate-y-0.5 transition-all">
              <span className="h-10 w-10 rounded-xl bg-brand-soft text-brand inline-flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
              </span>
              <div className="mt-3 flex items-center gap-1 font-semibold text-ink">
                {t.title}
                <span className="text-ink-3 group-hover:text-brand group-hover:translate-x-0.5 transition-all">→</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.desc}</p>
            </Link>
          ))}
        </div>

        {health && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <Badge tone="neutral">수집 현황</Badge>
            <span>아파트 {formatUtcToKst(health.apt?.lastCollectedAt)} 적재 · 24시간 신규·변경 <b className="num text-ink-2">{(health.apt?.changed24h ?? 0).toLocaleString()}</b>건</span>
            <span className="text-line-strong">|</span>
            <span>빌라 {formatUtcToKst(health.villa?.lastCollectedAt)} 적재 · <b className="num text-ink-2">{(health.villa?.changed24h ?? 0).toLocaleString()}</b>건</span>
          </div>
        )}
      </Page>
    </>
  );
}
