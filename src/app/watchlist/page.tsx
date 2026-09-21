'use client';

// 옛 주소. 서버 저장 방식 관심단지는 운영에서 API 가 없어 동작하지 않았다 → 브라우저 저장 방식(/favorites)으로 옮겼다.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function WatchlistRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/favorites'); }, [router]);
  return null;
}
