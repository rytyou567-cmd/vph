/**
 * UNIVERSAL FILE UPLOAD HANDLER
 * 
 * ROLE:
 * Central file ingestion point for PDF Editor and all conversion tools.
 * Handles drag/drop, file selection, thumbnail generation, and vault integration.
 * 
 * ARCHITECTURE:
 * - Storage: IndexedDB (via StorageManager) for client-side persistence
 * - Thumbnail: Automatic PDF/Image preview generation
 * - Routing: Stores file then redirects to appropriate tool
 * 
 * KEY WORKFLOWS:
 * 1. INGESTION: Drag/Drop or File Select
 * 2. THUMBNAIL: Generate preview (PDF.js for PDFs, FileReader for images)
 * 3. STORAGE: Save to IndexedDB with filename and project ID
 * 4. NAVIGATION: Redirect to PDF Editor or appropriate tool
 * 5. VAULT INTEGRATION: Tracks active_project_id in sessionStorage for resume
 * 
 * VAULT INTEGRATION:
 * - Project ID tracking prevents duplicate vault entries
 * - Tool name stored for proper labeling ("PDF Editor Project", "Image Compressor", etc.)
 * - File persists across sessions for resume capability
 */

import { StorageManager } from './pdf-editor/StorageManager.js';
import { shieldStorage } from './shield-redactor-storage.js';

const storage = new StorageManager();

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadInitial = document.getElementById('uploadInitial');
const uploadProgress = document.getElementById('uploadProgress');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const cancelBtn = document.getElementById('cancelBtn');
const doneBtn = document.getElementById('doneBtn');
const cancelContainer = document.getElementById('cancelContainer');
const doneContainer = document.getElementById('doneContainer');
const integrationRow = document.getElementById('integrationRow');
const thumbnailContainer = document.getElementById('thumbnailContainer');
const fileThumbnail = document.getElementById('fileThumbnail');
const uploadStatusText = document.getElementById('uploadStatusText');

let itemXHR = null;
let currentProgressInterval = null;
let currentFile = null;
let currentId = null;

// CSRF Token Helper
/**
 * CSRF UTILITY: Retrieves the security token from page metadata
 */
const getCsrfToken = () => {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
};

if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#1e90ff';
        dropZone.style.backgroundColor = '#fcfdff';
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#a0c4ff';
        dropZone.style.backgroundColor = '#fff';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#a0c4ff';
        dropZone.style.backgroundColor = '#fff';
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });

    dropZone.onclick = () => fileInput.click();
}

if (fileInput) {
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFileUpload(fileInput.files[0]);
        }
    });
}

/**
 * UNIVERSAL INGESTION: Handles file receipt, local storage, and routing
 * 
 * WORKFLOW:
 * 1. PERSISTENCE: Save file data to IndexedDB for cross-page retrieval
 * 2. PREVIEW: Generate high-fidelity thumbnails (supports PDF and Image)
 * 3. ROUTING: Identify appropriate tool based on project type
 * 4. PROGRESS: Trigger simulated upload sequence for UI feedback
 */
async function handleFileUpload(file, projectData = null) {
    currentFile = file;
    currentId = projectData?.id || 'proj_' + Date.now();
    sessionStorage.setItem('active_project_id', currentId);

    uploadInitial.style.display = 'none';
    uploadProgress.style.display = 'block';
    if (integrationRow) integrationRow.style.display = 'none';

    // Thumbnail Logic
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            fileThumbnail.src = e.target.result;
            thumbnailContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = function () {
            const typedarray = new Uint8Array(this.result);
            if (window.pdfjsLib) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

                pdfjsLib.getDocument(typedarray).promise.then(function (pdf) {
                    pdf.getPage(1).then(function (page) {
                        const scale = 0.5;
                        const viewport = page.getViewport({ scale: scale });
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        const renderContext = {
                            canvasContext: context,
                            viewport: viewport
                        };

                        page.render(renderContext).promise.then(function () {
                            fileThumbnail.src = canvas.toDataURL();
                            thumbnailContainer.style.display = 'block';
                        });
                    });
                });
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        thumbnailContainer.style.display = 'none';
    }

    // Store file for next page simulation
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            await storage.savePdf(e.target.result);
            await storage.saveFileName(file.name);
            console.log("PDF and FileName Saved to IndexedDB");
        } catch (err) {
            console.error('Storage Error:', err);
            alert("Failed to save file locally.");
        }
    }
    reader.readAsDataURL(file);


    // Determine Tool Name for Vault
    let toolName = projectData?.tool || sessionStorage.getItem('active_pdf_tool') || 'PDF Editor';
    if (!toolName.endsWith(' Project')) toolName += ' Project';
    currentTool = toolName;

    // Simulate upload progress
    let simulatedProgress = 0;
    currentProgressInterval = setInterval(() => {
        simulatedProgress += 5;
        if (simulatedProgress > 100) simulatedProgress = 100;

        progressBar.style.width = simulatedProgress + '%';
        progressText.innerText = simulatedProgress + '%';

        if (simulatedProgress >= 100) {
            clearInterval(currentProgressInterval);
            if (doneContainer) doneContainer.style.display = 'inline-block';
            if (uploadStatusText) {
                uploadStatusText.innerText = 'Uploaded!';
                uploadStatusText.style.color = '#00ff6affff';
                uploadStatusText.style.textShadow = "0 0 20px #00ff6aff";
                progressText.style.color = '#00ff6affff';
                progressText.style.textShadow = "0 0 20px #00ff6aff";
            }
        }
    }, 50);
}

let currentTool = 'PDF Editor Project';


window.pdfEditorLoadFile = (file, projectData) => {
    openModal('uploadModal');
    handleFileUpload(file, projectData);
};

if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
        if (currentProgressInterval) {
            clearInterval(currentProgressInterval);
        }
        resetUpload();
    });
}

if (doneBtn) {
    doneBtn.addEventListener('click', () => {
        window.location.href = 'pdfeditor.html';
    });
}

/**
 * UI RESET: Returns the upload component to its initial listener state
 */
function resetUpload() {
    if (fileInput) fileInput.value = '';
    uploadInitial.style.display = 'block';
    uploadProgress.style.display = 'none';
    if (integrationRow) integrationRow.style.display = 'flex';
    progressBar.style.width = '0%';
    progressText.innerText = '0%';
    if (cancelContainer) cancelContainer.style.display = 'inline-block';
    if (doneContainer) doneContainer.style.display = 'none';
    thumbnailContainer.style.display = 'none';
    fileThumbnail.src = '';
    if (uploadStatusText) uploadStatusText.innerText = 'Uploading...';
    currentFile = null;
    currentId = null;

    // Trigger reset animation
    const card = document.querySelector('#uploadModal .upload-card');
    if (card) {
        card.classList.add('reset-animating');
        setTimeout(() => {
            card.classList.remove('reset-animating');
        }, 600);
    }
}

// Expose reset globally
window.resetMainEditor = resetUpload;
