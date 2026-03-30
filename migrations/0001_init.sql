-- 아파트 실거래 데이터
CREATE TABLE IF NOT EXISTS apt_trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 식별자
  apt_seq         TEXT,                  -- 단지 고유ID
  apt_nm          TEXT NOT NULL,         -- 아파트명
  apt_dong        TEXT,                  -- 동명
  -- 위치
  sgg_cd          TEXT NOT NULL,         -- 시군구코드 (5자리)
  umd_nm          TEXT,                  -- 법정동명
  umd_cd          TEXT,                  -- 읍면동코드
  road_nm         TEXT,                  -- 도로명
  bonbun          TEXT,                  -- 지번 본번
  bubun           TEXT,                  -- 지번 부번
  -- 단지 정보
  build_year      INTEGER,              -- 건축년도
  exclu_use_ar    REAL NOT NULL,         -- 전용면적(㎡)
  area_group      INTEGER,              -- 전용면적 반올림 (그룹핑용)
  floor           INTEGER,              -- 층
  -- 거래 정보
  deal_amount     INTEGER NOT NULL,      -- 거래금액(만원)
  deal_date       TEXT NOT NULL,         -- 계약일 (YYYY-MM-DD)
  dealing_gbn     TEXT,                  -- 거래유형 (중개/직거래)
  sler_gbn        TEXT,                  -- 매도자 유형
  buyer_gbn       TEXT,                  -- 매수자 유형
  cdeal_type      TEXT,                  -- 해제여부 (Y=해제)
  cdeal_day       TEXT,                  -- 해제사유발생일
  rgst_date       TEXT,                  -- 등기일자
  land_leasehold  TEXT,                  -- 토지임대부 여부
  -- 메타
  collected_at    TEXT DEFAULT (datetime('now'))
);

-- 중복 방지 유니크 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_unique
  ON apt_trades(apt_seq, deal_date, floor, exclu_use_ar, deal_amount);

-- 지역 조회용
CREATE INDEX IF NOT EXISTS idx_trades_sgg_cd ON apt_trades(sgg_cd);
CREATE INDEX IF NOT EXISTS idx_trades_deal_date ON apt_trades(deal_date);

-- 분석용 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_trades_group ON apt_trades(apt_nm, sgg_cd, area_group);

-- 해제거래 제외용
CREATE INDEX IF NOT EXISTS idx_trades_cdeal ON apt_trades(cdeal_type);

-- 지역 코드 테이블
CREATE TABLE IF NOT EXISTS regions (
  sgg_cd    TEXT PRIMARY KEY,      -- 구/군 코드 (5자리)
  sido_nm   TEXT NOT NULL,         -- 시/도명
  sido_cd   TEXT NOT NULL,         -- 시/도코드 (2자리)
  sgg_nm    TEXT NOT NULL          -- 구/군명
);

CREATE INDEX IF NOT EXISTS idx_regions_sido ON regions(sido_cd);

-- 수집 이력 로그
CREATE TABLE IF NOT EXISTS collect_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type    TEXT NOT NULL,        -- 'full' | 'incremental'
  sgg_cd      TEXT,                 -- 수집 구/군 코드
  deal_ymd    TEXT,                 -- 수집 대상 월 (YYYYMM)
  count       INTEGER,             -- 수집 건수
  status      TEXT,                -- 'success' | 'error'
  error_msg   TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
