/**
 * MESH DROP - P2P FILE TRANSFER (SECURE HANDSHAKE V2)
 */

const myId = Math.random().toString(36).substr(2, 6);
const peer = new Peer(myId);

/* STATE */
const connectedPeers = {};
const CHUNK_SIZE = 16384 * 4; // 64KB chunks
const incomingFiles = {};
const pendingSends = {};
const pendingOffers = [];

// DOM
const elId = document.getElementById('my-peer-id');
const elPeerCount = document.getElementById('peer-count');
const elPeerList = document.getElementById('peer-list');
const elDropZone = document.getElementById('drop-zone');
const elTransfers = document.getElementById('transfers');
const elLog = document.getElementById('log-terminal');

// Modal DOM
const elAcceptModal = document.getElementById('accept-modal');
const elModalOverlay = document.getElementById('modal-overlay');
const elAcceptInfo = document.getElementById('accept-file-info');
const elBtnAccept = document.getElementById('btn-accept-transfer');
const elBtnAcceptAll = document.getElementById('btn-accept-all');
const elBtnReject = document.getElementById('btn-reject-transfer');

function log(msg) {
    const div = document.createElement('div');
    div.innerText = `> ${msg}`;
    elLog.prepend(div);
}

// --- PEERJS CORE ---
peer.on('open', (id) => {
    elId.innerText = id;
    log(`UPLINK_READY :: ${id}`);
});

peer.on('connection', (conn) => {
    handleP2PConnection(conn);
});

function handleP2PConnection(conn) {
    conn.on('open', () => {
        connectedPeers[conn.peer] = conn;
        updateUI();
        log(`NODE_LINKED :: ${conn.peer}`);
    });

    conn.on('data', (data) => {
        handleIncomingData(data, conn);
    });

    conn.on('close', () => {
        delete connectedPeers[conn.peer];
        updateUI();
        log(`LINK_LOST :: ${conn.peer}`);
    });
}

function handleIncomingData(data, conn) {
    switch (data.type) {
        case 'FILE_OFFER':
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
            handleFileChunk(data);
            break;
    }
}

function updateUI() {
    elPeerCount.innerText = Object.keys(connectedPeers).length;
    elPeerList.innerHTML = '';
    for (let id in connectedPeers) {
        const div = document.createElement('div');
        div.className = 'node-item';
        div.innerText = `> ${id}`;
        elPeerList.appendChild(div);
    }
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
    const peers = Object.values(connectedPeers);
    if (peers.length === 0) return alert("NO PEERS CONNECTED.");

    const transferId = 'tx_' + Math.random().toString(36).substr(2, 6);
    pendingSends[transferId] = { file, active: true };

    createTransferUI(transferId, file.name, 'OFFERING', true);
    log(`OFFERING :: ${file.name}`);

    peers.forEach(p => p.send({
        type: 'FILE_OFFER',
        transferId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        sender: myId
    }));
}

window.cancelTransfer = (id) => {
    if (pendingSends[id]) {
        pendingSends[id].active = false;
        log(`CANCELLED_SEND :: ${id}`);
        for (let pId in connectedPeers) {
            connectedPeers[pId].send({ type: 'FILE_CANCEL', transferId: id });
        }
        updateTransferStatus(id, 'CANCELLED', '#666');
    }
};

// 2. Recipient handles offer
function handleFileOffer(meta, conn) {
    incomingFiles[meta.transferId] = { meta, chunks: [], receivedCount: 0 };
    pendingOffers.push({ meta, conn });

    createTransferUI(meta.transferId, meta.fileName, 'PENDING_ACCEPT');
    updateAcceptModal();
}

function updateAcceptModal() {
    if (pendingOffers.length === 0) {
        closeModal();
        return;
    }

    const { meta, conn } = pendingOffers[0];

    if (pendingOffers.length > 1) {
        elAcceptInfo.innerHTML = `[BATCH_UPLINK :: ${pendingOffers.length} FILES]<br><br>CURRENT: <span style="color:#0f0">${meta.fileName}</span><br>SIZE: ${(meta.fileSize / (1024 * 1024)).toFixed(2)} MB<br>NODE: ${conn.peer}`;
        elBtnAcceptAll.style.display = 'inline-block';
    } else {
        elAcceptInfo.innerHTML = `FILE: <span style="color:#0f0">${meta.fileName}</span><br>SIZE: ${(meta.fileSize / (1024 * 1024)).toFixed(2)} MB<br>NODE: ${conn.peer}`;
        elBtnAcceptAll.style.display = 'none';
    }

    elAcceptModal.style.display = 'block';
    elModalOverlay.style.display = 'block';

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
}

function acceptOffer(offer) {
    offer.conn.send({ type: 'FILE_ACCEPT', transferId: offer.meta.transferId });
    createTransferUI(offer.meta.transferId, offer.meta.fileName, 'RECEIVING');
}

// 3. Sender starts streaming
async function startFileStream(id, conn) {
    const session = pendingSends[id];
    if (!session || !session.active) return;
    const file = session.file;

    updateTransferStatus(id, 'STREAMING', '#0af');
    log(`STREAM_START :: ${file.name} -> ${conn.peer}`);

    const buffer = await file.arrayBuffer();
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
        if (!session.active) break; // Check for cancellation mid-stream

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
        const chunk = buffer.slice(start, end);

        conn.send({
            type: 'FILE_CHUNK',
            transferId: id,
            index: i,
            total: totalChunks,
            chunk: chunk
        });

        if (i % 5 === 0) {
            updateProgress(id, Math.floor((i / totalChunks) * 100));
            await new Promise(r => setTimeout(r, 20));
        }
    }

    if (session.active) {
        updateProgress(id, 100);
        updateTransferStatus(id, 'COMPLETE', '#0f0');
        log(`STREAM_COMPLETE :: ${file.name}`);
    }
}

// 4. Recipient handles chunks
function handleFileChunk(data) {
    const session = incomingFiles[data.transferId];
    if (!session) return;

    session.chunks[data.index] = data.chunk;
    session.receivedCount++;

    const percent = Math.floor((session.receivedCount / data.total) * 100);
    updateProgress(data.transferId, percent);

    if (session.receivedCount === data.total) {
        finalizeFile(data.transferId);
    }
}

function finalizeFile(id) {
    const session = incomingFiles[id];
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
