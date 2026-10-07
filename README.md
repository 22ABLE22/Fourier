# Fourier Series Closed Curve Fitting

A zero-dependency static web app for fitting closed curves with Fourier series and visualizing the result as animated epicycles.

## Features

- Draw closed curves with mouse, pen, or touch using Pointer Events
- Two-finger pinch to zoom and two-finger drag to pan on touch devices
- Middle-mouse drag to pan and mouse wheel to zoom
- Fourier epicycle animation with frame-rate-independent speed control
- Harmonic, smoothness, and speed controls with synchronized sliders and numeric inputs
- Interactive spectrum panel: inspect amplitudes and mute individual harmonics
- Image tracing page: upload or drop an image, extract its largest closed contour, and open it in the main fitter
- Automatic contour normalization for reliable cross-page handoff
- System-aware dark mode with persistent Auto, Light, and Dark modes
- Built-in presets (heart, star, butterfly, treble clef, arrow, and infinity)
- Arc-length resampling and cached fitting for stable interactive performance
- Responsive high-DPI canvas rendering

## Usage

Open the live demo: [Fourier Series Closed Curve Fitting](https://22able22.github.io/Fourier/)

The site can also be opened directly from `file://`; it has no build step or runtime dependencies.

- Left mouse button or one-finger touch: draw a closed curve
- Middle mouse button or two-finger drag: pan the view
- Mouse wheel or pinch gesture: zoom around the pointer
- Use the spectrum bars to mute or restore individual harmonics
- Open **Trace an Image** to extract an image contour, then choose **Use in Main App**
- On GitHub Pages, use `/Fourier/draw/` for drawing and `/Fourier/trace/` for image tracing
- Use the theme button to cycle Auto, Light, and Dark modes

## Project Structure

```
index.html        # Main drawing and fitting page
image.html        # Root image upload, contour extraction, and handoff page
draw/index.html   # GitHub Pages drawing entry at /Fourier/draw/
trace/index.html  # GitHub Pages tracing entry at /Fourier/trace/
js/state.js       # Shared constants and application state
js/math.js        # FFT, inverse FFT, DFT, resampling, and smoothing
js/fit.js         # Fitting pipeline and inverse-FFT curve table
js/render.js      # Canvas drawing, epicycles, animation, and transforms
js/input.js       # Pointer, mouse, touch, pan, and pinch input
js/spectrum.js    # Interactive spectrum panel and mute controls
js/ui.js          # Main-page controls, presets, theme, and toasts
js/image.js       # Image tracing API and image-page UI
js/app.js         # Main-page bootstrap, resize handling, and image handoff

tests/fit.test.mjs          # Fast numerical and image-tracing regression tests
.github/workflows/ci.yml    # Node syntax and regression-test workflow
```

The main page uses classic non-module script tags loaded in dependency order, so it remains compatible with direct `file://` use. The image page is self-contained apart from its single `js/image.js` script.

## Technical Details

- Pure HTML5, CSS3, and JavaScript with no external dependencies
- FFT-based spectrum calculation with bounded adaptive sample counts
- Curve tables built once per fit with an inverse FFT instead of per-frame harmonic summation
- Arc-length resampling cached by point-set identity, endpoints, and sample count
- Muted harmonics are excluded consistently from the curve table, epicycle chain, error estimate, and paused trail
- Input strokes are cached in an offscreen canvas during animation
- Image tracing uses thresholded grayscale data and marching squares, followed by smoothing, area sorting, and normalization
- The image handoff uses `localStorage['fourier.pendingImport']` with relative navigation for GitHub Pages subpaths
- High-DPI rendering is capped at DPR 2 for predictable performance

## Tests

Run the fast regression suite from the repository root:

```text
node tests/fit.test.mjs
```

Check all browser JavaScript files for syntax errors:

```text
node --check js/app.js
```

GitHub Actions runs both checks on pushes and pull requests.

## License

MIT License
