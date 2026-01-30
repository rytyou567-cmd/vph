/**
 * MESH DROP - P2P FILE TRANSFER (SECURE HANDSHAKE V2)
 */

const myId = Math.random().toString(36).substr(2, 6);
const peer = new Peer(myId);

/* STATE */
const connectedPeers = {};
const CHUNK_SIZE = 16384; // 16KB chunks for optimal P2P reliability
const incomingFiles = {};
const pendingSends = {};
const pendingOffers = [];
const selectedPeers = new Set(); // Track which peers to send files to

/* ENCRYPTION STATE */
let myKeyPair = null; // {publicKey, privateKey}
let myPublicKeyData = null; // ArrayBuffer for transmission
let myFingerprint = null; // SHA-256 hash of public key
const peerPublicKeys = {}; // Map: peerId -> CryptoKey
const sharedKeys = {}; // Map: peerId -> AES-GCM key
const keyExchangeStatus = {}; // Map: peerId -> 'pending'|'ready'

// Transfer mode tracking (for direct download feature)
const transferModes = {}; // transferId -> 'ram' | 'stream'
const streamHandles = {}; // transferId -> FileSystemWritableFileStream

// Unencrypted mode flag
let unencryptedMode = false; // Set to true when user chooses to proceed without encryption
const unencryptedPeers = new Set(); // Track which specific peers are in unencrypted mode

// Encryption state tracking
let encryptionReady = false; // Track if encryption initialization is complete

// DOM
const elId = document.getElementById('my-peer-id');
const elPeerCount = document.getElementById('peer-count');
const elPeerList = document.getElementById('peer-list');
const elDropZone = document.getElementById('drop-zone');
const elTransfers = document.getElementById('transfers');
const elLog = document.getElementById('log-terminal');
const elFingerprint = document.getElementById('my-fingerprint');
const elEncryptionStatus = document.getElementById('encryption-status');

// Modal DOM
const elAcceptModal = document.getElementById('accept-modal');
const elModalOverlay = document.getElementById('modal-overlay');
const elAcceptInfo = document.getElementById('accept-file-info');
const elBtnAccept = document.getElementById('btn-accept-transfer');
const elBtnAcceptAll = document.getElementById('btn-accept-all');
const elBtnReject = document.getElementById('btn-reject-transfer');

// Metrics DOM
const elUploadSpeed = document.getElementById('upload-speed');
const elDownloadSpeed = document.getElementById('download-speed');

// Metrics tracking
let uploadBytes = 0;
let downloadBytes = 0;
let uploadStartTime = null;
let downloadStartTime = null;
let lastChunkTime = Date.now();

function log(msg) {
    const div = document.createElement('div');
    div.innerText = `> ${msg}`;
    elLog.prepend(div);
}

/**
 * Update transfer metrics (upload/download speed, latency)
 */
function updateMetrics() {
    const now = Date.now();

    // Calculate upload speed
    if (uploadStartTime && uploadBytes > 0) {
        const uploadDuration = (now - uploadStartTime) / 1000; // seconds
        const uploadKBps = (uploadBytes / 1024) / uploadDuration;
        elUploadSpeed.textContent = uploadKBps >= 1024
            ? `${(uploadKBps / 1024).toFixed(2)} MB/s`
            : `${uploadKBps.toFixed(2)} KB/s`;
    }

    // Calculate download speed
    if (downloadStartTime && downloadBytes > 0) {
        const downloadDuration = (now - downloadStartTime) / 1000; // seconds
        const downloadKBps = (downloadBytes / 1024) / downloadDuration;
        elDownloadSpeed.textContent = downloadKBps >= 1024
            ? `${(downloadKBps / 1024).toFixed(2)} MB/s`
            : `${downloadKBps.toFixed(2)} KB/s`;
    }
}

// Update metrics every 500ms
setInterval(updateMetrics, 500);

// --- PEERJS CORE ---
peer.on('open', async (id) => {
    elId.innerText = id;
    log(`UPLINK_READY :: ${id}`);

    // Run integrity check before proceeding
    const integrityOk = await verifyIntegrity();
    if (!integrityOk) {
        log('SYSTEM_COMPROMISED :: Halting initialization');
        return;
    }

    // Check if Web Crypto is available
    if (!CryptoUtils.isSupported()) {
        // Show warning modal with proceed option
        showWarningModal(
            'Web Crypto API is not available in this context.\n\n' +
            'HTTPS or localhost is required for encryption.\n\n' +
            'You can proceed WITHOUT encryption (unencrypted transfers) or reload via HTTPS.',
            () => {
                log('USER_ACCEPTED_UNENCRYPTED_MODE');
                unencryptedMode = true; // Set flag to skip encryption

                // Notify all connected peers that we're in unencrypted mode
                for (let peerId in connectedPeers) {
                    connectedPeers[peerId].send({
                        type: 'UNENCRYPTED_MODE_NOTIFICATION',
                        peerId: myId
                    });
                    log(`NOTIFIED_UNENCRYPTED :: ${peerId}`);
                }

                // Update footer status
                if (elEncryptionStatus) {
                    elEncryptionStatus.textContent = '🔓 UNENCRYPTED_MODE';
                    elEncryptionStatus.style.color = '#f90';
                    elEncryptionStatus.title = 'Channel Downgraded: You are in unencrypted mode. All transfers are unsecure.';
                }

                updateUI(); // Refresh UI to show unlock icons
            }
        );
    } else {
        // Initialize encryption
        await initializeEncryption();
    }
});

// Helper for safe sending (catches binarypack errors)
function safeSend(conn, data) {
    try {
        conn.send(data);
    } catch (e) {
        console.error(`SEND_FAILED :: ${data.type} to ${conn.peer}`, e);
        log(`SEND_ERROR :: ${data.type} - ${e.message}`);
    }
}

peer.on('connection', (conn) => {
    // Always call handleP2PConnection immediately to attach listeners
    // This prevents dropping messages (key exchange, offers) while waiting for initialization
    handleP2PConnection(conn);
});

function handleP2PConnection(conn) {
    connectedPeers[conn.peer] = conn;
    selectedPeers.add(conn.peer);
    keyExchangeStatus[conn.peer] = 'pending';
    updateUI();
    log(`NODE_LINKED :: ${conn.peer}`);

    conn.on('open', () => {
        log(`P2P_OPEN :: ${conn.peer}`);

        // If we're in unencrypted mode, notify the new peer immediately
        if (unencryptedMode) {
            safeSend(conn, {
                type: 'UNENCRYPTED_MODE_NOTIFICATION',
                peerId: myId
            });
            log(`NOTIFIED_UNENCRYPTED :: ${conn.peer}`);
            return;
        }

        // Avoid double-initiating if we're already handshaking
        if (keyExchangeStatus[conn.peer] === 'init' || keyExchangeStatus[conn.peer] === 'ready') return;

        // Initiate key exchange if ready, otherwise wait for initializeEncryption()
        if (encryptionReady) {
            initiateKeyExchange(conn);
        } else {
            log(`LINK_STAGED :: ${conn.peer} (waiting for local keys)`);
        }
    });

    // Handle case where connection is already open when listeners are attached
    if (conn.open) {
        log(`P2P_ALREADY_OPEN :: ${conn.peer}`);
        if (encryptionReady || unencryptedMode) {
            if (unencryptedMode) {
                conn.send({ type: 'UNENCRYPTED_MODE_NOTIFICATION', peerId: myId });
            } else if (keyExchangeStatus[conn.peer] !== 'init' && keyExchangeStatus[conn.peer] !== 'ready') {
                initiateKeyExchange(conn);
            }
        }
    }

    conn.on('data', (data) => {
        handleIncomingData(data, conn);
    });

    conn.on('close', () => {
        delete connectedPeers[conn.peer];
        selectedPeers.delete(conn.peer); // Remove from selection
        delete peerPublicKeys[conn.peer];
        delete sharedKeys[conn.peer];
        delete keyExchangeStatus[conn.peer];
        updateUI();
        log(`LINK_LOST :: ${conn.peer}`);
    });
}

function handleIncomingData(data, conn) {
    // Trace log for ALL incoming data (temporarily for debugging)
    if (data.type !== 'FILE_CHUNK' && data.type !== 'FILE_CHUNK_ENCRYPTED') {
        console.log(`RX_MSG :: ${data.type} from ${conn.peer}`);
    } else if (data.index % 100 === 0) {
        console.log(`RX_CHUNK :: ${data.index}/${data.total} from ${conn.peer}`);
    }

    switch (data.type) {
        case 'KEY_EXCHANGE':
            handleKeyExchange(data, conn);
            break;
        case 'KEY_READY':
            handleKeyReady(data, conn);
            break;
        case 'FILE_OFFER':
        case 'FILE_OFFER_ENCRYPTED':
            handleFileOffer(data, conn);
            break;
        case 'FILE_ACCEPT':
            startFileStream(data.transferId, conn);
            break;
        case 'FILE_REJECT':
            log(`REJECTED :: ${data.transferId}`);
            updateTransferStatus(data.transferId, 'REJECTED', '#f33');
            break;
        case 'FILE_CANCEL':
            log(`CANCELLED :: ${data.transferId}`);
            updateTransferStatus(data.transferId, 'CANCELLED', '#666');
            if (incomingFiles[data.transferId]) delete incomingFiles[data.transferId];

            // Remove from queue if it's there
            const idx = pendingOffers.findIndex(o => o.meta.transferId === data.transferId);
            if (idx !== -1) pendingOffers.splice(idx, 1);

            updateAcceptModal();
            break;
        case 'FILE_CHUNK':
        case 'FILE_CHUNK_ENCRYPTED':
            handleFileChunk(data, conn);
            break;
        case 'FILE_CHUNK_ACK':
            log(`ACK_RECEIVED_RAW :: ${data.transferId} [${data.receivedCount}/${data.total}]`);
            handleFileChunkAck(data);
            break;
        case 'UNENCRYPTED_MODE_NOTIFICATION':
            // Remote peer notified us they're in unencrypted mode
            unencryptedPeers.add(conn.peer);
            log(`PEER_UNENCRYPTED :: ${conn.peer} is in unencrypted mode`);
            updateUI(); // Update UI to show unlock icon
            break;
    }
}

function updateUI() {
    elPeerCount.innerText = Object.keys(connectedPeers).length;
    elPeerList.innerHTML = '';

    for (let id in connectedPeers) {
        const div = document.createElement('div');
        div.className = 'node-item';
        div.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 5px; cursor: pointer;';

        // Add checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'peer-checkbox';
        checkbox.checked = selectedPeers.has(id);
        checkbox.style.cssText = 'cursor: pointer; accent-color: #0f0;';

        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedPeers.add(id);
            } else {
                selectedPeers.delete(id);
            }
            updateSelectionCount();
        });

        // Add label with encryption indicator
        let lockIcon;
        let channelWarning = ''; // Add warning if channel is unsecure
        let tooltipText = '';

        // If WE are in unencrypted mode, show downgraded status
        if (unencryptedMode) {
            lockIcon = '🔓';
            channelWarning = '⚠️';
            tooltipText = 'Channel Downgraded: You are in unencrypted mode. All transfers to this peer are unsecure.';
        }
        // Priority 1: Check if THEY are in unencrypted mode (remote peer is unsecure)
        else if (unencryptedPeers.has(id)) {
            lockIcon = '🔓';
            tooltipText = 'Unsecure: This peer is in unencrypted mode. All transfers are unsecure.';
        }
        // Priority 2: Check encryption status (show their actual capability)
        else if (keyExchangeStatus[id] === 'ready') {
            lockIcon = '🔒';
            tooltipText = 'Encrypted: Secure end-to-end encrypted connection ready.';
        }
        // Priority 3: Default to waiting
        else {
            lockIcon = '⏳';
            tooltipText = 'Waiting: Encryption handshake in progress...';
        }

        const label = document.createElement('span');
        label.innerText = `${lockIcon}${channelWarning} > ${id}`;
        label.title = tooltipText;
        label.style.flex = '1';

        // Make entire row clickable
        div.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
        });

        // Highlight if selected
        if (selectedPeers.has(id)) {
            div.style.background = 'rgba(0, 255, 0, 0.1)';
            div.style.borderLeft = '2px solid #0f0';
        }

        div.appendChild(checkbox);
        div.appendChild(label);
        elPeerList.appendChild(div);
    }

    updateSelectionCount();
}

function updateSelectionCount() {
    const selectedCount = selectedPeers.size;
    const totalCount = Object.keys(connectedPeers).length;
    elPeerCount.innerText = `${selectedCount}/${totalCount}`;
}

function updateTransferStatus(id, status, color) {
    const ui = document.getElementById(id);
    if (ui) {
        const statusEl = ui.querySelector('span:last-child');
        statusEl.innerText = status;
        statusEl.style.color = color;
        const cancelBtn = ui.querySelector('.btn-cancel');
        if (cancelBtn) cancelBtn.style.display = 'none';
    }
}

function closeModal() {
    elAcceptModal.style.display = 'none';
    elModalOverlay.style.display = 'none';
}

/**
 * Show warning modal with custom message and callback
 */
function showWarningModal(message, onProceed) {
    const warningModal = document.getElementById('warning-modal');
    const warningOverlay = document.getElementById('warning-overlay');
    const warningMessage = document.getElementById('warning-message');
    const btnProceed = document.getElementById('btn-proceed-unencrypted');

    warningMessage.textContent = message;
    warningModal.style.display = 'block';
    warningOverlay.style.display = 'block';

    btnProceed.onclick = () => {
        warningModal.style.display = 'none';
        warningOverlay.style.display = 'none';
        if (onProceed) onProceed();
    };
}

// --- SECURITY & INTEGRITY ---

/**
 * Verify application integrity (detect tampering)
 * @returns {Promise<boolean>} True if integrity checks pass
 */
async function verifyIntegrity() {
    try {
        // Check if critical crypto functions exist
        const requiredFunctions = [
            'generateECCKeyPair',
            'encryptChunk',
            'decryptChunk',
            'createKeyBinding',
            'verifyKeyBinding',
            'exportPublicKey',
            'importPublicKey',
            'deriveEncryptionKey'
        ];

        for (const fn of requiredFunctions) {
            if (typeof CryptoUtils[fn] !== 'function') {
                throw new Error(`Critical function missing: ${fn}`);
            }
        }

        // Check if Web Crypto API is available
        if (!CryptoUtils.isSupported()) {
            // Not available - likely HTTP context (requires HTTPS)
            log('⚠️ WEB_CRYPTO_UNAVAILABLE :: Encryption disabled (HTTPS required)');
            console.warn('Web Crypto API not available. App will run WITHOUT encryption.');
            console.warn('To enable encryption: Use HTTPS or access via localhost.');
            // Allow app to run in degraded mode (no encryption)
        }

        // Check if PeerJS is loaded
        if (typeof Peer === 'undefined') {
            throw new Error('PeerJS library not loaded');
        }

        log('✓ INTEGRITY_CHECK_PASSED');
        return true;
    } catch (error) {
        log('⚠️ INTEGRITY_CHECK_FAILED :: ' + error.message);
        alert('🚨 SECURITY WARNING!\n\nIntegrity check failed. The application may have been tampered with.\n\nError: ' + error.message + '\n\nDo NOT proceed with sensitive operations.\n\nPlease reload the page or contact support if this persists.');
        return false;
    }
}

/**
 * Clear sensitive data from memory (best effort)
 */
function clearSensitiveData() {
    try {
        // Clear key material
        myKeyPair = null;
        myPublicKeyData = null;
        myFingerprint = null;

        for (let key in sharedKeys) {
            delete sharedKeys[key];
        }
        for (let key in peerPublicKeys) {
            delete peerPublicKeys[key];
        }
        for (let key in keyExchangeStatus) {
            delete keyExchangeStatus[key];
        }

        log('MEMORY_CLEARED :: Sensitive data wiped');
    } catch (error) {
        console.error('Failed to clear sensitive data:', error);
    }
}

// Clear memory on page unload
window.addEventListener('beforeunload', () => {
    clearSensitiveData();
});

// --- ENCRYPTION FUNCTIONS ---

/**
 * Initialize encryption by generating ECC key pair
 */
async function initializeEncryption() {
    try {
        log('INITIALIZING_ENCRYPTION...');

        if (!CryptoUtils) {
            throw new Error('CryptoUtils not loaded');
        }

        if (!CryptoUtils.isSupported()) {
            log('WARNING: Web Crypto API not supported');
            return;
        }

        log('Generating ECC key pair...');
        // Generate ECC key pair
        myKeyPair = await CryptoUtils.generateECCKeyPair();
        log('Key pair generated');

        myPublicKeyData = await CryptoUtils.exportPublicKey(myKeyPair.publicKey);
        log('Public key exported');

        myFingerprint = await CryptoUtils.generateFingerprint(myPublicKeyData);
        log('Fingerprint generated');

        // Display fingerprint
        if (elFingerprint) {
            elFingerprint.innerText = CryptoUtils.formatFingerprint(myFingerprint);
            elFingerprint.title = myFingerprint; // Full fingerprint on hover
        } else {
            log('WARNING: Fingerprint element not found');
        }

        log(`ENCRYPTION_READY :: ${CryptoUtils.formatFingerprint(myFingerprint)}`);

        // Mark encryption as ready
        encryptionReady = true;

        // Trigger handshakes for all currently staged connections
        for (let peerId in connectedPeers) {
            const conn = connectedPeers[peerId];
            if (conn.open && !unencryptedMode && !unencryptedPeers.has(peerId)) {
                if (keyExchangeStatus[peerId] !== 'ready' && keyExchangeStatus[peerId] !== 'init') {
                    initiateKeyExchange(conn);
                }
            }
        }
    } catch (error) {
        console.error('Encryption initialization failed:', error);
        log('ENCRYPTION_INIT_FAILED :: ' + error.message);
        alert(`Encryption initialization failed: ${error.message}\n\nCheck console for details.`);
    }
}

/**
 * Initiate key exchange with connected peer
 * @param {DataConnection} conn - PeerJS connection
 */
async function initiateKeyExchange(conn) {
    if (keyExchangeStatus[conn.peer] === 'init' || keyExchangeStatus[conn.peer] === 'ready') return;
    keyExchangeStatus[conn.peer] = 'init';
    try {
        // Skip encryption entirely if in unencrypted mode
        if (unencryptedMode) {
            log(`UNENCRYPTED_MODE :: Skipping key exchange with ${conn.peer}`);
            return;
        }

        // Skip if the remote peer is in unencrypted mode
        if (unencryptedPeers.has(conn.peer)) {
            log(`PEER_UNENCRYPTED :: Skipping key exchange with ${conn.peer} (they're in unencrypted mode)`);
            return;
        }

        if (!myPublicKeyData) {
            log('ERROR: Encryption not initialized - this should not happen after fix');
            return;
        }

        const timestamp = Date.now();
        const binding = await CryptoUtils.createKeyBinding(myId, myPublicKeyData, timestamp);

        // Send our public key with cryptographic binding (MITM protection)
        safeSend(conn, {
            type: 'KEY_EXCHANGE',
            publicKey: myPublicKeyData,
            fingerprint: myFingerprint,
            peerId: myId,
            timestamp: timestamp,
            binding: binding
        });

        log(`KEY_EXCHANGE_SENT :: ${conn.peer} [BINDING: ${binding.substring(0, 16)}...]`);
    } catch (error) {
        console.error('Key exchange failed:', error);
        log(`KEY_EXCHANGE_FAILED :: ${conn.peer}`);
    }
}

/**
 * Handle incoming key exchange message
 * @param {Object} data - Message data
 * @param {DataConnection} conn - PeerJS connection
 */
async function handleKeyExchange(data, conn) {
    try {
        const peerId = conn.peer;

        // Ignore key exchange if in unencrypted mode
        if (unencryptedMode) {
            log(`UNENCRYPTED_MODE :: Ignoring key exchange from ${peerId}`);
            return;
        }

        // Check if encryption is initialized
        if (!myKeyPair || !myPublicKeyData) {
            log(`⚠️ ENCRYPTION_NOT_READY :: ${peerId} - Waiting for initialization`);
            // Retry after a delay
            setTimeout(() => {
                if (myKeyPair && myPublicKeyData) {
                    handleKeyExchange(data, conn);
                } else {
                    log(`⚠️ ENCRYPTION_INIT_TIMEOUT :: ${peerId}`);
                }
            }, 1000);
            return;
        }

        // === SECURITY CHECKS (MITM PROTECTION) ===

        // 1. Verify key binding
        const bindingValid = await CryptoUtils.verifyKeyBinding(
            data.peerId,
            data.publicKey,
            data.timestamp,
            data.binding
        );

        if (!bindingValid) {
            log(`⚠️ KEY_BINDING_FAILED :: ${peerId} - POTENTIAL MITM ATTACK`);
            alert(`🚨 SECURITY WARNING!\n\nKey binding verification failed for peer ${peerId}.\n\nThis may indicate a man-in-the-middle attack attempting to intercept your connection.\n\nConnection has been rejected for your safety.`);

            // Disconnect peer immediately
            if (connectedPeers[peerId]) {
                connectedPeers[peerId].close();
            }
            return;
        }

        // 2. Verify timestamp (prevent replay attacks)
        const now = Date.now();
        const timeDiff = Math.abs(now - data.timestamp);
        if (timeDiff > 60000) { // 1 minute tolerance
            log(`⚠️ TIMESTAMP_EXPIRED :: ${peerId} (diff: ${timeDiff}ms)`);
            alert(`⚠️ Key exchange timestamp expired for ${peerId}.\n\nThe key exchange message is too old and may be a replay attack.\n\nConnection rejected.`);
            return;
        }

        // 3. Verify peer ID matches connection
        if (data.peerId !== peerId) {
            log(`⚠️ PEER_ID_MISMATCH :: Expected ${peerId}, got ${data.peerId}`);
            alert(`🚨 SECURITY WARNING!\n\nPeer ID mismatch detected!\n\nExpected: ${peerId}\nReceived: ${data.peerId}\n\nThis may indicate an impersonation attack.\n\nConnection rejected.`);

            if (connectedPeers[peerId]) {
                connectedPeers[peerId].close();
            }
            return;
        }

        log(`✓ KEY_BINDING_VERIFIED :: ${peerId}`);

        // === CONTINUE WITH KEY EXCHANGE ===

        // Import peer's public key
        const peerPublicKey = await CryptoUtils.importPublicKey(data.publicKey);
        peerPublicKeys[peerId] = peerPublicKey;

        // Derive shared encryption key using ECDH
        const sharedKey = await CryptoUtils.deriveEncryptionKey(
            myKeyPair.privateKey,
            peerPublicKey
        );
        sharedKeys[peerId] = sharedKey;

        // Send KEY_EXCHANGE back if we haven't already
        if (!keyExchangeStatus[peerId] || keyExchangeStatus[peerId] === 'pending') {
            const timestamp = Date.now();
            const binding = await CryptoUtils.createKeyBinding(myId, myPublicKeyData, timestamp);

            safeSend(conn, {
                type: 'KEY_EXCHANGE',
                publicKey: myPublicKeyData,
                fingerprint: myFingerprint,
                peerId: myId,
                timestamp: timestamp,
                binding: binding
            });
        }

        // Mark as ready
        keyExchangeStatus[peerId] = 'ready';

        // Confirm key exchange complete
        conn.send({
            type: 'KEY_READY',
            peerId: myId
        });

        updateUI();
        log(`ENCRYPTION_READY :: ${peerId} [${CryptoUtils.formatFingerprint(data.fingerprint)}]`);
    } catch (error) {
        console.error('Key exchange handling failed:', error);
        log(`KEY_EXCHANGE_ERROR :: ${conn.peer}`);
    }
}

/**
 * Handle KEY_READY confirmation
 * @param {Object} data - Message data
 * @param {DataConnection} conn - PeerJS connection
 */
function handleKeyReady(data, conn) {
    const peerId = conn.peer;

    // Skip if we're in unencrypted mode
    if (unencryptedMode) {
        log(`UNENCRYPTED_MODE :: Ignoring KEY_READY from ${peerId}`);
        return;
    }

    // Skip if remote peer is in unencrypted mode
    if (unencryptedPeers.has(peerId)) {
        log(`PEER_UNENCRYPTED :: Ignoring KEY_READY from ${peerId}`);
        return;
    }

    keyExchangeStatus[peerId] = 'ready';
    log(`READY_FOR_HANDSHAKE :: ${peerId}`);
    updateUI();
}


// --- FILE ACTIONS ---

elDropZone.addEventListener('dragover', (e) => { e.preventDefault(); elDropZone.classList.add('dragover'); });
elDropZone.addEventListener('dragleave', () => { elDropZone.classList.remove('dragover'); });
elDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elDropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        Array.from(e.dataTransfer.files).forEach(file => shareFile(file));
    }
});

// Make drop zone clickable to select files
elDropZone.addEventListener('click', () => {
    document.getElementById('file-input-hidden').click();
});

// SELECT ALL / CLEAR ALL buttons
document.getElementById('btn-select-all').addEventListener('click', () => {
    Object.keys(connectedPeers).forEach(id => selectedPeers.add(id));
    updateUI();
    log('ALL_PEERS_SELECTED');
});

document.getElementById('btn-clear-all').addEventListener('click', () => {
    selectedPeers.clear();
    updateUI();
    log('ALL_PEERS_DESELECTED');
});

// 2. Hidden Input Listener (for Mobile/Fallback)
const elFileInput = document.getElementById('file-input-hidden');
elFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        Array.from(e.target.files).forEach(file => shareFile(file));
    }
});

window.clearHistory = () => {
    elTransfers.innerHTML = '';
    log("HISTORY_CLEARED");
};

// 3. Offer a file
async function shareFile(file) {
    const allPeers = Object.values(connectedPeers);
    if (allPeers.length === 0) return alert("NO PEERS CONNECTED.");

    // Filter to only selected peers
    const peers = allPeers.filter(p => selectedPeers.has(p.peer));

    if (peers.length === 0) {
        return alert("NO PEERS SELECTED.\nPlease select at least one peer to send files.");
    }

    log(`OFFER_BROADCAST :: ${file.name} to ${peers.length} peers`);

    peers.forEach(p => {
        // Generate a unique ID for THIS peer-send operation
        const transferId = 'tx_' + Math.random().toString(36).substr(2, 6);
        const isEncrypted = !unencryptedMode && keyExchangeStatus[p.peer] === 'ready' && sharedKeys[p.peer];

        pendingSends[transferId] = {
            file,
            active: true,
            peerId: p.peer
        };

        const statusMsg = isEncrypted ? '🔐 OFFERING (ENCRYPTED)' : '🔓 OFFERING (UNENCRYPTED)';

        // Include peer ID in the card name for sender clarity
        createTransferUI(transferId, `${file.name} (to ${p.peer})`, statusMsg, true);

        if (!p.open) {
            log(`⚠️ WARNING :: Connection to ${p.peer} is not fully open. Message buffered.`);
        }

        safeSend(p, {
            type: isEncrypted ? 'FILE_OFFER_ENCRYPTED' : 'FILE_OFFER',
            transferId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            sender: myId,
            encrypted: isEncrypted
        });
    });
}

window.cancelTransfer = (id) => {
    if (pendingSends[id]) {
        pendingSends[id].active = false;
        const pId = pendingSends[id].peerId;

        log(`CANCEL_SEND :: ${id} to ${pId}`);

        // Only notify the specific peer associated with this unique ID
        if (pId && connectedPeers[pId]) {
            connectedPeers[pId].send({ type: 'FILE_CANCEL', transferId: id });
        }

        updateTransferStatus(id, 'CANCELLED', '#666');
    }
};

// 2. Recipient handles offer
function handleFileOffer(meta, conn) {
    try {
        log(`INCOMING_OFFER :: ${meta.fileName} [${(meta.fileSize / (1024 * 1024)).toFixed(2)} MB] from ${conn.peer}`);

        incomingFiles[meta.transferId] = { meta, chunks: [], receivedCount: 0 };
        pendingOffers.push({ meta, conn });

        log(`UI_UPDATE :: Creating transfer card for ${meta.transferId}`);
        createTransferUI(meta.transferId, meta.fileName, 'PENDING_ACCEPT');
        updateAcceptModal();
    } catch (e) {
        console.error('Error handling file offer:', e);
        log(`ERROR :: Handle Offer Failed: ${e.message}`);
    }
}

function updateAcceptModal() {
    try {
        if (pendingOffers.length === 0) {
            closeModal();
            return;
        }

        const { meta, conn } = pendingOffers[0];
        log(`MODAL_RENDER :: Showing acceptance for ${meta.fileName}`);

        const isEncrypted = meta.encrypted ? '🔐 ENCRYPTED' : '';
        const sizeMB = (meta.fileSize / (1024 * 1024)).toFixed(2);
        const isLarge = meta.fileSize > 50 * 1024 * 1024; // 50MB threshold

        // Warn for large files (RAM usage)
        const sizeWarning = isLarge ? `<br><span style="color:#f90;">⚠️ LARGE FILE - DIRECT DOWNLOAD RECOMMENDED</span>` : '';

        if (!elAcceptInfo) throw new Error('elAcceptInfo element missing');

        if (pendingOffers.length > 1) {
            elAcceptInfo.innerHTML = `[BATCH_UPLINK :: ${pendingOffers.length} FILES]<br><br>CURRENT: <span style="color:#0f0">${meta.fileName}</span> ${isEncrypted}<br>SIZE: ${sizeMB} MB${sizeWarning}<br>NODE: ${conn.peer}`;
            if (elBtnAcceptAll) elBtnAcceptAll.style.display = 'inline-block';
        } else {
            elAcceptInfo.innerHTML = `FILE: <span style="color:#0f0">${meta.fileName}</span> ${isEncrypted}<br>SIZE: ${sizeMB} MB${sizeWarning}<br>NODE: ${conn.peer}`;
            if (elBtnAcceptAll) elBtnAcceptAll.style.display = 'none';
        }

        if (elAcceptModal) elAcceptModal.style.display = 'block';
        if (elModalOverlay) elModalOverlay.style.display = 'block';
        // Show/hide Direct Download button
        const elBtnDirectDownload = document.getElementById('btn-direct-download');
        if (isLarge) {
            elBtnDirectDownload.style.display = 'block';
            elBtnDirectDownload.onclick = () => {
                acceptOfferWithStreaming(pendingOffers.shift());
                updateAcceptModal();
            };
        } else {
            elBtnDirectDownload.style.display = 'none';
        }
    } catch (e) {
        console.error('Error updating modal:', e);
        log(`ERROR :: Modal Update Failed: ${e.message}`);
    }
}

elBtnAccept.onclick = () => {
    acceptOffer(pendingOffers.shift());
    updateAcceptModal();
};

elBtnAcceptAll.onclick = () => {
    while (pendingOffers.length > 0) {
        acceptOffer(pendingOffers.shift());
    }
    updateAcceptModal();
};

elBtnReject.onclick = () => {
    const offer = pendingOffers.shift();
    offer.conn.send({ type: 'FILE_REJECT', transferId: offer.meta.transferId });
    updateAcceptModal();
};

function acceptOffer(offer) {
    offer.conn.send({ type: 'FILE_ACCEPT', transferId: offer.meta.transferId });
    createTransferUI(offer.meta.transferId, offer.meta.fileName, 'RECEIVING');
}

/**
 * Accept file offer with streaming to disk (Direct Download)
 * @param {Object} offer - { meta, conn }
 */
async function acceptOfferWithStreaming(offer) {
    try {
        // Check if File System Access API is supported
        if (!('showSaveFilePicker' in window)) {
            alert('⚠️ Direct Download not supported in this browser.\n\nFalling back to RAM mode.');
            log('STREAM_NOT_SUPPORTED :: Fallback to RAM mode');
            acceptOffer(offer);
            return;
        }

        const { meta, conn } = offer;

        // Get file extension from filename
        const fileExt = meta.fileName.includes('.') ? meta.fileName.split('.').pop() : '';

        // Prompt user to choose save location
        const options = {
            suggestedName: meta.fileName
        };

        // Only add types if we have a valid extension
        if (fileExt) {
            options.types = [{
                description: meta.fileType || 'File',
                accept: { [meta.fileType || 'application/octet-stream']: [`.${fileExt}`] }
            }];
        }

        const fileHandle = await window.showSaveFilePicker(options);

        // Create writable stream
        const writable = await fileHandle.createWritable();
        streamHandles[meta.transferId] = writable;
        transferModes[meta.transferId] = 'stream';

        // Initialize transfer with stream mode
        incomingFiles[meta.transferId] = {
            meta,
            writable,
            receivedCount: 0,
            totalChunks: 0,
            transferMode: 'stream' // Explicitly mark as streaming mode
        };

        // Send acceptance
        conn.send({ type: 'FILE_ACCEPT', transferId: meta.transferId });
        createTransferUI(meta.transferId, meta.fileName, '⚡ STREAMING TO DISK');
        log(`DIRECT_DOWNLOAD_STARTED :: ${meta.fileName} [${(meta.fileSize / (1024 * 1024)).toFixed(2)} MB]`);

    } catch (error) {
        if (error.name === 'AbortError') {
            log('User cancelled file save dialog');
        } else {
            console.error('Streaming setup failed:', error);
            alert(`⚠️ Streaming failed: ${error.message}\n\nFalling back to RAM mode.`);
            acceptOffer(offer);
        }
    }
}

// 3. Sender starts streaming
async function startFileStream(id, conn) {
    const session = pendingSends[id];
    if (!session || !session.active) return;
    const file = session.file;

    updateTransferStatus(id, 'STREAMING', '#0af');
    log(`STREAM_START :: ${file.name} -> ${conn.peer}`);

    const CHUNK_SIZE = 16384; // 16KB for safe P2P transfer
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
        if (!session.active) break; // Check for cancellation mid-stream
        if (conn.readyState !== 'open') {
            log(`STALL_DETECTED :: Connection lost with ${conn.peer}`);
            break;
        }

        const start = i * CHUNK_SIZE;
        // Memory efficient: only read the current slice into memory
        const blob = file.slice(start, start + CHUNK_SIZE);
        const chunk = await blob.arrayBuffer();

        // Check if encryption is available for this specific peer
        const hasEncryption = !unencryptedMode && !unencryptedPeers.has(conn.peer) && keyExchangeStatus[conn.peer] === 'ready' && sharedKeys[conn.peer];

        if (hasEncryption) {
            try {
                const { encryptedData, iv } = await CryptoUtils.encryptChunk(chunk, sharedKeys[conn.peer]);
                conn.send({
                    type: 'FILE_CHUNK_ENCRYPTED',
                    transferId: id,
                    index: i,
                    total: totalChunks,
                    chunk: encryptedData,
                    iv: iv
                });
            } catch (error) {
                console.error('Encryption failed:', error);
                log(`ENCRYPTION_ERROR :: ${id} to ${conn.peer}`);
                break;
            }
        } else {
            conn.send({
                type: 'FILE_CHUNK',
                transferId: id,
                index: i,
                total: totalChunks,
                chunk: chunk
            });

            if (i === 0) log(`FIRST_CHUNK_SENT :: ${id} to ${conn.peer}`);

            // Metrics tracking
            if (!uploadStartTime) uploadStartTime = Date.now();
            uploadBytes += chunk.byteLength;
            lastChunkTime = Date.now();
        }

        // Periodic pause to prevent UI blocking and allow ACKs to process
        if (i % 5 === 0) {
            await new Promise(r => setTimeout(r, 10));
        }

        // Trace logging for sender
        if (i === 0 || i % 100 === 0) {
            console.log(`SENDER_TRACE :: Sent chunk ${i}/${totalChunks}`);
        }
    }

    log(`SENDER_LOOP_COMPLETE :: Finished iterate for ${totalChunks} chunks`);

    if (session.active) {
        // Don't mark COMPLETE yet, wait for final confirmation (ACK) from the receiver
        updateTransferStatus(id, 'WAITING FOR RECEIVER...', '#f90');
        log(`STREAM_SENT :: ${file.name} - waiting for verification from ${conn.peer}`);
    }
}

/**
 * Handle chunk acknowledgement from receiver
 */
function handleFileChunkAck(data) {
    try {
        // Find session by transferId directly
        const session = pendingSends[data.transferId];

        if (!session) {
            console.warn(`ACK received for unknown session: ${data.transferId}`);
            return;
        }

        // Log progress occasionally to avoid spam
        if (data.receivedCount === data.total || data.receivedCount % 5 === 0) {
            log(`ACK_RECEIVED :: ${data.receivedCount}/${data.total} for ${data.transferId}`);
        }

        const percent = Math.floor((data.receivedCount / data.total) * 100);
        updateProgress(data.transferId, percent);

        if (data.receivedCount === data.total) {
            log(`ACK_COMPLETE :: All chunks verified by receiver for ${data.transferId}`);
            updateProgress(data.transferId, 100);
            updateTransferStatus(data.transferId, 'COMPLETE', '#0f0');
            session.active = false;

            // Final cleanup after successful verification
            setTimeout(() => delete pendingSends[data.transferId], 5000);
        }
    } catch (e) {
        console.error('Error handling ACK:', e);
    }
}

// 4. Recipient handles chunks
async function handleFileChunk(data, conn) {
    const session = incomingFiles[data.transferId];
    if (!session) return;

    try {
        // Determine which peer sent this chunk
        const senderId = session.meta.sender; // Assuming session stores sender ID
        let decryptedChunk;

        // Handle encrypted chunks - but skip decryption if sender is in unencrypted mode
        if (data.type === 'FILE_CHUNK_ENCRYPTED' && data.iv) {
            // Check if sender is in unencrypted mode
            if (unencryptedMode || unencryptedPeers.has(senderId)) {
                log(`DECRYPTION_SKIPPED :: ${data.transferId} (peer ${senderId} is unencrypted)`);
                // Treat encrypted data as plain data for unencrypted peers
                decryptedChunk = data.chunk;
            } else {
                // Normal encrypted decryption
                const key = sharedKeys[senderId]; // Use sharedKeys[senderId] as per original logic
                if (!key) {
                    log(`DECRYPTION_ERROR :: ${data.transferId} - No shared key available for sender ${senderId}`);
                    return;
                }

                decryptedChunk = await CryptoUtils.decryptChunk(data.chunk, key, data.iv); // Maintain original argument order (encryptedData, key, iv)
            }

            // Handle different transfer modes
            if (session.transferMode === 'stream') {
                // For streaming mode, write directly to the stream
                const stream = streamHandles[data.transferId];
                if (stream) {
                    await stream.write(decryptedChunk);
                }
            } else {
                // For RAM mode, store in chunks array
                if (!session.chunks) {
                    session.chunks = []; // Initialize if doesn't exist
                }
                session.chunks[data.index] = decryptedChunk;
            }
        } else {
            // Unencrypted chunk
            if (session.transferMode === 'stream') {
                // For streaming mode, write directly to the stream
                const stream = streamHandles[data.transferId];
                if (stream) {
                    await stream.write(data.chunk);
                }
            } else {
                // For RAM mode, store in chunks array
                if (!session.chunks) {
                    session.chunks = []; // Initialize if doesn't exist
                }
                session.chunks[data.index] = data.chunk;
            }
        }
    } catch (error) {
        console.error('Decryption error:', error);
        log(`DECRYPTION_ERROR :: ${data.transferId} - ${error.message}`);
        return; // This return causes the halt!
    }

    session.receivedCount++;

    // Track download metrics
    if (!downloadStartTime) downloadStartTime = Date.now();
    // Use actual chunk length for accurate metrics
    const chunkSize = data.chunk ? data.chunk.byteLength : CHUNK_SIZE;
    downloadBytes += chunkSize;
    lastChunkTime = Date.now();

    // Log periodic progress on receiver side
    if (session.receivedCount % 20 === 0) {
        console.log(`RCT_PROGRESS :: ${session.receivedCount}/${data.total}`);
    }

    const percent = Math.floor((session.receivedCount / data.total) * 100);
    updateProgress(data.transferId, percent);

    // Send ACK back to sender every 5 chunks or on completion
    if (session.receivedCount % 5 === 0 || session.receivedCount === data.total) {
        safeSend(conn, {
            type: 'FILE_CHUNK_ACK',
            transferId: data.transferId,
            receivedCount: session.receivedCount,
            total: data.total
        });
    }

    if (session.receivedCount === data.total) {
        log(`ACK_SENT :: Final confirmation for ${data.transferId}`);
        updateProgress(data.transferId, 100);

        // Handle completion based on transfer mode
        if (session.transferMode === 'stream') {
            const writable = streamHandles[data.transferId];
            if (writable) {
                await writable.close();
                delete streamHandles[data.transferId];
                delete transferModes[data.transferId];
                updateTransferStatus(data.transferId, 'COMPLETE', '#0f0');
                log(`STREAM_COMPLETE :: ${session.meta.fileName}`);
            }
            delete incomingFiles[data.transferId];
        } else {
            finalizeFile(data.transferId);
        }
    }
}

function finalizeFile(id) {
    const session = incomingFiles[id];
    if (!session || session.transferMode === 'stream') return; // Ensure it's RAM mode

    const blob = new Blob(session.chunks, { type: session.meta.fileType });
    const url = URL.createObjectURL(blob);

    const ui = document.getElementById(id);
    if (ui) {
        const statusEl = ui.querySelector('span:last-child');
        statusEl.innerText = 'COMPLETE';
        statusEl.style.color = '#0f0';

        const link = document.createElement('a');
        link.href = url;
        link.download = session.meta.fileName;
        link.innerText = '[ DOWNLOAD_FROM_RAM ]';
        link.className = 'download-link';
        ui.appendChild(link);
    }
    log(`TRANSFER_COMPLETE :: ${session.meta.fileName}`);
    delete incomingFiles[id];
}

// --- UI HELPERS ---
function createTransferUI(id, name, status, canCancel = false) {
    if (document.getElementById(id)) {
        updateTransferStatus(id, status, '#0af');
        return;
    }
    const div = document.createElement('div');
    div.id = id;
    div.className = 'transfer-item';
    div.innerHTML = `
        <div style="display:flex; justify-content:space-between;">
            <span style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>
            <span style="color: var(--cyber-blue)">${status}</span>
        </div>
        <div class="progress-bar"><div class="progress-inner" id="${id}_bar"></div></div>
        ${canCancel ? `<button onclick="cancelTransfer('${id}')" class="btn-cancel" style="font-size:8px; width:auto; padding:2px 5px; margin-top:5px; border-color:#666; color:#666;">CANCEL_UPLINK</button>` : ''}
    `;
    elTransfers.prepend(div);
    if (document.getElementById('accept-modal')) document.getElementById('accept-modal').style.zIndex = '2000';
    if (document.getElementById('modal-overlay')) document.getElementById('modal-overlay').style.zIndex = '1999';
}

function updateProgress(id, percent) {
    const bar = document.getElementById(`${id}_bar`);
    if (bar) bar.style.width = percent + '%';
}

document.getElementById('btn-connect').onclick = () => {
    const tid = document.getElementById('connect-to-peer-id').value;
    if (tid && tid !== myId) handleP2PConnection(peer.connect(tid));
    document.getElementById('connect-to-peer-id').value = '';
};

document.getElementById('btn-copy-id').onclick = () => {
    const id = document.getElementById('my-peer-id').innerText;
    navigator.clipboard.writeText(id).then(() => {
        const btn = document.getElementById('btn-copy-id');
        btn.innerText = 'COPIED!';
        setTimeout(() => btn.innerText = 'COPY', 2000);
    });
};
