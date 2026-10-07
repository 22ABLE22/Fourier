// 共享常量与应用状态:所有跨文件共享的状态集中在此,其他文件统一通过 S.xxx / CFG.xxx 读写
const CFG = { BASE_SAMPLES:256, MAX_SAFE_SAMPLES:1<<16, MAX_HARMONICS:(1<<16)/2, MAX_VISIBLE_EPICYCLES:160, MIN_VIEW_SCALE:0.02, MAX_VIEW_SCALE:100 };
const S = {
    rawPoints:[], fourier:[], path:[], time:0, curveTable:[],
    fitCenter:{x:0,y:0},
    smoothness:3, harmonics:5, speed:1, fitSamples:CFG.BASE_SAMPLES,
    animationId:null, paused:false, showCircles:true, showRadii:true,
    viewX:0, viewY:0, viewScale:1,
    isDrawing:false, lastPt:null, isPanning:false, panStart:null,
    canvasDpr:1, harmonicTimer:null, harmonicWarningAt:0,
    muted:[]  // 契约:与 S.fourier 下标对齐的布尔数组,true=该谐波静音(频谱面板用)
};
const cw = c => c.width, ch = c => c.height;
const fourierCanvas = document.getElementById('fourierCanvas');
const fourierCtx = fourierCanvas.getContext('2d');
