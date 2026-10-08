// Rendering: input strokes, trails, epicycles, animation, canvas sizing, and coordinate transforms.

// Offscreen input-layer cache: a same-size physical-pixel snapshot makes cache hits O(1).
let _inputLayer = null, _inputLayerKey = null, _inputLayerRef = null;

// Rebuild or reuse the layer from size, DPR, view, fit center, point reference, and length.
function renderInputLayer() {
    const w = cw(fourierCanvas), h = ch(fourierCanvas);
    const key = [w, h, S.canvasDpr, S.viewX, S.viewY, S.viewScale, S.fitCenter.x, S.fitCenter.y, S.rawPoints.length].join('|');
    if (_inputLayer && _inputLayerKey === key && _inputLayerRef === S.rawPoints) return _inputLayer;
    if (!_inputLayer) _inputLayer = document.createElement('canvas');
    if (_inputLayer.width !== w || _inputLayer.height !== h) { _inputLayer.width = w; _inputLayer.height = h; }
    const ctx = _inputLayer.getContext('2d');
    ctx.clearRect(0, 0, w, h);  // With fewer than two points, clear the layer so drawImage is empty.
    if (S.rawPoints.length > 1) {
        ctx.strokeStyle = 'rgba(37,99,235,0.35)'; ctx.lineWidth = 1.6 * S.canvasDpr;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        const p0 = rawToScreen(S.rawPoints[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < S.rawPoints.length; i++) {
            const pi = rawToScreen(S.rawPoints[i]);
            ctx.lineTo(pi.x, pi.y);
        }
        ctx.stroke();
    }
    _inputLayerKey = key; _inputLayerRef = S.rawPoints;
    return _inputLayer;
}

function redrawDrawing() {
    fourierCtx.clearRect(0, 0, cw(fourierCanvas), ch(fourierCanvas));
    _inputLayerKey = null;  // force a rebuild so direct and cached paths stay consistent
    fourierCtx.drawImage(renderInputLayer(), 0, 0);
}

// Previous animation timestamp; null means not started and is reset by stopAnimation.
let _lastAnimTs = null;

function animate(ts) {
    if (typeof ts !== 'number') ts = performance.now();  // no-argument startFit calls use this branch
    const timelineRange = document.getElementById('timelineRange');
    if (timelineRange) timelineRange.value = S.time.toFixed(3);
    if (S.paused) { _lastAnimTs = ts; S.animationId = requestAnimationFrame(animate); return; }
    // Integrate rAF deltas at 0.12 cycles/sec; cap deltas at 0.1s to avoid background-tab jumps.
    const dtSec = _lastAnimTs === null ? 0 : Math.min((ts - _lastAnimTs) / 1000, 0.1);
    _lastAnimTs = ts;
    S.time = (S.time + 0.12 * S.speed * dtSec) % 1;
    if (timelineRange) timelineRange.value = S.time.toFixed(3);
    rebuildTrail();  // rebuild the trail for the current harmonics and time
    draw(); S.animationId = requestAnimationFrame(animate);
}

// World coordinates to screen coordinates
function worldToScreen(p) {
    const fw = cw(fourierCanvas), fh = ch(fourierCanvas);
    return { x: fw/2 + S.viewX + p.x * S.viewScale, y: fh/2 + S.viewY + p.y * S.viewScale };
}

// Screen coordinates to world coordinates
function screenToWorld(p) {
    const fw = cw(fourierCanvas), fh = ch(fourierCanvas);
    return { x: (p.x - fw/2 - S.viewX) / S.viewScale, y: (p.y - fh/2 - S.viewY) / S.viewScale };
}

// Raw stroke coordinates to screen coordinates via the fit center.
function rawToScreen(p) {
    return worldToScreen({ x: p.x - S.fitCenter.x, y: p.y - S.fitCenter.y });
}

function draw() {
    const fw = cw(fourierCanvas), fh = ch(fourierCanvas), cx = fw/2 + S.viewX, cy = fh/2 + S.viewY;
    fourierCtx.clearRect(0, 0, fw, fh);
    fourierCtx.lineJoin = 'round'; fourierCtx.lineCap = 'round';
    renderInputLayer();  // Input layer: O(1) on a cache hit; rebuild only when size, view, or stroke data changes.
    fourierCtx.drawImage(_inputLayer, 0, 0);
    fourierCtx.strokeStyle = '#ef4444'; fourierCtx.lineWidth = 2.2 * S.canvasDpr;
    if (S.path.length > 1) {
        fourierCtx.beginPath();
        const t0 = worldToScreen(S.path[0]);
        fourierCtx.moveTo(t0.x, t0.y);
        for (let i = 1; i < S.path.length; i++) {
            const ti = worldToScreen(S.path[i]);
            fourierCtx.lineTo(ti.x, ti.y);
        }
        fourierCtx.stroke();
    }
    if (S.fourier.length > 0 && S.path.length > 0) {
        const chainEnd = drawEpicycles(fourierCtx, cx, cy, S.time, S.harmonics, S.viewScale);
        const hp = worldToScreen(getCurveHead(S.time));
        // Draw a dashed residual connector when the chain end differs from the curve head.
        const gap = Math.hypot(chainEnd.x - hp.x, chainEnd.y - hp.y);
        if (gap >= 0.5) {
            fourierCtx.shadowBlur = 0;
            fourierCtx.strokeStyle = 'rgba(124,58,237,0.55)'; fourierCtx.lineWidth = 1 * S.canvasDpr;
            fourierCtx.setLineDash([4 * S.canvasDpr, 4 * S.canvasDpr]);
            fourierCtx.beginPath(); fourierCtx.moveTo(chainEnd.x, chainEnd.y); fourierCtx.lineTo(hp.x, hp.y); fourierCtx.stroke();
            fourierCtx.setLineDash([]);
        }
        fourierCtx.shadowColor = 'rgba(124,58,237,0.35)'; fourierCtx.shadowBlur = 8 * S.canvasDpr;
        fourierCtx.fillStyle = '#7c3aed';
        fourierCtx.beginPath(); fourierCtx.arc(hp.x, hp.y, 3.4 * S.canvasDpr, 0, 2*Math.PI); fourierCtx.fill();
        fourierCtx.shadowBlur = 0;
    }
}

function drawEpicycles(ctx, ox, oy, t, n, s) {
    let px = 0, py = 0;
    const limit = Math.min(n, S.fourier.length, CFG.MAX_VISIBLE_EPICYCLES);
    for (let i = 0; i < limit; i++) {
        if (S.muted[i]) continue;  // Muted harmonics are excluded from the chain, circles, and radii.
        const { freq, amp, phase } = S.fourier[i];
        const angle = freq * 2*Math.PI * t + phase;
        const nx = px + amp * Math.cos(angle), ny = py + amp * Math.sin(angle);
        const alpha = Math.max(0.16, 0.55 - i * 0.006);
        ctx.strokeStyle = `rgba(245,158,11,${alpha})`; ctx.lineWidth = S.canvasDpr;
        if (S.showCircles) {
            ctx.beginPath(); ctx.arc(ox + px*s, oy + py*s, amp*s, 0, 2*Math.PI); ctx.stroke();
        }
        if (S.showRadii) {
            ctx.beginPath(); ctx.moveTo(ox + px*s, oy + py*s); ctx.lineTo(ox + nx*s, oy + ny*s); ctx.stroke();
        }
        px = nx; py = ny;
    }
    return { x: ox + px*s, y: oy + py*s };
}

function stopAnimation() {
    if (S.animationId) { cancelAnimationFrame(S.animationId); S.animationId = null; }
    _lastAnimTs = null;
    fourierCtx.clearRect(0, 0, cw(fourierCanvas), ch(fourierCanvas));
    S.paused = false; pauseBtn.textContent = '⏸️ Pause';
    const timelineRange = document.getElementById('timelineRange');
    if (timelineRange) timelineRange.value = S.time.toFixed(3);
}

function sizeFourierCanvas() {
    const wrap = fourierCanvas.parentElement;
    const cssW = Math.max(160, Math.round(wrap.clientWidth));
    const cssH = Math.max(160, Math.round(wrap.clientHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (cw(fourierCanvas) === w && ch(fourierCanvas) === h && S.canvasDpr === dpr) return false;

    const oldW = cw(fourierCanvas), oldH = ch(fourierCanvas);
    if (oldW > 0 && oldH > 0 && (S.rawPoints.length > 0 || S.fourier.length > 0 || S.path.length > 0)) {
        const scale = Math.min(w / oldW, h / oldH);
        const dx = (w - oldW * scale) / 2, dy = (h - oldH * scale) / 2;
        S.rawPoints = S.rawPoints.map(p => ({ x: p.x * scale + dx, y: p.y * scale + dy }));
        if (S.lastPt) S.lastPt = { x: S.lastPt.x * scale + dx, y: S.lastPt.y * scale + dy };
        S.fitCenter = { x: S.fitCenter.x * scale + dx, y: S.fitCenter.y * scale + dy };
        S.fourier = S.fourier.map(c => ({ ...c, amp: c.amp * scale }));
        S.path = S.path.map(p => ({ x: p.x * scale, y: p.y * scale }));
        S.viewX *= scale; S.viewY *= scale;  // Scale view offsets with the resize; viewScale stays unchanged.
    }
    rebuildCurve();  // rebuild the curve table after resize transforms

    _inputLayerKey = null;  // Invalidate the input-layer cache after a size change.
    S.canvasDpr = dpr;
    fourierCanvas.width = w; fourierCanvas.height = h;
    fourierCanvas.style.width = cssW + 'px';
    fourierCanvas.style.height = cssH + 'px';
    return true;
}

function refitOnResize() {
    if (sizeFourierCanvas()) {
        if (S.fourier.length === 0) { redrawDrawing(); return; }
        autoFitView(); draw();
    }
}
