/**
 * StorageManager.js
 * 
 * ROLE:
 * Manages persistent storage of the PDF file and metadata using IndexedDB.
 * 
 * WHY INDEXEDDB?
 * LocalStorage is limited to ~5MB strings. PDF files can easily exceed this.
 * IndexedDB allows storing large binary Blobs/ArrayBuffers asynchronously.
 * 
 * SCHEMA:
 * DB: 'ViewPortsDB'
 * Store: 'files'
 * Keys: 'currentPdf' (The File), 'currentFileName' (Metadata)
 */
export class StorageManager {
    constructor() {
        this.dbName = 'ViewPortsDB';
        this.storeName = 'files';
        this.db = null;
    }

    async init() {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = (event) => {
                console.error("StorageManager: DB Error", event);
                reject("Could not open database");
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                // Create object store if it doesn't exist (First Run)
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
        });
    }

    /**
     * Save PDF Data (ArrayBuffer or Base64 String)
     * @param {string|ArrayBuffer} data 
     */
    async savePdf(data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(data, 'currentPdf');

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    }

    /**
     * Get PDF Data
     * @returns {Promise<string|ArrayBuffer|null>}
     */
    async getPdf() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get('currentPdf');

            request.onsuccess = (event) => {
                resolve(event.target.result || null);
            };
            request.onerror = (e) => reject(e);
        });
    }

    async saveFileName(name) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(name, 'currentFileName');
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    }

    async getFileName() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get('currentFileName');
            request.onsuccess = (event) => resolve(event.target.result || null);
            request.onerror = (e) => reject(e);
        });
    }

    async clear() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            store.delete('currentPdf');
            store.delete('currentFileName');
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => reject(e);
        });
    }
}
