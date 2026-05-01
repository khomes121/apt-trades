-- 구/군 단위 월별 평균 ㎡당 단가 집계
CREATE TABLE IF NOT EXISTS sgg_monthly_stats (
  sgg_cd      TEXT NOT NULL,
  ym          TEXT NOT NULL,  -- 'YYYYMM'
  avg_m2_price REAL NOT NULL, -- 평균 ㎡당 단가 (만원)
  trade_count INTEGER NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (sgg_cd, ym)
);

-- 동 단위 월별 평균 ㎡당 단가 집계 (드릴다운용)
CREATE TABLE IF NOT EXISTS umd_monthly_stats (
  sgg_cd      TEXT NOT NULL,
  umd_nm      TEXT NOT NULL,
  ym          TEXT NOT NULL,  -- 'YYYYMM'
  avg_m2_price REAL NOT NULL, -- 평균 ㎡당 단가 (만원)
  trade_count INTEGER NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (sgg_cd, umd_nm, ym)
);
