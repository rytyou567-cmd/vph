/**
 * KRYPT: Forensic File Encrypter
 * ViewPorts Security Suite
 * 
 * ROLE:
 * Client-side AES-256-GCM file encryption/decryption with zero server exposure.
 * Uses Web Crypto API for cryptographically secure operations.
 * 
 * ARCHITECTURE:
 * - Algorithm: AES-256-GCM (Galois/Counter Mode - authenticated encryption)
 * - Key Derivation: PBKDF2 with 100,000 iterations
 * - Salt: 16-byte random (prevents rainbow table attacks)
 * - IV: 12-byte random (ensures unique ciphertext per encryption)
 * 
 * FILE FORMAT (.krypt):
 * [Salt: 16 bytes] + [IV: 12 bytes] + [Encrypted Data: variable]
 * 
 * KEY WORKFLOWS:
 * 1. ENCRYPTION: File → ArrayBuffer → AES-GCM Encrypt → Download .krypt
 * 2. DECRYPTION: .krypt File → Extract Salt/IV → AES-GCM Decrypt → Download Original
 * 
 * SECURITYConsiderations:
 * - Password strength is critical (user responsibility)
 * - Keys never leave browser memory
 * - No server-side key escrow
 */

const KRYPT = (() => {
    let elements = {};
    let currentFile = null;

    /**
     * INITIALIZATION: Binds DOM elements and configures tool state
     * @param {object} config - Configuration object with element IDs
     */
    function init(config) {
        elements = {
            dropZone: document.getElementById(config.dropZoneId),
            fileInput: document.getElementById(config.fileInputId),
            controls: document.getElementById(config.controlsId),
            keyInput: document.getElementById(config.keyInputId),
            encryptBtn: document.getElementById(config.encryptBtnId),
            decryptBtn: document.getElementById(config.decryptBtnId)
        };

        setupEventListeners();
    }

    /**
     * EVENT HANDLERS: Binds UI interactions (click, change, drag/drop)
     */
    function setupEventListeners() {
        elements.dropZone.onclick = () => elements.fileInput.click();
        elements.fileInput.onchange = (e) => handleFile(e.target.files[0]);

        elements.encryptBtn.onclick = () => processFile(true);
        elements.decryptBtn.onclick = () => processFile(false);
    }

    /**
     * FILE INGESTION: Handles file selection and transitions to key entry view
     * @param {File} file - Selected file for processing
     */
    function handleFile(file) {
        if (!file) return;
        currentFile = file;
        elements.dropZone.style.display = 'none';
        elements.controls.style.display = 'flex';
        elements.controls.style.flexDirection = 'column';
        elements.controls.style.gap = '15px';
    }

    /**
     * PROCESSOR: Orchestrates encryption/decryption based on user action
     * @param {boolean} isEncrypt - True for encryption, false for decryption
     */
    async function processFile(isEncrypt) {
        const password = elements.keyInput.value;
        if (!password) {
            alert('A Cipher Key is required for phase transition.');
            return;
        }

        try {
            const data = await currentFile.arrayBuffer();
            const result = isEncrypt ? await encrypt(data, password) : await decrypt(data, password);

            download(result, isEncrypt ? `${currentFile.name}.krypt` : currentFile.name.replace('.krypt', ''));
        } catch (e) {
            console.error(e);
            alert('Integrity Failure: Incorrect key or corrupted stream.');
        }
    }

    // --- CRYPTO CORE ---

    /**
     * KEY DERIVATION: Transitions password string to cryptographic key
     * 
     * WORKFLOW:
     * 1. Import raw password via PBKDF2
     * 2. Apply 100,000 iterations for brute-force resistance
     * 3. Return 256-bit AES-GCM key
     */
    async function deriveKey(password, salt) {
        const encoder = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        return await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * ENCRYPTION ENGINE: Encrypts data using AES-256-GCM
     * 
     * WORKFLOW:
     * 1. Generate random IV (12 bytes) and Salt (16 bytes)
     * 2. Derive key from password/salt
     * 3. Encrypt data buffer
     * 4. Return combined packet: [salt][iv][ciphertext]
     */
    async function encrypt(data, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt);

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );

        // Package as: [salt (16)] + [iv (12)] + [encrypted data]
        const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
        result.set(salt, 0);
        result.set(iv, salt.length);
        result.set(new Uint8Array(encrypted), salt.length + iv.length);

        return result;
    }

    /**
     * DECRYPTION ENGINE: Recovers original data from .krypt packet
     * 
     * WORKFLOW:
     * 1. Slicing: Extract Salt (0-16), IV (16-28), and Ciphertext (28+)
     * 2. Derive key from password and extracted Salt
     * 3. Decrypt ciphertext using derived key/iv
     */
    async function decrypt(data, password) {
        const salt = data.slice(0, 16);
        const iv = data.slice(16, 28);
        const encrypted = data.slice(28);

        const key = await deriveKey(password, salt);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encrypted
        );

        return new Uint8Array(decrypted);
    }

    /**
     * EXPORT: Triggers browser download for processed buffer
     */
    function download(data, filename) {
        const blob = new Blob([data]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * RESET: Restores initial state for fresh file ingestion
     */
    function reset() {
        elements.dropZone.style.display = 'block';
        elements.controls.style.display = 'none';
        elements.keyInput.value = '';
        currentFile = null;
    }

    return { init, reset };
})();

window.KRYPT = KRYPT;
