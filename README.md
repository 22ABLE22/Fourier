# Fourier Series Closed Curve Fitting

A visualization tool for closed curve fitting based on Fourier series.

## Features

- Draw closed curves freely with the left mouse button or touch
- Middle mouse button drag to pan and mouse wheel to zoom
- Fourier series epicycle animation visualization
- Adjustable harmonic count up to 32,768 with real-time fitting preview
- Arc-length resampling keeps fitting stable regardless of drawing speed
- Built-in presets (heart, star, butterfly, etc.)
- Zoom and speed control
- Responsive design with touch support

## Usage

Open the live demo: [Fourier Series Closed Curve Fitting](https://22able22.github.io/Fourier/)

- Left mouse button or touch: draw a closed curve
- Middle mouse button drag: pan the Fourier view
- Mouse wheel: zoom around the pointer
- Preset button: load a sample curve and fit it automatically

## Technical Details

- Pure HTML5 + CSS3 + JavaScript, no dependencies
- FFT-based spectrum calculation with dynamically sized and bounded samples
- High-DPI canvas rendering and adaptive animation detail for large harmonic counts
- Canvas 2D rendering for animation
- Left-button drawing, middle-button panning, wheel zoom, and touch input

## License

MIT License
