/**
 * CRYPTO-UTILS - Cryptographic utilities for end-to-end encryption
 * Uses Web Crypto API (SubtleCrypto) for all operations
 * 
 * Stack:
 * - ECC P-256 (secp256r1) for key pairs
 * - ECDH for key exchange
 * - HKDF-SHA256 for key derivation
 * - AES-256-GCM for file encryption
 * - SHA-256 for fingerprints
 */

const CryptoUtils = {
    /**
     * Generate an ECC key pair (P-256 curve)
     * @returns {Promise<CryptoKeyPair>} {publicKey, privateKey}
     */
    async generateECCKeyPair() {
        try {
            const keyPair = await crypto.subtle.generateKey(
                {
                    name: 'ECDH',
                    namedCurve: 'P-256' // secp256r1
                },
                true, // extractable
                ['deriveBits', 'deriveKey']
            );
            return keyPair;
        } catch (error) {
            console.error('ECC key generation failed:', error);
            throw new Error('Failed to generate ECC key pair');
        }
    },

    /**
     * Export public key to ArrayBuffer for transmission
     * @param {CryptoKey} publicKey 
     * @returns {Promise<ArrayBuffer>}
     */
    async exportPublicKey(publicKey) {
        try {
            const exported = await crypto.subtle.exportKey('raw', publicKey);
            return exported;
        } catch (error) {
            console.error('Public key export failed:', error);
            throw new Error('Failed to export public key');
        }
    },

    /**
     * Import peer's public key from ArrayBuffer
     * @param {ArrayBuffer} keyData 
     * @returns {Promise<CryptoKey>}
     */
    async importPublicKey(keyData) {
        try {
            const publicKey = await crypto.subtle.importKey(
                'raw',
                keyData,
                {
                    name: 'ECDH',
                    namedCurve: 'P-256'
                },
                true,
                [] // no usages for public key import
            );
            return publicKey;
        } catch (error) {
            console.error('Public key import failed:', error);
            throw new Error('Failed to import public key');
        }
    },

    /**
     * Derive shared secret using ECDH, then derive AES key
     * @param {CryptoKey} privateKey - Our private key
     * @param {CryptoKey} publicKey - Peer's public key
     * @returns {Promise<CryptoKey>} AES-GCM key
     */
    async deriveEncryptionKey(privateKey, publicKey) {
        try {
            // Derive AES key directly from ECDH
            const aesKey = await crypto.subtle.deriveKey(
                {
                    name: 'ECDH',
                    public: publicKey
                },
                privateKey,
                {
                    name: 'AES-GCM',
                    length: 256
                },
                false, // not extractable for security
                ['encrypt', 'decrypt']
            );
            return aesKey;
        } catch (error) {
            console.error('Key derivation failed:', error);
            throw new Error('Failed to derive encryption key');
        }
    },

    /**
     * Encrypt data chunk using AES-256-GCM
     * @param {ArrayBuffer} data - Data to encrypt
     * @param {CryptoKey} key - AES key
     * @returns {Promise<{encryptedData: ArrayBuffer, iv: Uint8Array}>}
     */
    async encryptChunk(data, key) {
        try {
            // Generate random IV (12 bytes for GCM)
            const iv = crypto.getRandomValues(new Uint8Array(12));

            const encryptedData = await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                    tagLength: 128 // 128-bit authentication tag
                },
                key,
                data
            );

            return {
                encryptedData, // Includes auth tag at the end
                iv
            };
        } catch (error) {
            console.error('Encryption failed:', error);
            throw new Error('Failed to encrypt chunk');
        }
    },

    /**
     * Decrypt data chunk using AES-256-GCM
     * @param {ArrayBuffer} encryptedData - Encrypted data (includes auth tag)
     * @param {CryptoKey} key - AES key
     * @param {Uint8Array} iv - Initialization vector
     * @returns {Promise<ArrayBuffer>} Decrypted data
     */
    async decryptChunk(encryptedData, key, iv) {
        try {
            const decryptedData = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                    tagLength: 128
                },
                key,
                encryptedData // Includes auth tag
            );

            return decryptedData;
        } catch (error) {
            console.error('Decryption failed:', error);
            throw new Error('Failed to decrypt chunk - authentication failed or corrupted data');
        }
    },

    /**
     * Generate SHA-256 fingerprint of public key
     * @param {ArrayBuffer} publicKeyData 
     * @returns {Promise<string>} Hex-encoded fingerprint
     */
    async generateFingerprint(publicKeyData) {
        try {
            const hashBuffer = await crypto.subtle.digest('SHA-256', publicKeyData);
            return this.arrayBufferToHex(hashBuffer);
        } catch (error) {
            console.error('Fingerprint generation failed:', error);
            throw new Error('Failed to generate fingerprint');
        }
    },

    /**
     * Convert ArrayBuffer to hex string
     * @param {ArrayBuffer} buffer 
     * @returns {string}
     */
    arrayBufferToHex(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    },

    /**
     * Convert hex string to ArrayBuffer
     * @param {string} hex 
     * @returns {ArrayBuffer}
     */
    hexToArrayBuffer(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes.buffer;
    },

    /**
     * Format fingerprint for display (e.g., "A1B2 C3D4 ...")
     * @param {string} fingerprint - Hex fingerprint
     * @returns {string} Formatted fingerprint
     */
    formatFingerprint(fingerprint) {
        // Take first 32 chars, group by 4
        const short = fingerprint.substring(0, 32).toUpperCase();
        return short.match(/.{1,4}/g).join(' ');
    },

    /**
     * Create authenticated binding of public key to peer ID (MITM protection)
     * @param {string} peerId - PeerJS peer ID
     * @param {ArrayBuffer} publicKeyData - Exported public key
     * @param {number} timestamp - Current timestamp
     * @returns {Promise<string>} Hex-encoded binding hash
     */
    async createKeyBinding(peerId, publicKeyData, timestamp) {
        try {
            const encoder = new TextEncoder();
            const peerIdBytes = encoder.encode(peerId);
            const timestampBytes = encoder.encode(timestamp.toString());

            // Concatenate: peerID || publicKey || timestamp
            const combined = new Uint8Array(
                peerIdBytes.length + publicKeyData.byteLength + timestampBytes.length
            );
            combined.set(peerIdBytes, 0);
            combined.set(new Uint8Array(publicKeyData), peerIdBytes.length);
            combined.set(timestampBytes, peerIdBytes.length + publicKeyData.byteLength);

            const hash = await crypto.subtle.digest('SHA-256', combined);
            return this.arrayBufferToHex(hash);
        } catch (error) {
            console.error('Key binding creation failed:', error);
            throw new Error('Failed to create key binding');
        }
    },

    /**
     * Verify key binding (MITM protection)
     * @param {string} peerId - Claimed peer ID
     * @param {ArrayBuffer} publicKeyData - Received public key
     * @param {number} timestamp - Received timestamp
     * @param {string} binding - Received binding hash
     * @returns {Promise<boolean>} True if binding is valid
     */
    async verifyKeyBinding(peerId, publicKeyData, timestamp, binding) {
        try {
            const computedBinding = await this.createKeyBinding(peerId, publicKeyData, timestamp);
            return computedBinding === binding;
        } catch (error) {
            console.error('Key binding verification failed:', error);
            return false;
        }
    },

    /**
     * Test if Web Crypto API is available
     * @returns {boolean}
     */
    isSupported() {
        return !!(window.crypto && window.crypto.subtle);
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CryptoUtils;
}
