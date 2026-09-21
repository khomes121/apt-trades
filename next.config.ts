import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // 개발 서버에서만: /api/* 를 운영 사이트의 공개(읽기 전용) API 로 넘긴다.
  // 운영에서는 _worker.js 가 /api/* 를 직접 받으므로 이 설정은 아무 일도 하지 않는다.
  // 덕분에 로컬에서 토큰 없이 실제 데이터로 화면을 볼 수 있다.
  // (_worker.js 에 새로 만든 엔드포인트는 배포 전까지 운영에 없으니 로컬에선 404 가 난다 — 미리보기 배포로 확인한다.)
  async rewrites() {
    if (!isDev) return [];
    const origin = process.env.API_PROXY_ORIGIN ?? "https://apt-trades.pages.dev";
    // DEV_MOCK_NEW_API=1 이면 아직 운영에 없는 엔드포인트를 public/dev-mock 의 견본으로 대신한다 (public/ 은 배포되지 않는다)
    const mock = process.env.DEV_MOCK_NEW_API === "1"
      ? [
          { source: "/api/home", destination: "/dev-mock/home.json" },
          { source: "/api/health", destination: "/dev-mock/health.json" },
        ]
      : [];
    return {
      beforeFiles: [...mock, { source: "/api/:path*", destination: `${origin}/api/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
