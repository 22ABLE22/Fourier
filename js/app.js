// Bootstrap and responsive sizing: initial canvas paint, window resize, and ResizeObserver.
sizeFourierCanvas();
draw();

// Import the image tracer handoff from localStorage and fit it on startup.
(function importPendingImage() {
    try {
        const raw = localStorage.getItem('fourier.pendingImport');
        if (!raw) return;
        localStorage.removeItem('fourier.pendingImport');
        const data = JSON.parse(raw);
        const pts = data && data.points;
        if (!Array.isArray(pts) || pts.length < 10) return;
        S.rawPoints = pts.map(p => ({ x: +p[0], y: +p[1] }));
        if (stageHint) stageHint.style.display = 'none';
        startFit();
    } catch (err) { /* Ignore malformed handoff data. */ }
})();

let resizeTimer = null;
const scheduleResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(refitOnResize, 80); };
window.addEventListener('resize', scheduleResize);
if (window.ResizeObserver) new ResizeObserver(scheduleResize).observe(fourierCanvas.parentElement);
