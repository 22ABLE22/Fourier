// Spectrum panel: harmonic bars, hover details, mute toggles, and mute reset.
// Contract dependencies: sorted S.fourier coefficients, S.harmonics, and S.muted.
// Consumers include rebuildCurve(), computeError(), UI.updateInfo(), and draw().
// Design:
//   x axis = harmonic index; K = min(coefficient count, width capacity, 600).
//   y axis = sqrt(amp / maxAmp); hover shows raw amplitude, frequency, and phase
//   colors use amber for active bars and gray for muted bars; bars beyond harmonics are translucent,
//          with a dashed cutoff line and an empty-state note
//   cap DPR at 2 and redraw on ResizeObserver changes; rendering is O(K)
const Spectrum = (() => {
    const COLOR_ON = '#f59e0b';       // active bar
    const COLOR_MUTED = '#d1d5db';    // muted bar
    const ALPHA_BEYOND = 0.3;         // i >= S.harmonics: translucent means excluded from fitting
    const PAD = { l: 6, r: 6, t: 11, b: 11 };
    const MAX_BARS = 600;             // maximum visible bars
    const EMPTY_NOTE = 'Click a bar to mute/unmute that harmonic';

    let canvas = null, ctx = null, wrap = null, tip = null, note = null, resetBtn = null;
    let geom = null;                  // hit-test geometry:{ padL, plotW, K, slot }
    let inited = false;

    // ===== Utilities =====

    function countMuted() {
        const len = S.fourier.length;
        const m = Array.isArray(S.muted) ? S.muted : [];
        let n = 0;
        for (let i = 0; i < len; i++) if (m[i]) n++;
        return n;
    }

    // Format amplitudes for hover details.
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

    // ===== State changes (mute toggles and reset refresh chain) =====

    // Normalize sparse or short mute arrays to the Fourier coefficient length.
    function syncMuted() {
        const n = S.fourier.length;
        const cur = Array.isArray(S.muted) ? S.muted : [];
        if (cur.length === n) return;
        const nm = new Array(n);
        for (let i = 0; i < n; i++) nm[i] = !!cur[i];
        S.muted = nm;
    }

    function applyState() {
        if (typeof rebuildCurve === 'function') rebuildCurve();               // rebuild the curve table from S.harmonics/S.muted
        if (typeof rebuildTrail === 'function') rebuildTrail();               // refresh the trail so a paused animation stays consistent
        if (typeof UI !== 'undefined' && UI && UI.updateInfo) UI.updateInfo(); // refresh the Samples/Error info bar
        refresh();                                                            // repaint the spectrum panel (colors/notes)
        if (typeof draw === 'function') draw();                               // repaint the main canvas
    }

    // Click a bar to toggle S.muted[i]; no-op when the spectrum is empty.
    function toggleMute(i) {
        if (S.fourier.length === 0 || i < 0 || i >= S.fourier.length) return false;
        syncMuted();
        S.muted[i] = !S.muted[i];
        applyState();
        return true;
    }

    // Reset all mute flags and refresh.
    function resetMutes() {
        S.muted = new Array(S.fourier.length).fill(false);
        applyState();
    }

    // ===== Rendering =====

    function drawPanel() {
        const rect = wrap.getBoundingClientRect();
        const W = Math.round(rect.width), H = Math.round(rect.height);
        if (W < 8 || H < 8) return false;                       // Skip drawing until the size is known.

        const dpr = Math.min(2, window.devicePixelRatio || 1);  // DPR is capped at 2.
        const pw = Math.max(1, Math.round(W * dpr)), ph = Math.max(1, Math.round(H * dpr));
        if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);                 // Draw in CSS pixels from here.
        ctx.clearRect(0, 0, W, H);
        ctx.textBaseline = 'alphabetic';
        hideTip();

        const len = S.fourier.length;
        const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
        const baseY = PAD.t + plotH;

        // ---- empty state ----
        if (len === 0 || plotW < 4 || plotH < 4) {
            geom = null;
            ctx.fillStyle = '#b3bdcc';
            ctx.font = '11px "Segoe UI", -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No spectrum yet — draw & fit', W / 2, H / 2);
            updateNote(0, 0, 0);
            return true;
        }

        // ---- geometry: K bars with integer slots ----
        const K = Math.max(1, Math.min(len, plotW, MAX_BARS));
        const slot = plotW / K;
        geom = { padL: PAD.l, plotW, K, slot };

        const mArr = Array.isArray(S.muted) ? S.muted : [];
        const cut = S.harmonics;

        // find the maximum amplitude among visible bars
        let maxAmp = 0;
        for (let i = 0; i < K; i++) { const a = S.fourier[i].amp; if (a > maxAmp) maxAmp = a; }

        // baseline
        ctx.fillStyle = '#e4e8ef';
        ctx.fillRect(PAD.l, baseY, plotW, 1);

        // ---- bars: O(K) fillRect calls ----
        const gap = slot > 3 ? 1 : 0;
        let curFill = null, curAlpha = null;
        for (let i = 0; i < K; i++) {
            const a = S.fourier[i].amp;
            if (!(a > 0)) continue;                            // skip non-positive amplitudes
            let bh = maxAmp > 0 ? plotH * Math.sqrt(a / maxAmp) : 0;
            if (bh < 1) bh = 1;                                // keep small visible harmonics at least 1px
            const x0 = Math.round(PAD.l + i * slot);
            let bw = Math.round(PAD.l + (i + 1) * slot) - x0 - gap;
            if (bw < 1) bw = 1;
            const fill = mArr[i] ? COLOR_MUTED : COLOR_ON;
            const alpha = i >= cut ? ALPHA_BEYOND : 1;         // beyond harmonics cutoff becomes translucent
            if (fill !== curFill) { ctx.fillStyle = fill; curFill = fill; }
            if (alpha !== curAlpha) { ctx.globalAlpha = alpha; curAlpha = alpha; }
            ctx.fillRect(x0, baseY - bh, bw, bh);
        }
        ctx.globalAlpha = 1;

        // ---- y-axis scale label ----
        ctx.fillStyle = '#c3cbd6';
        ctx.font = '8px "Segoe UI", -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('√amp', PAD.l, PAD.t - 3);

        // ---- harmonics cutoff: dashed line and label ----
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
            if (hx >= PAD.l + 44) {                            // avoid the left sqrt-amp label
                ctx.fillStyle = '#9aa5b4';
                ctx.font = '8px "Segoe UI", -apple-system, sans-serif';
                if (hx + 30 <= PAD.l + plotW) { ctx.textAlign = 'left'; ctx.fillText('H=' + cut, hx + 3, 8); }
                else { ctx.textAlign = 'right'; ctx.fillText('H=' + cut, hx - 3, 8); }
            }
        }

        updateNote(len, K, countMuted());
        return true;
    }

    // ===== Interaction =====

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
        if (top < 3) top = y + 15;                             // move below the cursor near the top
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

    // ===== Initialization =====

    function init() {
        canvas = document.getElementById('spectrumCanvas');
        if (!canvas) return false;                             // Missing panel DOM keeps the module as a no-op.
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

        // use a local ResizeObserver so size changes redraw automatically
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => { requestAnimationFrame(() => { if (inited) drawPanel(); }); });
            ro.observe(wrap);
        }
        inited = true;
        return true;
    }

    // ===== Public API =====

    function refresh() {
        if (!inited && !init()) return;                        // Missing spectrumCanvas keeps the module as a no-op.
        drawPanel();
    }

    refresh();  // Draw the empty-state note when the script loads.

    return {
        refresh,
        toggleMute,   // for tests and other modules
        resetMutes,   // clear all mute flags
        snapshot() {  // read-only debug and test snapshot
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
