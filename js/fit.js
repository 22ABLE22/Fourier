// Fitting pipeline: resampling, DFT, view fitting, harmonic controls, and curve-table contracts.
function startFit() {
    clearTimeout(S.harmonicTimer);
    if (S.rawPoints.length < 10) { showToast('Draw more points first!', true); return; }
    sizeFourierCanvas();
    computeFit();
    stageHint.style.display = 'none';
    if (S.animationId) { cancelAnimationFrame(S.animationId); S.animationId = null; }
    S.path = []; S.time = 0; animate();
}

function requiredSamples() {
    let samples = CFG.BASE_SAMPLES;
    const target = Math.min(CFG.MAX_SAFE_SAMPLES, Math.max(CFG.BASE_SAMPLES, 2 * S.harmonics));
    while (samples < target) samples *= 2;
    return samples;
}

// Resample cache: reuse only when the point reference, length, endpoints, and sample count match.
// Invalidation: a new stroke changes the reference, and resizing maps to a new reference.
// Drawing changes the length or endpoint, and fitSamples changes.
// Cached arrays are read-only: smoothing copies for k>1, while DFT never mutates the input.
let _resampleCache = { ref: null, n: 0, fitSamples: 0, x0: 0, y0: 0, x1: 0, y1: 0, pts: null };

function resampleBase() {
    const src = S.rawPoints, c = _resampleCache;
    if (c.pts && c.ref === src && c.n === src.length && c.fitSamples === S.fitSamples && src.length > 0 &&
        c.x0 === src[0].x && c.y0 === src[0].y &&
        c.x1 === src[src.length - 1].x && c.y1 === src[src.length - 1].y) {
        return c.pts;
    }
    const pts = resample(src, S.fitSamples);
    _resampleCache = {
        ref: src, n: src.length, fitSamples: S.fitSamples,
        x0: src.length ? src[0].x : 0, y0: src.length ? src[0].y : 0,
        x1: src.length ? src[src.length - 1].x : 0, y1: src.length ? src[src.length - 1].y : 0,
        pts: pts
    };
    return pts;
}

function computeFit() {
    S.fitSamples = requiredSamples();
    const resampled = smoothen(resampleBase(), S.smoothness);
    let centerX = 0, centerY = 0;
    for (const p of resampled) { centerX += p.x; centerY += p.y; }
    S.fitCenter = { x: centerX / resampled.length, y: centerY / resampled.length };
    S.fourier = dft(resampled);
    rebuildCurve();  // rebuild the table from S.harmonics/S.muted
    if (typeof Spectrum !== 'undefined' && Spectrum.refresh) Spectrum.refresh();
    if (typeof UI !== 'undefined' && UI.updateInfo) UI.updateInfo();
    rebuildTrail();  // rebuild the trail for the current time
    autoFitView();
    draw();
}

function refitLive() {
    if (S.fourier.length === 0 || S.rawPoints.length < 10) return;
    computeFit();
    if (!S.animationId) { S.path = []; S.time = 0; animate(); }
}

function computeError() {
    if (S.fourier.length === 0 || S.rawPoints.length < 2) return 1;
    let totalAmp2 = 0, usedAmp2 = 0;
    for (let i = 0; i < S.fourier.length; i++) {
        totalAmp2 += S.fourier[i].amp * S.fourier[i].amp;
        if (i < S.harmonics && !S.muted[i]) usedAmp2 += S.fourier[i].amp * S.fourier[i].amp;  // muted harmonics do not contribute to used energy
    }
    return totalAmp2 > 0 ? 1 - usedAmp2 / totalAmp2 : 0;
}

function autoFitView() {  // prefer the inverse-FFT curve table for bounds, with the original point-sum fallback
    const fw = cw(fourierCanvas), fh = ch(fourierCanvas);
    if (S.fourier.length === 0) { S.viewX = 0; S.viewY = 0; S.viewScale = 1; return; }
    const table = S.curveTable;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (table && table.length > 0) {
        const len = table.length;
        const stride = Math.max(1, Math.ceil(len / 4096));  // sample at most about 4096 points
        for (let i = 0; i < len; i += stride) {
            const p = table[i];
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        const last = table[len - 1];  //check the final point after striding so the last segment is not missed
        if (last.x < minX) minX = last.x; if (last.x > maxX) maxX = last.x;
        if (last.y < minY) minY = last.y; if (last.y > maxY) maxY = last.y;
    } else {
        const limit = Math.max(1, Math.min(S.harmonics, S.fourier.length));
        const steps = limit > 1000 ? 180 : 360;
        for (let i = 0; i < steps; i++) {
            const t = i / steps;
            let px = 0, py = 0;
            for (let j = 0; j < limit; j++) {
                const { freq, amp, phase } = S.fourier[j];
                const a = freq * 2*Math.PI * t + phase;
                px += amp * Math.cos(a); py += amp * Math.sin(a);
            }
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
    }
    const bw = Math.max(maxX - minX, 1e-6), bh = Math.max(maxY - minY, 1e-6);
    const FILL = 0.9;
    S.viewScale = Math.min(FILL * fw / bw, FILL * fh / bh);
    S.viewX = -(minX + maxX) / 2 * S.viewScale;
    S.viewY = -(minY + maxY) / 2 * S.viewScale;
}

function applyHarmonics(value, immediate = false) {
    const requested = Math.max(1, Math.floor(value));
    S.harmonics = Math.min(CFG.MAX_HARMONICS, requested);
    if (requested > CFG.MAX_HARMONICS && Date.now() - S.harmonicWarningAt > 1500) {
        S.harmonicWarningAt = Date.now();
        showToast(`Harmonics limited to ${CFG.MAX_HARMONICS}`, true);
    }

    const update = () => {
        if (S.rawPoints.length >= 10 && requiredSamples() > S.fitSamples) {
            computeFit();  // computeFit already calls rebuildCurve() and rebuildTrail()
        } else {
            rebuildCurve();  // rebuild the table after harmonic or mute changes
            rebuildTrail();  // rebuild the trail without resetting animation time or path
            if (typeof Spectrum !== 'undefined' && Spectrum.refresh) Spectrum.refresh();
            if (typeof UI !== 'undefined' && UI.updateInfo) UI.updateInfo();
            autoFitView(); draw();
        }
    };

    clearTimeout(S.harmonicTimer);
    if (immediate) update(); else S.harmonicTimer = setTimeout(update, 180);
}

// Rebuild the trail for the current harmonics and time.
function rebuildTrail() {
    const limit = Math.min(S.harmonics, S.fourier.length);
    S.path = getTrail(S.time, limit > 1000 ? 120 : 240);
}

// ===== Contract functions: curve table (stable signatures, inverse-FFT production path) =====

// Module-level FFT buffers: reallocate when T changes, otherwise clear and reuse.
let _fftRe = null, _fftIm = null;

// Build S.curveTable from S.harmonics and S.muted using the inverse FFT.
// Math: after filling the spectrum, ifft gives S[k]=Σ amp·e^{i(φ+2π·bin·k/T)};bin≡freq (mod T)
// // Folding bins preserves the phase because the frequency difference is integral.
// // Therefore it matches the direct sum and needs no 1/T normalization.
function rebuildCurve() {
    if (S.fourier.length === 0) { S.curveTable = []; return; }
    const limit = Math.max(1, Math.min(S.harmonics, S.fourier.length));
    let maxFreq = 0;
    for (let i = 0; i < limit; i++) {
        if (S.muted[i]) continue;
        const f = Math.abs(S.fourier[i].freq);
        if (f > maxFreq) maxFreq = f;
    }
    let T = 2048;
    const need = Math.max(2048, 2 * maxFreq);  // at least twice the largest used harmonic frequency
    while (T < need) T *= 2;                    // use the next power of two at least as large as need
    if (T > CFG.MAX_SAFE_SAMPLES) T = CFG.MAX_SAFE_SAMPLES;  // cap at 65536
    if (!_fftRe || _fftRe.length !== T) { _fftRe = new Float64Array(T); _fftIm = new Float64Array(T); }
    else { _fftRe.fill(0); _fftIm.fill(0); }
    for (let i = 0; i < limit; i++) {
        if (S.muted[i]) continue;
        const { freq, amp, phase } = S.fourier[i];
        const bin = ((freq % T) + T) % T;  // fold negative frequencies into [0,T)
        _fftRe[bin] += amp * Math.cos(phase);  // += handles rare bin collisions by accumulating
        _fftIm[bin] += amp * Math.sin(phase);
    }
    ifft(_fftRe, _fftIm);  // in place; the output is the sample table, without 1/T normalization
    const table = new Array(T);
    for (let k = 0; k < T; k++) table[k] = { x: _fftRe[k], y: _fftIm[k] };
    S.curveTable = table;
}

// Reference benchmark: direct per-point harmonic summation
function rebuildCurveNaive() {
    if (S.fourier.length === 0) { S.curveTable = []; return; }
    const limit = Math.max(1, Math.min(S.harmonics, S.fourier.length));
    let maxFreq = 0;
    for (let i = 0; i < limit; i++) {
        if (S.muted[i]) continue;
        const f = Math.abs(S.fourier[i].freq);
        if (f > maxFreq) maxFreq = f;
    }
    let T = 2048;
    const need = Math.max(2048, 2 * maxFreq);  // at least twice the largest used harmonic frequency
    while (T < need) T *= 2;                    // use the next power of two at least as large as need
    if (T > CFG.MAX_SAFE_SAMPLES) T = CFG.MAX_SAFE_SAMPLES;  // cap at 65536
    const table = new Array(T);
    for (let k = 0; k < T; k++) {
        const t = k / T;
        let px = 0, py = 0;
        for (let i = 0; i < limit; i++) {
            if (S.muted[i]) continue;
            const { freq, amp, phase } = S.fourier[i];
            const a = freq * 2 * Math.PI * t + phase;
            px += amp * Math.cos(a); py += amp * Math.sin(a);
        }
        table[k] = { x: px, y: py };
    }
    S.curveTable = table;
}

// Sample S.curveTable with linear interpolation for t in [0,1).
function curveAt(t) {
    const table = S.curveTable;
    if (table.length === 0) return { x: 0, y: 0 };
    const n = table.length;
    const u = ((t % 1) + 1) % 1;
    const pos = u * n;
    const i0 = Math.floor(pos) % n;
    const frac = pos - Math.floor(pos);
    const i1 = (i0 + 1) % n;
    const p0 = table[i0], p1 = table[i1];
    return { x: p0.x + (p1.x - p0.x) * frac, y: p0.y + (p1.y - p0.y) * frac };
}

// Trail: sample backward from the current time with pooled arrays and inline interpolation.
let _trailBuf = [];

function getTrail(time, steps) {
    if (_trailBuf.length !== steps) _trailBuf = new Array(steps);  // reallocate only when the length changes
    const res = _trailBuf;
    const table = S.curveTable;
    const n = table.length;
    if (n === 0) {  // empty table: preserve the old behavior with zero points
        for (let i = 0; i < steps; i++) res[i] = { x: 0, y: 0 };
        return res;
    }
    let u = time - Math.floor(time);  // first point t = time mod 1 in [0,1)
    const du = 1 / steps;
    for (let i = 0; i < steps; i++) {
        const pos = u * n;
        const fl = Math.floor(pos);
        const i0 = fl % n;
        const frac = pos - fl;
        const i1 = (i0 + 1) % n;
        const p0 = table[i0], p1 = table[i1];
        res[i] = { x: p0.x + (p1.x - p0.x) * frac, y: p0.y + (p1.y - p0.y) * frac };
        u -= du;
        if (u < 0) u += 1;
    }
    return res;
}

// Current curve head
function getCurveHead(time) { return curveAt(((time % 1) + 1) % 1); }
