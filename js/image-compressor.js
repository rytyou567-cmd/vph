/**
 * IMAGE COMPRESSOR ENGINE
 * 
 * ROLE:
 * Client-side image compression tool with zero server dependency.
 * Supports quality adjustment, format conversion (JPEG ↔ PNG), and resolution scaling.
 * 
 * ARCHITECTURE:
 * - Multi-threaded: Uses Web Workers for non-blocking compression
 * - Canvas-based: Leverages HTML5 Canvas for image resizing
 * - Library: JSQuash for modern, high-performance encoding
 * 
 * KEY WORKFLOWS:
 * 1. INGESTION: Drag/Drop or File Select → Load image as ImageBitmap
 * 2. COMPRESSION: Canvas resize → Transfer to Worker → Encode → Return compressed Blob
 * 3. PREVIEW: Dual-canvas preview (Original vs Compressed)
 * 4. EXPORT: Download compressed file or Save to Vault
 * 
 * DEPENDENCIES:
 * - shield-redactor-storage.js (Vault integration)
 * - image-compressor-worker.js (Multi-threaded encoding)
 */

import { shieldStorage } from './shield-redactor-storage.js';

/**
 * INITIALIZATION: Binds UI elements and sets up event listeners
 * 
 * @param {object} config - Configuration object with element IDs
 * @returns {void}
 * 
 * WORKFLOW:
 * 1. Cache DOM element references
 * 2. Initialize Web Worker for compression
 * 3. Setup drag-and-drop handlers
 * 4. Bind quality slider, format selector, and download/vault buttons
 */
export function init(config) {
    const dropZone = document.getElementById(config.dropZoneId);
    const fileInput = document.getElementById(config.fileInputId);
    const initialView = document.getElementById(config.initialViewId);
    const resultView = document.getElementById(config.resultViewId);
    const originalPreview = document.getElementById(config.originalPreviewId);
    const compressedPreview = document.getElementById(config.compressedPreviewId);
    const originalSize = document.getElementById(config.originalSizeId);
    const compressedSize = document.getElementById(config.compressedSizeId);
    const qualitySlider = document.getElementById(config.qualitySliderId);
    const qualityValue = document.getElementById(config.qualityValueId);
    const downloadBtn = document.getElementById(config.downloadBtnId);
    const loadingIndicator = document.getElementById(config.loadingIndicatorId);
    const outputFormatSelect = document.getElementById(config.outputFormatId);
    const maxWidthSelect = document.getElementById(config.maxWidthId);
    const saveVaultBtn = document.getElementById(config.saveVaultBtnId);

    let currentFile = null;
    let originalBitmap = null; // Store bitmap for resizing
    let compressedBlob = null;
    let worker = null;
    let currentId = null;

    /**
     * WORKER INITIALIZATION: Creates background thread for compression
     * 
     * WORKFLOW:
     * 1. Spawn Worker from module URL
     * 2. Setup message handler to receive compressed results
     * 3. Setup error handler for Worker crashes
     */
    function initWorker() {
        if (!config.workerUrl) return;
        try {
            worker = new Worker(config.workerUrl, { type: 'module' });

            worker.onmessage = (e) => {
                const { id, success, buffer, error } = e.data;
                if (success) {
                    handleCompressionResult(buffer);
                } else {
                    compressedSize.innerText = "Error";
                    alert("Compression failed: " + error);
                }
            };

            worker.onerror = (e) => { };
        } catch (e) { }
    }

    initWorker();

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.backgroundColor = 'rgba(255, 140, 0, 0.2)'; });
        dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.style.backgroundColor = ''; });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.backgroundColor = '';
            if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
        });
    }

    if (fileInput) fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

    // UI Change Listeners
    if (outputFormatSelect) outputFormatSelect.addEventListener('change', () => compressImage());
    if (maxWidthSelect) maxWidthSelect.addEventListener('change', () => compressImage());

    /**
     * FILE INGESTION: Loads image file and initiates compression pipeline
     * 
     * @param {File} file - The image file to compress
     * @param {object|null} projectData - Optional vault project data for resume
     * 
     * WORKFLOW:
     * 1. Validate file type (JPEG/PNG only)
     * 2. Create ImageBitmap for efficient resizing
     * 3. Display original preview
     * 4. Trigger initial compression at current quality
     * 5. Show results UI
     */
    async function handleFile(file, projectData = null) {
        if (!file.type.match(/image\/(jpeg|png)/)) {
            alert("Only JPEG and PNG images are supported.");
            return;
        }

        currentFile = file;
        currentId = projectData?.id || 'proj_' + Date.now();
        originalSize.innerText = formatSize(file.size);
        initialView.style.display = 'none';
        loadingIndicator.style.display = 'block';

        if (outputFormatSelect) outputFormatSelect.value = "original";
        if (maxWidthSelect) maxWidthSelect.value = "0";

        // Read file
        originalBitmap = await createImageBitmap(file);

        // Display original
        originalPreview.src = URL.createObjectURL(file);

        // Initial compression
        compressImage();

        loadingIndicator.style.display = 'none';
        resultView.style.display = 'block';
    }

    window.imageCompressorLoadFile = (file, projectData) => {
        openModal('imageCompressorModal');
        handleFile(file, projectData);
    };

    /**
     * COMPRESSION ENGINE: Coordinates the compression workflow
     * 
     * WORKFLOW:
     * 1. Read current UI settings (quality, format, max width)
     * 2. Calculate target dimensions (respecting max width constraint)
     * 3. Render image to Canvas at target size
     * 4. Extract ImageData (raw RGBA pixels)
     * 5. Transfer buffer to Worker for encoding
     * 6. Worker returns compressed blob → handleCompressionResult()
     */
    function compressImage() {
        if (!originalBitmap || !worker) return;

        const quality = parseInt(qualitySlider.value);
        qualityValue.innerText = quality + '%';

        // Determine Output Format
        let targetFormat = currentFile.type;
        if (outputFormatSelect && outputFormatSelect.value !== 'original') {
            targetFormat = outputFormatSelect.value;
        }

        if (targetFormat === 'image/png') {
            qualitySlider.style.opacity = '0.5';
        } else {
            qualitySlider.style.opacity = '1';
        }

        updateSliderBackground();

        // Determine Size
        let targetWidth = originalBitmap.width;
        let targetHeight = originalBitmap.height;
        const maxW = parseInt(maxWidthSelect ? maxWidthSelect.value : 0);

        if (maxW > 0 && targetWidth > maxW) {
            const ratio = maxW / targetWidth;
            targetWidth = maxW;
            targetHeight = Math.round(targetHeight * ratio);
        }

        compressedSize.innerText = "Compressing...";

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');

        if (targetFormat === 'image/jpeg') {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, targetWidth, targetHeight);
        }

        ctx.drawImage(originalBitmap, 0, 0, targetWidth, targetHeight);
        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const bufferCopy = new Uint8ClampedArray(imageData.data);

        worker.postMessage({
            type: 'compress',
            buffer: bufferCopy.buffer,
            width: targetWidth,
            height: targetHeight,
            quality: quality,
            fileType: targetFormat,
            id: Date.now()
        }, [bufferCopy.buffer]);
    }

    /**
     * RESULT HANDLER: Processes compressed buffer from Worker
     * 
     * @param {ArrayBuffer} buffer - Compressed image data
     * 
     * WORKFLOW:
     * 1. Wrap buffer in Blob with correct MIME type
     * 2. Generate preview URL for compressed image
     * 3. Calculate file size savings percentage
     * 4. Update UI with size comparison (green = savings, red = larger)
     */
    function handleCompressionResult(buffer) {
        let targetFormat = currentFile.type;
        if (outputFormatSelect && outputFormatSelect.value !== 'original') {
            targetFormat = outputFormatSelect.value;
        }

        compressedBlob = new Blob([buffer], { type: targetFormat });
        compressedPreview.src = URL.createObjectURL(compressedBlob);

        const sizeStr = formatSize(compressedBlob.size);
        const savings = Math.round((1 - compressedBlob.size / currentFile.size) * 100);

        if (compressedBlob.size > currentFile.size) {
            compressedSize.innerHTML = `<span style="color: #ff4500;">${sizeStr} (+${Math.abs(savings)}%)</span>`;
        } else {
            compressedSize.innerHTML = `${sizeStr} <span style="color: #00ff00;">(-${savings}%)</span>`;
        }
    }

    /**
     * UI UTILITY: Manages the custom background gradient for the quality slider
     * Creates a filled track effect matching the current slider value.
     */
    function updateSliderBackground() {
        if (!qualitySlider) return;
        const val = qualitySlider.value;
        const color = "#ff00cc";
        const background = `linear-gradient(to right, ${color} 0%, ${color} ${val}%, rgba(255, 255, 255, 0.2) ${val}%, rgba(255, 255, 255, 0.2) 100%)`;
        qualitySlider.style.background = background;
    }

    let timeout;
    qualitySlider.addEventListener('input', () => {
        qualityValue.innerText = qualitySlider.value + '%';
        updateSliderBackground();
        clearTimeout(timeout);
        timeout = setTimeout(compressImage, 100);
    });

    updateSliderBackground();

    downloadBtn.addEventListener('click', () => {
        if (!compressedBlob) return;
        let ext = "";
        let targetFormat = currentFile.type;
        if (outputFormatSelect && outputFormatSelect.value !== 'original') targetFormat = outputFormatSelect.value;

        if (targetFormat === 'image/jpeg') ext = ".jpg";
        else if (targetFormat === 'image/png') ext = ".png";

        const link = document.createElement('a');
        link.href = URL.createObjectURL(compressedBlob);
        link.download = "compressed_" + currentFile.name.split('.')[0] + ext;
        link.click();
    });

    if (saveVaultBtn) {
        saveVaultBtn.onclick = async () => {
            if (!currentFile) return;
            const originalText = saveVaultBtn.innerText;
            saveVaultBtn.disabled = true;
            saveVaultBtn.innerText = 'SAVING...';

            try {
                await shieldStorage.saveProject({
                    id: currentId,
                    name: currentFile.name,
                    file: currentFile,
                    tool: 'Image Compressor'
                });
                alert('Vault Secured. Project Saved.');
            } catch (err) {
                console.error(err);
                alert('Save failed: ' + err.message);
            } finally {
                saveVaultBtn.disabled = false;
                saveVaultBtn.innerText = originalText;
            }
        };
    }

    /**
     * RESET: Clears all state and returns to initial view
     * Allows user to compress a new image without page reload
     */
    function reset() {
        currentFile = null;
        originalBitmap = null;
        compressedBlob = null;
        currentId = null;
        initialView.style.display = 'block';
        resultView.style.display = 'none';
        fileInput.value = '';
        originalPreview.src = '';
        compressedPreview.src = '';
    }

    window.resetImageCompressor = reset;

    /**
     * UTILITY: Converts bytes to human-readable format (KB, MB, etc.)
     * @param {number} bytes - File size in bytes
     * @returns {string} Formatted string (e.g., "1.25 MB")
     */
    function formatSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}
