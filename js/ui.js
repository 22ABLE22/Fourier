// UI DOM references, toast handling, controls, presets, and info updates.
const fitBtn = document.getElementById('fitBtn');
const clearBtn = document.getElementById('clearBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetViewBtn = document.getElementById('resetViewBtn');
const circleBtn = document.getElementById('circleBtn');
const radiusBtn = document.getElementById('radiusBtn');
const smoothInput = document.getElementById('smoothInput');
const harmonicInput = document.getElementById('harmonicInput');
const speedInput = document.getElementById('speedInput');
const smoothRange = document.getElementById('smoothRange');
const harmonicRange = document.getElementById('harmonicRange');
const speedRange = document.getElementById('speedRange');
const timelineRange = document.getElementById('timelineRange');
const themeBtn = document.getElementById('themeBtn');
const infoSamples = document.getElementById('infoSamples');
const infoError = document.getElementById('infoError');
const stageHint = document.getElementById('stageHint');
const toast = document.getElementById('toast');

function showToast(msg, isError = false) {
    toast.textContent = msg; toast.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => toast.className = 'toast', 2000);
}

const UI = {
    updateInfo() {
        if (S.fourier.length === 0) {
            infoSamples.textContent = '0';
            infoError.textContent = '-';
        } else {
            infoSamples.textContent = String(S.fitSamples);
            infoError.textContent = (computeError() * 100).toFixed(1) + '%';
        }
    }
};

clearBtn.addEventListener('click', () => {
    clearTimeout(S.harmonicTimer);
    stopAnimation(); S.rawPoints = []; S.fourier = []; S.path = []; S.time = 0;
    S.muted = [];  // stale mute flags would misalign with the new empty spectrum
    fourierCtx.clearRect(0, 0, cw(fourierCanvas), ch(fourierCanvas));
    stageHint.style.display = '';
    rebuildCurve();  // S.fourier is empty, so rebuildCurve clears S.curveTable
    UI.updateInfo();
    if (typeof Spectrum !== 'undefined' && Spectrum.refresh) Spectrum.refresh();
    showToast('Cleared');
});

fitBtn.addEventListener('click', startFit);

// Log mapping between the harmonics slider position t in [0,1] and the count in [1,32768]
const harmToRangeT = h => Math.log2(Math.max(1, h)) / 15;
const rangeTToHarm = t => Math.min(32768, Math.max(1, Math.round(Math.pow(2, t * 15))));

smoothInput.addEventListener('input', () => {
    const v = parseInt(smoothInput.value, 10);
    if (!isFinite(v)) return;
    S.smoothness = Math.min(10, Math.max(1, v));
    smoothRange.value = String(S.smoothness);
    refitLive();
});
smoothInput.addEventListener('change', () => {
    smoothInput.value = S.smoothness;
    smoothRange.value = String(S.smoothness);
});

// Range -> number: keep the readout in sync and drive the existing pipeline
smoothRange.addEventListener('input', () => {
    const v = parseInt(smoothRange.value, 10);
    if (!isFinite(v)) return;
    smoothInput.value = String(v);
    S.smoothness = Math.min(10, Math.max(1, v));
    refitLive();
});

harmonicInput.addEventListener('input', () => {
    const v = parseInt(harmonicInput.value, 10);
    if (isFinite(v)) { applyHarmonics(v); harmonicRange.value = String(harmToRangeT(Math.max(1, v))); }
});
harmonicInput.addEventListener('change', () => {
    const v = parseInt(harmonicInput.value, 10);
    applyHarmonics(isFinite(v) ? v : S.harmonics, true);
    harmonicInput.value = S.harmonics;
    harmonicRange.value = String(harmToRangeT(S.harmonics));
});

// Range -> number: show the integer harmonics live while dragging; applyHarmonics debounces at 180ms
harmonicRange.addEventListener('input', () => {
    const h = rangeTToHarm(parseFloat(harmonicRange.value));
    harmonicInput.value = String(h);
    applyHarmonics(h);
});

speedInput.addEventListener('input', () => {
    const v = parseFloat(speedInput.value);
    if (!isFinite(v)) return;
    S.speed = Math.min(5, Math.max(0.01, v));
    speedRange.value = String(S.speed);
});
speedInput.addEventListener('change', () => {
    speedInput.value = String(Math.round(S.speed * 1000) / 1000);
    speedRange.value = String(S.speed);
});

// Range -> number: three-decimal readout of the clamped speed
speedRange.addEventListener('input', () => {
    const v = parseFloat(speedRange.value);
    if (!isFinite(v)) return;
    S.speed = Math.min(5, Math.max(0.01, v));
    speedInput.value = String(Math.round(S.speed * 1000) / 1000);
});

function scrubTimeline() {
    const t = parseFloat(timelineRange.value);
    if (!isFinite(t)) return;
    if (S.animationId) stopAnimation();
    S.time = Math.min(1, Math.max(0, t));
    S.paused = true;
    pauseBtn.textContent = '▶️ Resume';
    rebuildTrail();
    draw();
}
timelineRange.addEventListener('input', scrubTimeline);
timelineRange.addEventListener('change', scrubTimeline);

// Initialize both halves of each control pair from the current shared state
smoothInput.value = String(S.smoothness);
smoothRange.value = String(S.smoothness);
harmonicInput.value = String(S.harmonics);
harmonicRange.value = String(harmToRangeT(S.harmonics));
speedInput.value = String(Math.round(S.speed * 1000) / 1000);
speedRange.value = String(S.speed);
if (timelineRange) timelineRange.value = S.time.toFixed(3);

pauseBtn.addEventListener('click', () => {
    if (!S.animationId) {
        if (!S.paused) return;
        S.paused = false;
        pauseBtn.textContent = '⏸️ Pause';
        if (timelineRange) timelineRange.value = S.time.toFixed(3);
        animate();
        return;
    }
    S.paused = !S.paused;
    pauseBtn.textContent = S.paused ? '▶️ Resume' : '⏸️ Pause';
    if (timelineRange) timelineRange.value = S.time.toFixed(3);
});

resetViewBtn.addEventListener('click', () => { autoFitView(); draw(); });

circleBtn.addEventListener('click', () => {
    S.showCircles = !S.showCircles; circleBtn.setAttribute('aria-pressed', String(S.showCircles)); draw();
});

radiusBtn.addEventListener('click', () => {
    S.showRadii = !S.showRadii; radiusBtn.setAttribute('aria-pressed', String(S.showRadii)); draw();
});

const presets = {
    heart: t => ({ x: 80*Math.sin(t)**3, y: -(65*Math.cos(t)-25*Math.cos(2*t)-10*Math.cos(3*t)-5*Math.cos(4*t)) }),
    star: t => { const r = 80+60*Math.cos(5*t); return { x: r*Math.cos(t), y: r*Math.sin(t) }; },
    butterfly: t => { const e = Math.exp(Math.cos(t))-2*Math.cos(4*t)-Math.sin(t/12)**5; return { x: 60*Math.sin(t)*e, y: -50*Math.cos(t)*e }; },
    treble: t => { const r = 60+30*Math.sin(3*t)+20*Math.cos(2*t); return { x: r*Math.sin(t), y: -r*Math.cos(t)+20*Math.sin(2*t) }; },
    arrow: t => ({ x: 100*Math.cos(t)+30*Math.cos(3*t), y: 60*Math.sin(t)+40*Math.sin(2*t) }),
    infinity: t => { const d = 1+Math.sin(t)**2; return { x: 100*Math.cos(t)/d, y: 100*Math.sin(t)*Math.cos(t)/d }; }
};

document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
        const fn = presets[btn.dataset.preset]; if (!fn) return;
        stopAnimation(); S.rawPoints = []; stageHint.style.display = 'none';
        S.muted = [];  // preset replaces the point set, so old mute flags no longer apply
        S.fitCenter = { x: 0, y: 0 }; S.viewX = 0; S.viewY = 0; S.viewScale = 1;
        const dw = cw(fourierCanvas), dh = ch(fourierCanvas);
        const scale = Math.min(dw,dh)/350;
        for (let i = 0; i < 360; i++) {
            const t = 2*Math.PI*i/360, p = fn(t);
            S.rawPoints.push({ x: p.x * scale, y: p.y * scale });
        }
        redrawDrawing();
        showToast('Preset loaded: ' + btn.textContent.trim());
        startFit();
    });
});

// Theme toggle: cycles auto -> light -> dark, persisted in localStorage
const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: '🌗 Auto', light: '☀️ Light', dark: '🌙 Dark' };

function readTheme() {
    try { return localStorage.getItem('fourier.theme'); } catch (e) { return null; }  // file:// may deny storage
}
function writeTheme(mode) {
    try { localStorage.setItem('fourier.theme', mode); } catch (e) { /* ignore quota/security errors */ }
}
function applyTheme(mode) {
    document.documentElement.dataset.theme = mode;
    themeBtn.textContent = THEME_LABEL[mode] || THEME_LABEL.auto;
}

let themeMode = readTheme();
if (!THEME_LABEL[themeMode]) themeMode = 'auto';
applyTheme(themeMode);

themeBtn.addEventListener('click', () => {
    themeMode = THEME_ORDER[(THEME_ORDER.indexOf(themeMode) + 1) % THEME_ORDER.length];
    writeTheme(themeMode);
    applyTheme(themeMode);
});
