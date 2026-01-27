/**
 * PDF TO WORD CONVERTER
 * 
 * ROLE:
 * Converts PDF to editable DOCX with layout preservation (no OCR required).
 * Extracts text, images, and positioning data from PDF.js and reconstructs in Word format via docx.js.
 * 
 * ARCHITECTURE:
 * - Text Extraction: PDF.js TextContent API (native text, not images)
 * - Image Extraction: PDF.js OperatorList (embedded images with coordinates)
 * - Layout Reconstruction: Calculates Y-positions, line grouping, indents, and spacing
 * - Word Generation: docx.js library creates .docx with floating images and absolute positioning
 * 
 * KEY WORKFLOWS:
 * 1. INGESTION: Upload PDF
 * 2. EXTRACTION LOOP: For each page:
 *    a. Extract text items with coordinates (x, y, font, size)
 *    b. Extract images with transform matrices (position, scale)
 *    c. Group text into lines based on Y-coordinate proximity
 * 3. LAYOUT RECONSTRUCTION:
 *    - Convert PDF coordinates (points) to Word units (twips)
 *    - Calculate vertical spacing between lines
 *    - Preserve horizontal indentation
 *    - Position images as floating objects
 * 4. DOCX GENERATION: Build Word document with docx.js Packer
 * 5. EXPORT: Download .docx file
 * 
 * CONVERSION MODES:
 * - STANDARD: Text + Images with layout preservation
 * - TEXT ONLY: Ignore images, extract text only
 * - IMAGES ONLY: Extract images, ignore text
 * 
 * LIMITATIONS:
 * - Requires native PDF text (not scanned images - OCR not implemented)
 * - Layout preservation is approximate (PDF→Word format differences)
 * - Complex PDF features (forms, annotations) not supported
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

    // Options UI
    const uploadReady = document.getElementById(config.uploadReadyId);
    const fileNameEl = document.getElementById(config.fileNameId);
    const fileSizeEl = document.getElementById(config.fileSizeId);
    const conversionTypeEl = document.getElementById(config.conversionTypeId);
    const imageQualityEl = document.getElementById(config.imageQualityId);
    const preserveFormattingEl = document.getElementById(config.preserveFormattingId);
    const startConversionBtn = document.getElementById(config.startConversionBtnId);

    let selectedFile = null;
    let currentId = null;

    const PT_TO_TWIP = 20; // Conversion factor from Points to Twips
    let resultBlob = null;
    let baseFileName = 'converted';

    // Set PDF.js Worker
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    }

    // Helper to get docx namespace robustly
    /**
     * LIBRARY RESOLVER: Robustly retrieves the docx.js namespace
     * Handles global vs module exports depending on loading context.
     * @returns {object|null} docx library instance
     */
    function getDocx() {
        if (window.docx) return window.docx;
        if (typeof docx !== 'undefined') return docx;
        return null;
    }

    const docxLib = getDocx();

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#0044ff';
            dropZone.style.backgroundColor = 'rgba(0, 68, 255, 0.1)';
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#0044ff';
            dropZone.style.backgroundColor = 'rgba(0, 68, 255, 0.05)';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#0044ff';
            dropZone.style.backgroundColor = 'rgba(0, 68, 255, 0.05)';
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFileSelect(files[0]);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleFileSelect(fileInput.files[0]);
            }
        });
    }

    if (startConversionBtn) {
        startConversionBtn.onclick = () => {
            if (selectedFile) startConversion(selectedFile);
        };
    }

    /**
     * INGESTION: Handles initial file selection and UI preparation
     * @param {File} file - Source PDF
     * @param {object|null} projectData - Optional vault data
     */
    async function handleFileSelect(file, projectData = null) {
        if (file.type !== 'application/pdf') {
            alert('Please upload a valid PDF file.');
            return;
        }

        selectedFile = file;
        currentId = projectData?.id || 'proj_' + Date.now();

        // Update UI
        if (uploadInitial) uploadInitial.style.display = 'none';
        if (uploadReady) uploadReady.style.display = 'block';
        if (saveVaultBtn) saveVaultBtn.style.display = 'inline-block';

        if (fileNameEl) fileNameEl.textContent = file.name;
        if (fileSizeEl) fileSizeEl.textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';
    }

    /**
     * CORE PIPELINE: Orchestrates PDF content extraction and Word document reconstruction.
     * 
     * @param {File} file - Source PDF
     * 
     * WORKFLOW:
     * 1. INITIALIZE: Validate docx library and setup UI progress
     * 2. READ: Load PDF via PDF.js and extract metadata
     * 3. PAGE LOOP: 
     *    a. Extract TextContent (characters + coordinates)
     *    b. Extract OperatorList (vector/raster image commands)
     *    c. Parse Image data from OperatorList into Base64 PNGs
     *    d. Group text into logical lines based on Y-coordinate proximity
     * 4. RECONSTRUCTION:
     *    a. Sort text and images by Y-coordinate (top-down)
     *    b. Calculate required "spacing-before" in Twips for layout preservation
     *    c. Create Paragraphs for text and ImageRuns for images
     *    d. Group everything into Document Sections
     * 5. FINALIZATION: Bundle via docx.js Packer and generate downloadable Blob
     */
    async function startConversion(file) {
        const lib = getDocx();
        if (!lib) {
            alert('The Word conversion library (docx) failed to load. Please check your connection and refresh.');
            return;
        }

        // Get Options
        const conversionType = conversionTypeEl ? conversionTypeEl.value : 'standard';
        const imageQuality = imageQualityEl ? imageQualityEl.value : 'standard';
        const preserveFormatting = preserveFormattingEl ? preserveFormattingEl.checked : true;

        const docxRef = lib.Paragraph ? lib : (lib.default || lib);

        if (uploadReady) uploadReady.style.display = 'none';
        if (uploadProgress) uploadProgress.style.display = 'block';
        if (progressBar) progressBar.style.width = '5%';
        progressText.innerText = 'Initializing...';

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            baseFileName = file.name.replace(/\.[^/.]+$/, "");

            const sections = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                progressText.innerText = `Extracting page ${i} of ${pdf.numPages}...`;
                const progress = 5 + (i / pdf.numPages) * 80;
                progressBar.style.width = `${progress}%`;

                const page = await pdf.getPage(i);
                const viewportRaw = page.getViewport({ scale: 1.0 });
                const pageWidthTwips = Math.round(viewportRaw.width * PT_TO_TWIP);
                const pageHeightTwips = Math.round(viewportRaw.height * PT_TO_TWIP);

                const textContent = await page.getTextContent();
                const operatorList = await page.getOperatorList();

                const pageImages = [];
                if (conversionType !== 'text') {
                    for (let j = 0; j < operatorList.fnArray.length; j++) {
                        if (operatorList.fnArray[j] === pdfjsLib.OPS.paintImageXObject) {
                            const imgName = operatorList.argsArray[j][0];
                            let transform = [1, 0, 0, 1, 0, 0];
                            for (let k = j - 1; k >= 0; k--) {
                                if (operatorList.fnArray[k] === pdfjsLib.OPS.transform) {
                                    transform = operatorList.argsArray[k];
                                    break;
                                }
                            }

                            try {
                                const img = await page.objs.get(imgName);
                                if (img) {
                                    const pixelCount = img.width * img.height;
                                    const dataLength = img.data.length;
                                    const channels = dataLength / pixelCount;

                                    const canvas = document.createElement('canvas');
                                    canvas.width = img.width;
                                    canvas.height = img.height;
                                    const ctx = canvas.getContext('2d');
                                    const imageData = ctx.createImageData(img.width, img.height);

                                    if (channels === 3) {
                                        for (let p = 0; p < pixelCount; p++) {
                                            imageData.data[p * 4] = img.data[p * 3];
                                            imageData.data[p * 4 + 1] = img.data[p * 3 + 1];
                                            imageData.data[p * 4 + 2] = img.data[p * 3 + 2];
                                            imageData.data[p * 4 + 3] = 255;
                                        }
                                    } else if (channels === 1) {
                                        for (let p = 0; p < pixelCount; p++) {
                                            const val = img.data[p];
                                            imageData.data[p * 4] = val; imageData.data[p * 4 + 1] = val; imageData.data[p * 4 + 2] = val;
                                            imageData.data[p * 4 + 3] = 255;
                                        }
                                    } else {
                                        imageData.data.set(img.data);
                                    }
                                    ctx.putImageData(imageData, 0, 0);
                                    const base64 = canvas.toDataURL('image/png').split(',')[1];

                                    const yBottom = transform[5];
                                    const imgHeightPoints = Math.abs(transform[3]);
                                    const yTop = viewportRaw.height - (yBottom + imgHeightPoints);

                                    pageImages.push({
                                        base64, width: img.width, height: img.height,
                                        y: yTop, x: transform[4],
                                        displayHeightPoints: imgHeightPoints,
                                        displayWidthPoints: Math.abs(transform[0])
                                    });
                                }
                            } catch (e) { }
                        }
                    }
                }

                const children = [];
                const contentItems = [];
                let currentY = null;
                let currentLine = [];
                let lineStartX = null;

                if (conversionType !== 'images') {
                    textContent.items.forEach(item => {
                        const y = item.transform[5];
                        const x = item.transform[4];
                        if (currentY !== null && Math.abs(y - currentY) > 5) {
                            if (currentLine.length > 0) {
                                contentItems.push({ type: 'text', y: currentY, line: [...currentLine] });
                            }
                            currentLine = []; lineStartX = null;
                        }
                        if (currentLine.length > 0 && lineStartX !== null) {
                            const lastItem = currentLine[currentLine.length - 1];
                            const gap = x - (lastItem.x + lastItem.width);
                            if (gap > 1) {
                                currentLine.push({ str: ' ', fontName: item.fontName, height: item.height, x: x, width: 0 });
                            }
                        }
                        currentLine.push({ str: item.str, fontName: item.fontName, height: item.height, x: x, width: item.width });
                        if (lineStartX === null) lineStartX = x;
                        currentY = y;
                    });
                }
                if (currentLine.length > 0) contentItems.push({ type: 'text', y: currentY, line: [...currentLine] });

                pageImages.forEach(img => contentItems.push({ type: 'image', y: img.y, imageData: img }));
                contentItems.sort((a, b) => b.y - a.y);

                let lastY = viewportRaw.height;
                contentItems.forEach(item => {
                    if (item.type === 'text') {
                        const textRuns = item.line.map(textItem => {
                            const fontName = textItem.fontName || 'Arial';
                            const fontSize = textItem.height || 12;
                            return new docxRef.TextRun({
                                text: textItem.str,
                                font: getFontFamily(fontName),
                                size: Math.round(fontSize * 2),
                                bold: fontName.toLowerCase().includes('bold'),
                                italics: fontName.toLowerCase().includes('italic'),
                                color: '000000'
                            });
                        });

                        const x = item.line[0].x;
                        const y = item.y;
                        const fontSize = item.line[0].height || 12;
                        const estimatedLineHeight = fontSize * 1.2;
                        const verticalGapPoints = lastY - y - estimatedLineHeight;
                        const spacingBeforeTwips = Math.max(0, Math.round(verticalGapPoints * PT_TO_TWIP));

                        const paragraphOptions = {
                            children: textRuns,
                            spacing: {
                                before: preserveFormatting ? spacingBeforeTwips : 0,
                                after: 0,
                                line: Math.round(estimatedLineHeight * PT_TO_TWIP),
                                lineRule: "exact"
                            }
                        };
                        if (preserveFormatting) paragraphOptions.indent = { left: Math.round(x * PT_TO_TWIP) };
                        children.push(new docxRef.Paragraph(paragraphOptions));
                        lastY = y;
                    } else if (item.type === 'image') {
                        const img = item.imageData;
                        const binaryString = window.atob(img.base64);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let k = 0; k < binaryString.length; k++) bytes[k] = binaryString.charCodeAt(k);

                        const imageRunOptions = {
                            data: bytes,
                            transformation: {
                                width: Math.round(img.displayWidthPoints * (96 / 72)),
                                height: Math.round(img.displayHeightPoints * (96 / 72))
                            }
                        };
                        if (preserveFormatting) {
                            const PT_TO_EMU = 12700;
                            imageRunOptions.floating = {
                                horizontalPosition: { relative: docxRef.HorizontalPositionRelativeFrom.PAGE, offset: Math.round(img.x * PT_TO_EMU) },
                                verticalPosition: { relative: docxRef.VerticalPositionRelativeFrom.PAGE, offset: Math.round(img.y * PT_TO_EMU) },
                                allowOverlap: true, zIndex: 0
                            };
                        }
                        children.push(new docxRef.Paragraph({ children: [new docxRef.ImageRun(imageRunOptions)], spacing: { before: 0, after: 0 } }));
                    }
                });

                if (children.length === 0) children.push(new docxRef.Paragraph({ children: [new docxRef.TextRun(" ")] }));

                sections.push({
                    properties: { page: { size: { width: pageWidthTwips, height: pageHeightTwips }, margin: { top: 0, right: 0, bottom: 0, left: 0 } } },
                    children: children
                });
            }

            /**
             * UTILITY: Maps PDF font names to standard Word fonts
             * @param {string} fontName - PDF font descriptor
             * @returns {string} Standard font family (Arial, Times New Roman, etc.)
             */
            function getFontFamily(fontName) {
                if (!fontName) return 'Arial';
                const name = fontName.toLowerCase();
                if (name.includes('times') || name.includes('serif')) return 'Times New Roman';
                if (name.includes('courier') || name.includes('mono')) return 'Courier New';
                if (name.includes('helvetica') || name.includes('arial')) return 'Arial';
                if (name.includes('calibri')) return 'Calibri';
                return 'Arial';
            }

            progressText.innerText = 'Building Document...';
            progressBar.style.width = '90%';

            const doc = new docxRef.Document({ sections: sections });
            resultBlob = await docxRef.Packer.toBlob(doc);

            progressBar.style.width = '100%';
            progressText.innerText = 'Conversion Complete!';
            progressText.style.color = '#0044ff';

            if (cancelContainer) cancelContainer.style.display = 'none';
            if (downloadContainer) downloadContainer.style.display = 'inline-block';

        } catch (error) {
            alert('An error occurred during conversion: ' + error.message);
            resetUpload();
        }
    }

    window.pdfToWordLoadFile = (file, projectData) => {
        openModal('pdfToWordModal');
        handleFileSelect(file, projectData);
    };

    if (saveVaultBtn) {
        saveVaultBtn.onclick = async () => {
            if (!selectedFile) return;
            const originalText = saveVaultBtn.innerText;
            saveVaultBtn.disabled = true;
            saveVaultBtn.innerText = 'SAVING...';

            try {
                await shieldStorage.saveProject({
                    id: currentId,
                    name: selectedFile.name,
                    file: selectedFile,
                    tool: 'PDF to Word'
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
            const url = URL.createObjectURL(new Blob([resultBlob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${baseFileName}.docx`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
            resetUpload();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            resetUpload();
        };
    }

    /**
     * RESET: Clears all file state and returns to discovery view
     */
    function resetUpload() {
        if (fileInput) fileInput.value = '';
        selectedFile = null;
        currentId = null;

        if (uploadInitial) uploadInitial.style.display = 'block';
        if (uploadReady) uploadReady.style.display = 'none';
        if (uploadProgress) uploadProgress.style.display = 'none';
        if (saveVaultBtn) saveVaultBtn.style.display = 'none';

        if (progressBar) progressBar.style.width = '0%';
        progressText.innerText = '0%';
        progressText.style.color = 'inherit';
        resultBlob = null;

        if (cancelContainer) cancelContainer.style.display = 'inline-block';
        if (downloadContainer) downloadContainer.style.display = 'none';

        const card = document.querySelector('#pdfToWordModal .upload-card');
        if (card) {
            card.classList.add('pdf-to-word-reset-animating');
            setTimeout(() => { card.classList.remove('pdf-to-word-reset-animating'); }, 600);
        }
    }

    window.resetPdfToWord = resetUpload;
}
