import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Explicit paths first, then bare command names that must be probed before use.
const pathCandidates = [
  process.env.EDGE_PATH,
  process.env.MSEDGE_PATH,
  join(process.env['PROGRAMFILES'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const commandCandidates = ['msedge', 'microsoft-edge', 'microsoft-edge-stable', 'google-chrome', 'chromium', 'chromium-browser'];

function isRunnable(binary) {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (result.error) return false;
  return result.status === 0;
}

function resolveBrowser() {
  for (const candidate of pathCandidates) {
    if (existsSync(candidate) && isRunnable(candidate)) return candidate;
  }
  for (const command of commandCandidates) {
    if (isRunnable(command)) return command;
  }
  return null;
}

const browser = resolveBrowser();

// In CI the smoke check must actually run: a silent skip would hide real breakage.
// Local development without a Chromium browser may skip explicitly.
const requireBrowser = process.env.CI === 'true' || process.env.REQUIRE_BROWSER_SMOKE === '1';
if (!browser) {
  const message = 'browser-smoke: no Chromium-based browser found';
  if (requireBrowser) {
    console.error(`${message} (required in CI; set EDGE_PATH or install a browser)`);
    process.exit(1);
  }
  console.log(`${message} — SKIP (local run)`);
  process.exit(0);
}

const pages = [
  { file: 'index.html', title: 'Fourier Series Closed Curve Fitting', required: ['#fourierCanvas', '#fitBtn', '#themeBtn'], scripts: 8 },
  { file: 'draw/index.html', title: 'Fourier Series Closed Curve Fitting', required: ['#fourierCanvas', '#fitBtn', '#themeBtn'], scripts: 8 },
  { file: 'image.html', title: 'Fourier Image Tracer', required: ['#traceCanvas', '#fileInput', '#useBtn'], scripts: 1 },
  { file: 'trace/index.html', title: 'Fourier Image Tracer', required: ['#traceCanvas', '#fileInput', '#useBtn'], scripts: 1 },
];

function pageTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : '';
}
function textContent(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function assertPage(page, html, stderr) {
  const title = pageTitle(html);
  if (title !== page.title) throw new Error(`${page.file}: expected title ${JSON.stringify(page.title)}, got ${JSON.stringify(title)}`);
  for (const selector of page.required) {
    const id = selector.slice(1);
    if (!new RegExp(`\\bid=["']${id}["']`, 'i').test(html)) throw new Error(`${page.file}: missing ${selector}`);
  }
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]);
  if (scripts.length !== page.scripts) throw new Error(`${page.file}: expected ${page.scripts} scripts, got ${scripts.length}`);
  if (page.file === 'index.html' && scripts.some(src => src.startsWith('../js/'))) throw new Error(`${page.file}: root scripts must not use ../js/`);
  if (page.file !== 'index.html' && page.file !== 'image.html' && scripts.some(src => !src.startsWith('../js/'))) throw new Error(`${page.file}: entry scripts must use ../js/`);
  const combined = `${textContent(html)}\n${stderr}`;
  const errors = combined.match(/(?:uncaught|uncaught exception|syntaxerror|typeerror|referenceerror|failed to load|net::err|\berror:\s)/ig);
  if (errors?.length) throw new Error(`${page.file}: browser reported ${errors.join(', ')}`);
}

let failed = false;
for (const page of pages) {
  const url = pathToFileURL(resolve(ROOT, page.file)).href;
  // A dedicated profile is required: an already-running browser can attach to the
  // default profile and make --dump-dom print nothing at all. Writing the DOM to a
  // file also avoids pipe-capture differences between platforms.
  const workDir = mkdtempSync(join(tmpdir(), 'fourier-smoke-'));
  const profile = join(workDir, 'profile');
  const domFile = join(workDir, 'dom.html');
  const result = spawnSync(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    `--user-data-dir=${profile}`,
    '--dump-dom', '--virtual-time-budget=2500', '--enable-logging=stderr', '--log-level=1', url,
  ], { encoding: 'utf8', timeout: 40000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  let html = '';
  try {
    if (existsSync(domFile)) html = readFileSync(domFile, 'utf8');
  } catch (readError) { /* fall back to stdout below */ }
  if (!html && result.stdout) html = result.stdout;
  try { rmSync(workDir, { recursive: true, force: true }); } catch (cleanupError) { /* best effort */ }

  if (result.error?.code === 'ENOENT') {
    console.error(`browser-smoke: ${page.file}: browser disappeared after detection (${browser})`);
    failed = true;
    continue;
  }
  if (result.error) {
    console.error(`browser-smoke: ${page.file}: ${result.error.message}`);
    failed = true;
    continue;
  }
  if (result.status !== 0) {
    console.error(`browser-smoke: ${page.file}: browser exited ${result.status}\n${result.stderr}`);
    failed = true;
    continue;
  }
  if (!html || !html.trim()) {
    console.error(`browser-smoke: ${page.file}: empty DOM output from ${browser}\n${result.stderr}`);
    failed = true;
    continue;
  }
  try {
    assertPage(page, html, result.stderr);
    console.log(`browser-smoke: ${page.file} passed`);
  } catch (error) {
    console.error(`browser-smoke: ${error.message}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
