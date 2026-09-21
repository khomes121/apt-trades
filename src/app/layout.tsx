import type { Metadata, Viewport } from "next";
import "./globals.css";
import GlobalNav from "@/components/GlobalNav";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: {
    default: "실거래 레이더 — 전국 아파트·빌라 실거래가 분석",
    template: "%s · 실거래 레이더",
  },
  description:
    "국토교통부 실거래가 공개 데이터를 매일 새벽 수집해 단지별 가격 변동, 지역 시세 동향, 날짜별 거래를 한눈에 보여 줍니다.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f18" },
  ],
};

// 첫 그림이 그려지기 전에 테마를 정한다 (안 그러면 다크 모드에서 흰 화면이 번쩍인다)
const themeBoot = `(function(){try{var t=localStorage.getItem('apt-trades:theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <GlobalNav />
        <div className="flex-1 flex flex-col">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
