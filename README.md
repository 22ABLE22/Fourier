# Fourier Series Closed Curve Fitting

A visualization tool for closed curve fitting based on Fourier series.

## Features

- Draw closed curves freely with the mouse or touch (unified Pointer Events)
- Two-finger pinch to zoom, two-finger drag to pan on touch devices
- Middle mouse button drag to pan and mouse wheel to zoom
- Fourier series epicycle animation visualization
- Adjustable harmonic count up to 32,768 with real-time fitting preview
- **Interactive spectrum panel**: visualize harmonic amplitudes and click a bar to mute/unmute that harmonic
- Arc-length resampling keeps fitting stable regardless of drawing speed
- Built-in presets (heart, star, butterfly, etc.)
- Zoom and speed control
- Responsive design with high-DPI canvas support

## Usage

Open the live demo: [Fourier Series Closed Curve Fitting](https://22able22.github.io/Fourier/)

- Left mouse button or one-finger touch: draw a closed curve
- Middle mouse button drag / two-finger drag: pan the view
- Mouse wheel / pinch gesture: zoom around the pointer
- Spectrum panel: click a bar to mute that harmonic and see its contribution disappear
- Preset button: load a sample curve and fit it automatically

## Project Structure

The app is a zero-dependency static site (open `index.html` directly, no build step):

```
index.html        # HTML shell + CSS + script tags
js/state.js       # Shared constants (CFG) and application state (S)
js/math.js        # FFT / DFT / arc-length resample / smoothing
js/fit.js         # Fitting pipeline + curve table (rebuildCurve/curveAt/getTrail)
js/render.js      # Canvas drawing, epicycles, animation loop, coordinate transforms
js/input.js       # Pointer/mouse/touch input, pan & pinch zoom
js/spectrum.js    # Interactive spectrum panel (amplitudes + mute toggling)
js/ui.js          # Controls, presets, toasts, info bar
js/app.js         # Bootstrap, resize handling
```

Scripts are classic (non-module) `<script>` tags loaded in order, so the page also
works when opened from `file://`. All modules share the global state object `S`.

## Technical Details

- Pure HTML5 + CSS3 + JavaScript, no dependencies
- FFT-based spectrum calculation with dynamically sized and bounded samples
- Curve table built once per fit via an **inverse FFT** (O(T log T)) instead of
  per-frame harmonic summation; animation just samples the table
- Arc-length resampling is cached, so changing smoothness only re-runs smoothing
- Amplitude-sorted coefficients drive epicycles (max 160 visible), with a residual
  connector drawn when more harmonics contribute than can be shown
- High-DPI canvas rendering and adaptive animation detail for large harmonic counts
- Unified Pointer Events: left button / single finger draws, middle button / two
  fingers pan, wheel / pinch zooms, all through a single world↔screen transform

## License

MIT License
