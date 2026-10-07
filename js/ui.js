// 界面:控件/信息栏 DOM 引用、Toast、全部控件事件绑定、预设图形与信息栏更新(UI.updateInfo)
const fitBtn = document.getElementById('fitBtn');
const clearBtn = document.getElementById('clearBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetViewBtn = document.getElementById('resetViewBtn');
const circleBtn = document.getElementById('circleBtn');
const radiusBtn = document.getElementById('radiusBtn');
const smoothInput = document.getElementById('smoothInput');
const harmonicInput = document.getElementById('harmonicInput');
const speedInput = document.getElementById('speedInput');
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
    fourierCtx.clearRect(0, 0, cw(fourierCanvas), ch(fourierCanvas));
    stageHint.style.display = '';
    rebuildCurve();  // S.fourier 已清空,重建会清空 S.curveTable
    UI.updateInfo();
    if (typeof Spectrum !== 'undefined' && Spectrum.refresh) Spectrum.refresh();
    showToast('Cleared');
});

fitBtn.addEventListener('click', startFit);

smoothInput.addEventListener('input', () => {
    const v = parseInt(smoothInput.value, 10);
    if (!isFinite(v)) return;
    S.smoothness = Math.min(10, Math.max(1, v));
    refitLive();
});
smoothInput.addEventListener('change', () => { smoothInput.value = S.smoothness; });

harmonicInput.addEventListener('input', () => {
    const v = parseInt(harmonicInput.value, 10);
    if (isFinite(v)) applyHarmonics(v);
});
harmonicInput.addEventListener('change', () => {
    const v = parseInt(harmonicInput.value, 10);
    applyHarmonics(isFinite(v) ? v : S.harmonics, true);
    harmonicInput.value = S.harmonics;
});

speedInput.addEventListener('input', () => {
    const v = parseFloat(speedInput.value);
    if (!isFinite(v)) return;
    S.speed = Math.min(5, Math.max(0.01, v));
});
speedInput.addEventListener('change', () => { speedInput.value = String(Math.round(S.speed * 10000) / 10000); });

pauseBtn.addEventListener('click', () => {
    if (!S.animationId) return;
    S.paused = !S.paused; pauseBtn.textContent = S.paused ? '▶️ Resume' : '⏸️ Pause';
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
