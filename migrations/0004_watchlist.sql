-- 관심단지 테이블
CREATE TABLE IF NOT EXISTS watchlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  apt_nm      TEXT NOT NULL,        -- 아파트명
  sgg_cd      TEXT NOT NULL,        -- 시군구코드
  umd_nm      TEXT,                 -- 법정동명
  complex_no  TEXT,                 -- 네이버 complexNo (선택)
  criteria    TEXT,                 -- 조건 JSON
  added_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(apt_nm, sgg_cd)
);
