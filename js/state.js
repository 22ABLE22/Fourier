// Shared constants and application state; other files read and write S.xxx / CFG.xxx here.
const CFG = { BASE_SAMPLES:256, MAX_SAFE_SAMPLES:1<<16, MAX_HARMONICS:(1<<16)/2, MAX_VISIBLE_EPICYCLES:160, MIN_VIEW_SCALE:0.02, MAX_VIEW_SCALE:100 };
const S = {
    rawPoints:[], fourier:[], path:[], time:0, curveTable:[],
    fitCenter:{x:0,y:0},
    smoothness:3, harmonics:5, speed:1, fitSamples:CFG.BASE_SAMPLES,
    animationId:null, paused:false, showCircles:true, showRadii:true,
    viewX:0, viewY:0, viewScale:1,
    isDrawing:false, lastPt:null, isPanning:false, panStart:null,
    canvasDpr:1, harmonicTimer:null, harmonicWarningAt:0,
    muted:[]  // Boolean flags aligned with S.fourier; true excludes a harmonic.
};
const cw = c => c.width, ch = c => c.height;
const fourierCanvas = document.getElementById('fourierCanvas');
const fourierCtx = fourierCanvas.getContext('2d');
