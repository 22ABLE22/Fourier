import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const js = name => readFileSync(join(ROOT, 'js', name), 'utf8');
const CFG = { BASE_SAMPLES: 256, MAX_SAFE_SAMPLES: 1 << 16, MAX_HARMONICS: 1 << 15, MAX_VISIBLE_EPICYCLES: 160, MIN_VIEW_SCALE: 0.02, MAX_VIEW_SCALE: 100 };
const S = { rawPoints: [], fourier: [], path: [], time: 0, curveTable: [], fitCenter: { x: 0, y: 0 }, smoothness: 3, harmonics: 5, speed: 1, fitSamples: 256, animationId: null, paused: false, showCircles: true, showRadii: true, viewX: 0, viewY: 0, viewScale: 1, isDrawing: false, lastPt: null, isPanning: false, panStart: null, canvasDpr: 1, harmonicTimer: null, harmonicWarningAt: 0, muted: [] };
const counters = { spectrum: 0, ui: 0, draw: 0 };
const context = vm.createContext({
    console, performance, setTimeout, clearTimeout, CFG, S,
    fourierCanvas: { width: 800, height: 600 },
    cw: c => c.width, ch: c => c.height,
    Spectrum: { refresh() { counters.spectrum++; } },
    UI: { updateInfo() { counters.ui++; } },
    showToast() {}, sizeFourierCanvas() {}, draw() { counters.draw++; }, animate() {},
    stageHint: { style: {} }, pauseBtn: { textContent: '' }
});
vm.runInContext(js('math.js'), context, { filename: 'math.js' });
vm.runInContext(js('fit.js'), context, { filename: 'fit.js' });

const F = context;
const maxError = (a, b) => {
    assert.equal(a.length, b.length);
    return a.reduce((m, p, i) => Math.max(m, Math.abs(p.x - b[i].x), Math.abs(p.y - b[i].y)), 0);
};
const coefficients = n => Array.from({ length: n }, (_, i) => ({ amp: 1 + i / n, phase: i * 0.17, freq: i % 2 ? -(i + 1) : i + 1 }));

S.fourier = coefficients(32); S.harmonics = 32; S.muted = new Array(32).fill(false);
F.rebuildCurveNaive();
const naive = S.curveTable.slice();
F.rebuildCurve();
assert.ok(maxError(S.curveTable, naive) < 1e-6, 'inverse FFT must match naive reconstruction');
S.muted[3] = true; F.rebuildCurveNaive(); const mutedNaive = S.curveTable.slice(); F.rebuildCurve();
assert.ok(maxError(S.curveTable, mutedNaive) < 1e-6, 'muted coefficients must be excluded consistently');

const heart = Array.from({ length: 360 }, (_, i) => {
    const t = 2 * Math.PI * i / 360;
    return { x: 80 * Math.sin(t) ** 3, y: -(65 * Math.cos(t) - 25 * Math.cos(2 * t) - 10 * Math.cos(3 * t) - 5 * Math.cos(4 * t)) };
});
S.rawPoints = heart; S.smoothness = 3; S.harmonics = 40; S.muted = [];
F.computeFit();
assert.ok(S.fourier.length === S.fitSamples - 1, 'DC coefficient should be omitted');
assert.ok(S.curveTable.length >= 2048, 'fit should build an inverse FFT table');
assert.ok(counters.spectrum > 0 && counters.ui > 0 && counters.draw > 0, 'fit should refresh dependent views');
assert.equal(F.getTrail(0.25, 120).length, 120);
assert.ok(Number.isFinite(F.computeError()), 'fit error should be finite');

const imageContext = vm.createContext({ window: {}, console });
vm.runInContext(js('image.js'), imageContext, { filename: 'image.js' });
const imageTracer = imageContext.window.ImageTracer;
assert.ok(imageTracer && typeof imageTracer.traceFromImageData === 'function', 'image tracer API should be exported');
const width = 80, height = 80, pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = (x - 40) ** 2 + (y - 40) ** 2 < 18 ** 2;
    const value = inside ? 0 : 255, i = (y * width + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value; pixels[i + 3] = 255;
}
const loops = imageTracer.traceFromImageData({ width, height, data: pixels }, { threshold: 128, smoothing: 1 });
assert.ok(loops.length > 0 && loops[0].length >= 10, 'image tracer should find a closed contour');
const normalized = imageTracer.normalize(loops[0]);
const extent = normalized.reduce((box, p) => ({ minX: Math.min(box.minX, p[0]), maxX: Math.max(box.maxX, p[0]), minY: Math.min(box.minY, p[1]), maxY: Math.max(box.maxY, p[1]) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
assert.ok(Math.abs((extent.maxX - extent.minX) - 300) < 1.1 && Math.abs((extent.maxY - extent.minY) - 300) < 1.1, 'normalized contour should fit a 300-unit box');

console.log('fit.test.mjs: all numerical and image-tracing assertions passed');
