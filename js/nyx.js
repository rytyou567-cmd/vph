/**
 * NYX: SVG Glitch & Motion Lab
 * ViewPorts Creative Suite
 * 
 * ROLE:
 * Real-time SVG animation engine with parametric glitch and pulse effects.
 * Generates production-ready CSS keyframe animations.
 * 
 * ARCHITECTURE:
 * - Effect System: CSS Variables + Class-based activation
 * - Live Preview: Real-time SVG manipulation
 * - Code Generator: Exports standalone CSS snippets
 * 
 * KEY WORKFLOWS:
 * 1. INGESTION: Upload SVG → Inject to preview container
 * 2. EFFECT APPLICATION: Slider adjustments → Update CSS variables → Apply animation classes
 * 3. LIVE CODE: Generate CSS keyframes in real-time for preview
 * 4. EXPORT: Copy production-ready CSS to clipboard
 * 
 * EFFECTS:
 * - GLITCH: Pseudo-random transform offsets (0-50px range)
 * - PULSE: Scale + brightness animation (1.0x-2.0x range)
 * - Combined: Both effects run in parallel via multi-animation
 */

const NYX = (() => {
    let elements = {};
    let currentSVG = null;

    /**
     * INITIALIZATION: Binds UI elements and prepares animation state
     */
    function init(config) {
        elements = {
            dropZone: document.getElementById(config.dropZoneId),
            fileInput: document.getElementById(config.fileInputId),
            preview: document.getElementById(config.previewId),
            glitchRange: document.getElementById(config.glitchRangeId),
            pulseRange: document.getElementById(config.pulseRangeId),
            exportBtn: document.getElementById(config.exportBtnId),
            codePreview: document.getElementById(config.codePreviewId)
        };

        setupEventListeners();
    }

    /**
     * EVENT HANDLERS: Setup listeners for file ingestion and real-time effects
     */
    function setupEventListeners() {
        elements.dropZone.onclick = () => elements.fileInput.click();
        elements.fileInput.onchange = (e) => handleFile(e.target.files[0]);

        elements.dropZone.ondragover = (e) => {
            e.preventDefault();
            elements.dropZone.classList.add('active');
        };

        elements.dropZone.ondragleave = () => elements.dropZone.classList.remove('active');

        elements.dropZone.ondrop = (e) => {
            e.preventDefault();
            elements.dropZone.classList.remove('active');
            handleFile(e.dataTransfer.files[0]);
        };

        elements.glitchRange.oninput = updateEffects;
        elements.pulseRange.oninput = updateEffects;

        if (elements.exportBtn) {
            elements.exportBtn.onclick = exportSnippet;
        }
    }

    /**
     * INGESTION: Validates SVG and injects into live DOM preview
     * @param {File} file - Source SVG file
     */
    async function handleFile(file) {
        if (!file || !file.name.endsWith('.svg')) {
            alert('Please provide a valid SVG resource.');
            return;
        }

        const text = await file.text();
        elements.preview.innerHTML = text;
        elements.preview.style.display = 'block';
        elements.dropZone.style.display = 'none';

        currentSVG = elements.preview.querySelector('svg');
        if (currentSVG) {
            currentSVG.setAttribute('width', '100%');
            currentSVG.setAttribute('height', 'auto');
            currentSVG.style.maxHeight = '400px';
        }

        updateEffects();
    }

    /**
     * EFFECT ENGINE: Calculates and applies CSS transforms based on UI state
     */
    function updateEffects() {
        if (!currentSVG) return;

        const glitchValue = elements.glitchRange.value;
        const pulseValue = elements.pulseRange.value;

        // Apply effects via CSS variables on the SVG container
        elements.preview.style.setProperty('--nyx-glitch', `${glitchValue / 10}px`);
        elements.preview.style.setProperty('--nyx-pulse', `${1 + (pulseValue / 100)}`);

        // Add classes for animations if not zero
        if (glitchValue > 0) currentSVG.classList.add('nyx-glitch-active');
        else currentSVG.classList.remove('nyx-glitch-active');

        if (pulseValue > 0) currentSVG.classList.add('nyx-pulse-active');
        else currentSVG.classList.remove('nyx-pulse-active');

        renderLiveSnippet();
    }

    /**
     * CODE PREVIEW: Generates real-time CSS keyframes for dashboard display
     */
    function renderLiveSnippet() {
        if (!currentSVG || !elements.codePreview) return;

        const glitch = elements.glitchRange.value / 10;
        const pulse = 1 + (elements.pulseRange.value / 100);
        const duration = (2 - (elements.pulseRange.value / 100)).toFixed(1);

        const snippet = `
@keyframes nyx-glitch {
  20% { transform: translate(-${glitch}px, ${glitch}px); }
  40% { transform: translate(-${glitch}px, -${glitch}px); }
  60% { transform: translate(${glitch}px, ${glitch}px); }
}

.nyx-active {
  animation: nyx-glitch 0.2s infinite,
             nyx-pulse ${duration}s infinite;
}
        `.trim();

        elements.codePreview.textContent = snippet;
    }

    /**
     * EXPORT: Generates final production-ready CSS and copies to clipboard
     */
    function exportSnippet() {
        if (!currentSVG) return;

        const glitch = elements.glitchRange.value / 10;
        const pulse = 1 + (elements.pulseRange.value / 100);

        const css = `
/* NYX Lab Export */
@keyframes nyx-glitch {
    0% { transform: translate(0); }
    20% { transform: translate(-${glitch}px, ${glitch}px); }
    40% { transform: translate(-${glitch}px, -${glitch}px); }
    60% { transform: translate(${glitch}px, ${glitch}px); }
    80% { transform: translate(${glitch}px, -${glitch}px); }
    100% { transform: translate(0); }
}

.nyx-animated-svg {
    animation: nyx-glitch 0.2s infinite linear alternate-reverse,
               nyx-pulse ${2 - (elements.pulseRange.value / 100)}s infinite ease-in-out;
}

@keyframes nyx-pulse {
    0%, 100% { transform: scale(1); filter: brightness(1); }
    50% { transform: scale(${pulse}); filter: brightness(1.2) drop-shadow(0 0 10px #b400ff); }
}
        `.trim();

        navigator.clipboard.writeText(css);
        alert('CSS Motion Snippet copied to command interface.');
    }

    /**
     * RESET: Clears preview and restores default state
     */
    function reset() {
        elements.preview.innerHTML = '';
        elements.preview.style.display = 'none';
        elements.dropZone.style.display = 'block';
        elements.glitchRange.value = 0;
        elements.pulseRange.value = 0;
        if (elements.codePreview) {
            elements.codePreview.textContent = '// Waiting for SVG injection...';
        }
        currentSVG = null;
    }

    return { init, reset };
})();

window.NYX = NYX;
