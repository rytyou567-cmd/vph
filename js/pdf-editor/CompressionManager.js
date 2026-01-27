/**
 * CompressionManager.js
 * 
 * ROLE:
 * Handles "Visual Compression" of PDFs by rasterizing pages into optimized JPEG images.
 * This is a destructive process that converts vector text/graphics into pixels to aggressively reduce file size.
 * 
 * WORKFLOW:
 * 1. Receives original PDF bytes and a target file size (in bytes).
 * 2. Calculates a "Safe Budget" per page (Target Size / Page Count).
 * 3. OPTIMIZATION LOOP:
 *    - Renders Page 1 at various Quality (0.1-0.9) and Scale (0.5-1.5) settings.
 *    - Measures the resulting blob size against the per-page budget.
 *    - Iterates until a fitting configuration is found.
 * 4. RECONSTRUCTION:
 *    - Renders every page of the source PDF to an image using the selected optimization settings.
 *    - Creates a NEW PDF using `pdf-lib`.
 *    - Embeds the optimized JPEGs as pages in the new PDF.
 *    - Returns the rasterized, compressed PDF bytes.
 * 
 * DEPENDENCIES:
 * - pdf.js (Reading/Rendering)
 * - pdf-lib (Writing/Embedding)
 */
export class CompressionManager {
    constructor() {
        // Quality Presets (Used if manual budget calculation is bypassed or as starting points)
        this.presets = {
            excessive: { scale: 1.0, quality: 0.5 }, // "Extreme" - 50% quality
            recommended: { scale: 1.0, quality: 0.7 }, // "Standard" - 70% quality
            high: { scale: 1.0, quality: 0.9 }       // "High Quality" - 90% quality
        };
    }

    /**
     * Compress the PDF by rasterizing each page to an image and rebuilding it.
     * This method effectively "flattens" the PDF, removing editable text but ensuring size reduction.
     * 
     * @param {Uint8Array} originalPdfBytes - The source PDF file content
     * @param {number} targetBytes - The desired output file size in bytes
     * @param {function} progressCallback - (percent) => void for UI updates
     * @returns {Promise<Uint8Array>} The compressed PDF bytes
     */
    async compress(originalPdfBytes, targetBytes, progressCallback) {
        if (!window.pdfjsLib || !window.PDFLib) {
            throw new Error("Required libraries (pdf.js, pdf-lib) not loaded.");
        }

        const { PDFDocument } = window.PDFLib;

        // 1. Load Original PDF using pdf.js to access renderable pages
        const loadingTask = pdfjsLib.getDocument(originalPdfBytes);
        const sourcePdf = await loadingTask.promise;
        const numPages = sourcePdf.numPages;

        // 2. Calculate Budget
        // Use a simple average budget per page.
        // Reserve 10% safety margin for PDF structure overhead (headers, trailers, objects).
        const safeBudget = targetBytes * 0.9;
        const perPageBudget = safeBudget / numPages;

        console.log(`Target: ${targetBytes} bytes. Per Page: ${Math.floor(perPageBudget)} bytes.`);

        // 3. Determine Optimal Settings (Heuristic Analysis on Page 1)
        // We test one page to find parameters that create an image fitting the 'perPageBudget'.
        const testPageNum = 1;
        const testPage = await sourcePdf.getPage(testPageNum);

        let scale = 1.5; // Start with decent resolution (1.5x standard 72dpi view)
        let quality = 0.8; // Start with good JPEG quality

        // Iterative Downsampling Loop
        // Tries to find the highest quality settings that still fit within the budget.
        let bestBlob = null;
        let attempts = 0;

        while (attempts < 5) {
            if (progressCallback) progressCallback(`Analyzing Settings... (${attempts + 1}/5)`);

            // Render page to JPEG blob
            bestBlob = await this._renderPageToBlob(testPage, scale, quality);

            // Check if it fits
            if (bestBlob.size <= perPageBudget) {
                break; // Fits! Stop reducing.
            }

            // Reduce settings if too large
            if (scale > 0.6) {
                scale -= 0.3; // Reduce resolution first
            } else {
                quality -= 0.2; // Then reduce compression quality
                if (quality < 0.1) quality = 0.1; // Hard floor
            }
            attempts++;
        }

        console.log(`Selected Settings: Scale=${scale.toFixed(1)}, Quality=${quality.toFixed(1)}`);


        // 4. Create New Optimized PDF
        // Rebuild the document page by page using the determined settings.
        const newPdf = await PDFDocument.create();

        for (let i = 1; i <= numPages; i++) {
            if (progressCallback) progressCallback(Math.round(((i - 1) / numPages) * 100));

            const page = await sourcePdf.getPage(i);
            const blob = await this._renderPageToBlob(page, scale, quality);

            const imageBytes = await blob.arrayBuffer();
            const embeddedImage = await newPdf.embedJpg(imageBytes);

            const { width, height } = embeddedImage;
            const newPage = newPdf.addPage([width, height]);
            newPage.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: width,
                height: height
            });
        }

        if (progressCallback) progressCallback(100);
        return await newPdf.save();
    }

    /**
     * Helper: Renders a pdf.js page object to a JPEG Blob via an off-screen HTML5 Canvas.
     * @private
     * @param {object} page - The pdf.js page object to render.
     * @param {number} scale - The scale factor for rendering the page (e.g., 1.0 for 100%).
     * @param {number} quality - The JPEG quality (0.0 to 1.0) for the output blob.
     * @returns {Promise<Blob>} A Promise that resolves with the JPEG Blob of the rendered page.
     */
    async _renderPageToBlob(page, scale, quality) {
        const viewport = page.getViewport({ scale: scale });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Render PDF page to canvas
        await page.render({
            canvasContext: ctx,
            viewport: viewport
        }).promise;

        // Export canvas to JPEG Blob
        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                resolve(blob);
            }, 'image/jpeg', quality);
        });
    }
}
