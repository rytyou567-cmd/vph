/**
 * LOOMIS: Image-to-Color-Palette Extractor
 * 
 * ROLE:
 * Extracts dominant colors from images and generates CSS code.
 * Features a precision "Loupe" magnifier for pixel-perfect color sampling.
 * 
 * ARCHITECTURE:
 * - Color Quantization: 8-level RGB bucketing (32x32x32 color space reduction)
 * - Dual Mode: Auto-extraction (top 5 most frequent) + Manual Sampling (click to pick)
 * - Canvas-based: Renders image for pixel inspection
 * 
 * KEY WORKFLOWS:
 * 1. INGESTION: Upload image → Render to canvas
 * 2. AUTO EXTRACTION: Scan all pixels → Bucket into color bins → Sort by frequency → Display top 5
 * 3. MANUAL SAMPLING: Hover for loupe → Click to sample exact pixel → Add to palette
 * 4. CODE GENERATION: Palette → CSS Variables + Gradient
 * 
 * LOUPE MECHANICS:
 * - 3x magnification of 50px source region
 * - Tracks mouse in real-time
 * - Click samples exact pixel color at cursor position
 */

/**
 * INITIALIZATION: Connects UI elements and prepares state
 * @param {object} config - Configuration object with element IDs
 */
export function init(config) {
    const elements = {};
    for (const [key, id] of Object.entries(config)) {
        elements[key] = document.getElementById(id);
    }

    let currentBitmap = null;
    let isLoaded = false;

    // --- INITIAL VIEW HANDLERS ---
    elements.dropZoneId.onclick = () => elements.fileInputId.click();
    elements.changeImageBtnId.onclick = () => elements.fileInputId.click();

    elements.fileInputId.onchange = (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    };

    /**
     * INGESTION: Validates and loads image data
     * @param {File} file - Source image
     */
    async function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Please upload an image file (JPG, PNG, SVG).');
            return;
        }

        currentBitmap = await createImageBitmap(file);
        renderPreview();
        extractColors();
        isLoaded = true;
    }

    /**
     * RENDERING: Draws image to preview canvas with letterboxing/scaling
     */
    function renderPreview() {
        const canvas = elements.previewCanvasId;
        const ctx = canvas.getContext('2d');

        // Scale to fit
        const maxW = 800;
        const maxH = 500;
        let w = currentBitmap.width;
        let h = currentBitmap.height;

        if (w > maxW) {
            h = (maxW / w) * h;
            w = maxW;
        }
        if (h > maxH) {
            w = (maxH / h) * w;
            h = maxH;
        }

        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(currentBitmap, 0, 0, w, h);

        elements.dropZoneId.style.display = 'none';
        elements.canvasContainerId.style.display = 'block';
        elements.changeImageBtnId.style.display = 'block';

        // Set up loupe and sampling
        setupLoupe();
    }

    /**
     * LOUPE ENGINE: Manages pixel magnification and coordinate tracking
     * Creates a 3x zoom effect by drawing a small region of the main canvas
     * onto a secondary circular canvas that follows the cursor.
     */
    function setupLoupe() {
        const canvas = elements.previewCanvasId;
        const loupe = elements.loupeId;
        const loupeCanvas = elements.loupeCanvasId;
        const loupeCtx = loupeCanvas.getContext('2d');
        const mainCtx = canvas.getContext('2d');

        // Set loupe canvas size
        loupeCanvas.width = 150;
        loupeCanvas.height = 150;

        // Mouse move for loupe tracking
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Position loupe
            loupe.style.left = (e.clientX + 20) + 'px';
            loupe.style.top = (e.clientY + 20) + 'px';
            loupe.style.display = 'block';

            // Draw magnified portion
            const scale = canvas.width / rect.width;
            const canvasX = x * scale;
            const canvasY = y * scale;
            const zoom = 3;
            const sourceSize = loupeCanvas.width / zoom;

            loupeCtx.fillStyle = '#000';
            loupeCtx.fillRect(0, 0, loupeCanvas.width, loupeCanvas.height);

            loupeCtx.drawImage(
                canvas,
                canvasX - sourceSize / 2,
                canvasY - sourceSize / 2,
                sourceSize,
                sourceSize,
                0,
                0,
                loupeCanvas.width,
                loupeCanvas.height
            );
        });

        canvas.addEventListener('mouseleave', () => {
            loupe.style.display = 'none';
        });

        // Click to sample color
        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const scale = canvas.width / rect.width;
            const canvasX = Math.floor(x * scale);
            const canvasY = Math.floor(y * scale);

            const pixel = mainCtx.getImageData(canvasX, canvasY, 1, 1).data;
            const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);

            // Add to palette as manual pick
            addManualColor(hex, canvasX, canvasY);
        });
    }

    let manualColors = [];
    let autoColors = [];

    /**
     * PALETTE MANAGEMENT: Adds a color to the manual selection list
     * @param {string} hex - Color code
     * @param {number} x - X coordinate of sample
     * @param {number} y - Y coordinate of sample
     */
    function addManualColor(hex, x, y) {
        // Avoid duplicates
        if (manualColors.some(c => c.hex === hex)) return;

        manualColors.unshift({ hex, x, y });
        if (manualColors.length > 5) manualColors.pop();

        renderPalette();
        generateCode();
    }

    /**
     * PALETTE MANAGEMENT: Removes a specific color from manual list
     * @param {string} hexToRemove 
     */
    function removeManualColor(hexToRemove) {
        manualColors = manualColors.filter(c => c.hex !== hexToRemove);
        renderPalette();
        generateCode();
    }

    /**
     * AUTO-EXTRACTOR: Scans image for dominant color clusters
     * 
     * ALGORITHM (Quantization):
     * 1. Pixel Sampling: Iterates image data at multi-pixel intervals
     * 2. Bucketing: Groups colors into 32x32x32 RGB bins (Color Space Reduction)
     * 3. Averaging: Calculates mean color for each active bin
     * 4. Sorting: Ranks colors by frequency and returns Top 5
     */
    async function extractColors() {
        const canvas = elements.previewCanvasId;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        // --- IMPROVED BUCKETING (Quantization) ---
        // Instead of exact hex, we group colors into bins (32x32x32)
        const bins = {};
        const step = 4; // Sample more pixels for accuracy

        for (let i = 0; i < imageData.length; i += 4 * step) {
            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];
            const a = imageData[i + 3];

            if (a < 128) continue; // Skip transparency

            // Reduce color space to 8 levels per channel (3-bit per channel)
            const rBin = Math.floor(r / 32) * 32;
            const gBin = Math.floor(g / 32) * 32;
            const bBin = Math.floor(b / 32) * 32;
            const binKey = `${rBin},${gBin},${bBin}`;

            if (!bins[binKey]) {
                bins[binKey] = { r: 0, g: 0, b: 0, count: 0 };
            }
            bins[binKey].r += r;
            bins[binKey].g += g;
            bins[binKey].b += b;
            bins[binKey].count++;
        }

        // Calculate average color for each bin
        const distinctColors = Object.values(bins).map(bin => {
            const r = Math.round(bin.r / bin.count);
            const g = Math.round(bin.g / bin.count);
            const b = Math.round(bin.b / bin.count);
            return {
                hex: rgbToHex(r, g, b),
                count: bin.count
            };
        });

        // Sort by frequency and get top 5
        const sorted = distinctColors
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(x => x.hex);

        autoColors = sorted;
        renderPalette();
        generateCode();
    }

    /**
     * UI RENDERING: Syncs color palette with DOM container
     */
    function renderPalette() {
        const colorsToShow = manualColors.length > 0
            ? manualColors.map(c => c.hex)
            : autoColors;

        if (colorsToShow.length === 0) return;

        const header = manualColors.length > 0
            ? '<div style="color: #ff00cc; font-size: 12px; margin-bottom: 10px; font-weight: bold;">MANUAL PICKS (Click ✕ to remove)</div>'
            : '<div style="color: #888; font-size: 12px; margin-bottom: 10px;">AUTO PULSE</div>';

        elements.paletteContainerId.innerHTML = header + colorsToShow.map(hex => `
            <div class="color-swatch pulsate-on-hover" style="background: ${hex}; position: relative;" onclick="copyColor('${hex}')">
                <span>${hex}</span>
                ${manualColors.length > 0 ? `<button onclick="event.stopPropagation(); removeManualColor('${hex}')" style="position: absolute; top: 3px; right: 3px; background: rgba(0,0,0,0.7); color: #fff; border: none; border-radius: 50%; width: 18px; height: 18px; cursor: pointer; font-size: 12px; line-height: 1;">✕</button>` : ''}
            </div>
        `).join('');
    }

    window.copyColor = (hex) => {
        navigator.clipboard.writeText(hex);
        // Visual feedback
        const btn = event.currentTarget;
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span>COPIED!</span>';
        setTimeout(() => btn.innerHTML = originalText, 1000);
    };

    window.removeManualColor = (hex) => {
        manualColors = manualColors.filter(c => c.hex !== hex);
        renderPalette();
        generateCode();
    };

    /**
     * CODE GENERATOR: Translates palette to CSS Root Variables and Gradients
     */
    function generateCode() {
        const colorsToShow = manualColors.length > 0
            ? manualColors.map(c => c.hex)
            : autoColors;

        if (colorsToShow.length === 0) return;

        const cssVars = colorsToShow.map((c, i) => `  --color-${i + 1}: ${c};`).join('\n');
        const gradient = `background: linear-gradient(135deg, ${colorsToShow[0]}, ${colorsToShow[colorsToShow.length - 1]});`;

        elements.codePreviewId.innerText = `:root {\n${cssVars}\n}\n\n.my-gradient {\n  ${gradient}\n}`;
    }

    /**
     * UTILITY: Standard RGB to HEX string conversion
     */
    function rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    /**
     * RESET: Wipes session state for reuse
     */
    window.loomisReset = () => {
        elements.dropZoneId.style.display = 'block';
        elements.canvasContainerId.style.display = 'none';
        elements.changeImageBtnId.style.display = 'none';
        elements.loupeId.style.display = 'none';
        elements.paletteContainerId.innerHTML = '';
        elements.codePreviewId.innerText = '// Upload an image to generate code...';
        currentBitmap = null;
        isLoaded = false;
        manualColors = [];
        autoColors = [];
    };
}
