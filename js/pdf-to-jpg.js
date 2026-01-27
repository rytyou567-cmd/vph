/**
 * PDF TO JPG CONVERTER
 * 
 * ROLE:
 * Rasterizes PDF pages to high-quality JPEG images using PDF.js.
 * For multi-page PDFs, creates a ZIP archive of all extracted images.
 * 
 * ARCHITECTURE:
 * - Rendering: PDF.js for canvas-based page rasterization
 * - Quality: 2x scale factor (high DPI) + 90% JPEG quality
 * - Packaging: JSZip for multi-page bundling
 * 
 * KEY WORKFLOWS:
 * 1. INGESTION: Upload PDF
 * 2. RENDER LOOP: For each page → Render to Canvas (2x scale) → toBlob (JPEG 90%)
 * 3. PACKAGING: Single page → Direct download | Multi-page → ZIP all pages
 * 4. EXPORT: Download .jpg or .zip file
 * 
 * PERFORMANCE:
 * - Sequential rendering (prevents memory overflow)
 * - Progressive UI updates during multi-page processing
 * - High-quality output (scale=2.0 balances quality vs file size)
 */

import { shieldStorage } from './shield-redactor-storage.js';

export function init(config) {
    const dropZone = document.getElementById(config.dropZoneId);
    const fileInput = document.getElementById(config.fileInputId);
    const uploadInitial = document.getElementById(config.uploadInitialId);
    const uploadProgress = document.getElementById(config.uploadProgressId);
    const progressBar = document.getElementById(config.progressBarId);
    const progressText = document.getElementById(config.progressTextId);
    const cancelBtn = document.getElementById(config.cancelBtnId);
    const cancelContainer = document.getElementById(config.cancelContainerId);
    const downloadBtn = document.getElementById(config.downloadBtnId);
    const downloadContainer = document.getElementById(config.downloadContainerId);
    const saveVaultBtn = document.getElementById(config.saveVaultBtnId);

    let resultBlob = null;
    let extension = 'jpg';
    let baseFileName = 'extracted-images';
    let currentFile = null;
    let currentId = null;

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#b033ff';
            dropZone.style.backgroundColor = 'rgba(166, 0, 255, 0.1)';
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#a600ff';
            dropZone.style.backgroundColor = 'rgba(166, 0, 255, 0.05)';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#a600ff';
            dropZone.style.backgroundColor = 'rgba(166, 0, 255, 0.05)';
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                processPdfToJpg(files[0]);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                processPdfToJpg(fileInput.files[0]);
            }
        });
    }

    /**
     * CONVERSION ENGINE: Performs PDF to JPEG rasterization
     * 
     * @param {File} file - Source PDF file
     * @param {object|null} projectData - Optional vault data
     * 
     * WORKFLOW:
     * 1. Load PDF document via PDF.js
     * 2. Iterate through all pages
     * 3. Render each page to an off-screen canvas at 2.0x scale (High DPI)
     * 4. Convert canvas to JPEG blob at 0.9 quality
     * 5. If single page: Store blob directly
     * 6. If multi-page: Bundle all blobs into a JSZip archive
     * 7. Update UI progress and show download button
     */
    async function processPdfToJpg(file, projectData = null) {
        if (file.type !== 'application/pdf') {
            alert('Please upload a valid PDF file.');
            return;
        }

        currentFile = file;
        currentId = projectData?.id || 'proj_' + Date.now();
        uploadInitial.style.display = 'none';
        uploadProgress.style.display = 'block';
        progressBar.style.width = '5%';
        progressText.innerText = 'Loading PDF...';
        if (saveVaultBtn) saveVaultBtn.style.display = 'inline-block';

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const numPages = pdf.numPages;

            baseFileName = file.name.replace(/\.[^/.]+$/, "");
            const images = [];

            for (let i = 1; i <= numPages; i++) {
                progressText.innerText = `Processing page ${i} of ${numPages}...`;
                const progress = 5 + (i / numPages) * 85;
                progressBar.style.width = `${progress}%`;

                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 2.0 }); // High quality
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({ canvasContext: context, viewport: viewport }).promise;

                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
                images.push(blob);
            }

            if (numPages === 1) {
                resultBlob = images[0];
                extension = 'jpg';
            } else {
                progressText.innerText = 'Creating ZIP archive...';
                progressBar.style.width = '95%';
                const zip = new JSZip();
                images.forEach((blob, idx) => {
                    zip.file(`page-${idx + 1}.jpg`, blob);
                });
                resultBlob = await zip.generateAsync({ type: 'blob' });
                extension = 'zip';
            }

            progressBar.style.width = '100%';
            progressText.innerText = 'Extraction Complete!';
            progressText.style.color = '#a600ff';

            if (cancelContainer) cancelContainer.style.display = 'none';
            if (downloadContainer) downloadContainer.style.display = 'inline-block';

        } catch (error) {
            console.error('Extraction error:', error);
            alert('An error occurred: ' + error.message);
            resetUpload();
        }
    }

    window.pdfToJpgLoadFile = (file, projectData) => {
        openModal('pdfToJpgModal');
        processPdfToJpg(file, projectData);
    };

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
                    tool: 'PDF to JPG'
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

    if (downloadBtn) {
        downloadBtn.onclick = () => {
            if (!resultBlob) return;
            const url = URL.createObjectURL(resultBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${baseFileName}.${extension}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            resetUpload();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            resetUpload();
        };
    }

    /**
     * RESET: Clears state and returns to upload interface
     * Resets input, progress, and file pointers for reuse.
     */
    function resetUpload() {
        if (fileInput) fileInput.value = '';
        uploadInitial.style.display = 'block';
        uploadProgress.style.display = 'none';
        progressBar.style.width = '0%';
        progressText.innerText = '0%';
        progressText.style.color = 'inherit';
        resultBlob = null;
        currentFile = null;
        currentId = null;
        if (saveVaultBtn) saveVaultBtn.style.display = 'none';

        if (cancelContainer) cancelContainer.style.display = 'inline-block';
        if (downloadContainer) downloadContainer.style.display = 'none';

        const card = document.querySelector('#pdfToJpgModal .upload-card');
        if (card) {
            card.classList.add('pdf-to-jpg-reset-animating');
            setTimeout(() => {
                card.classList.remove('pdf-to-jpg-reset-animating');
            }, 600);
        }
    }

    window.resetPdfToJpg = resetUpload;
}
