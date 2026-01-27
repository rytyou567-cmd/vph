/**
 * SHIELD STORAGE: IndexedDB Persistence Layer
 * 
 * ROLE:
 * Provides client-side encrypted storage for redactor projects and vaults.
 * Ensures data remains in the user's browser (Zero-Knowledge Architecture).
 */
class ShieldStorage {
    constructor() {
        this.dbName = 'ShieldVault';
        this.dbVersion = 1;
        this.storeName = 'projects';
        this.db = null;
    }

    /**
     * DB INITIALIZER: Establishes connection to the IndexedDB instance
     */
    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };

            request.onerror = (e) => reject(`IndexedDB Error: ${e.target.error}`);
        });
    }

    /**
     * PERSISTENCE: Commits or updates a project record in the store
     */
    async saveProject(project) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.put({
                ...project,
                updatedAt: new Date().toISOString()
            });

            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * RETRIEVAL: Fetches a single project by unique ID
     */
    async getProject(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * RETRIEVAL: Streams all projects stored in the vault
     */
    async getAllProjects() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * DESTRUCTION: Permanently removes a project from the local vault
     */
    async deleteProject(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.delete(id);

            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

export const shieldStorage = new ShieldStorage();
