// 输入:画布 Pointer Events(鼠标/笔/触摸:绘制、平移、双指缩放)、取点、结束绘制与结束平移
fourierCanvas.style.touchAction = 'none';

let inputDrawId = null, inputPanId = null;
const inputTouches = new Map();
let inputPinch = null;

// 客户端坐标→画布像素坐标(rect 尺寸为 0 时比例退化为 1,避免除零)
function clientToCanvas(cx, cy) {
    const rect = fourierCanvas.getBoundingClientRect();
    const sx = rect.width > 0 ? cw(fourierCanvas) / rect.width : 1;
    const sy = rect.height > 0 ? ch(fourierCanvas) / rect.height : 1;
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
}

// 事件坐标→原始笔迹坐标(先转屏幕像素,再转世界坐标,最后加上拟合中心)
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
    try { fourierCanvas.setPointerCapture(e.pointerId); } catch (err) { /* 捕获失败忽略 */ }
    const isTouch = e.pointerType === 'touch';
    if (isTouch) {
        inputTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (inputTouches.size === 2) {
            // 双指:先结束正在进行的绘制,再进入缩放
            if (inputDrawId !== null && S.isDrawing) finishDrawing();
            const ids = [...inputTouches.keys()];
            const a = inputTouches.get(ids[0]), b = inputTouches.get(ids[1]);
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
            inputPinch = { ids, dist, lastDist: dist, w: screenToWorld(clientToCanvas(midX, midY)), scale0: S.viewScale };
            inputDrawId = null;  // 余指不续画
            return;
        }
        // 单指触摸 → 绘制(button 视为 0)
        e.preventDefault();
        stopAnimation(); S.rawPoints = []; S.isDrawing = true; S.lastPt = getEventPos(e); S.rawPoints.push(S.lastPt);
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
        stopAnimation(); S.rawPoints = []; S.isDrawing = true; S.lastPt = getEventPos(e); S.rawPoints.push(S.lastPt);
        stageHint.style.display = 'none';
        inputDrawId = e.pointerId;
    }
});

function inputMove(e) {
    // 双指缩放(积分式:逐 move 更新)
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
    // 平移(从 panStart 幂等重算)
    if (inputPanId === e.pointerId && S.isPanning && S.panStart) {
        e.preventDefault();
        S.viewX = S.panStart.viewX + (e.clientX - S.panStart.x) * S.panStart.sx;
        S.viewY = S.panStart.viewY + (e.clientY - S.panStart.y) * S.panStart.sy;
        draw();
        return;
    }
    // 绘制(增量线段)
    if (inputDrawId === e.pointerId && S.isDrawing && S.lastPt) {
        if (e.pointerType === 'mouse' && (e.buttons & 1) !== 1) { finishDrawing(); return; }
        const pt = getEventPos(e);
        if (pt.x === S.lastPt.x && pt.y === S.lastPt.y) return;  // 同一事件冒泡到 window 会二次执行:完全同点跳过,避免重复采样
        const a = rawToScreen(S.lastPt), b = rawToScreen(pt);
        fourierCtx.strokeStyle = '#2563eb'; fourierCtx.lineWidth = 2 * S.canvasDpr;
        fourierCtx.lineCap = 'round'; fourierCtx.lineJoin = 'round';
        fourierCtx.beginPath(); fourierCtx.moveTo(a.x, a.y); fourierCtx.lineTo(b.x, b.y); fourierCtx.stroke();
        S.rawPoints.push(pt); S.lastPt = pt;
    }
}

function inputEnd(e) {
    if (e.pointerType === 'touch') inputTouches.delete(e.pointerId);
    if (inputPinch && inputTouches.size < 2) inputPinch = null;  // 余指不绘制(不恢复 inputDrawId)
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
