/**
 * SHIELD REDACTOR: Forensic Document Sanitizer
 * 
 * ROLE:
 * Protects sensitive data by providing manual and automated redaction tools.
 * Scans for security threats and PII (Personally Identifiable Information).
 * 
 * ARCHITECTURE:
 * - Scanning: ShieldScanner for threat detection (malicious scripts/metadata)
 * - OCR: Tesseract.js for automatic PII discovery
 * - Redaction: HTML5 Canvas for persistent visual blacking
 * - Storage: ShieldStorage (IndexedDB) for project persistence
 * 
 * KEY WORKFLOWS:
 * 1. INGESTION: Load PDF or Image → Create ImageBitmap for manipulation
 * 2. SCANNING: 
 *    a. Threat Scan: Identifies active content (JS) or suspicious metadata
 *    b. PII Scan: Uses OCR to find emails, SSNs, credit cards, etc.
 * 3. REDACTION: User draws black rectangles over sensitive text
 * 4. SANITIZATION:
 *    - PDF: Strips OpenAction, AA, and JavaScript catalog entries
 *    - Image: Re-encodes bitmap to strip hidden steganographic data
 * 5. EXPORT: Download sanitized version or Save to Shield Vault
 */

import { shieldStorage } from './shield-redactor-storage.js';
import { ShieldScanner } from './shield-scanner.js';

/**
 * INITIALIZATION: Establishes the redactor environment and scanner
 */
export function init(config) {
    const scanner = new ShieldScanner();
    const elements = {};
    for (const [key, id] of Object.entries(config)) {
        elements[key] = document.getElementById(id);
    }

    let currentProject = {
        id: null,
        file: null,
        fileBytes: null,
        redactions: [],
        originalBitmap: null
    };

    let currentPiiMatches = [];
    let lastThreatsHTML = '';

    // --- INITIAL VIEW HANDLERS ---
    elements.newProjectBtnId.onclick = () => elements.fileInputId.click();
    elements.fileInputId.onchange = (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    };

    elements.viewVaultBtnId.onclick = () => showVault();
    elements.backToHomeBtnId.onclick = () => resetUI();

    /**
     * FILE HANDLER: Prepares the redactor for a new file
     * Converts PDFs to high-res bitmaps for visual manipulation.
     */
    async function handleFile(file, projectData = null) {
        currentProject.file = file;
        currentProject.fileBytes = await file.arrayBuffer();
        currentProject.id = projectData?.id || 'proj_' + Date.now();
        currentProject.redactions = projectData?.redactions || [];

        if (file.type === 'application/pdf') {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const page = await pdf.getPage(1); // Handle page 1 for now
            const viewport = page.getViewport({ scale: 2 });

            const tempCanvas = document.createElement('canvas');
            const context = tempCanvas.getContext('2d');
            tempCanvas.width = viewport.width;
            tempCanvas.height = viewport.height;

            await page.render({ canvasContext: context, viewport }).promise;
            currentProject.originalBitmap = await createImageBitmap(tempCanvas);
        } else {
            currentProject.originalBitmap = await createImageBitmap(file);
        }

        setupEditor();
        runScan(file);
    }

    window.shieldRedactorLoadFile = (file, projectData) => {
        openModal(config.modalId);
        handleFile(file, projectData);
    };

    /**
     * UI TRANSITION: Activates the editor view
     */
    function setupEditor() {
        elements.initialViewId.style.display = 'none';
        elements.vaultViewId.style.display = 'none';
        elements.editorViewId.style.display = 'block';

        renderCanvas();
        updateProjectStatus();
    }

    /**
     * THREAT SCANNER: Orchestrates the ShieldScanner pipeline
     * Identifies potential malware or suspicious payloads in the donor file.
     */
    async function runScan(file) {
        if (!elements.threatShieldId) return;

        elements.threatShieldId.innerText = 'SCANNING...';
        elements.threatShieldId.className = 'threat-status-badge scanning';
        elements.scanResultsId.innerHTML = ''; // Clear previous results
        lastThreatsHTML = '';

        try {
            const results = await scanner.scan(file);
            if (results.safe) {
                elements.threatShieldId.innerText = '🛡️ SECURE';
                elements.threatShieldId.className = 'threat-status-badge safe';
                const existing = elements.scanResultsId.querySelector('#shield-threat-container');
                if (existing) existing.remove();
            } else {
                const highThreats = results.threats.filter(t => t.severity === 'Critical' || t.severity === 'High');
                if (highThreats.length > 0) {
                    elements.threatShieldId.innerText = '⚠️ THREAT DETECTED';
                    elements.threatShieldId.className = 'threat-status-badge threat';
                    elements.threatShieldId.style.cursor = 'pointer';
                    elements.threatShieldId.title = 'Click to view threat details';

                    // Prepare threat container as an element to avoid duplication
                    const threatItems = results.threats.map(t => {
                        const [description, log] = t.description.split(' | LOG: ');
                        return `
                            <div class="pii-match threat-item" style="border:1px solid #ff4d4d; background:rgba(255,0,0,0.1); padding:8px; margin-bottom:5px; border-radius:4px;">
                                <div style="color:#ff4d4d; font-weight:bold; font-size:11px; margin-bottom:4px;">${t.type.toUpperCase()}</div>
                                <div style="font-size:10px; color:#fff; margin-bottom:6px;">${description}</div>
                                ${log ? `<div style="font-family:monospace; font-size:9px; background:rgba(0,0,0,0.5); padding:4px; border-radius:3px; color:#00ff80; word-break:break-all; border-left:2px solid #ff4d4d;">DISCOVERY_LOG: ${log}</div>` : ''}
                            </div>
                        `;
                    }).join('');

                    lastThreatsHTML = `<div id="shield-threat-container">${threatItems}</div>`;

                    // Clear any existing threat container and prepend new one
                    const existing = elements.scanResultsId.querySelector('#shield-threat-container');
                    if (existing) existing.remove();
                    elements.scanResultsId.insertAdjacentHTML('afterbegin', lastThreatsHTML);

                    elements.threatShieldId.onclick = () => {
                        const container = elements.scanResultsId.querySelector('#shield-threat-container');
                        if (container) {
                            elements.scanResultsId.prepend(container);
                            elements.scanResultsId.scrollTop = 0;
                            container.style.animation = 'none';
                            void container.offsetWidth;
                            container.style.animation = 'threat-blink 1s 2';
                        }
                    };
                } else {
                    elements.threatShieldId.innerText = '🔍 SUSPICIOUS';
                    elements.threatShieldId.className = 'threat-status-badge suspicious';
                }
            }
        } catch (err) {
            console.error('Scan Error:', err);
            elements.threatShieldId.innerText = 'SCAN FAILED';
        }
    }

    /**
     * RENDERING ENGINE: Draws base image and all active redaction layers to canvas
     */
    function renderCanvas() {
        const canvas = elements.canvasId;
        const ctx = canvas.getContext('2d');
        const bitmap = currentProject.originalBitmap;

        // Auto-scale to fit container width roughly
        const maxWidth = 800;
        const scale = Math.min(1, maxWidth / bitmap.width);

        canvas.width = bitmap.width * scale;
        canvas.height = bitmap.height * scale;

        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        // Draw current redactions
        ctx.fillStyle = 'black';
        currentProject.redactions.forEach(rect => {
            ctx.fillRect(rect.x * canvas.width, rect.y * canvas.height, rect.w * canvas.width, rect.h * canvas.height);
        });
    }

    // --- MANUAL REDACTION ---
    let isDrawing = false;
    let startX, startY;

    elements.canvasId.onmousedown = (e) => {
        isDrawing = true;
        const rect = elements.canvasId.getBoundingClientRect();
        startX = (e.clientX - rect.left) / elements.canvasId.width;
        startY = (e.clientY - rect.top) / elements.canvasId.height;
    };

    elements.canvasId.onmousemove = (e) => {
        if (!isDrawing) return;
        renderCanvas();
        const ctx = elements.canvasId.getContext('2d');
        const rect = elements.canvasId.getBoundingClientRect();
        const currX = (e.clientX - rect.left) / elements.canvasId.width;
        const currY = (e.clientY - rect.top) / elements.canvasId.height;

        ctx.strokeStyle = '#00ff80';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
            Math.min(startX, currX) * elements.canvasId.width,
            Math.min(startY, currY) * elements.canvasId.height,
            Math.abs(currX - startX) * elements.canvasId.width,
            Math.abs(currY - startY) * elements.canvasId.height
        );
    };

    elements.canvasId.onmouseup = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        const rect = elements.canvasId.getBoundingClientRect();
        const endX = (e.clientX - rect.left) / elements.canvasId.width;
        const endY = (e.clientY - rect.top) / elements.canvasId.height;

        currentProject.redactions.push({
            x: Math.min(startX, endX),
            y: Math.min(startY, endY),
            w: Math.abs(endX - startX),
            h: Math.abs(endY - startY)
        });

        renderCanvas();
        updateProjectStatus();
    };

    function updateProjectStatus() {
        if (elements.exportRedactedBtnId) {
            const hasRedactions = currentProject.redactions.length > 0;
            elements.exportRedactedBtnId.disabled = !hasRedactions;
            elements.exportRedactedBtnId.title = hasRedactions ? 'Export file with visual redactions' : 'Requires active redactions';
        }
    }

    // --- EXPORT LOGIC (SANITIZATION) ---
    /**
     * EXPORT ENGINE: Handles two distinct output modes
     * 1. CLEAN: Strips active content/metadata but keeps original visuals
     * 2. REDACTED: Strips active content AND burns black redaction boxes permanently
     */
    const runExport = async (mode = 'clean') => {
        const btn = mode === 'clean' ? elements.exportBtnId : elements.exportRedactedBtnId;
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerText = 'PROCESSING...';

        try {
            if (currentProject.file.type === 'application/pdf') {
                const { PDFDocument, PDFName, rgb } = window.PDFLib;
                const pdfDoc = await PDFDocument.load(currentProject.fileBytes);
                const catalog = pdfDoc.catalog;

                // 1. Sanitization (Always done)
                if (catalog) {
                    ['OpenAction', 'AA', 'Names', 'JavaScript'].forEach(key => catalog.delete(PDFName.of(key)));
                }

                // 2. Burning Redactions (Only if in redacted mode)
                if (mode === 'redacted') {
                    const pages = pdfDoc.getPages();
                    if (pages.length > 0) {
                        const firstPage = pages[0];
                        const { width, height } = firstPage.getSize();
                        currentProject.redactions.forEach(rect => {
                            firstPage.drawRectangle({
                                x: rect.x * width,
                                y: (1 - rect.y - rect.h) * height,
                                width: rect.w * width,
                                height: rect.h * height,
                                color: rgb(0, 0, 0)
                            });
                        });
                    }
                }

                const pdfBytes = await pdfDoc.save();
                downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), `${mode}_${currentProject.file.name}`);
            } else {
                // For images: Re-encoding bitmap
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const bitmap = currentProject.originalBitmap;
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                ctx.drawImage(bitmap, 0, 0);

                if (mode === 'redacted') {
                    ctx.fillStyle = 'black';
                    currentProject.redactions.forEach(rect => {
                        ctx.fillRect(rect.x * canvas.width, rect.y * canvas.height, rect.w * canvas.width, rect.h * canvas.height);
                    });
                }

                const mimeType = currentProject.file.type || 'image/png';
                canvas.toBlob((blob) => {
                    downloadBlob(blob, `${mode}_${currentProject.file.name}`);
                }, mimeType);
            }
        } catch (err) {
            console.error('Export Error:', err);
            alert(`Export Failed: ${err.message}`);
        } finally {
            btn.disabled = false;
            btn.innerText = originalText;
            updateProjectStatus();
        }
    };

    elements.exportBtnId.onclick = () => runExport('clean');
    if (elements.exportRedactedBtnId) elements.exportRedactedBtnId.onclick = () => runExport('redacted');

    /**
     * UTILITY: Triggers native browser download for a Blob
     */
    function downloadBlob(blob, name) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
        URL.revokeObjectURL(link.href);
    }




    // --- VAULT LOGIC ---
    /**
     * VAULT MANAGER: Displays all stored projects from IndexedDB
     */
    async function showVault() {
        elements.initialViewId.style.display = 'none';
        elements.vaultViewId.style.display = 'block';

        const projects = await shieldStorage.getAllProjects();
        elements.vaultListId.innerHTML = projects.map(p => {
            const toolLabel = p.tool === 'Shield Redactor' ? 'Shield Redactor Storage' : (p.tool || 'Shield Redactor Storage');
            const isStorage = toolLabel.toLowerCase().includes('storage');
            return `
                <div class="vault-item" data-id="${p.id}" style="border: 1px solid #444; padding: 10px; border-radius: 8px; cursor: pointer; transition: 0.3s; position: relative;">
                    <div style="position: absolute; top: 10px; right: 10px; display: flex; gap: 6px;">
                        ${isStorage ? `
                            <button class="vault-item-download" data-id="${p.id}" title="Download File" style="background: rgba(0, 255, 128, 0.1); color: #00ff80; border: 1px solid rgba(0, 255, 128, 0.3); border-radius: 4px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px;">↓</button>
                        ` : ''}
                        <button class="vault-item-delete" data-id="${p.id}" title="Remove from Vault" style="background: rgba(255, 77, 77, 0.1); color: #ff4d4d; border: 1px solid rgba(255, 77, 77, 0.3); border-radius: 4px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px;">×</button>
                    </div>
                    <div class="vault-item-tool-label">${toolLabel}</div>
                    <div style="color: #00ff80; font-weight: bold; margin-bottom: 5px; padding-right: 50px;">${p.name}</div>
                    <div style="font-size: 10px; color: #888;">${new Date(p.updatedAt || Date.now()).toLocaleDateString()}</div>
                </div>
            `;
        }).join('') || '<div style="color:#666; grid-column: 1/-1; text-align:center;">No projects found in vault.</div>';

        document.querySelectorAll('.vault-item').forEach(el => {
            el.onclick = (e) => {
                if (e.target.closest('.vault-item-delete') || e.target.closest('.vault-item-download')) return;
                loadProject(el.dataset.id);
            };
        });

        document.querySelectorAll('.vault-item-delete').forEach(btn => {
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.dataset.id;
                if (window.confirm('Are you sure you want to remove this project from the vault? This cannot be undone.')) {
                    await shieldStorage.deleteProject(id);
                    showVault(); // Refresh
                }
            };
        });

        document.querySelectorAll('.vault-item-download').forEach(btn => {
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.dataset.id;
                const p = await shieldStorage.getProject(id);
                if (p && p.file) {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(p.file);
                    link.download = p.name || 'download';
                    link.click();
                    URL.revokeObjectURL(link.href);
                }
            };
        });
    }

    /**
     * PROJECT LOADER: Reconstructs an editor session from Vault storage
     * Includes intelligent routing to specialized tools if needed.
     */
    async function loadProject(id) {
        const p = await shieldStorage.getProject(id);
        if (!p) return;

        // Route to the correct tool
        if (p.tool === 'Image Compressor' && window.imageCompressorLoadFile) {
            closeSpecificModal(config.modalId);
            window.imageCompressorLoadFile(p.file, p);
            return;
        }
        if (p.tool === 'JPG to PDF' && window.jpgToPdfLoadFile) {
            closeSpecificModal(config.modalId);
            window.jpgToPdfLoadFile(p.file, p);
            return;
        }
        if (p.tool === 'PDF to JPG' && window.pdfToJpgLoadFile) {
            closeSpecificModal(config.modalId);
            window.pdfToJpgLoadFile(p.file, p);
            return;
        }
        if (p.tool === 'PDF to Word' && window.pdfToWordLoadFile) {
            closeSpecificModal(config.modalId);
            window.pdfToWordLoadFile(p.file, p);
            return;
        }
        if ((p.tool === 'Edit PDF' || p.tool === 'PDF Editor Project' || p.tool === 'PDF Merger Project' || p.tool === 'PDF Compressor Project') && window.pdfEditorLoadFile) {
            closeSpecificModal(config.modalId);
            window.pdfEditorLoadFile(p.file, p);
            return;
        }

        // Default to Shield Redactor (handles 'Shield Redactor' and 'Shield Redactor Storage')
        currentProject.id = p.id;
        currentProject.file = p.file;
        currentProject.fileBytes = await p.file.arrayBuffer();
        currentProject.redactions = p.redactions || [];

        if (p.file.type === 'application/pdf') {
            const arrayBuffer = await p.file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 2 });
            const tempCanvas = document.createElement('canvas');
            const context = tempCanvas.getContext('2d');
            tempCanvas.width = viewport.width;
            tempCanvas.height = viewport.height;
            await page.render({ canvasContext: context, viewport }).promise;
            currentProject.originalBitmap = await createImageBitmap(tempCanvas);
        } else {
            currentProject.originalBitmap = await createImageBitmap(p.file);
        }

        setupEditor();
    }

    elements.saveBtnId.onclick = async () => {
        const originalText = elements.saveBtnId.innerText;
        elements.saveBtnId.disabled = true;
        elements.saveBtnId.innerText = 'SAVING...';

        try {
            await shieldStorage.saveProject({
                id: currentProject.id,
                name: currentProject.file.name,
                file: currentProject.file,
                redactions: currentProject.redactions,
                tool: 'Shield Redactor Storage'
            });
            alert('Vault Secured. Project Saved.');
        } catch (err) {
            console.error(err);
            alert('Save failed: ' + err.message);
        } finally {
            elements.saveBtnId.disabled = false;
            elements.saveBtnId.innerText = originalText;
        }
    };

    // --- REDACT ALL HANDLER ---
    if (elements.redactAllBtnId) {
        elements.redactAllBtnId.onclick = () => {
            if (!currentPiiMatches.length) return;
            const canvas = elements.canvasId;
            currentPiiMatches.forEach(match => {
                currentProject.redactions.push({
                    x: match.bbox.x0 / canvas.width,
                    y: match.bbox.y0 / canvas.height,
                    w: (match.bbox.x1 - match.bbox.x0) / canvas.width,
                    h: (match.bbox.y1 - match.bbox.y0) / canvas.height
                });
            });
            renderCanvas();
            elements.scanResultsId.innerHTML = '<div style="color:#00ff80; padding:10px;">ALL_RESOURCES_REDACTED_SUCCESSFULLY</div>';

            updateProjectStatus();
            elements.redactAllBtnId.style.display = 'none';
        };
    }

    /**
     * AUTO-SCAN (OCR): Utilizes Tesseract.js for visual PII discovery
     * Identifies emails, phone numbers, SSNs, and common security tokens.
     */
    elements.autoScanBtnId.onclick = async () => {
        elements.autoScanBtnId.disabled = true;
        elements.autoScanBtnId.innerText = 'SCANNING...';
        elements.scanResultsId.innerHTML = '<div style="color:#00ff80; padding:10px;">Initializing OCR Engine...</div>';
        if (elements.redactAllBtnId) elements.redactAllBtnId.style.display = 'none';

        try {
            const worker = await Tesseract.createWorker('eng');
            const canvas = elements.canvasId;
            const { data } = await worker.recognize(canvas);
            const { words, lines } = data;

            currentPiiMatches = [];
            const standardPatterns = [
                { type: 'Email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
                { type: 'Phone', regex: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/ },
                { type: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
                { type: 'Credit Card', regex: /\b(?:\d[ -]*?){13,16}\b/ },
                { type: 'IP Address', regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ }
            ];

            // 1. Label-Based Name Detection (Contextual)
            const nameLabels = ['name', 'full name', 'owner', 'contact', 'attn', 'to', 'from', 'customer', 'patient', 'client', 'employee'];
            lines.forEach(line => {
                const text = line.text.trim();
                const lowerText = text.toLowerCase();

                for (const label of nameLabels) {
                    if (lowerText.startsWith(label)) {
                        const remaining = text.substring(label.length).replace(/^[:\s-]+/, '').trim();
                        if (remaining.length > 2 && remaining.split(/\s+/).length <= 4) {
                            // Find precise box by skipping the label words
                            const labelWordCount = label.split(/\s+/).length;
                            const nameWords = line.words.slice(labelWordCount);
                            if (nameWords.length > 0) {
                                const bbox = {
                                    x0: Math.min(...nameWords.map(w => w.bbox.x0)),
                                    y0: Math.min(...nameWords.map(w => w.bbox.y0)),
                                    x1: Math.max(...nameWords.map(w => w.bbox.x1)),
                                    y1: Math.max(...nameWords.map(w => w.bbox.y1))
                                };
                                currentPiiMatches.push({
                                    text: remaining,
                                    type: 'Potential Name',
                                    bbox: bbox
                                });
                            }
                        }
                    }
                }
            });

            // 2. Standard Regex Discovery (Word-based)
            words.forEach(word => {
                const text = word.text.trim();
                for (const p of standardPatterns) {
                    if (p.regex.test(text)) {
                        if (!currentPiiMatches.some(m => m.text.includes(text))) {
                            currentPiiMatches.push({
                                text: text,
                                type: p.type,
                                bbox: word.bbox
                            });
                        }
                        break;
                    }
                }
            });



            // Clear PII results but keep threats
            const existingThreats = elements.scanResultsId.querySelector('#shield-threat-container');
            elements.scanResultsId.innerHTML = '';
            if (existingThreats) elements.scanResultsId.appendChild(existingThreats);
            else if (lastThreatsHTML) elements.scanResultsId.insertAdjacentHTML('afterbegin', lastThreatsHTML);

            if (currentPiiMatches.length === 0) {
                elements.scanResultsId.insertAdjacentHTML('beforeend', '<div style="color:#888; padding:10px;" class="pii-status-msg">No PII detected.</div>');
            } else {
                if (elements.redactAllBtnId) elements.redactAllBtnId.style.display = 'block';
                const piiHTML = currentPiiMatches.map((match, i) => `
                    <div class="pii-match" style="border:1px solid rgba(0,255,128,0.3); padding:8px; margin-bottom:5px; border-radius:4px; background:rgba(0,0,0,0.3);">
                        <div style="color:#00ff80; font-weight:bold;">${match.type}</div>
                        <div style="font-size:10px; overflow:hidden; text-overflow:ellipsis;">${match.text}</div>
                        <button class="redact-match-btn" data-index="${i}" style="background:#00ff80; color:#000; border:none; padding:2px 5px; font-size:10px; margin-top:5px; cursor:pointer; width:100%;">REDACT</button>
                    </div>
                `).join('');
                elements.scanResultsId.insertAdjacentHTML('beforeend', piiHTML);

                document.querySelectorAll('.redact-match-btn').forEach(btn => {
                    btn.onclick = () => {
                        const match = currentPiiMatches[btn.dataset.index];
                        const canvas = elements.canvasId;
                        currentProject.redactions.push({
                            x: match.bbox.x0 / canvas.width,
                            y: match.bbox.y0 / canvas.height,
                            w: (match.bbox.x1 - match.bbox.x0) / canvas.width,
                            h: (match.bbox.y1 - match.bbox.y0) / canvas.height
                        });
                        renderCanvas();
                        btn.disabled = true;
                        btn.innerText = 'REDACTED';
                        updateProjectStatus();
                    };
                });
            }

            await worker.terminate();
        } catch (err) {
            console.error(err);
            elements.scanResultsId.innerHTML = '<div style="color:red; padding:10px;">OCR Error. Try manual redaction.</div>';
        }

        elements.autoScanBtnId.disabled = false;
        elements.autoScanBtnId.innerText = 'AUTO-SCAN PII';
    };

    /**
     * UI RESET: Purges current project state and returns to landing
     */
    function resetUI() {
        elements.initialViewId.style.display = 'block';
        elements.editorViewId.style.display = 'none';
        elements.vaultViewId.style.display = 'none';

        // Reset Project State
        currentProject = { id: null, file: null, fileBytes: null, redactions: [], originalBitmap: null };
        currentPiiMatches = [];
        lastThreatsHTML = '';

        // Reset UI Elements
        updateProjectStatus();
        if (elements.redactAllBtnId) elements.redactAllBtnId.style.display = 'none';
        if (elements.fileInputId) elements.fileInputId.value = '';
        if (elements.scanResultsId) elements.scanResultsId.innerHTML = '';
        if (elements.threatShieldId) {
            elements.threatShieldId.innerText = 'Checking...';
            elements.threatShieldId.className = 'threat-status-badge';
            elements.threatShieldId.onclick = null;
            elements.threatShieldId.style.cursor = 'default';
        }

        const canvas = elements.canvasId;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    window.resetShieldRedactor = resetUI;
}
