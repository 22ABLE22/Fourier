import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function read(name) {
  return readFileSync(join(ROOT, name), 'utf8').replace(/\r\n/g, '\n');
}

function normalize(name, text) {
  let result = text;
  if (name === 'draw/index.html') {
    result = result.replaceAll('../js/', 'js/').replaceAll('../trace/', 'image.html');
  } else if (name === 'image.html') {
    result = result.replace(/^\s*<meta name="fourier-main-path"[^>]*>\n/m, '')
      .replaceAll('href="draw/"', 'href="index.html"');
  } else if (name === 'trace/index.html') {
    result = result.replace(/^\s*<meta name="fourier-main-path"[^>]*>\n/m, '')
      .replaceAll('../js/', 'js/').replaceAll('../draw/', 'index.html');
  }
  return result;
}

function diff(leftName, rightName, left, right) {
  const a = left.split('\n');
  const b = right.split('\n');
  const lines = [`Entry drift: ${leftName} != ${rightName}`];
  const limit = Math.max(a.length, b.length);
  for (let i = 0; i < limit; i++) {
    if (a[i] !== b[i]) {
      lines.push(`@@ line ${i + 1} @@`);
      if (a[i] !== undefined) lines.push(`- ${a[i]}`);
      if (b[i] !== undefined) lines.push(`+ ${b[i]}`);
    }
  }
  return lines.join('\n');
}

const pairs = [
  ['index.html', 'draw/index.html'],
  ['image.html', 'trace/index.html'],
];
let failed = false;
for (const [leftName, rightName] of pairs) {
  const left = normalize(leftName, read(leftName));
  const right = normalize(rightName, read(rightName));
  if (left !== right) {
    failed = true;
    console.error(diff(leftName, rightName, left, right));
  } else {
    console.log(`entry-drift: ${leftName} and ${rightName} match after normalization`);
  }
}
if (failed) process.exitCode = 1;
