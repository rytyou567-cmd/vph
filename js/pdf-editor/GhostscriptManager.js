/**
 * GhostscriptManager.js
 * 
 * ROLE:
 * Acts as the main-thread bridge/wrapper for WASM-based Ghostscript operations.
 * It manages the lifecycle of the Web Worker, ensuring isolation and preventing main-thread blocking.
 * 
 * WORKFLOW (One-Shot Worker Pattern):
 * 1. `compress()` is called with PDF data.
 * 2. A NEW dedicated Web Worker is spawned (`ghostscript.worker.js`).
 * 3. Data is sent to the worker via `postMessage`.
 * 4. The main thread waits for a response (Promise-based).
 * 5. Upon completion or error, the worker is IMMEDIATELY TERMINATED to free WASM memory.
 * 
 * WHY ONE-SHOT?
 * Ghostscript WASM instances can leak memory or become unstable after multiple runs. 
 * Spawning a fresh worker for each distinct operation guarantees a clean state.
 */
export class GhostscriptManager {
    constructor() {
        this.ready = true; // Always "ready" to spawn a worker
    }

    // No load() needed for main thread anymore, worker handles it.
    async load() {
        return Promise.resolve();
    }

    /**
     * Spawns a worker to compress PDF data using Ghostscript WASM.
     * @param {Uint8Array|string} pdfData - The Input PDF (Bytes or Base64).
     * @param {string} quality - Ghostscript PDFSETTINGS preset (e.g., '/screen', '/ebook', '/printer').
     * @returns {Promise<Uint8Array>} The compressed PDF output bytes.
     */
    async compress(pdfData, quality = '/screen') {
        return new Promise((resolve, reject) => {
            const worker = new Worker('js/pdf-editor/ghostscript.worker.js');

            worker.onmessage = (e) => {
                const { status, result, error } = e.data;

                if (status === 'done') {
                    resolve(result);
                    worker.terminate(); // Free EVERYTHING immediately
                } else if (status === 'error') {
                    reject(new Error(error));
                    worker.terminate();
                }
            };

            worker.onerror = (err) => {
                reject(err);
                worker.terminate();
            };

            // Send data
            // Note: If pdfData is ArrayBuffer, we can transfer it to avoid copy
            let transferList = [];
            if (pdfData instanceof Uint8Array) {
                // Create a copy or transfer buffer if possible? 
                // We shouldn't transfer existingPdfBytes if it's from Storage (might be reused).
                // Let's just clone (structured clone is default).
            }

            worker.postMessage({
                action: 'compress',
                id: Date.now(),
                data: pdfData,
                quality
            });
        });
    }
}
