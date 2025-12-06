export function getColorForValue(value: number, min: number, max: number): string {
    if (min === max) return 'hsl(120, 100%, 30%)'; // Default green if flat

    // Normalize 0..1
    let ratio = (value - min) / (max - min);
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;

    // Green (120) -> Yellow (60) -> Red (0)
    const hue = (1 - ratio) * 120;
    return `hsl(${hue}, 100%, 40%)`;
}

export function getTextColorForBackground(value: number, min: number, max: number): string {
    return '#ffffff'; 
}

// Returns {r, g, b} in 0..1 range for Three.js
export function getRGBForValue(value: number, min: number, max: number): { r: number, g: number, b: number } {
    if (min === max) return { r: 0, g: 1, b: 0 };

    let t = (value - min) / (max - min);
    if (t < 0) t = 0;
    if (t > 1) t = 1;

    // Heatmap Gradient: Blue -> Cyan -> Green -> Yellow -> Red
    // 0.0: 0, 0, 1 (Blue)
    // 0.25: 0, 1, 1 (Cyan)
    // 0.5: 0, 1, 0 (Green)
    // 0.75: 1, 1, 0 (Yellow)
    // 1.0: 1, 0, 0 (Red)

    let r = 0, g = 0, b = 0;

    if (t < 0.25) {
        // Blue to Cyan
        r = 0;
        g = t * 4;
        b = 1;
    } else if (t < 0.5) {
        // Cyan to Green
        r = 0;
        g = 1;
        b = 1 - (t - 0.25) * 4;
    } else if (t < 0.75) {
        // Green to Yellow
        r = (t - 0.5) * 4;
        g = 1;
        b = 0;
    } else {
        // Yellow to Red
        r = 1;
        g = 1 - (t - 0.75) * 4;
        b = 0;
    }

    return { r, g, b };
}