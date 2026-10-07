// Image tracing utilities and page wiring.
(function () {
    'use strict';

    function edgeT(threshold, a, b) {
        if (a === b) return 0.5;
        const t = (threshold - 0.5 - a) / (b - a);
        return Math.max(0, Math.min(1, t));
    }

    function smoothLoop(points, passes) {
        let result = points;
        for (let pass = 0; pass < passes; pass++) {
            const next = new Array(result.length);
            for (let i = 0; i < result.length; i++) {
                const a = result[(i + result.length - 1) % result.length];
                const b = result[i];
                const c = result[(i + 1) % result.length];
                next[i] = { x: (a.x + 4 * b.x + c.x) / 6, y: (a.y + 4 * b.y + c.y) / 6 };
            }
            result = next;
        }
        return result;
    }

    function decimate(points, count) {
        if (count >= points.length) return points;
        const result = [];
        for (let i = 0; i < count; i++) result.push(points[Math.floor(i * points.length / count)]);
        return result;
    }

    function normalize(loop) {
        if (!Array.isArray(loop) || !loop.length) return [];
        const points = loop.map(function (p) {
            return Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p.x), y: Number(p.y) };
        });
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        points.forEach(function (p) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        const scale = 300 / Math.max(maxX - minX, maxY - minY, 1e-9);
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        return points.map(function (p) { return [(p.x - cx) * scale, (p.y - cy) * scale]; });
    }

    function traceFromImageData(imageData, options) {
        options = options || {};
        const width = imageData.width, height = imageData.height;
        if (width < 3 || height < 3) return [];
        const threshold = Math.max(0, Math.min(255, Number(options.threshold === undefined ? 128 : options.threshold)));
        const invert = !!options.invert;
        const smoothing = Math.max(0, Math.min(8, Math.round(Number(options.smoothing || 0))));
        const maxPoints = Math.max(30, Number(options.maxPoints || 2000));
        const W = width + 2, H = height + 2;
        const gray = new Uint8Array(W * H);
        gray.fill(255);
        const src = imageData.data;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                let value = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
                if (invert) value = 255 - value;
                gray[(y + 1) * W + x + 1] = value;
            }
        }

        const keyCount = 2 * W * H;
        const first = new Int32Array(keyCount); first.fill(-1);
        const second = new Int32Array(keyCount); second.fill(-1);
        const pointX = new Float64Array(keyCount);
        const pointY = new Float64Array(keyCount);
        const present = new Uint8Array(keyCount);

        function setPoint(key, x, y) {
            if (!present[key]) { present[key] = 1; pointX[key] = x; pointY[key] = y; }
        }
        function pair(a, b) {
            if (first[a] < 0) first[a] = b; else if (second[a] < 0) second[a] = b;
            if (first[b] < 0) first[b] = a; else if (second[b] < 0) second[b] = a;
        }
        function addSegment(a, b, coords) {
            setPoint(a, coords[a][0], coords[a][1]);
            setPoint(b, coords[b][0], coords[b][1]);
            pair(a, b);
        }

        for (let y = 0; y < H - 1; y++) {
            for (let x = 0; x < W - 1; x++) {
                const i00 = y * W + x, i10 = i00 + 1, i01 = i00 + W, i11 = i01 + 1;
                const tlv = gray[i00], trv = gray[i10], blv = gray[i01], brv = gray[i11];
                const tl = tlv >= threshold ? 8 : 0, tr = trv >= threshold ? 4 : 0;
                const br = brv >= threshold ? 2 : 0, bl = blv >= threshold ? 1 : 0;
                const code = tl | tr | br | bl;
                if (code === 0 || code === 15) continue;
                const top = 2 * i00, left = top + 1, right = 2 * (y * W + x + 1) + 1, bottom = 2 * i01;
                const coords = {};
                coords[top] = [x + edgeT(threshold, tlv, trv), y];
                coords[bottom] = [x + edgeT(threshold, blv, brv), y + 1];
                coords[left] = [x, y + edgeT(threshold, tlv, blv)];
                coords[right] = [x + 1, y + edgeT(threshold, trv, brv)];
                let segments;
                switch (code) {
                    case 1: segments = [[left, bottom]]; break;
                    case 2: segments = [[bottom, right]]; break;
                    case 3: segments = [[left, right]]; break;
                    case 4: segments = [[top, right]]; break;
                    case 5: {
                        const centerOn = (tlv + trv + brv + blv) / 4 >= threshold;
                        segments = centerOn ? [[top, left], [right, bottom]] : [[top, right], [bottom, left]];
                        break;
                    }
                    case 6: segments = [[top, bottom]]; break;
                    case 7: segments = [[top, left]]; break;
                    case 8: segments = [[top, left]]; break;
                    case 9: segments = [[top, bottom]]; break;
                    case 10: {
                        const centerOn = (tlv + trv + brv + blv) / 4 >= threshold;
                        segments = centerOn ? [[top, right], [bottom, left]] : [[top, left], [right, bottom]];
                        break;
                    }
                    case 11: segments = [[top, right]]; break;
                    case 12: segments = [[left, right]]; break;
                    case 13: segments = [[bottom, right]]; break;
                    case 14: segments = [[left, bottom]]; break;
                    default: segments = [];
                }
                segments.forEach(function (segment) { addSegment(segment[0], segment[1], coords); });
            }
        }

        const visited = new Uint8Array(keyCount), loops = [];
        for (let start = 0; start < keyCount; start++) {
            if (!present[start] || visited[start] || first[start] < 0) continue;
            const points = [];
            let current = start, previous = -1, guard = 0;
            do {
                visited[current] = 1;
                points.push({ x: pointX[current] - 1, y: pointY[current] - 1 });
                const next = first[current] !== previous ? first[current] : second[current];
                previous = current;
                current = next;
                guard++;
            } while (current >= 0 && current !== start && guard <= keyCount);
            if (current !== start || points.length < 3) continue;
            let area = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < points.length; i++) {
                const a = points[i], b = points[(i + 1) % points.length];
                area += a.x * b.y - b.x * a.y;
                minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
                minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y);
            }
            const absArea = Math.abs(area) / 2;
            if (absArea < 1) continue;
            if (maxX - minX >= width + 1 && maxY - minY >= height + 1) continue;
            const processed = smoothing ? smoothLoop(points, smoothing) : points;
            loops.push({ points: processed, area: absArea });
        }
        loops.sort(function (a, b) { return b.area - a.area; });
        const selected = loops.slice(0, 16).map(function (entry) { return entry.points; });
        let total = selected.reduce(function (sum, loop) { return sum + loop.length; }, 0);
        if (total > maxPoints) {
            const quotas = selected.map(function (loop) { return Math.max(3, Math.floor(maxPoints * loop.length / total)); });
            let quotaTotal = quotas.reduce(function (sum, n) { return sum + n; }, 0);
            while (quotaTotal > maxPoints) {
                let index = -1;
                for (let i = 0; i < quotas.length; i++) if (quotas[i] > 3 && (index < 0 || quotas[i] > quotas[index])) index = i;
                if (index < 0) break;
                quotas[index]--; quotaTotal--;
            }
            return selected.map(function (loop, i) { return decimate(loop, quotas[i]); });
        }
        return selected;
    }

    function traceFromCanvas(canvas, options) {
        const context = canvas.getContext('2d');
        return traceFromImageData(context.getImageData(0, 0, canvas.width, canvas.height), options);
    }

    window.ImageTracer = { traceFromImageData: traceFromImageData, traceFromCanvas: traceFromCanvas, normalize: normalize };

    (function initPage() {
        if (typeof document === 'undefined') return;
        const fileInput = document.getElementById('fileInput');
        const canvas = document.getElementById('traceCanvas');
        if (!fileInput || !canvas) return;
        const stage = document.getElementById('stage');
        const ctx = canvas.getContext('2d');
        const threshold = document.getElementById('thresholdRange');
        const thresholdVal = document.getElementById('thresholdVal');
        const invert = document.getElementById('invertChk');
        const smooth = document.getElementById('smoothRange');
        const smoothVal = document.getElementById('smoothVal');
        const mask = document.getElementById('maskChk');
        const useBtn = document.getElementById('useBtn');
        const pointsInfo = document.getElementById('infoPoints');
        const statusInfo = document.getElementById('infoStatus');
        const hint = document.getElementById('stageHint');
        const toast = document.getElementById('toast');
        const themeBtn = document.getElementById('themeBtn');
        let sourceCanvas = null, sourceData = null, contours = [], normalized = null, maskCanvas = null, queued = false;

        function showToast(message, error) {
            if (!toast) return;
            toast.textContent = message; toast.className = 'toast show' + (error ? ' error' : '');
            window.setTimeout(function () { toast.className = 'toast'; }, 2200);
        }
        function setStatus(value) { if (statusInfo) statusInfo.textContent = value; }
        function applyTheme(value) {
            document.documentElement.dataset.theme = value;
            if (themeBtn) themeBtn.textContent = value === 'dark' ? '🌙 Dark' : value === 'light' ? '☀️ Light' : '🌗 Auto';
        }
        try { applyTheme(localStorage.getItem('fourier.theme') || 'auto'); } catch (e) { applyTheme('auto'); }
        if (themeBtn) themeBtn.addEventListener('click', function () {
            const order = ['auto', 'light', 'dark'];
            const current = document.documentElement.dataset.theme || 'auto';
            const next = order[(order.indexOf(current) + 1) % order.length];
            applyTheme(next);
            try { localStorage.setItem('fourier.theme', next); } catch (e) { /* storage can be unavailable for file URLs */ }
        });

        function resizeCanvas() {
            const wrap = canvas.parentElement;
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const width = Math.max(160, wrap.clientWidth), height = Math.max(160, wrap.clientHeight);
            canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
            render();
        }
        function displayBox() {
            if (!sourceCanvas) return null;
            const imageRatio = sourceCanvas.width / sourceCanvas.height;
            let width = canvas.width, height = width / imageRatio;
            if (height > canvas.height) { height = canvas.height; width = height * imageRatio; }
            return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width: width, height: height, scale: width / sourceCanvas.width };
        }
        function rebuildMask(options) {
            if (!sourceData) return;
            maskCanvas = document.createElement('canvas'); maskCanvas.width = sourceData.width; maskCanvas.height = sourceData.height;
            const output = maskCanvas.getContext('2d').createImageData(sourceData.width, sourceData.height);
            for (let i = 0; i < sourceData.data.length; i += 4) {
                let v = 0.299 * sourceData.data[i] + 0.587 * sourceData.data[i + 1] + 0.114 * sourceData.data[i + 2];
                if (options.invert) v = 255 - v;
                if (v < options.threshold) { output.data[i] = 17; output.data[i + 1] = 24; output.data[i + 2] = 39; output.data[i + 3] = 165; }
            }
            maskCanvas.getContext('2d').putImageData(output, 0, 0);
        }
        function render() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (!sourceCanvas) return;
            const box = displayBox();
            ctx.drawImage(sourceCanvas, box.x, box.y, box.width, box.height);
            if (mask.checked && maskCanvas) ctx.drawImage(maskCanvas, box.x, box.y, box.width, box.height);
            contours.forEach(function (loop, index) {
                if (!loop.length) return;
                ctx.beginPath(); ctx.moveTo(box.x + loop[0].x * box.scale, box.y + loop[0].y * box.scale);
                for (let i = 1; i < loop.length; i++) ctx.lineTo(box.x + loop[i].x * box.scale, box.y + loop[i].y * box.scale);
                ctx.closePath(); ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = (index === 0 ? 2.8 : 1.4) * Math.min(2, window.devicePixelRatio || 1); ctx.stroke();
            });
        }
        function retrace() {
            queued = false;
            if (!sourceData) return;
            const options = { threshold: Number(threshold.value), invert: invert.checked, smoothing: Number(smooth.value) };
            contours = window.ImageTracer.traceFromImageData(sourceData, options);
            rebuildMask(options); render();
            const count = contours.reduce(function (sum, loop) { return sum + loop.length; }, 0);
            if (!contours.length) { normalized = null; useBtn.disabled = true; pointsInfo.textContent = '0'; setStatus('No contour'); showToast('No closed contour found', true); return; }
            normalized = window.ImageTracer.normalize(contours[0]);
            pointsInfo.textContent = String(count);
            if (normalized.length < 10) { normalized = null; useBtn.disabled = true; setStatus('Too few points'); showToast('Contour has too few points', true); }
            else { useBtn.disabled = false; setStatus('Ready'); }
        }
        function scheduleRetrace() { if (!queued) { queued = true; requestAnimationFrame(retrace); } }
        function loadFile(file) {
            if (!file) return;
            if (file.type && file.type.indexOf('image/') !== 0) { showToast('Please choose an image file', true); return; }
            setStatus('Loading…');
            const reader = new FileReader();
            reader.onload = function () {
                const image = new Image();
                image.onload = function () {
                    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
                    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
                    sourceCanvas = document.createElement('canvas'); sourceCanvas.width = width; sourceCanvas.height = height;
                    const sourceContext = sourceCanvas.getContext('2d'); sourceContext.drawImage(image, 0, 0, width, height);
                    try { sourceData = sourceContext.getImageData(0, 0, width, height); }
                    catch (error) { sourceData = null; setStatus('Error'); showToast('Cannot read image pixels', true); return; }
                    if (hint) hint.style.display = 'none'; retrace();
                };
                image.onerror = function () { setStatus('Error'); showToast('Failed to decode image', true); };
                image.src = reader.result;
            };
            reader.onerror = function () { setStatus('Error'); showToast('Failed to read image', true); };
            reader.readAsDataURL(file);
        }
        fileInput.addEventListener('change', function () { loadFile(fileInput.files && fileInput.files[0]); });
        [threshold, smooth].forEach(function (input) { input.addEventListener('input', function () { if (input === threshold) thresholdVal.textContent = input.value; else smoothVal.textContent = input.value; scheduleRetrace(); }); });
        invert.addEventListener('change', scheduleRetrace); mask.addEventListener('change', render);
        useBtn.addEventListener('click', function () {
            if (!normalized) return;
            try { localStorage.setItem('fourier.pendingImport', JSON.stringify({ points: normalized, ts: Date.now() })); location.href = 'index.html'; }
            catch (error) { showToast('Could not hand off contour to the main app', true); }
        });
        ['dragenter', 'dragover'].forEach(function (type) { stage.addEventListener(type, function (event) { event.preventDefault(); stage.classList.add('drop-active'); }); });
        ['dragleave', 'drop'].forEach(function (type) { stage.addEventListener(type, function (event) { event.preventDefault(); stage.classList.remove('drop-active'); }); });
        stage.addEventListener('drop', function (event) { const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]; loadFile(file); });
        new ResizeObserver(resizeCanvas).observe(canvas.parentElement); resizeCanvas();
    }());
}());
