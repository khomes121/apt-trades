'use client';

import { Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import RegionSelector from '@/components/RegionSelector';
import FilterPanel, { ActiveConditions, getDateRange } from '@/components/FilterPanel';
import ResultTable from '@/components/ResultTable';
import { Badge, Button, Card, CardTitle, ErrorBox, Page, PageHeader, Skeleton, Spinner } from '@/components/ui';
import type { Region, SearchParams, TradeResult } from '@/types';

const PAGE_DESC = '같은 단지·같은 평형 안에서 최저가와 최고가가 얼마나 벌어졌는지 찾아냅니다.';

function defaultParams(): SearchParams {
  return {
    sgg_codes: [],
    ...getDateRange(12),
    diff_operator: 'AND',
    exclude_cancelled: true,
    exclude_direct: true,
    min_trade_count: 1,
  };
}

type Action =
  | { type: 'patch'; patch: Partial<SearchParams> }
  | { type: 'replace'; next: SearchParams };

function reducer(state: SearchParams, action: Action): SearchParams {
  return action.type === 'replace' ? action.next : { ...state, ...action.patch };
}

// ── 한 번에 눌러 보는 예시 ────────────────────────────────────────────────────

interface Example {
  title: string;
  desc: string;
  sido: string[];
  build(): Partial<SearchParams>;
}

const EXAMPLES: Example[] = [
  {
    title: '부산 · 최근 1년 · 1억 이상 벌어진 단지',
    desc: '한 해 사이 같은 평형에서 1억 원 넘게 차이 난 곳',
    sido: ['26'],
    build: () => ({ ...getDateRange(12), diff_amount: 10000 }),
  },
  {
    title: '서울 · 최근 6개월 · 변동률 10% 이상',
    desc: '짧은 기간에 가격 차가 크게 난 평형',
    sido: ['11'],
    build: () => ({ ...getDateRange(6), diff_rate: 10, min_trade_count: 2 }),
  },
  {
    title: '5대 광역시 · 10년 이내 신축 · 5천만 이상',
    desc: '부산·대구·광주·대전·울산의 새 아파트만',
    sido: ['26', '27', '29', '30', '31'],
    build: () => ({ ...getDateRange(12), diff_amount: 5000, build_year_from: new Date().getFullYear() - 10 }),
  },
];

const HOW_IT_WORKS = [
  { n: '1', title: '지역이나 단지명을 고릅니다', desc: '구·군을 여러 곳 골라도 되고, 단지명만 넣어도 됩니다.' },
  { n: '2', title: '기간과 변동 조건을 정합니다', desc: '예: 최근 1년 동안 1억 원 이상, 또는 10% 이상.' },
  { n: '3', title: '벌어진 순서로 보여 줍니다', desc: '행을 누르면 그 단지의 거래 내역과 시세 그래프가 열립니다.' },
];

// ── 페이지 ──────────────────────────────────────────────────────────────────

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchPageInner />
    </Suspense>
  );
}

function SearchFallback() {
  return (
    <Page>
      <PageHeader eyebrow="아파트" title="변동 분석" desc={PAGE_DESC} />
      <div className="grid grid-cols-1 lg:grid-cols-[22rem_minmax(0,1fr)] gap-4 sm:gap-6">
        <Skeleton className="h-96 !rounded-2xl" />
        <Skeleton className="h-96 !rounded-2xl" />
      </div>
    </Page>
  );
}

/** 주소의 ?q= · &sgg= 를 읽는다. 값이 바뀌면 도구를 새로 시작한다(key). */
function SearchPageInner() {
  const sp = useSearchParams();
  const q = (sp.get('q') ?? '').trim();
  const sgg = (sp.get('sgg') ?? '').trim();
  return <SearchTool key={`${q}|${sgg}`} initialQ={q} initialSgg={/^\d{5}$/.test(sgg) ? sgg : ''} />;
}

function SearchTool({ initialQ, initialSgg }: { initialQ: string; initialSgg: string }) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);
  const [params, dispatch] = useReducer(reducer, undefined, (): SearchParams => ({
    ...defaultParams(),
    ...(initialQ ? { apt_nm: initialQ } : {}),
    ...(initialSgg ? { sgg_codes: [initialSgg] } : {}),
  }));
  const [results, setResults] = useState<TradeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqSeq = useRef(0);
  const autoRan = useRef(false);
  const wantScroll = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function runSearch(p: SearchParams, opts: { scroll?: boolean } = {}) {
    if (p.sgg_codes.length === 0 && !p.apt_nm?.trim()) {
      setError('지역을 고르거나 단지명을 입력해 주세요.');
      return;
    }
    const seq = ++reqSeq.current;
    wantScroll.current = opts.scroll ?? true;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
      const json = await res.json() as { results?: TradeResult[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? '검색에 실패했습니다.');
      if (seq !== reqSeq.current) return;
      setResults(json.results ?? []);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(e instanceof Error ? e.message : '검색 중 오류가 발생했습니다.');
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }

  // 지역 목록을 받고, 주소에 ?q= 가 있었다면 그때 한 번 자동으로 검색한다
  useEffect(() => {
    let alive = true;
    fetch('/api/regions')
      .then(r => r.json())
      .then((data: Region[]) => {
        if (!alive) return;
        if (!Array.isArray(data)) throw new Error('bad regions');
        setRegions(data);
      })
      .catch(() => { if (alive) setError('지역 정보를 불러오지 못했습니다. 단지명 검색은 그대로 쓸 수 있습니다.'); })
      .finally(() => {
        if (!alive) return;
        setRegionsLoading(false);
        if (initialQ && !autoRan.current) {
          autoRan.current = true;
          void runSearch({
            ...defaultParams(),
            apt_nm: initialQ,
            ...(initialSgg ? { sgg_codes: [initialSgg] } : {}),
          }, { scroll: false });
        }
      });
    return () => { alive = false; };
    // initialQ·initialSgg 가 바뀌면 key 로 컴포넌트가 통째로 새로 만들어진다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 검색이 끝나면 결과 자리로 내려간다 (직접 누른 검색만)
  useEffect(() => {
    if (results !== null && wantScroll.current) {
      wantScroll.current = false;
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [results]);

  const regionMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of regions) map[r.sgg_cd] = `${r.sido_nm} ${r.sgg_nm}`;
    return map;
  }, [regions]);

  const patch = (p: Partial<SearchParams>) => dispatch({ type: 'patch', patch: p });

  function resetAll() {
    dispatch({ type: 'replace', next: defaultParams() });
    setError(null);
  }

  function runExample(ex: Example) {
    const sido = new Set(ex.sido);
    const next: SearchParams = {
      ...defaultParams(),
      ...ex.build(),
      sgg_codes: regions.filter(r => sido.has(r.sido_cd)).map(r => r.sgg_cd),
    };
    dispatch({ type: 'replace', next });
    void runSearch(next);
  }

  return (
    <Page>
      <PageHeader
        eyebrow="아파트"
        title="변동 분석"
        desc={PAGE_DESC}
        right={<Badge tone="neutral">국토교통부 실거래가 · 매일 새벽 갱신</Badge>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[22rem_minmax(0,1fr)] gap-4 sm:gap-6 items-start">
        <Card className="min-w-0">
          <CardTitle sub="시·도를 누르면 구·군이 펼쳐집니다">지역 선택</CardTitle>
          {regionsLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="지역 정보를 불러오는 중">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-14" />
              <Skeleton className="h-10" />
              <Skeleton className="h-56" />
            </div>
          ) : (
            <RegionSelector
              regions={regions}
              selectedCodes={params.sgg_codes}
              onChange={codes => patch({ sgg_codes: codes })}
            />
          )}
        </Card>

        <Card className="min-w-0">
          <CardTitle
            sub="단지명만 넣어도, 지역만 골라도 검색됩니다"
            right={<Button variant="ghost" size="sm" onClick={resetAll}>조건 초기화</Button>}
          >
            검색 조건
          </CardTitle>
          <FilterPanel params={params} onChange={patch} onSubmit={() => void runSearch(params)} />
        </Card>
      </div>

      {/* 조건 요약 + 검색 — 모바일에서는 화면 아래에 붙어 따라온다 */}
      <div className="sticky bottom-3 z-30 lg:static">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2.5 lg:gap-4 rounded-2xl border border-line bg-surface/95 backdrop-blur-md shadow-pop lg:shadow-card p-3 lg:px-5 lg:py-4">
          <div className="min-w-0 flex-1">
            <div className="hidden lg:block text-xs font-medium text-ink-3 mb-1.5">적용 중인 조건</div>
            <div className="overflow-x-auto lg:overflow-visible -mx-1 px-1">
              <ActiveConditions
                params={params}
                onChange={patch}
                regionCount={params.sgg_codes.length}
                onClearRegions={() => patch({ sgg_codes: [] })}
                className="lg:flex-wrap"
              />
            </div>
          </div>
          <Button
            variant="primary"
            size="lg"
            onClick={() => void runSearch(params)}
            disabled={loading}
            className="w-full lg:w-auto lg:min-w-[10rem] shrink-0"
          >
            {loading ? <><Spinner /> 검색 중</> : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
                </svg>
                검색
              </>
            )}
          </Button>
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div ref={resultsRef} className="scroll-mt-20">
        {loading ? (
          <div className="space-y-4 sm:space-y-6" aria-busy="true" aria-label="검색 중">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[6.5rem] !rounded-2xl" />)}
            </div>
            <Card>
              <div className="space-y-2.5">
                <Skeleton className="h-9 w-56" />
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
              <p className="mt-4 text-xs text-ink-3">지역이 넓거나 기간이 길면 몇 초 걸릴 수 있습니다.</p>
            </Card>
          </div>
        ) : results !== null ? (
          <ResultTable results={results} regions={regionMap} />
        ) : (
          <Card className="rise">
            <CardTitle sub="같은 단지 안에서도 평형별로 따로 계산합니다. 5㎡ 단위로 묶어 비슷한 평형은 한 줄로 봅니다.">
              이 도구가 찾아 주는 것
            </CardTitle>
            <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {HOW_IT_WORKS.map(s => (
                <li key={s.n} className="rounded-xl bg-surface-2 border border-line p-4">
                  <span className="num inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-brand text-xs font-bold">{s.n}</span>
                  <div className="mt-2.5 text-sm font-semibold text-ink">{s.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-2">{s.desc}</p>
                </li>
              ))}
            </ol>

            <div className="mt-6">
              <div className="text-sm font-semibold text-ink">바로 해 보기</div>
              <p className="text-xs text-ink-3 mt-0.5">누르면 조건이 채워지고 곧바로 검색합니다.</p>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {EXAMPLES.map(ex => (
                  <button
                    key={ex.title}
                    type="button"
                    onClick={() => runExample(ex)}
                    disabled={regionsLoading || regions.length === 0 || loading}
                    className="group text-left rounded-xl border border-line-strong bg-surface px-4 py-3.5 transition-colors cursor-pointer enabled:hover:border-brand enabled:hover:bg-brand-soft disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-ink group-hover:text-brand">{ex.title}</span>
                      <span className="text-ink-3 group-hover:text-brand group-hover:translate-x-0.5 transition-all" aria-hidden>→</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-2">{ex.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>
    </Page>
  );
}
