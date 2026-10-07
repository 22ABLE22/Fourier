// 拟合流程:重采样→DFT→视图自适应、谐波控制(applyHarmonics),以及曲线采样契约(rebuildCurve/curveAt/getTrail/getCurveHead)
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

// 重采样缓存:rawPoints 引用、length、首末点坐标与 fitSamples 全部命中才复用结果。
// 失效条件(自然覆盖):新笔画换引用(sizeFourierCanvas 的 map 亦换引用)、
// 绘制中 append 改长度/末点、fitSamples 变化。
// 缓存数组只读消费:smoothen(k>1) 先 slice、k<=1 时返回引用但 dft 仅读取,均不改写缓存内容。
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
    rebuildCurve();  // 先依据 S.harmonics/S.muted 重建采样表
    if (typeof Spectrum !== 'undefined' && Spectrum.refresh) Spectrum.refresh();
    if (typeof UI !== 'undefined' && UI.updateInfo) UI.updateInfo();
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
        if (i < S.harmonics && !S.muted[i]) usedAmp2 += S.fourier[i].amp * S.fourier[i].amp;  // 静音谐波不计入有效能量
    }
    return totalAmp2 > 0 ? 1 - usedAmp2 / totalAmp2 : 0;
}

function autoFitView() {  // 优先用 S.curveTable(逆FFT重建的采样表)求包围盒,表缺失时回退原逐点求和
    const fw = cw(fourierCanvas), fh = ch(fourierCanvas);
    if (S.fourier.length === 0) { S.viewX = 0; S.viewY = 0; S.viewScale = 1; return; }
    const table = S.curveTable;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (table && table.length > 0) {
        const len = table.length;
        const stride = Math.max(1, Math.ceil(len / 4096));  // 最多采样约 4096 点
        for (let i = 0; i < len; i += stride) {
            const p = table[i];
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        const last = table[len - 1];  // stride 取整后补查末点,避免漏掉末尾区段
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
    if (S.animationId) { S.path = []; S.time = 0; }

    const update = () => {
        if (S.rawPoints.length >= 10 && requiredSamples() > S.fitSamples) {
            computeFit();  // computeFit 内部已调用 rebuildCurve()
        } else {
            rebuildCurve();  // 谐波数量变化(或静音变化)后重建采样表
            if (typeof Spectrum !== 'undefined' && Spectrum.refresh) Spectrum.refresh();
            if (typeof UI !== 'undefined' && UI.updateInfo) UI.updateInfo();
            autoFitView(); draw();
        }
    };

    clearTimeout(S.harmonicTimer);
    if (immediate) update(); else S.harmonicTimer = setTimeout(update, 180);
}

// ===== 契约函数:曲线采样表(签名不可变,生产路径为逆FFT版) =====

// 模块级复用缓冲:T 变化时重新分配,否则仅清零复用
let _fftRe = null, _fftIm = null;

// 依据 S.harmonics 与 S.muted 重建曲线采样表 S.curveTable(逆FFT版,生产路径)
// 数学依据:填谱后 ifft 给出 S[k]=Σ amp·e^{i(φ+2π·bin·k/T)};bin≡freq (mod T)
// 使 e^{i2π·bin·k/T}=e^{i2π·freq·k/T}(折叠差 (freq-bin)·k/T 为整数),
// 故与朴素式逐点相等——无需 1/T 归一化。
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
    const need = Math.max(2048, 2 * maxFreq);  // 不小于 max(2048, 2*实际用到的最大谐波频率)
    while (T < need) T *= 2;                    // 取不小于 need 的 2 的幂
    if (T > CFG.MAX_SAFE_SAMPLES) T = CFG.MAX_SAFE_SAMPLES;  // 上限 65536
    if (!_fftRe || _fftRe.length !== T) { _fftRe = new Float64Array(T); _fftIm = new Float64Array(T); }
    else { _fftRe.fill(0); _fftIm.fill(0); }
    for (let i = 0; i < limit; i++) {
        if (S.muted[i]) continue;
        const { freq, amp, phase } = S.fourier[i];
        const bin = ((freq % T) + T) % T;  // 负频率折叠到 [0,T)
        _fftRe[bin] += amp * Math.cos(phase);  // += 防御极端 bin 碰撞(叠加而非覆盖)
        _fftIm[bin] += amp * Math.sin(phase);
    }
    ifft(_fftRe, _fftIm);  // 就地:出参即为采样点(无 1/T 归一化,见上)
    const table = new Array(T);
    for (let k = 0; k < T; k++) table[k] = { x: _fftRe[k], y: _fftIm[k] };
    S.curveTable = table;
}

// 参考/测试基准:朴素逐点谐波求和(原实现原样保留,生产路径走 rebuildCurve)
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
    const need = Math.max(2048, 2 * maxFreq);  // 不小于 max(2048, 2*实际用到的最大谐波频率)
    while (T < need) T *= 2;                    // 取不小于 need 的 2 的幂
    if (T > CFG.MAX_SAFE_SAMPLES) T = CFG.MAX_SAFE_SAMPLES;  // 上限 65536
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

// 对 S.curveTable 按 t∈[0,1) 线性插值取点
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

// 轨迹:从当前时刻往回取 steps 个采样点(池化外层数组 + 内联插值,语义与逐点 curveAt 一致)
let _trailBuf = [];

function getTrail(time, steps) {
    if (_trailBuf.length !== steps) _trailBuf = new Array(steps);  // 长度变化才重分配
    const res = _trailBuf;
    const table = S.curveTable;
    const n = table.length;
    if (n === 0) {  // 表为空:与旧实现一致,每点 {x:0,y:0}
        for (let i = 0; i < steps; i++) res[i] = { x: 0, y: 0 };
        return res;
    }
    let u = time - Math.floor(time);  // 首点 t = time mod 1 ∈ [0,1)
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

// 当前笔尖位置
function getCurveHead(time) { return curveAt(((time % 1) + 1) % 1); }
