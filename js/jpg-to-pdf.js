/**
 * JPG TO PDF CONVERTER
 * 
 * ROLE:
 * Converts JPEG/PNG images to PDF documents without server upload.
 * Uses PDF-Lib to create PDF files entirely in the browser.
 * 
 * ARCHITECTURE:
 * - PDF-Lib: Browser-native PDF creation library
 * - Canvas-free: Direct image embedding (no rendering)
 * - Preservation: Maintains original image dimensions
 * 
 * WORKFLOW:
 * 1. INGESTION: Drag/Drop/Paste image
 * 2. EMBEDDING: Load image into PDF-Lib (embedJpg/embedPng)
 * 3. LAYOUT: Create single-page PDF with image at full size
 * 4. EXPORT: Save as Blob for download or vault storage
 * 
 * DEPENDENCIES:
 * - PDF-Lib (global): Browser PDF creation
 * - shield-redactor-storage.js: Vault integration
 */

import { shieldStorage } from './shield-redactor-storage.js';

/**
 * INITIALIZATION: Binds UI and event handlers
 * @param {object} config - Configuration with element IDs
 */
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

    let pdfBlob = null;
    let fileName = 'converted.pdf';
    let currentFile = null;
    let currentId = null;

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#ffaa00';
            dropZone.style.backgroundColor = 'rgba(255, 153, 0, 0.1)';
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#ff9900';
            dropZone.style.backgroundColor = 'rgba(255, 153, 0, 0.05)';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#ff9900';
            dropZone.style.backgroundColor = 'rgba(255, 153, 0, 0.05)';
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                convertJpgToPdf(files[0]);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                convertJpgToPdf(fileInput.files[0]);
            }
        });
    }

    // Add clipboard paste support
    document.addEventListener('paste', (e) => {
        const modal = document.getElementById('jpgToPdfModal');
        if (!modal || modal.style.display === 'none') return;

        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) {
                    convertJpgToPdf(file);
                    break;
                }
            }
        }
    });

    /**
     * CONVERSION ENGINE: Converts image to PDF using PDF-Lib
     * 
     * @param {File} file - Image file (JPEG/PNG)
     * @param {object|null} projectData - Optional vault project data
     * 
     * WORKFLOW:
     * 1. Validate image format
     * 2. Create new PDF document
     * 3. Read image as ArrayBuffer
     * 4. Embed image into PDF (separate methods for JPEG vs PNG)
     * 5. Create page matching image dimensions
     * 6. Draw image to fill entire page
     * 7. Save PDF as Blob
     */
    async function convertJpgToPdf(file, projectData = null) {
        if (!file.type.startsWith('image/')) {
            alert('Please upload a valid image file (JPG, PNG).');
            return;
        }

        currentFile = file;
        currentId = projectData?.id || 'proj_' + Date.now();
        uploadInitial.style.display = 'none';
        uploadProgress.style.display = 'block';
        progressBar.style.width = '10%';
        progressText.innerText = 'Initializing...';
        if (saveVaultBtn) saveVaultBtn.style.display = 'inline-block';

        try {
            const { PDFDocument } = PDFLib;
            const pdfDoc = await PDFDocument.create();

            progressText.innerText = 'Reading image...';
            progressBar.style.width = '30%';

            const arrayBuffer = await file.arrayBuffer();
            let image;

            if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
                image = await pdfDoc.embedJpg(arrayBuffer);
            } else if (file.type === 'image/png') {
                image = await pdfDoc.embedPng(arrayBuffer);
            } else {
                throw new Error('Unsupported image format');
            }

            progressText.innerText = 'Creating PDF...';
            progressBar.style.width = '60%';

            const page = pdfDoc.addPage([image.width, image.height]);
            page.drawImage(image, {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height,
            });

            progressText.innerText = 'Finalizing...';
            progressBar.style.width = '90%';

            const pdfBytes = await pdfDoc.save();
            pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
            fileName = file.name.split('.').slice(0, -1).join('.') + '.pdf';

            progressBar.style.width = '100%';
            progressText.innerText = 'Conversion Complete!';
            progressText.style.color = '#ff9900';

            if (cancelContainer) cancelContainer.style.display = 'none';
            if (downloadContainer) downloadContainer.style.display = 'inline-block';

        } catch (error) {
            console.error('Conversion error:', error);
            alert('An error occurred during conversion: ' + error.message);
            resetUpload();
        }
    }

    window.jpgToPdfLoadFile = (file, projectData) => {
        openModal('jpgToPdfModal');
        convertJpgToPdf(file, projectData);
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
                    tool: 'JPG to PDF'
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
            if (!pdfBlob) return;
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Auto-reset after download
            resetUpload();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            resetUpload();
        };
    }

    /**
     * RESET: Clears state and returns to upload screen
     * Allows converting another image without page reload
     */
    function resetUpload() {
        if (fileInput) fileInput.value = '';
        uploadInitial.style.display = 'block';
        uploadProgress.style.display = 'none';
        progressBar.style.width = '0%';
        progressText.innerText = '0%';
        progressText.style.color = 'inherit';
        pdfBlob = null;
        currentFile = null;
        currentId = null;
        if (saveVaultBtn) saveVaultBtn.style.display = 'none';

        if (cancelContainer) cancelContainer.style.display = 'inline-block';
        if (downloadContainer) downloadContainer.style.display = 'none';

        // Trigger reset animation
        const card = document.querySelector('.upload-card-jpg-t-pdf');
        if (card) {
            card.classList.add('reset-animating');
            setTimeout(() => {
                card.classList.remove('reset-animating');
            }, 600);
        }
    }

    window.resetJpgToPdf = resetUpload;
}
