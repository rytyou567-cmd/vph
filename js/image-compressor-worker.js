/**
 * IMAGE COMPRESSOR WEB WORKER
 * 
 * ROLE:
 * Offloads CPU-intensive image encoding to a background thread to prevent UI blocking.
 * Uses JSQuash library for modern, high-performance JPEG/PNG encoding.
 * 
 * ARCHITECTURE:
 * - Runs in isolated Worker thread (no DOM access)
 * - Communicates via postMessage with main thread
 * - Supports transferable objects for zero-copy memory transfer
 * 
 * WORKFLOW:
 * 1. Receives ImageData buffer from main thread
 * 2. Encodes using JSQuash (JPEG with quality or PNG lossless)
 * 3. Returns compressed buffer back to main thread
 */

// Import Modern Encoders (CDN)
import { encode as encodeJpeg } from 'https://unpkg.com/@jsquash/jpeg?module';
import { encode as encodePng } from 'https://unpkg.com/@jsquash/png?module';

/**
 * MESSAGE HANDLER: Worker Entry Point
 * Listens for compression jobs from the main thread.
 * 
 * Expected Message Format:
 * {
 *   id: number,          // Job identifier for tracking
 *   type: 'compress',    // Command type
 *   buffer: ArrayBuffer, // Raw RGBA pixel data
 *   width: number,       // Image width in pixels
 *   height: number,      // Image height in pixels
 *   quality: number,     // JPEG quality (0-100), ignored for PNG
 *   fileType: string     // 'image/jpeg' or 'image/png'
 * }
 */
self.onmessage = async (e) => {
    const { id, type, buffer, width, height, quality, fileType } = e.data;

    if (type === 'compress') {
        try {
            // Reconstruct ImageData from transferred buffer
            const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
            let resultBuffer;

            // Encode based on target format
            if (fileType === 'image/jpeg') {
                // Lossy compression with quality control
                resultBuffer = await encodeJpeg(imageData, { quality });
            } else {
                // Lossless PNG compression (quality ignored)
                resultBuffer = await encodePng(imageData);
            }

            // Send compressed buffer back to main thread
            self.postMessage({
                id,
                success: true,
                buffer: resultBuffer
            });

        } catch (err) {
            // Report encoding failure
            self.postMessage({ id, success: false, error: err.message });
        }
    }
};
