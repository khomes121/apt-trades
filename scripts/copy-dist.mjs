/**
 * Copies Next.js build output to dist/ for Cloudflare Pages deployment.
 * Run after `npm run build`.
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const nextOut = join(root, '.next');
const dist = join(root, 'dist');

// Clean dist to avoid stale/nested files from previous builds
if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, '_next'), { recursive: true });

// Copy static assets recursively (cross-platform)
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry), d = join(dest, entry);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}
copyDir(join(nextOut, 'static'), join(dist, '_next', 'static'));

// Copy all pre-rendered HTML pages recursively
function copyHtmlPages(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  for (const entry of readdirSync(srcDir)) {
    const srcPath  = join(srcDir, entry);
    const destPath = join(destDir, entry);
    if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyHtmlPages(srcPath, destPath);
    } else if (entry.endsWith('.html')) {
      copyFileSync(srcPath, destPath);
    }
  }
}
copyHtmlPages(join(nextOut, 'server', 'app'), dist);

// Copy favicon
try {
  const faviconBody = join(nextOut, 'server', 'app', 'favicon.ico.body');
  if (existsSync(faviconBody)) copyFileSync(faviconBody, join(dist, 'favicon.ico'));
} catch { /* favicon 없어도 배포에 영향 없음 */ }

// Copy worker (source lives at project root)
copyFileSync(join(root, '_worker.js'), join(dist, '_worker.js'));

console.log('dist/ ready for Cloudflare Pages deployment.');
