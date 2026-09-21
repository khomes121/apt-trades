'use client';

/**
 * 관심단지 — 이 브라우저에만 저장한다(localStorage).
 * 서버에 쓰지 않는 이유: 이 사이트는 로그인이 없는 공개 사이트라, 서버에 쓰기 창구를 열면 아무나 쓸 수 있다.
 * (D1 의 watchlist 테이블은 다른 시스템의 매핑용이라 여기서 건드리지 않는다.)
 */
import { useCallback, useSyncExternalStore } from 'react';

export interface Favorite {
  apt_nm: string;
  sgg_cd: string;
  umd_nm?: string | null;
  region?: string;      // '부산광역시 해운대구' 같은 표시용
  addedAt: string;      // ISO
}

const KEY = 'apt-trades:favorites:v1';
const EVT = 'apt-trades:favorites';
const EMPTY: Favorite[] = [];
let cacheRaw: string | null = null;
let cacheVal: Favorite[] = EMPTY;

function read(): Favorite[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === cacheRaw) return cacheVal;
    cacheRaw = raw;
    const parsed = raw ? JSON.parse(raw) : [];
    cacheVal = Array.isArray(parsed) ? parsed : EMPTY;
  } catch {
    cacheVal = EMPTY;
  }
  return cacheVal;
}

function write(list: Favorite[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* 사생활 보호 모드 등 — 저장 못 해도 화면은 돈다 */ }
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', cb);
  };
}

export const favKey = (apt_nm: string, sgg_cd: string) => `${sgg_cd}|${apt_nm}`;

export function useFavorites() {
  const list = useSyncExternalStore(subscribe, read, () => EMPTY);

  const has = useCallback(
    (apt_nm: string, sgg_cd: string) => list.some(f => f.apt_nm === apt_nm && f.sgg_cd === sgg_cd),
    [list],
  );

  const toggle = useCallback((f: Omit<Favorite, 'addedAt'>) => {
    const cur = read();
    const exists = cur.some(x => x.apt_nm === f.apt_nm && x.sgg_cd === f.sgg_cd);
    write(exists
      ? cur.filter(x => !(x.apt_nm === f.apt_nm && x.sgg_cd === f.sgg_cd))
      : [{ ...f, addedAt: new Date().toISOString() }, ...cur]);
    return !exists;
  }, []);

  const remove = useCallback((apt_nm: string, sgg_cd: string) => {
    write(read().filter(x => !(x.apt_nm === apt_nm && x.sgg_cd === sgg_cd)));
  }, []);

  return { list, has, toggle, remove };
}
