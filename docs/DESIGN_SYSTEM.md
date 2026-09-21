# 실거래 레이더 — 디자인 시스템 (2026-09-22 전면 개편)

> 화면을 고치거나 새 페이지를 만들 때 **반드시 먼저 읽는다.** 규칙은 짧다.

## 🚨 반드시 3가지

1. **색은 의미 토큰만 쓴다.** `bg-surface` `text-ink` `border-line` `text-up` …
   `gray-500` `blue-600` `bg-white` 같은 팔레트 색·흰색을 직접 쓰면 **다크 모드에서 깨진다.**
   `dark:` 변형도 쓰지 않는다 — `globals.css` 의 CSS 변수가 통째로 바뀐다.
2. **부품은 `src/components/ui.tsx` 에서 가져다 쓴다.** 페이지마다 버튼·카드를 새로 만들지 않는다.
3. **표기는 `src/lib/format.ts` 로만 한다.** 가격·면적·날짜 포맷 함수를 페이지에 또 만들지 않는다.

## 토큰 (Tailwind 클래스로 그대로 쓴다)

| 용도 | 클래스 |
|---|---|
| 페이지 바탕 / 카드 / 옅은 면 / 더 옅은 면 | `bg-bg` / `bg-surface` / `bg-surface-2` / `bg-surface-3` |
| 테두리 (기본 / 입력칸·강조) | `border-line` / `border-line-strong` |
| 글자 (본문 / 보조 / 흐림) | `text-ink` / `text-ink-2` / `text-ink-3` |
| 브랜드 (버튼·링크·선택됨) | `bg-brand text-brand-ink` · `hover:bg-brand-strong` · 옅게 `bg-brand-soft text-brand` |
| **상승 = 빨강** / **하락 = 파랑** (한국 시장 관례) | `text-up bg-up-soft` / `text-down bg-down-soft` |
| 정상 / 주의 | `text-ok bg-ok-soft` / `text-warn bg-warn-soft` |
| 그림자 | `shadow-card` (카드) · `shadow-pop` (모달·툴팁) |

차트(recharts)·SVG 에는 CSS 변수를 그대로 넣는다: `stroke="var(--brand)"` `fill="var(--up)"`
`tick={{ fill: 'var(--ink-3)', fontSize: 11 }}` · 격자 `stroke="var(--line)"`.
여러 계열 색이 필요하면(평형별 선 등) 이 순서를 쓴다 — 밝은·어두운 화면 둘 다에서 읽힌다:
`#2f5bea #12996b #8b5cf6 #e08a00 #e0393e #0ea5b7 #d9480f #5c7cfa`

## 부품 (`@/components/ui`)

`Page` `PageHeader` `Card` `CardTitle` `Button(variant: primary|secondary|ghost, size: sm|md|lg)`
`Chip(active, size)` `Segmented` `Badge(tone)` `Stat` `Label` `Skeleton` `Spinner` `EmptyState`
`ErrorBox` `TableWrap` `cx`

CSS 클래스: `.field` (input·select·textarea 공통) · `.data-table` (표) · `.num` (숫자 — 고정폭) ·
`.skeleton` · `.rise` (등장 애니메이션)

```tsx
<Page>
  <PageHeader eyebrow="아파트" title="변동 분석" desc="…" right={<Button variant="primary">검색</Button>} />
  <Card><CardTitle sub="부제">제목</CardTitle> … </Card>
</Page>
```

## 표기 (`@/lib/format`)

`formatPrice(만원)` → `12억 3,000` · `formatEok(만원)` → `12.3억` · `formatArea(㎡)` → `84.9㎡ (26평)` ·
`toPyeong` · `formatKDate('2026-09-19')` → `9월 19일 (토)` · `formatShortDate` → `09.19` · `toYmd(Date)` ·
`formatRate(3.2)` → `+3.2%` · `trendColor(v)` → `text-up|text-down|text-ink-3`

## 모양 규칙

- 카드 모서리 `rounded-2xl`, 버튼·입력 `rounded-xl`, 칩 `rounded-full`. 옛 `rounded-lg border shadow-sm` 조합은 쓰지 않는다.
- 숫자(가격·건수·면적·날짜)에는 `num` 클래스. 표의 금액 열은 오른쪽 정렬 + 굵게.
- 로딩은 글자("로딩 중...") 대신 `Skeleton`. 결과 0건·오류는 `EmptyState`·`ErrorBox`.
- **모바일(폭 375px)에서 가로 스크롤이 생기면 안 된다.** 넓은 표는 `TableWrap` 안에 넣는다.
  필터가 많은 화면은 모바일에서 접을 수 있게 한다.
- 이모지는 빈 상태 아이콘 정도에만. 제목·버튼에 이모지를 붙이지 않는다.
- 문구는 담백한 존댓말. 영어 UI 용어(Filter, Reset) 대신 우리말.

## 구조

- 데이터는 전부 `_worker.js` 의 `/api/*` 가 D1 에서 **읽기만** 한다. 페이지에서 쓰기 요청을 만들지 않는다.
- 관심단지는 서버가 아니라 **브라우저(localStorage)** — `@/lib/favorites` 의 `useFavorites()`.
- `src/app/api/*` 의 Next 라우트는 로컬 개발용 옛 코드다. 운영은 `_worker.js` 가 받는다. 새 API 는 `_worker.js` 에 만든다.
- 정적 빌드라 `useSearchParams()` 를 쓰는 컴포넌트는 `<Suspense>` 로 감싼다 (안 그러면 빌드가 죽는다).
- 배포: `npm run deploy` (`.env.local` 의 CF 토큰 필요). 먼저 `--branch preview` 로 올려 확인한다.
