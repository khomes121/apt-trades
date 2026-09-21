/** 화면 표기 공용 함수 — 가격·면적·날짜를 한 가지 방식으로만 쓴다. */

/** 만원 → "12억 3,000" / "8,500만" */
export function formatPrice(manwon: number | null | undefined): string {
  if (manwon == null || isNaN(manwon)) return '-';
  const sign = manwon < 0 ? '-' : '';
  const v = Math.abs(Math.round(manwon));
  const eok = Math.floor(v / 10000);
  const rest = v % 10000;
  if (eok === 0) return `${sign}${rest.toLocaleString()}만`;
  if (rest === 0) return `${sign}${eok.toLocaleString()}억`;
  return `${sign}${eok.toLocaleString()}억 ${rest.toLocaleString()}`;
}

/** 만원 → "12.3억" (좁은 자리·차트 축용) */
export function formatEok(manwon: number | null | undefined, digits = 1): string {
  if (manwon == null || isNaN(manwon)) return '-';
  if (Math.abs(manwon) < 10000) return `${Math.round(manwon / 100) / 10}천만`;
  return `${(manwon / 10000).toFixed(digits).replace(/\.0+$/, '')}억`;
}

/** ㎡ → 평 (반올림) */
export function toPyeong(m2: number | null | undefined): number | null {
  if (m2 == null || isNaN(m2)) return null;
  return Math.round(m2 / 3.305785);
}

/** "84.9㎡ (26평)" */
export function formatArea(m2: number | null | undefined): string {
  if (m2 == null || isNaN(m2)) return '-';
  return `${Number(m2.toFixed(1))}㎡ (${toPyeong(m2)}평)`;
}

/** 'YYYY-MM-DD' → '9월 19일 (토)' */
export function formatKDate(ymd: string | null | undefined, withYear = false): string {
  if (!ymd) return '-';
  const d = new Date(`${ymd}T00:00:00`);
  if (isNaN(d.getTime())) return ymd;
  const dow = '일월화수목금토'[d.getDay()];
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${dow})`;
  return withYear ? `${d.getFullYear()}년 ${base}` : base;
}

/** 'YYYY-MM-DD' → 'MM.DD' */
export function formatShortDate(ymd: string): string {
  return ymd.slice(5).replace('-', '.');
}

/** Date → 'YYYY-MM-DD' (로컬 기준) */
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 변동률 → '+3.2%' */
export function formatRate(rate: number | null | undefined, digits = 1): string {
  if (rate == null || isNaN(rate)) return '-';
  return `${rate > 0 ? '+' : ''}${rate.toFixed(digits)}%`;
}

/** 상승=up(빨강) / 하락=down(파랑) / 보합=ink-3 — Tailwind 글자색 클래스 */
export function trendColor(v: number | null | undefined): string {
  if (v == null || v === 0 || isNaN(v)) return 'text-ink-3';
  return v > 0 ? 'text-up' : 'text-down';
}

/** UTC 'YYYY-MM-DD HH:MM:SS' (D1 datetime) → 'M월 D일 HH:MM' KST */
export function formatUtcToKst(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  if (isNaN(d.getTime())) return s;
  const k = new Date(d.getTime() + 9 * 3600e3);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
}
