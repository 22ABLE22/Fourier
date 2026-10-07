// 频谱面板:谐波振幅条形图 + 悬停提示 + 点击静音 + Reset mutes
// 契约消费:S.fourier(振幅降序 {amp,freq,phase})、S.harmonics、S.muted(下标对齐)、
//           rebuildCurve() / computeError() / UI.updateInfo() / draw(),fit.js 每次拟合后调用 Spectrum.refresh()
// 设计:
//   x 轴 = 谐波序号(S.fourier 顺序),显示条数 K = min(fourier 长度, 画布宽度容量, 600)
//   y 轴 = √(amp / maxAmp) 缩放(小谐波可见),悬停提示给出真实振幅/频率/相位
//   配色 = 默认琥珀 #f59e0b(与旋轮线一致);静音 #d1d5db;i ≥ S.harmonics 半透明(不参与拟合),
//          并在截断处画竖直虚线;面板为空时画居中提示
//   DPR ≤ 2 设置物理尺寸,ResizeObserver 观察 .spectrum-wrap 自动重绘;重绘仅 O(K) 次 fillRect
const Spectrum = (() => {
    const COLOR_ON = '#f59e0b';       // 活跃条(与旋轮线同色)
    const COLOR_MUTED = '#d1d5db';    // 静音条(浅灰)
    const ALPHA_BEYOND = 0.3;         // i ≥ S.harmonics:半透明 = 当前不参与拟合
    const PAD = { l: 6, r: 6, t: 11, b: 11 };
    const MAX_BARS = 600;             // 显示条数上限(宽度不足时取宽度容量)
    const EMPTY_NOTE = 'Click a bar to mute/unmute that harmonic';

    let canvas = null, ctx = null, wrap = null, tip = null, note = null, resetBtn = null;
    let geom = null;                  // 命中测试几何:{ padL, plotW, K, slot }
    let inited = false;

    // ===== 工具 =====

    function countMuted() {
        const len = S.fourier.length;
        const m = Array.isArray(S.muted) ? S.muted : [];
        let n = 0;
        for (let i = 0; i < len; i++) if (m[i]) n++;
        return n;
    }

    // 真实振幅格式化(悬停提示用):普通数取 2~4 位,极端值走科学计数
    function fmtAmp(a) {
        if (!isFinite(a)) return String(a);
        const abs = Math.abs(a);
        if (abs === 0) return '0';
        if (abs >= 1e6 || abs < 1e-3) return a.toExponential(2);
        return abs < 1 ? a.toFixed(4) : a.toFixed(2);
    }

    function hideTip() {
        if (tip && !tip.hidden) tip.hidden = true;
    }

    function updateNote(len, K, mc) {
        if (!note) return;
        if (len === 0) { note.textContent = EMPTY_NOTE; note.title = ''; return; }
        let txt = `Top ${K} of ${len} coefficients shown · ${mc} muted`;
        const cut = Math.max(1, Math.min(S.harmonics, len));
        if (cut < len) txt += ` · cutoff H=${cut}`;
        note.textContent = txt;
        note.title = 'Bars use a √(amplitude) scale so small harmonics stay visible; hover shows raw values';
    }

    // ===== 状态变更(静音切换 / 重置后的统一刷新链) =====

    // S.muted 可能是稀疏/过短数组:先规整到与 S.fourier 等长的布尔数组
    function syncMuted() {
        const n = S.fourier.length;
        const cur = Array.isArray(S.muted) ? S.muted : [];
        if (cur.length === n) return;
        const nm = new Array(n);
        for (let i = 0; i < n; i++) nm[i] = !!cur[i];
        S.muted = nm;
    }

    function applyState() {
        if (typeof rebuildCurve === 'function') rebuildCurve();               // 依据 S.harmonics/S.muted 重建采样表
        if (typeof UI !== 'undefined' && UI && UI.updateInfo) UI.updateInfo(); // 刷新 Samples/Error 信息栏
        refresh();                                                            // 重绘频谱面板(颜色/提示行)
        if (typeof draw === 'function') draw();                               // 主画布重绘
    }

    // 点击某条 → 切换 S.muted[i];S.fourier 为空时无效。返回是否生效
    function toggleMute(i) {
        if (S.fourier.length === 0 || i < 0 || i >= S.fourier.length) return false;
        syncMuted();
        S.muted[i] = !S.muted[i];
        applyState();
        return true;
    }

    // Reset mutes:整体替换 S.muted 并刷新
    function resetMutes() {
        S.muted = new Array(S.fourier.length).fill(false);
        applyState();
    }

    // ===== 绘制 =====

    function drawPanel() {
        const rect = wrap.getBoundingClientRect();
        const W = Math.round(rect.width), H = Math.round(rect.height);
        if (W < 8 || H < 8) return false;                       // 尺寸未知时不绘制(等待 ResizeObserver)

        const dpr = Math.min(2, window.devicePixelRatio || 1);  // DPR 上限 2
        const pw = Math.max(1, Math.round(W * dpr)), ph = Math.max(1, Math.round(H * dpr));
        if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);                 // 之后统一按 CSS 像素绘制
        ctx.clearRect(0, 0, W, H);
        ctx.textBaseline = 'alphabetic';
        hideTip();

        const len = S.fourier.length;
        const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
        const baseY = PAD.t + plotH;

        // ---- 空状态 ----
        if (len === 0 || plotW < 4 || plotH < 4) {
            geom = null;
            ctx.fillStyle = '#b3bdcc';
            ctx.font = '11px "Segoe UI", -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No spectrum yet — draw & fit', W / 2, H / 2);
            updateNote(0, 0, 0);
            return true;
        }

        // ---- 几何:K 条、每条一个 slot(整数边界保证条形不重叠) ----
        const K = Math.max(1, Math.min(len, plotW, MAX_BARS));
        const slot = plotW / K;
        geom = { padL: PAD.l, plotW, K, slot };

        const mArr = Array.isArray(S.muted) ? S.muted : [];
        const cut = S.harmonics;

        // 最大振幅只在可见条内求(K ≤ 600,O(K))
        let maxAmp = 0;
        for (let i = 0; i < K; i++) { const a = S.fourier[i].amp; if (a > maxAmp) maxAmp = a; }

        // 基线
        ctx.fillStyle = '#e4e8ef';
        ctx.fillRect(PAD.l, baseY, plotW, 1);

        // ---- 条形:O(K) 次 fillRect ----
        const gap = slot > 3 ? 1 : 0;
        let curFill = null, curAlpha = null;
        for (let i = 0; i < K; i++) {
            const a = S.fourier[i].amp;
            if (!(a > 0)) continue;                            // 非正振幅不画(仍可被命中测试)
            let bh = maxAmp > 0 ? plotH * Math.sqrt(a / maxAmp) : 0;
            if (bh < 1) bh = 1;                                // 可见小谐波至少 1px
            const x0 = Math.round(PAD.l + i * slot);
            let bw = Math.round(PAD.l + (i + 1) * slot) - x0 - gap;
            if (bw < 1) bw = 1;
            const fill = mArr[i] ? COLOR_MUTED : COLOR_ON;
            const alpha = i >= cut ? ALPHA_BEYOND : 1;         // 超出 harmonics 截断 → 半透明
            if (fill !== curFill) { ctx.fillStyle = fill; curFill = fill; }
            if (alpha !== curAlpha) { ctx.globalAlpha = alpha; curAlpha = alpha; }
            ctx.fillRect(x0, baseY - bh, bw, bh);
        }
        ctx.globalAlpha = 1;

        // ---- y 轴缩放标注 ----
        ctx.fillStyle = '#c3cbd6';
        ctx.font = '8px "Segoe UI", -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('√amp', PAD.l, PAD.t - 3);

        // ---- harmonics 截断:竖直虚线 + 小标签 ----
        if (cut >= 1 && cut < len && cut <= K) {
            const hx = Math.round(PAD.l + cut * slot);
            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(100,116,139,0.9)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hx + 0.5, 3.5);
            ctx.lineTo(hx + 0.5, baseY);
            ctx.stroke();
            ctx.restore();
            if (hx >= PAD.l + 44) {                            // 避开左侧 √amp 标注
                ctx.fillStyle = '#9aa5b4';
                ctx.font = '8px "Segoe UI", -apple-system, sans-serif';
                if (hx + 30 <= PAD.l + plotW) { ctx.textAlign = 'left'; ctx.fillText('H=' + cut, hx + 3, 8); }
                else { ctx.textAlign = 'right'; ctx.fillText('H=' + cut, hx - 3, 8); }
            }
        }

        updateNote(len, K, countMuted());
        return true;
    }

    // ===== 交互 =====

    function indexAt(x) {
        if (!geom || S.fourier.length === 0) return -1;
        const rel = x - geom.padL;
        if (rel < 0 || rel > geom.plotW) return -1;
        let i = Math.floor(rel / geom.slot);
        if (i < 0) i = 0;
        if (i >= geom.K) i = geom.K - 1;
        return i < S.fourier.length ? i : -1;
    }

    function showTip(i, x, y) {
        if (!tip) return;
        const c = S.fourier[i];
        if (!c) { hideTip(); return; }
        const muted = !!(Array.isArray(S.muted) && S.muted[i]);
        const state = muted ? 'muted' : (i >= S.harmonics ? 'beyond H=' + S.harmonics : 'active');
        tip.textContent = `#${i} · |f|=${Math.abs(c.freq)} · A=${fmtAmp(c.amp)} · φ=${c.phase.toFixed(3)} · ${state}`;
        tip.hidden = false;
        const wr = wrap.getBoundingClientRect();
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let left = x - tw / 2;
        if (left < 3) left = 3;
        if (left > wr.width - tw - 3) left = Math.max(3, wr.width - tw - 3);
        let top = y - th - 9;
        if (top < 3) top = y + 15;                             // 靠近顶部时翻到光标下方
        if (top > wr.height - th - 3) top = Math.max(3, wr.height - th - 3);
        tip.style.left = Math.round(left) + 'px';
        tip.style.top = Math.round(top) + 'px';
    }

    function onCanvasMove(e) {
        if (!geom) { hideTip(); return; }
        const rect = canvas.getBoundingClientRect();
        const i = indexAt(e.clientX - rect.left);
        if (i < 0) { hideTip(); return; }
        showTip(i, e.clientX - rect.left, e.clientY - rect.top);
    }

    function onCanvasClick(e) {
        if (!geom) return;
        const rect = canvas.getBoundingClientRect();
        const i = indexAt(e.clientX - rect.left);
        if (i >= 0) toggleMute(i);
    }

    // ===== 初始化 =====

    function init() {
        canvas = document.getElementById('spectrumCanvas');
        if (!canvas) return false;                             // 面板 DOM 不存在 → 保持桩行为
        wrap = canvas.parentElement || document.querySelector('.spectrum-wrap');
        ctx = canvas.getContext('2d');
        tip = document.getElementById('spectrumTip');
        note = document.getElementById('spectrumNote');
        resetBtn = document.getElementById('spectrumResetBtn');
        if (!wrap || !ctx) { canvas = null; return false; }

        canvas.addEventListener('click', onCanvasClick);
        canvas.addEventListener('mousemove', onCanvasMove);
        canvas.addEventListener('mouseleave', hideTip);
        if (resetBtn) resetBtn.addEventListener('click', resetMutes);

        // 自建 ResizeObserver(spectrum.js 内,不动 app.js):尺寸变化自动重绘
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => { requestAnimationFrame(() => { if (inited) drawPanel(); }); });
            ro.observe(wrap);
        }
        inited = true;
        return true;
    }

    // ===== 对外接口 =====

    function refresh() {
        if (!inited && !init()) return;                        // spectrumCanvas 不存在时直接 return(契约)
        drawPanel();
    }

    refresh();  // 脚本加载即绘制空状态提示

    return {
        refresh,
        toggleMute,   // 供测试/其它模块直接切换静音
        resetMutes,   // 清除全部静音
        snapshot() {  // 只读调试/测试快照(几何与计数)
            return {
                total: S.fourier.length,
                K: geom ? geom.K : 0,
                padL: geom ? geom.padL : 0,
                plotW: geom ? geom.plotW : 0,
                slot: geom ? geom.slot : 0,
                harmonics: S.harmonics,
                mutedCount: countMuted()
            };
        }
    };
})();
