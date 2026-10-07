// Pointer Events input: drawing, panning, pinch zooming, sampling, and gesture cleanup.
fourierCanvas.style.touchAction = 'none';

let inputDrawId = null, inputPanId = null;
const inputTouches = new Map();
let inputPinch = null;

// Convert client coordinates to canvas pixels, with a safe fallback for zero-size rects.
function clientToCanvas(cx, cy) {
    const rect = fourierCanvas.getBoundingClientRect();
    const sx = rect.width > 0 ? cw(fourierCanvas) / rect.width : 1;
    const sy = rect.height > 0 ? ch(fourierCanvas) / rect.height : 1;
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
}

// Convert event coordinates to raw stroke coordinates through screen/world space.
function getEventPos(e) {
    const s = clientToCanvas(e.clientX, e.clientY);
    const w = screenToWorld(s);
    return { x: w.x + S.fitCenter.x, y: w.y + S.fitCenter.y };
}

function finishDrawing() {
    if (!S.isDrawing) return;
    S.isDrawing = false; S.lastPt = null;
    if (S.rawPoints.length > 1) {
        const first = S.rawPoints[0], last = S.rawPoints[S.rawPoints.length - 1];
        if (last.x !== first.x || last.y !== first.y) S.rawPoints.push({ x: first.x, y: first.y });
        redrawDrawing();
    }
}

function endPan() {
    if (!S.isPanning) return;
    S.isPanning = false; S.panStart = null;
    fourierCanvas.classList.remove('panning');
}

fourierCanvas.addEventListener('pointerdown', e => {
    try { fourierCanvas.setPointerCapture(e.pointerId); } catch (err) { /* Ignore capture failures. */ }
    const isTouch = e.pointerType === 'touch';
    if (isTouch) {
        inputTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (inputTouches.size === 2) {
            // Two fingers: finish drawing before entering pinch zoom.
            if (inputDrawId !== null && S.isDrawing) finishDrawing();
            const ids = [...inputTouches.keys()];
            const a = inputTouches.get(ids[0]), b = inputTouches.get(ids[1]);
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
            inputPinch = { ids, dist, lastDist: dist, w: screenToWorld(clientToCanvas(midX, midY)), scale0: S.viewScale };
            inputDrawId = null;  // Do not resume drawing with the remaining finger.
            return;
        }
        // Single-finger touch draws (button is treated as 0).
        e.preventDefault();
        stopAnimation(); S.rawPoints = []; S.muted = []; S.isDrawing = true; S.lastPt = getEventPos(e); S.rawPoints.push(S.lastPt);
        stageHint.style.display = 'none';
        inputDrawId = e.pointerId;
        return;
    }
    if (e.button === 1) {
        e.preventDefault();
        const rect = fourierCanvas.getBoundingClientRect();
        S.isPanning = true;
        S.panStart = { x: e.clientX, y: e.clientY, viewX: S.viewX, viewY: S.viewY, sx: cw(fourierCanvas) / rect.width, sy: ch(fourierCanvas) / rect.height };
        fourierCanvas.classList.add('panning');
        inputPanId = e.pointerId;
        return;
    }
    if (e.button === 0) {
        e.preventDefault();
        stopAnimation(); S.rawPoints = []; S.muted = []; S.isDrawing = true; S.lastPt = getEventPos(e); S.rawPoints.push(S.lastPt);
        stageHint.style.display = 'none';
        inputDrawId = e.pointerId;
    }
});

function inputMove(e) {
    // Pinch zoom with incremental updates.
    if (inputPinch) {
        if (e.pointerType === 'touch' && inputPinch.ids.includes(e.pointerId) && inputTouches.has(e.pointerId)) {
            inputTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const a = inputTouches.get(inputPinch.ids[0]);
            const b = inputTouches.get(inputPinch.ids[1]);
            if (a && b) {
                const dist = Math.hypot(a.x - b.x, a.y - b.y);
                if (inputPinch.lastDist > 0) {
                    S.viewScale = Math.min(CFG.MAX_VIEW_SCALE, Math.max(CFG.MIN_VIEW_SCALE, S.viewScale * (dist / inputPinch.lastDist)));
                }
                inputPinch.lastDist = dist; inputPinch.dist = dist;
                const mid = clientToCanvas((a.x + b.x) / 2, (a.y + b.y) / 2);
                S.viewX = mid.x - cw(fourierCanvas) / 2 - inputPinch.w.x * S.viewScale;
                S.viewY = mid.y - ch(fourierCanvas) / 2 - inputPinch.w.y * S.viewScale;
                draw();
            }
        }
        return;
    }
    // Pan by recomputing from panStart.
    if (inputPanId === e.pointerId && S.isPanning && S.panStart) {
        e.preventDefault();
        S.viewX = S.panStart.viewX + (e.clientX - S.panStart.x) * S.panStart.sx;
        S.viewY = S.panStart.viewY + (e.clientY - S.panStart.y) * S.panStart.sy;
        draw();
        return;
    }
    // Draw an incremental segment.
    if (inputDrawId === e.pointerId && S.isDrawing && S.lastPt) {
        if (e.pointerType === 'mouse' && (e.buttons & 1) !== 1) { finishDrawing(); return; }
        const pt = getEventPos(e);
        if (pt.x === S.lastPt.x && pt.y === S.lastPt.y) return;  // The same event can bubble to window; skip identical points to avoid duplicate samples.
        const a = rawToScreen(S.lastPt), b = rawToScreen(pt);
        fourierCtx.strokeStyle = '#2563eb'; fourierCtx.lineWidth = 2 * S.canvasDpr;
        fourierCtx.lineCap = 'round'; fourierCtx.lineJoin = 'round';
        fourierCtx.beginPath(); fourierCtx.moveTo(a.x, a.y); fourierCtx.lineTo(b.x, b.y); fourierCtx.stroke();
        S.rawPoints.push(pt); S.lastPt = pt;
    }
}

function inputEnd(e) {
    if (e.pointerType === 'touch') inputTouches.delete(e.pointerId);
    if (inputPinch && inputTouches.size < 2) inputPinch = null;  // Do not resume drawing with the remaining finger.
    if (e.pointerId === inputDrawId) { inputDrawId = null; finishDrawing(); }
    if (e.pointerId === inputPanId) { inputPanId = null; endPan(); }
}

fourierCanvas.addEventListener('pointermove', inputMove);
window.addEventListener('pointermove', inputMove);
fourierCanvas.addEventListener('pointerup', inputEnd);
window.addEventListener('pointerup', inputEnd);
fourierCanvas.addEventListener('pointercancel', inputEnd);
window.addEventListener('pointercancel', inputEnd);
fourierCanvas.addEventListener('lostpointercapture', inputEnd);

window.addEventListener('blur', () => {
    finishDrawing(); endPan();
    inputPinch = null; inputDrawId = null; inputPanId = null;
});

fourierCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const m = clientToCanvas(e.clientX, e.clientY);
    const w = screenToWorld(m);
    const nextScale = Math.min(CFG.MAX_VIEW_SCALE, Math.max(CFG.MIN_VIEW_SCALE, S.viewScale * Math.exp(-e.deltaY * 0.001)));
    if (nextScale === S.viewScale) return;
    S.viewX = m.x - cw(fourierCanvas) / 2 - w.x * nextScale;
    S.viewY = m.y - ch(fourierCanvas) / 2 - w.y * nextScale;
    S.viewScale = nextScale;
    draw();
}, { passive: false });
