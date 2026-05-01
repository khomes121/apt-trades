'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/',       label: '아파트' },
  { href: '/villa',  label: '빌라/다세대' },
  { href: '/trend',  label: '시세 동향' },
  { href: '/daily',  label: '날짜별 실거래' },
];

export default function GlobalNav() {
  const pathname = usePathname();
  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-12">
        <span className="text-sm font-semibold text-gray-700">🏠 아파트 실거래가</span>
        <div className="flex items-center gap-1">
          {TABS.map(tab => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                pathname === tab.href
                  ? 'bg-blue-50 text-blue-700 font-medium border border-blue-200'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
