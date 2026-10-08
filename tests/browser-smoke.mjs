import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const candidates = [
  process.env.EDGE_PATH,
  process.env.MSEDGE_PATH,
  join(process.env['PROGRAMFILES'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  'msedge',
  'microsoft-edge',
].filter(Boolean);
const edge = candidates.find(candidate => /[\\/]/.test(candidate) ? existsSync(candidate) : true);

if (!edge) {
  console.log('browser-smoke: SKIP (Microsoft Edge executable not found)');
  process.exit(0);
}

const pages = [
  { file: 'index.html', title: 'Fourier Series Closed Curve Fitting', required: ['#fourierCanvas', '#fitBtn', '#themeBtn'], scripts: 8 },
  { file: 'draw/index.html', title: 'Fourier Series Closed Curve Fitting', required: ['#fourierCanvas', '#fitBtn', '#themeBtn'], scripts: 8 },
  { file: 'image.html', title: 'Fourier Image Tracer', required: ['#traceCanvas', '#fileInput', '#useBtn'], scripts: 1 },
  { file: 'trace/index.html', title: 'Fourier Image Tracer', required: ['#traceCanvas', '#fileInput', '#useBtn'], scripts: 1 },
];

function htmlAttr(html, tag, attr) {
  const match = html.match(new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']*)["']`, 'i'));
  return match?.[1] ?? '';
}
function textContent(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function assertPage(page, html, stderr) {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
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
  const result = spawnSync(edge, [
    '--headless', '--disable-gpu', '--no-sandbox', '--dump-dom',
    '--virtual-time-budget=1500', '--enable-logging=stderr', '--log-level=1', url,
  ], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (result.error?.code === 'ENOENT') {
    console.log('browser-smoke: SKIP (Microsoft Edge executable not found)');
    process.exit(0);
  }
  if (result.error) {
    console.error(`browser-smoke: ${page.file}: ${result.error.message}`);
    failed = true;
    continue;
  }
  if (result.status !== 0) {
    console.error(`browser-smoke: ${page.file}: Edge exited ${result.status}\n${result.stderr}`);
    failed = true;
    continue;
  }
  try {
    assertPage(page, result.stdout, result.stderr);
    console.log(`browser-smoke: ${page.file} passed`);
  } catch (error) {
    console.error(`browser-smoke: ${error.message}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
