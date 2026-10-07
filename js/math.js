// 数值计算:FFT、逆离散和(ifft)、DFT、弧长重采样、平滑(自原 IIFE 原样搬运,逻辑未改)
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len *= 2) {
        const angle = -2 * Math.PI / len;
        const wLenRe = Math.cos(angle), wLenIm = Math.sin(angle);
        for (let start = 0; start < n; start += len) {
            let wRe = 1, wIm = 0;
            for (let j = 0; j < len / 2; j++) {
                const even = start + j, odd = even + len / 2;
                const oddRe = re[odd] * wRe - im[odd] * wIm;
                const oddIm = re[odd] * wIm + im[odd] * wRe;
                re[odd] = re[even] - oddRe; im[odd] = im[even] - oddIm;
                re[even] += oddRe; im[even] += oddIm;
                const nextRe = wRe * wLenRe - wIm * wLenIm;
                wIm = wRe * wLenIm + wIm * wLenRe; wRe = nextRe;
            }
        }
    }
}

// 逆离散和(未归一化):S[k]=Σ A[j]·e^{+i2πjk/T};由 conj(fft(conj(A))) 得到
function ifft(re, im) {
    for (let i = 0; i < im.length; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < im.length; i++) im[i] = -im[i];
}

function dft(pts) {
    const N = pts.length;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= N; my /= N;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let n = 0; n < N; n++) { re[n] = pts[n].x - mx; im[n] = pts[n].y - my; }
    fft(re, im);

    const halfN = Math.floor(N / 2);
    // 缺陷E:去均值后 DC(freq=0)项恒≈0(仅浮点噪声),不再入列;
    // 消费方(computeError/autoFitView/rebuildCurve)均只按 i < limit 遍历、不依赖 freq0 存在
    const coeffs = [];
    for (let i = 1; i <= halfN; i++) {
        coeffs.push({ amp: Math.hypot(re[i], im[i]) / N, phase: Math.atan2(im[i], re[i]), freq: i });
        if (i !== N - i) {
            const neg = N - i;
            coeffs.push({ amp: Math.hypot(re[neg], im[neg]) / N, phase: Math.atan2(im[neg], re[neg]), freq: -i });
        }
    }
    coeffs.sort((a, b) => b.amp - a.amp);
    return coeffs;
}

function resample(pts, n) {
    if (pts.length < 2) return pts;
    const len = pts.length, cumulative = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % len];
        cumulative[i + 1] = cumulative[i] + Math.hypot(p1.x - p0.x, p1.y - p0.y);
    }
    const totalLength = cumulative[len];
    if (totalLength < 1e-9) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));

    const res = [], targetStep = totalLength / n;
    let segment = 0;
    for (let i = 0; i < n; i++) {
        const target = i * targetStep;
        while (segment < len - 1 && cumulative[segment + 1] < target) segment++;
        const segmentLength = cumulative[segment + 1] - cumulative[segment];
        const frac = segmentLength > 1e-12 ? (target - cumulative[segment]) / segmentLength : 0;
        const p0 = pts[segment], p1 = pts[(segment + 1) % len];
        res.push({ x: p0.x + frac*(p1.x-p0.x), y: p0.y + frac*(p1.y-p0.y) });
    }
    return res;
}

function smoothen(pts, k) {
    if (pts.length < 2 || k <= 1) return pts;
    const res = pts.slice();
    for (let pass = 0; pass < k; pass++) {
        const tmp = new Array(res.length);
        for (let i = 0; i < res.length; i++) { const p0 = res[(i-1+res.length)%res.length], p1 = res[i], p2 = res[(i+1)%res.length]; tmp[i] = { x: (p0.x+4*p1.x+p2.x)/6, y: (p0.y+4*p1.y+p2.y)/6 }; }
        for (let i = 0; i < res.length; i++) res[i] = tmp[i];
    }
    return res;
}
