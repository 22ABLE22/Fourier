// 启动与自适应:初始画布尺寸与首帧绘制、窗口 resize 与 ResizeObserver
sizeFourierCanvas();
draw();

let resizeTimer = null;
const scheduleResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(refitOnResize, 80); };
window.addEventListener('resize', scheduleResize);
if (window.ResizeObserver) new ResizeObserver(scheduleResize).observe(fourierCanvas.parentElement);
