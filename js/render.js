// 渲染:原始笔迹/轨迹/旋轮线绘制、动画循环、画布尺寸与坐标换算(worldToScreen/screenToWorld/rawToScreen)
function redrawDrawing() {
    fourierCtx.clearRect(0, 0, cw(fourierCanvas), ch(fourierCanvas));
    if (S.rawPoints.length < 2) return;
    fourierCtx.strokeStyle = '#2563eb'; fourierCtx.lineWidth = 2 * S.canvasDpr; fourierCtx.lineCap = 'round'; fourierCtx.lineJoin = 'round';
    fourierCtx.beginPath();
    const p0 = rawToScreen(S.rawPoints[0]);
    fourierCtx.moveTo(p0.x, p0.y);
    for (let i = 1; i < S.rawPoints.length; i++) {
        const pi = rawToScreen(S.rawPoints[i]);
        fourierCtx.lineTo(pi.x, pi.y);
    }
    fourierCtx.stroke();
}

function animate() {
    if (S.paused) { S.animationId = requestAnimationFrame(animate); return; }
    const dt = 0.002 * S.speed; S.time = (S.time + dt) % 1;
    const limit = Math.min(S.harmonics, S.fourier.length);
    S.path = getTrail(S.time, limit > 1000 ? 120 : 240);
    draw(); S.animationId = requestAnimationFrame(animate);
}

// 世界坐标→屏幕坐标
function worldToScreen(p) {
    const fw = cw(fourierCanvas), fh = ch(fourierCanvas);
    return { x: fw/2 + S.viewX + p.x * S.viewScale, y: fh/2 + S.viewY + p.y * S.viewScale };
}

// 屏幕坐标→世界坐标
function screenToWorld(p) {
    const fw = cw(fourierCanvas), fh = ch(fourierCanvas);
    return { x: (p.x - fw/2 - S.viewX) / S.viewScale, y: (p.y - fh/2 - S.viewY) / S.viewScale };
}

// 原始笔迹坐标→屏幕坐标(先减拟合中心得到世界坐标,再投影到屏幕)
function rawToScreen(p) {
    return worldToScreen({ x: p.x - S.fitCenter.x, y: p.y - S.fitCenter.y });
}

function draw() {
    const fw = cw(fourierCanvas), fh = ch(fourierCanvas), cx = fw/2 + S.viewX, cy = fh/2 + S.viewY;
    fourierCtx.clearRect(0, 0, fw, fh);
    fourierCtx.lineJoin = 'round'; fourierCtx.lineCap = 'round';
    if (S.rawPoints.length > 1) {
        fourierCtx.strokeStyle = 'rgba(37,99,235,0.35)'; fourierCtx.lineWidth = 1.6 * S.canvasDpr;
        fourierCtx.beginPath();
        const s0 = rawToScreen(S.rawPoints[0]);
        fourierCtx.moveTo(s0.x, s0.y);
        for (let i = 1; i < S.rawPoints.length; i++) {
            const si = rawToScreen(S.rawPoints[i]);
            fourierCtx.lineTo(si.x, si.y);
        }
        fourierCtx.stroke();
    }
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
        // 笔尖残余矢量:链条末端到画笔尖的差距超过阈值时画虚线提示
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
    fourierCtx.clearRect(0, 0, cw(fourierCanvas), ch(fourierCanvas));
    S.paused = false; pauseBtn.textContent = '⏸️ Pause';
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
    }
    rebuildCurve();  // 缩放数据变换之后重建曲线采样表(S.fourier 为空时会清空表)

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
