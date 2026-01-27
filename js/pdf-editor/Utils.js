/**
 * Utils.js
 * 
 * ROLE:
 * Shared Utility Library for the PDF Editor.
 * Provides stateless helper functions for Geometry, Color Conversion, and Performance throttling.
 * 
 * KEY FUNCTIONS:
 * - `getRelativeCoords`: Essential for mapping mouse clicks to Canvas coordinates.
 * - `hexToPdfRgb`: Converts CSS Hex colors to the 0-1 RGB format required by `pdf-lib`.
 */
export const Utils = {
    // Helper to get coordinates relative to an element (Canvas)
    // Subtracts the element's offset from the global mouse position
    getRelativeCoords(event, element) {
        const rect = element.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    },

    // Convert hex to PDF RGB (0-1 range)
    hexToPdfRgb(hex) {
        if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) {
            return { r: 0, g: 0, b: 0 }; // Default Black
        }
        // Handle shorthand #RGB
        if (hex.length === 4) {
            hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }

        const r = parseInt(hex.substring(1, 3), 16) / 255;
        const g = parseInt(hex.substring(3, 5), 16) / 255;
        const b = parseInt(hex.substring(5, 7), 16) / 255;

        // Ensure numbers
        return {
            r: isNaN(r) ? 0 : r,
            g: isNaN(g) ? 0 : g,
            b: isNaN(b) ? 0 : b
        };
    },

    // Convert RGB string to Hex
    rgbToHex(rgb) {
        if (!rgb || rgb === 'transparent') return 'transparent';
        if (rgb.startsWith('#')) return rgb;

        // Handle rgba(r, g, b, a)
        // If a is 0, it's transparent.
        if (rgb.startsWith('rgba')) {
            const parts = rgb.match(/[\d.]+/g);
            if (parts && parts.length >= 4) {
                const alpha = parseFloat(parts[3]);
                if (alpha === 0) return 'transparent';
            }
        }

        const sep = rgb.indexOf(",") > -1 ? "," : " ";
        const rgbArr = rgb.substr(4).split(")")[0].split(sep); // This might fail for rgba with spaces?
        // Better regex parsing for both rgb and rgba
        const parts = rgb.match(/[\d.]+/g);
        if (!parts || parts.length < 3) return '#000000'; // Default fallback

        let r = (+parts[0]).toString(16),
            g = (+parts[1]).toString(16),
            b = (+parts[2]).toString(16);

        if (r.length == 1) r = "0" + r;
        if (g.length == 1) g = "0" + g;
        if (b.length == 1) b = "0" + b;

        return "#" + r + g + b;
    },

    // Throttle helper
    throttle(func, limit) {
        let inThrottle;
        return function () {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }
};
