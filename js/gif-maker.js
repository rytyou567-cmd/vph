/**
 * GIF MAKER - CORE CONTROLLER
 * 
 * ROLE:
 * Handles frame ingestion, sequencing, live preview, and high-performance
 * client-side GIF encoding using gif.js.
 */

export const GIF_MAKER = (() => {
    let frames = []; // Array of { src, delay, canvas }
    let currentPreviewIndex = 0;
    let previewInterval = null;
    let isGenerating = false;

    const elements = {
        dropZone: null,
        fileInput: null,
        frameGrid: null,
        previewCanvas: null,
        previewContainer: null,
        frameCount: null,
        delayInput: null,
        delaySlider: null,
        widthInput: null,
        heightInput: null,
        fitMethod: null,
        generateBtn: null,
        title: null,
        tags: null,
        nsfw: null,
        private: null,
        watermark: null,
        watermarkText: null,
        watermarkPosition: null,
        toggleMoreOptions: null,
        moreOptionsPanel: null,
        reverse: null,
        forverse: null,
        disableDithering: null,
        globalPalette: null,
        playCount: null,
        bgColor: null,
        optimization: null,
        compression: null
    };

    function init(config) {
        // Map elements
        Object.keys(config).forEach(key => {
            elements[key] = document.getElementById(config[key]);
        });

        setupEventListeners();
        startPreview();
    }

    function setupEventListeners() {
        if (elements.dropZone) {
            elements.dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                elements.dropZone.classList.add('drag-over');
            });

            elements.dropZone.addEventListener('dragleave', () => {
                elements.dropZone.classList.remove('drag-over');
            });

            elements.dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                elements.dropZone.classList.remove('drag-over');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    handleFiles(files);
                }
            });
        }

        if (elements.fileInput) {
            elements.fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    handleFiles(e.target.files);
                }
            });
        }

        if (elements.delayInput && elements.delaySlider) {
            elements.delayInput.addEventListener('input', (e) => {
                elements.delaySlider.value = e.target.value;
                updatePreviewTiming();
            });

            elements.delaySlider.addEventListener('input', (e) => {
                elements.delayInput.value = e.target.value;
                updatePreviewTiming();
            });
        }

        if (elements.generateBtn) {
            elements.generateBtn.addEventListener('click', generateGif);
        }

        if (elements.toggleMoreOptions) {
            elements.toggleMoreOptions.addEventListener('click', () => {
                const isHidden = elements.moreOptionsPanel.style.display === 'none';
                elements.moreOptionsPanel.style.display = isHidden ? 'block' : 'none';
                elements.toggleMoreOptions.innerText = isHidden ? 'Hide Options ▴' : 'More Options ▾';
            });
        }

        // Toggle watermark options visibility
        if (elements.watermark) {
            const watermarkOptions = document.getElementById('watermarkOptions');
            const toggleWatermarkOptions = () => {
                if (watermarkOptions) {
                    watermarkOptions.style.display = elements.watermark.checked ? 'flex' : 'none';
                }
            };
            toggleWatermarkOptions();
            elements.watermark.addEventListener('change', toggleWatermarkOptions);
        }
    }

    async function handleFiles(files) {
        const newFrames = await Promise.all(Array.from(files).filter(f => f.type.startsWith('image/')).map(fileToFrame));
        frames = [...frames, ...newFrames];

        updateUI();
        if (frames.length > 0) {
            if (elements.previewCanvas) {
                elements.previewCanvas.style.display = 'block';
                // Initialize preview index to 0 for a clean start
                currentPreviewIndex = 0;
            }
            if (elements.dropZone) elements.dropZone.style.display = 'none';
        }
    }

    function fileToFrame(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    resolve({
                        src: e.target.result,
                        img: img,
                        delay: parseInt(elements.delayInput.value) || 500
                    });
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function updateUI() {
        if (elements.frameCount) elements.frameCount.innerText = `${frames.length} Frames`;

        // Render Frame Grid
        if (elements.frameGrid) {
            elements.frameGrid.innerHTML = '';
            frames.forEach((frame, index) => {
                const item = document.createElement('div');
                item.className = 'frame-item';
                item.innerHTML = `
                    <img src="${frame.src}">
                    <button class="remove-frame" onclick="window.GIF_MAKER.removeFrame(${index})">×</button>
                `;
                elements.frameGrid.appendChild(item);
            });
        }
    }

    function removeFrame(index) {
        frames.splice(index, 1);
        updateUI();
        if (frames.length === 0) {
            elements.previewCanvas.style.display = 'none';
            document.querySelector('.gif-dropzone').style.display = 'block';
        }
    }

    function startPreview() {
        if (previewInterval) clearTimeout(previewInterval);

        const loop = () => {
            if (frames.length > 0 && !isGenerating) {
                const frame = frames[currentPreviewIndex];
                if (frame && frame.img) {
                    renderFrameToCanvas(frame);
                    currentPreviewIndex = (currentPreviewIndex + 1) % frames.length;
                }
            }

            const delay = (elements.delayInput ? parseInt(elements.delayInput.value) : 500) || 500;
            previewInterval = setTimeout(loop, delay);
        };

        loop();
    }

    function updatePreviewTiming() {
        // Preview timing is handled in the loop's setTimeout
    }

    function renderFrameToCanvas(frame) {
        if (!elements.previewCanvas) return;
        const canvas = elements.previewCanvas;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const w = (elements.widthInput ? parseInt(elements.widthInput.value) : 500) || 500;
        const h = (elements.heightInput ? parseInt(elements.heightInput.value) : 500) || 500;
        const fit = elements.fitMethod ? elements.fitMethod.value : 'stretch';

        canvas.width = w;
        canvas.height = h;

        ctx.clearRect(0, 0, w, h);

        if (fit === 'stretch') {
            ctx.drawImage(frame.img, 0, 0, w, h);
        } else if (fit === 'contain') {
            const ratio = Math.min(w / frame.img.width, h / frame.img.height);
            const nw = frame.img.width * ratio;
            const nh = frame.img.height * ratio;
            ctx.drawImage(frame.img, (w - nw) / 2, (h - nh) / 2, nw, nh);
        } else if (fit === 'cover') {
            const ratio = Math.max(w / frame.img.width, h / frame.img.height);
            const nw = frame.img.width * ratio;
            const nh = frame.img.height * ratio;
            ctx.drawImage(frame.img, (w - nw) / 2, (h - nh) / 2, nw, nh);
        }

        // Watermark
        if (elements.watermark && elements.watermark.checked) {
            const text = elements.watermarkText ? elements.watermarkText.value : 'ViewPorts GIF Studio';
            const position = elements.watermarkPosition ? elements.watermarkPosition.value : 'bottom-left';

            ctx.font = '14px Rajdhani';
            ctx.fillStyle = 'rgba(255, 170, 0, 0.6)';

            const metrics = ctx.measureText(text);
            const textWidth = metrics.width;
            const padding = 10;

            let x, y;
            switch (position) {
                case 'bottom-left':
                    x = padding;
                    y = h - padding;
                    break;
                case 'bottom-right':
                    x = w - textWidth - padding;
                    y = h - padding;
                    break;
                case 'top-left':
                    x = padding;
                    y = padding + 14;
                    break;
                case 'top-right':
                    x = w - textWidth - padding;
                    y = padding + 14;
                    break;
                case 'center':
                    x = (w - textWidth) / 2;
                    y = h / 2;
                    break;
                default:
                    x = padding;
                    y = h - padding;
            }

            ctx.fillText(text, x, y);
        }
    }

    async function generateGif() {
        if (frames.length === 0 || isGenerating) return;

        isGenerating = true;
        if (elements.generateBtn) {
            elements.generateBtn.innerText = 'Initializing Worker...';
            elements.generateBtn.disabled = true;
        }

        try {
            // Check if GIF.js is loaded
            if (typeof GIF === 'undefined') {
                await loadGifLibrary();
            }

            const gif = new GIF({
                workers: 2,
                quality: elements.disableDithering && elements.disableDithering.checked ? 1 : 10,
                width: parseInt(elements.widthInput.value) || 500,
                height: parseInt(elements.heightInput.value) || 500,
                workerScript: '/js/gif.worker.js',
                transparent: elements.bgColor && elements.bgColor.value ? null : 'rgba(0,0,0,0)',
                background: elements.bgColor && elements.bgColor.value ? '#' + elements.bgColor.value : null,
                repeat: (elements.playCount ? parseInt(elements.playCount.value) : 0) || 0,
                dither: elements.disableDithering && elements.disableDithering.checked ? false : true,
                globalPalette: elements.globalPalette && elements.globalPalette.checked ? true : false
            });

            // Handle Reversing Logic
            let framesToProcess = [...frames];
            if (elements.reverse && elements.reverse.checked) {
                framesToProcess.reverse();
            }
            if (elements.forverse && elements.forverse.checked) {
                const reversed = [...framesToProcess].reverse();
                framesToProcess = [...framesToProcess, ...reversed];
            }

            // Add frames
            framesToProcess.forEach(frame => {
                const canvas = document.createElement('canvas');
                canvas.width = gif.options.width;
                canvas.height = gif.options.height;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                // Re-render frame logic for capturing
                const fit = elements.fitMethod.value;
                if (fit === 'stretch') ctx.drawImage(frame.img, 0, 0, canvas.width, canvas.height);
                else {
                    const ratio = fit === 'contain' ?
                        Math.min(canvas.width / frame.img.width, canvas.height / frame.img.height) :
                        Math.max(canvas.width / frame.img.width, canvas.height / frame.img.height);
                    const nw = frame.img.width * ratio;
                    const nh = frame.img.height * ratio;
                    ctx.drawImage(frame.img, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
                }

                if (elements.watermark.checked) {
                    const text = elements.watermarkText ? elements.watermarkText.value : 'ViewPorts GIF Studio';
                    const position = elements.watermarkPosition ? elements.watermarkPosition.value : 'bottom-left';

                    ctx.font = '14px Rajdhani';
                    ctx.fillStyle = 'rgba(255, 170, 0, 0.6)';

                    const metrics = ctx.measureText(text);
                    const textWidth = metrics.width;
                    const padding = 10;

                    let x, y;
                    switch (position) {
                        case 'bottom-left':
                            x = padding;
                            y = canvas.height - padding;
                            break;
                        case 'bottom-right':
                            x = canvas.width - textWidth - padding;
                            y = canvas.height - padding;
                            break;
                        case 'top-left':
                            x = padding;
                            y = padding + 14;
                            break;
                        case 'top-right':
                            x = canvas.width - textWidth - padding;
                            y = padding + 14;
                            break;
                        case 'center':
                            x = (canvas.width - textWidth) / 2;
                            y = canvas.height / 2;
                            break;
                        default:
                            x = padding;
                            y = canvas.height - padding;
                    }

                    ctx.fillText(text, x, y);
                }

                gif.addFrame(canvas, { delay: parseInt(elements.delayInput.value) || 500, copy: true });
            });

            gif.on('progress', (p) => {
                elements.generateBtn.innerText = `Encoding: ${Math.round(p * 100)}%`;
            });

            gif.on('finished', (blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = (elements.title.value || 'animation') + '.gif';
                a.click();

                isGenerating = false;
                elements.generateBtn.innerText = 'Generate GIF';
                elements.generateBtn.disabled = false;
            });

            gif.render();
        } catch (err) {
            console.error('GIF Generation Error:', err);
            alert('Failed to generate GIF. See console for details.');
            isGenerating = false;
            elements.generateBtn.innerText = 'Generate GIF';
            elements.generateBtn.disabled = false;
        }
    }

    function loadGifLibrary() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = window.location.origin + '/js/gif.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function reset() {
        frames = [];
        currentPreviewIndex = 0;
        updateUI();
        if (elements.previewCanvas) elements.previewCanvas.style.display = 'none';
        const dz = document.querySelector('.gif-dropzone');
        if (dz) dz.style.display = 'block';
        if (elements.title) elements.title.value = '';
        if (elements.tags) elements.tags.value = '';
    }

    return { init, removeFrame, reset };
})();

window.GIF_MAKER = GIF_MAKER;

