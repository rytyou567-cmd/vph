/**
 * PDFEditor.js
 * 
 * ROLE:
 * The Main Controller for the ViewPorts PDF Editor.
 * Orchestrates the interaction between the UI, State, Tools, and the Storage layer.
 * 
 * KEY RESPONSIBILITIES:
 * 1. INITIALIZATION: Bootstraps the application, loading dependencies and the active PDF.
 * 2. MODULE WIRING: Connects `Viewer`, `ToolManager`, `UIManager` together.
 * 3. FILE OPERATIONS: Handles Loading, Merging, and Saving PDFs.
 * 4. FLATTENING ENGINE: `generateModifiedPdf()` rebuilds the PDF layer-by-layer, burning annotations into the file for export.
 * 5. GLOBAL EVENTS: Exposes window-level API for HTML buttons.
 */

import { StateManager } from './StateManager.js';
import { Viewer } from './Viewer.js';
import { UIManager } from './UIManager.js';
import { ToolManager } from './ToolManager.js';
import { ImageManager } from './ImageManager.js';
import { StorageManager } from './StorageManager.js';
import { CompressionManager } from './CompressionManager.js';
import { GhostscriptManager } from './GhostscriptManager.js';
import { Utils } from './Utils.js';
import { shieldStorage } from '../shield-redactor-storage.js';

class PDFEditor {
    constructor() {
        // Instantiate Core Modules
        this.state = new StateManager();
        this.ui = new UIManager();
        this.tools = new ToolManager(this.state);
        this.images = new ImageManager(this.state);
        this.compressor = new CompressionManager();
        this.gsManager = new GhostscriptManager();
        this.currentProjectId = sessionStorage.getItem('active_project_id');

        // Initialize Viewer with callbacks
        this.viewer = new Viewer(window.pdfjsLib, document.getElementById('pdfContainer'),
            // Render callback: invoked when a page finishes rendering
            (pdf) => {
                this.ui.renderSidebar(pdf, (pageNum) => {
                    document.querySelector(`[data-page-number="${pageNum}"]`).scrollIntoView();
                });
            },
            // Merge callback: invoked when clicking "Insert Page" in UI
            (index) => this.showMergeModal(index)
        );

        this.init();
    }

    /**
     * Logic: Merging external PDF
     * Reads a new PDF file and inserts all its pages at the specified `insertIndex`.
     */
    async handleMergePDF(insertIndex) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf';

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const btn = document.getElementById('merge-btn-' + insertIndex);
            if (btn) btn.innerText = "Merging...";

            try {
                const storage = new StorageManager();
                const currentBytes = await storage.getPdf();
                const { PDFDocument } = window.PDFLib;

                // Load both docs
                const currentPdfDoc = await PDFDocument.load(currentBytes);
                const arrayBuffer = await file.arrayBuffer();
                const newPdfDoc = await PDFDocument.load(arrayBuffer);

                // Copy all pages
                const importedPages = await currentPdfDoc.copyPages(newPdfDoc, newPdfDoc.getPageIndices());

                // Insert sequentially
                let insertionPos = insertIndex;
                for (const page of importedPages) {
                    currentPdfDoc.insertPage(insertionPos, page);
                    insertionPos++;
                }

                // Save & Reload
                const savedBytes = await currentPdfDoc.save();
                await storage.savePdf(savedBytes);
                window.location.reload();

            } catch (err) {
                console.error("Merge failed:", err);
                alert("Failed to merge PDF: " + err.message);
                if (btn) btn.innerText = "+ Insert PDF";
            }
        };

        input.click();
    }

    /**
     * Shows the Advanced Merge Modal (Allows range selection).
     */
    async showMergeModal(insertIndex) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf';

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const arrayBuffer = await file.arrayBuffer();
                const { PDFDocument } = window.PDFLib;
                const newPdfDoc = await PDFDocument.load(arrayBuffer);
                const numPages = newPdfDoc.getPageCount();

                // Store context for the execute step
                this.mergeContext = {
                    insertIndex: insertIndex,
                    newPdfDoc: newPdfDoc,
                    fileName: file.name,
                    numPages: numPages
                };

                // UI Update
                document.getElementById('mergeFileName').innerText = file.name;
                document.getElementById('mergePageCount').innerText = `(${numPages} page${numPages > 1 ? 's' : ''})`;
                document.getElementById('mergePageRange').value = '';

                // Default to 'All'
                const allRadio = document.querySelector('input[name="mergeType"][value="all"]');
                if (allRadio) allRadio.checked = true;
                this.toggleMergeOptions();

                // Show Modal
                const modal = document.getElementById('mergeModal');
                if (modal) {
                    modal.style.display = 'flex';
                    setTimeout(() => modal.classList.add('active'), 10);
                }
            } catch (err) {
                console.error("Failed to load PDF:", err);
                alert("Failed to load PDF: " + err.message);
            }
        };

        input.click();
    }

    toggleMergeOptions() {
        const type = document.querySelector('input[name="mergeType"]:checked')?.value;
        const specificDiv = document.getElementById('mergeSpecificOptions');
        if (specificDiv) {
            specificDiv.style.display = (type === 'specific') ? 'block' : 'none';
        }
    }

    /**
     * Executes the Merge based on Modal Selection (All vs Range).
     */
    async executeMerge() {
        if (!this.mergeContext) return;

        const { insertIndex, newPdfDoc, numPages } = this.mergeContext;
        const type = document.querySelector('input[name="mergeType"]:checked')?.value;

        let indicesToMerge = [];

        try {
            // Determine Pages
            if (type === 'all') {
                indicesToMerge = newPdfDoc.getPageIndices();
            } else {
                const rangeStr = document.getElementById('mergePageRange').value;
                indicesToMerge = this.parsePageRange(rangeStr, numPages);

                if (indicesToMerge.length === 0) {
                    alert('Please enter valid page numbers (e.g., 1, 3-5, 8)');
                    return;
                }
            }

            const btn = document.querySelector('#mergeModal .modal-footer-btns button:last-child');
            if (btn) btn.innerText = "Merging...";

            // Perform Merge
            const storage = new StorageManager();
            const currentBytes = await storage.getPdf();
            const { PDFDocument } = window.PDFLib;
            const currentPdfDoc = await PDFDocument.load(currentBytes);

            const importedPages = await currentPdfDoc.copyPages(newPdfDoc, indicesToMerge);

            let insertionPos = insertIndex;
            for (const page of importedPages) {
                currentPdfDoc.insertPage(insertionPos, page);
                insertionPos++;
            }

            const savedBytes = await currentPdfDoc.save();
            await storage.savePdf(savedBytes);
            window.location.reload();

        } catch (err) {
            console.error("Merge failed:", err);
            alert("Error merging pages: " + err.message);
            const btn = document.querySelector('#mergeModal .modal-footer-btns button:last-child');
            if (btn) btn.innerText = "Insert Pages";
        }
    }

    parsePageRange(rangeStr, maxPages) {
        if (!rangeStr || !rangeStr.trim()) return [];

        const indices = new Set();
        const parts = rangeStr.split(',');

        for (const part of parts) {
            const p = part.trim();
            if (p.includes('-')) {
                const [start, end] = p.split('-').map(num => parseInt(num.trim()));
                if (!isNaN(start) && !isNaN(end)) {
                    const low = Math.min(start, end);
                    const high = Math.max(start, end);
                    for (let i = low; i <= high; i++) {
                        if (i >= 1 && i <= maxPages) {
                            indices.add(i - 1);
                        }
                    }
                }
            } else {
                const num = parseInt(p);
                if (!isNaN(num) && num >= 1 && num <= maxPages) {
                    indices.add(num - 1);
                }
            }
        }

        return Array.from(indices).sort((a, b) => a - b);
    }

    /**
     * Bootstraps the Editor.
     * Loads the PDF from IndexedDB (persisted state) or falls back to a default "Hello World" PDF.
     * Sets up global event listeners and window hooks.
     */
    async init() {
        const storage = new StorageManager();
        let storedPdf = null;
        try {
            storedPdf = await storage.getPdf();
        } catch (e) {
            console.error("Failed to load PDF from Storage:", e);
        }

        // Base64 fallback PDF (Blank or Hello World) for first-time load
        const fallbackPdf = 'data:application/pdf;base64,JVBERi0xLjcKCjEgMCBvYmogICUgZW50cnkgcG9pbnQKPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgplbmRvYmoKCjIgMCBvYmogCjw8CiAgL1R5cGUgL1BhZ2VzCiAgL01lZGlhQm94IFsgMCAwIDIwMCAyMDAgXQogIC9Db3VudCAxCiAgL0tpZHMgWyAzIDAgUiBdCj4+CmVuZG9iagoKMyAwIG9iago8PAogIC9UeXBlIC9QYWdlCiAgL1BhcmVudCAyIDAgUgogIC9SZXNvdXJjZXMgPDwKICAgIC9Gb250IDw8CiAgICAgIC9FMSA0IDAgUHgogICAgPj4KICA+PgogIC9Db250ZW50cyA1IDAgUgo+PgplbmRvYmoKCjQgMCBvYmoKPDwKICAvVHlwZSAvRm9udAogIC9TdWJ0eXBlIC9UeXBlMQogIC9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9iagoKNSAwIG9iago8PAogIC9MZW5ndGggNDQKPj4Kc3RyZWFtCkJUCjcwIDUwIFRECi9FMSAxMiBUZgooSGVsbG8gV29ybGQhKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCgp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTAgMDAwMDAgbiAKMDAwMDAwMDA2MCAwMDAwMCBuIAowMDAwMDAwMTU3IDAwMDAwIG4gCjAwMDAwMDAyNTUgMDAwMDAgbiAKMDAwMDAwMDM0MSAwMDAwMCBuIAp0cmFpbGVyCjw8CiAgL1NpemUgNgogIC9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgo0MzYKJSVFT0YK';

        this.viewer.loadDocument(storedPdf || fallbackPdf);

        // Bind Image Tool Input
        const imgInput = document.getElementById('imageToolInput');
        if (imgInput) {
            imgInput.addEventListener('change', (e) => this.images.handleImageUpload(e));
        }

        // Setup Annotation Layer whenever a page is rendered by PDF.js
        document.addEventListener('page-rendered', (e) => {
            const { wrapper, width, height } = e.detail;
            this.tools.setupLayers(wrapper, width, height);
        });

        // UI Updates on Tool Change
        document.addEventListener('tool-changed', (e) => {
            this.ui.updateToolUI(e.detail.tool);
        });

        // --- GLOBAL API HOOKS (For HTML Buttons) ---
        window.setTool = (tool) => this.tools.setTool(tool);
        window.addNewPage = () => {
            const { width, height, pageNum } = this.viewer.addNewPage();
            // Update Thumbnail
            this.ui.addThumbnail(pageNum, width, height, () => {
                document.querySelector(`[data-page-number="${pageNum}"]`).scrollIntoView();
            });
        };
        window.undo = () => this.state.undo();
        window.redo = () => this.state.redo();
        window.toggleSidebar = () => this.ui.toggleSidebar();

        window.clearAllAnnotations = () => {
            if (confirm('Are you sure you want to clear all changes? This cannot be undone.')) {
                this.tools.clearAll();
            }
        };

        // Modal Controls
        window.toggleMergeOptions = () => this.toggleMergeOptions();
        window.executeMerge = () => this.executeMerge();
        window.closeMergeModal = () => {
            const modal = document.getElementById('mergeModal');
            if (modal) {
                modal.classList.remove('active');
                setTimeout(() => modal.style.display = 'none', 300);
            }
        };

        // Compression Modal Logic
        window.showCompressionModal = () => {
            const modal = document.getElementById('compressionModal');
            if (modal) {
                modal.style.display = 'flex';
                modal.style.opacity = '1';
                modal.classList.add('active');
            }
            // Reset UI state
            const progress = document.getElementById('compressionProgress');
            if (progress) progress.style.display = 'none';
            const options = document.getElementById('compressionOptions');
            const btns = document.querySelector('.modal-footer-btns');
            if (options) options.style.display = 'block';
            if (btns) btns.style.display = 'flex';
        };

        window.closeCompressionModal = () => {
            document.getElementById('compressionModal').style.display = 'none';
        };

        window.startCompression = async () => {
            // [UI Reset Code]
            const optionsDiv = document.getElementById('compressionOptions');
            const btnsDiv = document.querySelector('.modal-footer-btns');
            if (optionsDiv) optionsDiv.style.display = 'none';
            if (btnsDiv) btnsDiv.style.display = 'none';

            const progressBar = document.getElementById('compressionProgressBar');
            const progressText = document.getElementById('compressionProgressText');
            const progressDiv = document.getElementById('compressionProgress');

            if (progressDiv) progressDiv.style.display = 'block';
            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.innerText = 'Starting...';

            try {
                const storage = new StorageManager();
                const existingPdfBytes = await storage.getPdf();
                if (!existingPdfBytes) throw new Error("No PDF loaded.");

                const useWasm = document.getElementById('useWasm').checked;
                let resultBytes;

                // Branch: WASM (Ghostscript) vs JS (Images)
                if (useWasm) {
                    const preset = document.getElementById('wasmPreset').value;
                    if (progressText) progressText.innerText = 'Initializing Compression Engine (WASM)...';
                    if (progressBar) progressBar.style.width = '20%';

                    // Lazy Load GS
                    if (!this.gsManager.ready) await this.gsManager.load();

                    resultBytes = await this.gsManager.compress(existingPdfBytes, preset);

                    if (progressBar) progressBar.style.width = '100%';
                    if (progressText) progressText.innerText = 'Done!';
                } else {
                    // Standard JS Compression calculation
                    let targetBytes = 1024 * 1024;
                    const unitInput = document.querySelector('input[name="sizeUnit"]:checked');
                    if (unitInput) {
                        const unit = unitInput.value;
                        let val = 0;
                        if (unit === 'KB') val = parseInt(document.getElementById('targetValueKB').value);
                        else val = parseInt(document.getElementById('targetValueMB').value);
                        targetBytes = unit === 'KB' ? val * 1024 : val * 1024 * 1024;
                    }
                    resultBytes = await this.compressor.compress(existingPdfBytes, targetBytes, (status) => {
                        if (typeof status === 'string') {
                            if (progressText) progressText.innerText = status;
                        } else {
                            if (progressBar) progressBar.style.width = status + '%';
                            if (progressText) progressText.innerText = `Processing page ${status}%...`;
                        }
                    });
                }
                this.downloadBlob(resultBytes, 'compressed_document.pdf', 'application/pdf');
                window.closeCompressionModal();
            } catch (e) {
                console.error(e);
                alert("Compression failed: " + e.message);
                window.closeCompressionModal();
            }
        };

        // Initial sizing check
        this.calculatePdfSize();
    }

    /**
     * Size Estimation.
     * Roughly calculates the output file size including new images and annotations.
     */
    async calculatePdfSize() {
        const displayEl = document.getElementById('pdf-size-display');
        if (displayEl) {
            displayEl.classList.add('loading-dots');
            displayEl.innerText = 'Calculating...';
        }

        try {
            const storage = new StorageManager();
            const existingPdfBytes = await storage.getPdf();
            let baseSize = 0;
            let totalOriginalPages = 1;

            // 1. Base PDF Size
            if (existingPdfBytes) {
                if (typeof existingPdfBytes === 'string') {
                    // Estimate base64 size
                    baseSize = (existingPdfBytes.length - (existingPdfBytes.indexOf(',') + 1)) * 0.75;
                } else if (existingPdfBytes.byteLength) {
                    baseSize = existingPdfBytes.byteLength;
                }
                if (window.PDFLib) {
                    try {
                        const pdfDoc = await window.PDFLib.PDFDocument.load(existingPdfBytes, { ignoreEncryption: true });
                        totalOriginalPages = pdfDoc.getPageCount();
                    } catch (e) { }
                }
            }

            const avgPageSize = totalOriginalPages > 0 ? (baseSize / totalOriginalPages) : 0;
            let estimatedSize = 0;
            const pages = document.querySelectorAll('.pdf-page-wrapper');

            if (pages.length === 0) {
                estimatedSize = baseSize;
            } else {
                // 2. Add New Annotations Size
                for (const wrapper of pages) {
                    const originalIndexStr = wrapper.dataset.originalPageIndex;
                    if (originalIndexStr && !isNaN(parseInt(originalIndexStr))) estimatedSize += avgPageSize;
                    else estimatedSize += 5000; // New/Blank page overhead

                    // Images
                    const imageCanvases = wrapper.querySelectorAll('.image-wrapper canvas');
                    for (const canvas of imageCanvases) {
                        try {
                            let dataUrl;
                            if (!this.hasTransparency(canvas)) dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                            else dataUrl = canvas.toDataURL('image/png');
                            if (dataUrl.length > 1000) estimatedSize += dataUrl.length * 0.75;
                        } catch (err) { }
                    }

                    // Drawings (Pencil/Highlight layers)
                    const layerClasses = ['.pencil-layer', '.highlighter-layer', '.arrow-layer', '.whiteout-layer'];
                    layerClasses.forEach(cls => {
                        const layer = wrapper.querySelector(cls);
                        if (layer && !this.isCanvasBlank(layer)) {
                            try {
                                const dataUrl = layer.toDataURL('image/png');
                                estimatedSize += dataUrl.length * 0.75;
                            } catch (err) { }
                        }
                    });

                    // Text
                    const textElements = wrapper.querySelectorAll('.text-wrapper, .pdflib-edited-text');
                    estimatedSize += (textElements.length * 500);
                }
            }

            let sizeText = (estimatedSize < 1024 * 1024) ? (estimatedSize / 1024).toFixed(1) + ' KB' : (estimatedSize / (1024 * 1024)).toFixed(1) + ' MB';
            if (displayEl) {
                displayEl.classList.remove('loading-dots');
                displayEl.innerText = 'PDF Size: ~' + sizeText;
            }
        } catch (e) {
            if (displayEl) displayEl.innerText = 'Size Error';
        }
    }

    /**
     * Saves the current project state to the global Vault (IndexedDB).
     */
    async saveToVault() {
        const saveBtn = document.getElementById('save-vault-btn');
        try {
            if (saveBtn) saveBtn.innerText = 'Saving to Vault...';

            // Flatten to PDF bytes
            const pdfBytes = await this.generateModifiedPdf();
            if (!pdfBytes) return;

            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const storage = new StorageManager();
            const fileName = (await storage.getFileName()) || 'edited_document.pdf';

            const projectId = this.currentProjectId || 'proj_' + Date.now();
            let toolName = sessionStorage.getItem('active_pdf_tool') || 'PDF Editor';
            if (!toolName.endsWith(' Project')) toolName += ' Project';

            // Use Global Vault Storage
            await shieldStorage.saveProject({
                id: projectId,
                name: fileName,
                file: blob,
                tool: toolName
            });

            // Update Session for Consistency
            this.currentProjectId = projectId;
            sessionStorage.setItem('active_project_id', projectId);
            alert('Vault Secured. Progress Saved.');
        } catch (err) {
            console.error(err);
            alert("Failed to save to vault: " + err.message);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerText = 'Save Progress';
            }
        }
    }

    async saveAndDownloadPDF() {
        const doneBtn = document.getElementById('done-btn');
        try {
            if (doneBtn) doneBtn.innerText = 'Saving...';
            const pdfBytes = await this.generateModifiedPdf();
            if (!pdfBytes) return;
            const storage = new StorageManager();
            const fileName = (await storage.getFileName()) || 'edited_document.pdf';
            this.downloadBlob(pdfBytes, fileName, 'application/pdf');
        } catch (err) {
            console.error(err);
            alert("Failed to save PDF: " + err.message);
        } finally {
            if (doneBtn) doneBtn.innerText = 'Done';
        }
    }

    /**
     * CRITICAL FLATTENING ENGINE
     * Reconstructs the PDF by overlaying HTML annotations onto the PDF structure.
     * 1. Creates a destination PDF.
     * 2. Iterates over all view pages.
     * 3. If original page exists, copies it; else creates new blank page.
     * 4. "Burns" images, drawings, and text onto the PDF page using `pdf-lib`.
     */
    async generateModifiedPdf() {
        if (!window.PDFLib) return null;
        const { PDFDocument, rgb } = window.PDFLib;
        const pages = document.querySelectorAll('.pdf-page-wrapper');
        if (pages.length === 0) return null;

        // Load Source
        let sourcePdfDoc;
        const storage = new StorageManager();
        const existingPdfBytes = await storage.getPdf();
        if (existingPdfBytes) sourcePdfDoc = await PDFDocument.load(existingPdfBytes);
        else sourcePdfDoc = await PDFDocument.create();

        // Create Dest
        const pdfDoc = await PDFDocument.create();
        const currentPages = document.querySelectorAll('.pdf-page-wrapper');

        for (let i = 0; i < currentPages.length; i++) {
            const wrapper = currentPages[i];
            let pdfPage;
            const originalIndex = parseInt(wrapper.dataset.originalPageIndex);

            // A. Copy Original or Create New
            if (!isNaN(originalIndex) && originalIndex >= 0) {
                const [copiedPage] = await pdfDoc.copyPages(sourcePdfDoc, [originalIndex]);
                pdfPage = pdfDoc.addPage(copiedPage);
            } else {
                const w = parseFloat(wrapper.style.width) || 595, h = parseFloat(wrapper.style.height) || 842;
                pdfPage = pdfDoc.addPage([w, h]);
                pdfPage.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(1, 1, 1) });
            }

            const { width, height } = pdfPage.getSize();
            // Scaling factors (PDF Points vs HTML Pixels)
            const wrapperRect = wrapper.getBoundingClientRect();
            const wrapperWidth = parseFloat(wrapper.style.width), wrapperHeight = parseFloat(wrapper.style.height);
            const scaleX = width / wrapperWidth, scaleY = height / wrapperHeight;

            // B. BURN IMAGES
            const imageElements = wrapper.querySelectorAll('.image-wrapper');
            for (const imgEl of imageElements) {
                const canvas = imgEl.querySelector('canvas');
                if (!canvas) continue;

                // Position Coords (PDF Lib logic: Y is origin bottom-left, HTML is top-left)
                const left = parseFloat(imgEl.style.left), top = parseFloat(imgEl.style.top), imgWidth = parseFloat(imgEl.style.width), imgHeight = parseFloat(imgEl.style.height);
                const pdfX = left * scaleX, pdfY = height - ((top + imgHeight) * scaleY);

                // Convert to PNG bytes
                const imgDataUrl = canvas.toDataURL('image/png');
                const imgBytes = await fetch(imgDataUrl).then(res => res.arrayBuffer());
                const embeddedImage = await pdfDoc.embedPng(imgBytes);

                pdfPage.drawImage(embeddedImage, {
                    x: pdfX,
                    y: pdfY,
                    width: imgWidth * scaleX,
                    height: imgHeight * scaleY,
                    opacity: parseFloat(canvas.style.opacity) || 1
                });

                // Convert dataset.link to actual PDF Hyperlink
                const linkUrl = imgEl.dataset.link;
                if (linkUrl) {
                    const linkAnnotation = pdfDoc.context.register(pdfDoc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [pdfX, pdfY, pdfX + (imgWidth * scaleX), pdfY + (imgHeight * scaleY)], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: linkUrl } }));
                    const annots = pdfPage.node.Annots();
                    if (annots) annots.push(linkAnnotation);
                    else pdfPage.node.set(window.PDFLib.PDFName.of('Annots'), pdfDoc.context.obj([linkAnnotation]));
                }
            }

            // C. BURN DRAWINGS (Combine layers into one Composite Canvas)
            const widthPx = Math.ceil(wrapperWidth), heightPx = Math.ceil(wrapperHeight);
            const compositeCanvas = document.createElement('canvas');
            compositeCanvas.width = widthPx; compositeCanvas.height = heightPx;
            const ctx = compositeCanvas.getContext('2d');

            ['highlighter', 'pencil', 'arrow', 'whiteout'].forEach(ln => {
                const l = wrapper.querySelector('.' + ln + '-layer');
                if (l) ctx.drawImage(l, 0, 0, widthPx, heightPx);
            });

            const cd = compositeCanvas.toDataURL('image/png');
            if (cd.length > 500) { // If not blank
                try {
                    const db = await fetch(cd).then(r => r.arrayBuffer());
                    const ed = await pdfDoc.embedPng(db);
                    pdfPage.drawImage(ed, { x: 0, y: 0, width, height }); // Overlay full page drawing
                } catch (e) { }
            }

            // D. BURN NEW TEXT
            const helveticaFont = await pdfDoc.embedStandardFont(window.PDFLib.StandardFonts.Helvetica);
            for (const txtEl of wrapper.querySelectorAll('.text-wrapper')) {
                const contentDiv = txtEl.querySelector('.text-content'); if (!contentDiv) continue;
                const style = window.getComputedStyle(contentDiv), fontSize = parseFloat(style.fontSize) * scaleY;
                const rect = txtEl.getBoundingClientRect(), pdfX_box = (rect.left - wrapperRect.left) * scaleX, pdfY_box = height - ((rect.top - wrapperRect.top + rect.height) * scaleY), pdfW = rect.width * scaleX, pdfH = rect.height * scaleY;

                // Background
                const bgColorHex = Utils.rgbToHex(style.backgroundColor);
                if (bgColorHex && bgColorHex !== 'transparent') { const c = Utils.hexToPdfRgb(bgColorHex); pdfPage.drawRectangle({ x: pdfX_box, y: pdfY_box, width: pdfW, height: pdfH, color: rgb(c.r, c.g, c.b) }); }

                // Text Content (Multiline Support + WinAnsi Fix)
                const textColor = Utils.hexToPdfRgb(Utils.rgbToHex(style.color));
                const text = contentDiv.innerText || "";
                const lines = text.split('\n');
                const lineHeight = fontSize * 1.1;

                // Start drawing from top of box
                let curY = pdfY_box + pdfH - fontSize;

                // Simple Vertical Alignment (Only adjust if more than 1 line or centered)
                const totalH = lines.length * lineHeight;
                if (style.justifyContent === 'center') curY = pdfY_box + (pdfH + totalH) / 2 - fontSize;
                else if (style.justifyContent === 'flex-end') curY = pdfY_box + totalH - (fontSize * 0.2);

                lines.forEach(line => {
                    // WinAnsi filtering: keep only basic Latin and extended Latin characters
                    const cleanLine = line.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
                    if (cleanLine.length === 0 && lines.length > 1) { curY -= lineHeight; return; }

                    try {
                        const tw = helveticaFont.widthOfTextAtSize(cleanLine, fontSize);
                        let dx = pdfX_box;
                        if (style.alignItems === 'center') dx = pdfX_box + (pdfW - tw) / 2;
                        else if (style.alignItems === 'flex-end') dx = pdfX_box + (pdfW - tw);

                        pdfPage.drawText(cleanLine, { x: dx, y: curY, size: fontSize, font: helveticaFont, color: rgb(textColor.r, textColor.g, textColor.b), maxWidth: pdfW });
                    } catch (e) {
                        console.error("PDF: Line Render Error", e);
                    }
                    curY -= lineHeight;
                });
            }

            // E. BURN EDITED TEXT
            for (const span of wrapper.querySelectorAll('.pdflib-edited-text')) {
                const style = window.getComputedStyle(span), fontSize = parseFloat(style.fontSize), text = span.innerText;
                const spanRect = span.getBoundingClientRect(), pdfX = (spanRect.left - wrapperRect.left) * scaleX, pdfY = height - ((spanRect.top - wrapperRect.top + spanRect.height) * scaleY), pdfW = spanRect.width * scaleX, pdfH = spanRect.height * scaleY;
                let bgRgb = rgb(1, 1, 1);
                const bgHex = Utils.rgbToHex(style.backgroundColor);
                if (bgHex && bgHex !== '#ffffff') { const c = Utils.hexToPdfRgb(bgHex); bgRgb = rgb(c.r, c.g, c.b); }
                pdfPage.drawRectangle({ x: pdfX, y: pdfY, width: pdfW, height: pdfH, color: bgRgb });
                const c = Utils.hexToPdfRgb(Utils.rgbToHex(style.color));

                // WinAnsi Fix for edited text spans (rare but possible to have newlines)
                const lines = text.split('\n');
                let curLineY = pdfY + (pdfH * 0.2);
                lines.forEach(line => {
                    const cleanLine = line.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
                    pdfPage.drawText(cleanLine, { x: pdfX, y: curLineY, size: fontSize * scaleY, color: rgb(c.r, c.g, c.b), maxWidth: pdfW + 10 });
                    curLineY -= (fontSize * scaleY * 1.1);
                });
            }
        }
        return await pdfDoc.save();
    }

    isCanvasBlank(canvas) {
        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const w = canvas.width, h = canvas.height;
            if (w === 0 || h === 0) return true;
            const data = ctx.getImageData(0, 0, w, h).data;
            for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) return false; }
            return true;
        } catch (e) { return false; }
    }

    hasTransparency(canvas) {
        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const w = canvas.width, h = canvas.height;
            if (w === 0 || h === 0) return false;
            const data = ctx.getImageData(0, 0, w, h).data;
            for (let i = 3; i < data.length; i += 4) { if (data[i] < 255) return true; }
            return false;
        } catch (e) { return true; }
    }

    downloadBlob(data, filename, type) {
        const blob = new Blob([data], { type: type });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none'; a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        window.URL.revokeObjectURL(url); a.remove();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.editorApp = new PDFEditor();
});
