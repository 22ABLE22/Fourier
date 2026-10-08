// Bootstrap and responsive sizing: initial canvas paint, window resize, and ResizeObserver.
sizeFourierCanvas();
draw();

// Import the image tracer handoff from localStorage and fit it on startup.
(function importPendingImage() {
    const key = 'fourier.pendingImport';
    let raw;
    try {
        raw = localStorage.getItem(key);
    } catch (err) {
        return;
    }
    if (!raw) return;

    let data;
    try {
        data = JSON.parse(raw);
    } catch (err) {
        showToast('Invalid import data', true);
        try { localStorage.removeItem(key); } catch (removeErr) { /* Ignore storage cleanup failures. */ }
        return;
    }
    try { localStorage.removeItem(key); } catch (err) { /* Ignore storage cleanup failures. */ }

    const pts = data && data.points;
    const validPoints = Array.isArray(pts) && pts.length >= 10 && pts.length <= 10000 &&
        pts.every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!validPoints) {
        showToast('Invalid import data', true);
        return;
    }

    if (data && Object.prototype.hasOwnProperty.call(data, 'ts')) {
        const age = Date.now() - data.ts;
        if (!Number.isFinite(data.ts) || age > 24 * 60 * 60 * 1000) {
            showToast(age > 24 * 60 * 60 * 1000 ? 'Import expired' : 'Invalid import data', true);
            return;
        }
    }

    S.rawPoints = pts.map(p => ({ x: p[0], y: p[1] }));
    if (stageHint) stageHint.style.display = 'none';
    startFit();
})();

let resizeTimer = null;
const scheduleResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(refitOnResize, 80); };
window.addEventListener('resize', scheduleResize);
if (window.ResizeObserver) new ResizeObserver(scheduleResize).observe(fourierCanvas.parentElement);
