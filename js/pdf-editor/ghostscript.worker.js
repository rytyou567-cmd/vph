/**
 * ghostscript.worker.js
 * 
 * ROLE:
 * Dedicated Web Worker for running the heavy Ghostscript WASM executable off the main thread.
 * 
 * WORKFLOW:
 * 1. Initializes the Emscripten-compiled Ghostscript module (`libgs.js`).
 * 2. Receives a 'compress' command with raw PDF data.
 * 3. Writes the data to the WASM Virtual File System (MEMFS).
 * 4. Executes the Ghostscript command-line arguments via `callMain()` (e.g., -dPDFSETTINGS=/screen).
 * 5. Reads the generated output file from MEMFS.
 * 6. Cleans up virtual files and sends the result back to the main thread.
 */

// Import the Emscripten-compiled library
// Path is relative to this worker file (public/js/pdf-editor/ghostscript.worker.js)
importScripts('../vendor/ghostscript/libgs.js');

let moduleInstance = null;

async function initModule() {
    if (moduleInstance) return;

    return new Promise((resolve, reject) => {
        const config = {
            locateFile: (path) => {
                // Determine absolute path for .wasm file
                // self.location.href is .../pdf-editor/ghostscript.worker.js
                // We want .../vendor/ghostscript/libgs.wasm
                if (path.endsWith('.wasm')) {
                    // Go up two levels from pdf-editor to js, then into vendor/ghostscript
                    return '../vendor/ghostscript/libgs.wasm';
                }
                return path;
            },
            print: (text) => console.log('[GS-Worker]', text),
            printErr: (text) => console.warn('[GS-Worker-ERR]', text),
            noInitialRun: true,
            noExitRuntime: true // Keep runtime alive for this session
        };

        // libgs.js adds 'Module' to global scope (self.Module) or returns it?
        // It usually defines 'Module' var.
        if (typeof Module === 'function') {
            Module(config).then(m => {
                moduleInstance = m;
                resolve();
            });
        } else {
            reject(new Error("Ghostscript Module not found in worker"));
        }
    });
}


self.onmessage = async (e) => {
    const { action, id, data, quality } = e.data;

    // --- ACTION: COMPRESS ---
    if (action === 'compress') {
        try {
            // Ensure WASM module is ready
            await initModule();

            const FS = moduleInstance.FS;
            // Use random filenames to ensure isolation in MEMFS if worker reuse were enabled
            const inputName = `/input_${Date.now()}.pdf`;
            const outputName = `/output_${Date.now()}.pdf`;

            // 1. Prepare Data (Convert Base64/String to Uint8Array if needed)
            let dataBytes;
            if (typeof data === 'string') {
                // Base64 or DataURL
                let base64 = data;
                if (data.startsWith('data:')) base64 = data.split(',')[1];
                const binaryString = atob(base64);
                const len = binaryString.length;
                dataBytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    dataBytes[i] = binaryString.charCodeAt(i);
                }
            } else {
                dataBytes = new Uint8Array(data);
            }

            // 2. Write File
            FS.writeFile(inputName, dataBytes);

            // 3. Exec
            const args = [
                '-sDEVICE=pdfwrite',
                `-dPDFSETTINGS=${quality}`,
                '-dCompatibilityLevel=1.4',
                '-dNOPAUSE',
                '-dQUIET',
                '-dBATCH',
                `-sOutputFile=${outputName}`,
                inputName
            ];

            try {
                moduleInstance.callMain(args);
            } catch (runErr) {
                // Ignore exit status
            }

            // 4. Read Output
            let output = null;
            try {
                output = FS.readFile(outputName);
            } catch (err) {
                throw new Error("Output file not generated");
            }

            // 5. Cleanup
            try { FS.unlink(inputName); } catch (z) { }
            try { FS.unlink(outputName); } catch (z) { }

            // Send back (Transferable for zero-copy if possible, but Uint8Array needs buffer)
            self.postMessage({
                status: 'done',
                id,
                result: output
            }, [output.buffer]); // Transfer buffer ownership

        } catch (error) {
            self.postMessage({ status: 'error', id, error: error.message });
        }
    }
};
