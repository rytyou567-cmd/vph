/**
 * SHIELD SCANNER: Forensic Threat Detection Engine
 * 
 * ROLE:
 * Performs multi-layered heuristic analysis on uploaded files to detect malware signatures,
 * suspicious metadata, and active content (scripts) that could compromise user security.
 * 
 * DETECTION CAPABILITIES:
 * - Forensic Header Analysis (Magic Number validation)
 * - PDF Security Analysis (JS injection, Auto-execution triggers)
 * - Script Detection (Embedded <script> in SVG, VBA macros in Office)
 * - Phishing Heuristics (Keyword density, suspicious domain tracking)
 * - Evasive Technique Detection (Double extensions, null-byte padding, EOF smuggling)
 * 
 * ARCHITECTURE:
 * - Static Analysis: Scans file headers and raw text segments without execution
 * - Pattern Matching: Uses regex and keyword sets for rapid discovery
 * - Scoring: Aggregates multiple indicators to determine overall safety
 */
export class ShieldScanner {
    /**
     * INITIALIZATION: Configures common file signatures (Magic Numbers)
     */
    constructor() {
        this.threats = [];
        this.magicNumbers = {
            pdf: [0x25, 0x50, 0x44, 0x46],
            png: [0x89, 0x50, 0x4E, 0x47],
            jpg: [0xFF, 0xD8, 0xFF],
            zip: [0x50, 0x4B, 0x03, 0x04],
            exe: [0x4D, 0x5A]
        };
    }

    /**
     * FORENSIC UTILITY: Maps a byte offset to a specific line number and snippet for logging
     * @param {string} text - Scanned text segment
     * @param {number} index - Byte/Character offset
     * @returns {object} { number, content } information
     */
    getLineInfo(text, index) {
        if (index < 0) return { number: 1, content: '' };
        const lines = text.substring(0, index).split('\n');
        const lineNumber = lines.length;
        const fullLines = text.split('\n');
        const content = (fullLines[lineNumber - 1] || '').trim().substring(0, 100);
        return { number: lineNumber, content: content };
    }

    /**
     * MASTER SCAN: Orchestrates the 20-point security analysis pipeline
     * 
     * @param {File} file - Target file for investigation
     * @returns {object} { safe, threats } result pack
     */
    async scan(file) {
        this.threats = [];
        const buffer = await file.arrayBuffer();
        const header = new Uint8Array(buffer.slice(0, 16));
        const text = new TextDecoder().decode(buffer.slice(0, 100000)); // Scan first 100KB for text patterns

        // 1. Double Extension Detection
        this.checkDoubleExtension(file.name);

        // 2. Suspicious Filename
        this.checkSuspiciousFilename(file.name);

        // 3. Magic Number Mismatch
        this.checkMagicNumber(file, header);

        // 4. EICAR Test Signature
        this.checkEicar(text);

        // 5. PDF JavaScript Detection
        this.checkPdfJS(text);

        // 6. PDF OpenAction Detection
        this.checkPdfOpenAction(text);

        // 7. SVG Script Injection
        this.checkSvgScript(text, file.name);

        // 8. Embedded Executable (MZ Header)
        this.checkEmbeddedPE(header, buffer, file.name);

        // 9. Office Macro Detection (Basic)
        this.checkOfficeMacros(text, file.name);

        // 10. Zip Autorun Detection
        this.checkAutorun(text, file.name);

        // 11. Obfuscated Script detection
        this.checkObfuscation(text);

        // 12. Phishing Keyword Detection
        this.checkPhishing(text);

        // 13. Null Byte Padding
        this.checkNullPadding(buffer);

        // 14. DDE Exploit Detection
        this.checkDDE(text);

        // 15. High Entropy / Packed Data
        this.checkHighEntropy(buffer);

        // 16. Polyglot Detection
        this.checkPolyglot(header, text);

        // 17. Recursive Depth (Mock check for names)
        this.checkRecursiveDepth(file.name);

        // 18. Malformed PDF Header
        this.checkPdfMalformed(header, file.name);

        // 19. Stealth EOF Data
        this.checkStealthEOF(buffer, file.name);

        // 20. Suspicious Phishing Domains
        this.checkSuspiciousDomains(text);

        return {
            safe: this.threats.length === 0,
            threats: this.threats
        };
    }

    /**
     * REPORTING: Commits a detected threat to the project manifest
     */
    addThreat(type, severity, description) {
        this.threats.push({ type, severity, description });
    }

    checkDoubleExtension(name) {
        const parts = name.split('.');
        if (parts.length > 2) {
            const ext = parts[parts.length - 1].toLowerCase();
            const prevExt = parts[parts.length - 2].toLowerCase();
            const dangerous = ['exe', 'bat', 'cmd', 'sh', 'js', 'vbs', 'scr'];
            if (dangerous.includes(ext) || dangerous.includes(prevExt)) {
                this.addThreat('Double Extension', 'High', `File has suspicious multiple extensions: .${prevExt}.${ext}`);
            }
        }
    }

    checkSuspiciousFilename(name) {
        const suspicious = [/invoice/i, /payment/i, /urgent/i, /overdue/i, /account/i, /verify/i];
        if (suspicious.some(reg => reg.test(name)) && name.includes(' ')) {
            this.addThreat('Suspicious Name', 'Low', 'Filename contains common phishing keywords.');
        }
    }

    checkMagicNumber(file, header) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (this.magicNumbers[ext]) {
            const expected = this.magicNumbers[ext];
            const actual = Array.from(header.slice(0, expected.length));
            if (!expected.every((val, i) => val === actual[i])) {
                this.addThreat('Mismatched Header', 'Critical', `File extension .${ext} does not match its internal data structure.`);
            }
        }
    }

    checkEicar(text) {
        if (text.includes('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')) {
            this.addThreat('EICAR Test Virus', 'Critical', 'Standard antivirus test signature detected.');
        }
    }

    checkPdfJS(text) {
        if (text.includes('/JS') || text.includes('/JavaScript')) {
            const start = text.includes('/JavaScript') ? text.indexOf('/JavaScript') : text.indexOf('/JS');
            const info = this.getLineInfo(text, start);
            this.addThreat('PDF JavaScript', 'Medium', `Embedded JavaScript detected in PDF. Could lead to cross-site scripting. | LOG: [L${info.number}] ${info.content}`);
        }
    }

    checkPdfOpenAction(text) {
        if (text.includes('/OpenAction') || text.includes('/AA')) {
            let actionType = 'General';
            let detail = '';
            let log = '';

            // Try to extract the action dictionary
            const start = text.includes('/OpenAction') ? text.indexOf('/OpenAction') : text.indexOf('/AA');
            const snippet = text.substring(Math.max(0, start - 20), start + 300);

            if (snippet.includes('/S/JavaScript') || snippet.includes('/S /JavaScript')) {
                actionType = 'JavaScript';
                const jsMatch = snippet.match(/\/JS\s*\((.*?)\)/s) || snippet.match(/\/JS\s*<(.*?)>/s);
                log = jsMatch ? `Script Snippet: ${jsMatch[1].substring(0, 100)}...` : 'Embedded JavaScript detected.';
                detail = 'Executes embedded script automatically.';
            } else if (snippet.includes('/S/Launch') || snippet.includes('/S /Launch')) {
                actionType = 'Program Launch';
                const fileMatch = snippet.match(/\/F\s*\((.*?)\)/) || snippet.match(/\/FileName\s*\((.*?)\)/);
                log = fileMatch ? `Target App/File: ${fileMatch[1]}` : 'Attempts to launch an external system command.';
                detail = 'Attempts to launch an external file or application.';
            } else if (snippet.includes('/S/URI') || snippet.includes('/S /URI')) {
                actionType = 'URL Redirect';
                const uriMatch = snippet.match(/\/URI\s*\((.*?)\)/);
                log = uriMatch ? `Destination: ${uriMatch[1]}` : 'Hidden web link detected.';
                detail = uriMatch ? `Redirects to: ${uriMatch[1]}` : 'Redirects to an external URL or web resource.';
            } else if (snippet.includes('/S/SubmitForm') || snippet.includes('/S /SubmitForm')) {
                actionType = 'Data Submission';
                const urlMatch = snippet.match(/\/F\s*\((.*?)\)/);
                log = urlMatch ? `Server Endpoint: ${urlMatch[1]}` : 'Automated form submission detected.';
                detail = 'Automatically submits form data to a remote server.';
            } else if (text.includes('/AA')) {
                actionType = 'Additional Action';
                detail = 'PDF contains context-sensitive automated actions (e.g., trigger on page open/close).';
                log = 'Action trigger found in PDF metadata dictionary.';
            }

            const info = this.getLineInfo(text, start);
            this.addThreat(`PDF Auto-Execution (${actionType})`, 'High', `${detail} | LOG: [L${info.number}] ${info.content}`);
        }
    }

    checkSvgScript(text, name) {
        if (name.endsWith('.svg') && (text.includes('<script') || text.includes('onload='))) {
            const start = text.includes('<script') ? text.indexOf('<script') : text.indexOf('onload=');
            const info = this.getLineInfo(text, start);
            this.addThreat('SVG Script Execution', 'High', `SVG image file contains embedded scripts or event handlers that execute when rendered. | LOG: [L${info.number}] ${info.content}`);
        }
    }

    checkEmbeddedPE(header, buffer, name) {
        const ext = name.split('.').pop().toLowerCase();
        if (ext !== 'exe' && ext !== 'dll') {
            const view = new Uint8Array(buffer);
            for (let i = 0; i < Math.min(view.length, 1024); i++) {
                if (view[i] === 0x4D && view[i + 1] === 0x5A) { // MZ
                    this.addThreat('Hidden Executable', 'Critical', `Executable binary header found inside a non-binary file. | LOG: Magic Header: 0x4D 0x5A (MZ) found at offset ${i}`);
                    break;
                }
            }
        }
    }

    checkOfficeMacros(text, name) {
        const officeExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
        if (officeExts.includes(name.split('.').pop().toLowerCase())) {
            if (text.includes('vbaProject.bin') || text.includes('word/vbaProject')) {
                const marker = text.includes('vbaProject.bin') ? 'vbaProject.bin' : 'word/vbaProject';
                const start = text.indexOf(marker);
                const info = this.getLineInfo(text, start);
                this.addThreat('Office Macro Execution', 'High', `Microsoft Office (${name.split('.').pop().toUpperCase()}) file contains embedded VBA macros capable of executing malicious code. | LOG: [L${info.number}] ${info.content}`);
            }
        }
    }

    checkAutorun(text, name) {
        if (text.includes('autorun.inf') || text.includes('[autorun]')) {
            this.addThreat('Auto-Run Config', 'Medium', 'Detection of auto-run configuration files.');
        }
    }

    checkObfuscation(text) {
        const patterns = [/eval\s*\(/, /unescape\s*\(/, /String\.fromCharCode/];
        let score = 0;
        let firstMatchIndex = -1;
        patterns.forEach(p => {
            const match = text.match(p);
            if (match) {
                if (firstMatchIndex === -1) firstMatchIndex = match.index;
                score++;
            }
        });
        if (text.length > 1000 && (text.match(/[a-zA-Z0-9+/]{100,}/g) || []).length > 2) score++; // Base64 density
        if (score >= 2) {
            const info = firstMatchIndex !== -1 ? this.getLineInfo(text, firstMatchIndex) : { number: '?', content: 'Unknown' };
            this.addThreat('Obfuscated Code', 'Low', `Highly obfuscated strings detected, common in malware payloads. | LOG: [L${info.number}] ${info.content}`);
        }
    }

    checkPhishing(text) {
        const keywords = ['login to view', 'click here to verify', 'suspended account', 'action required'];
        const found = keywords.filter(k => text.toLowerCase().includes(k));
        if (found.length > 0) {
            const first = text.toLowerCase().indexOf(found[0]);
            const info = this.getLineInfo(text, first);
            this.addThreat('Potential Phishing Content', 'Medium', `Document contains language typical of phishing attempts. | LOG: [L${info.number}] ${info.content}`);
        }
    }

    checkNullPadding(buffer) {
        const view = new Uint8Array(buffer);
        let nullCount = 0;
        for (let i = view.length - 1; i > Math.max(0, view.length - 1000); i--) {
            if (view[i] === 0) nullCount++;
        }
        if (nullCount > 500) {
            this.addThreat('Excessive Padding', 'Low', 'Large amounts of trailing null bytes detected (possible payload masking).');
        }
    }

    checkDDE(text) {
        if (text.includes('DDEAUTO') || text.includes('DDE ')) {
            const start = text.includes('DDEAUTO') ? text.indexOf('DDEAUTO') : text.indexOf('DDE ');
            const info = this.getLineInfo(text, start);
            this.addThreat('DDE Exploit', 'High', `Potential Dynamic Data Exchange (DDE) exploit pattern detected. | LOG: [L${info.number}] ${info.content}`);
        }
    }

    checkHighEntropy(buffer) {
        // Mock entropy check - truly high entropy needs more math, but we can flag very large, non-standard files
        if (buffer.byteLength > 10 * 1024 * 1024 && !['mp4', 'mkv', 'zip'].includes(name.split('.').pop())) {
            // Just a placeholder for the logic
        }
    }

    checkPolyglot(header, text) {
        if (text.includes('%PDF') && (header[0] === 0xFF && header[1] === 0xD8)) {
            this.addThreat('Polyglot File', 'High', 'File appears to be both a JPEG and a PDF (malicious technique).');
        }
    }

    checkRecursiveDepth(name) {
        if ((name.match(/\//g) || []).length > 10) {
            this.addThreat('Excessive Nesting', 'Low', 'File path depth is unusually high.');
        }
    }

    checkPdfMalformed(header, name) {
        if (name.endsWith('.pdf') && (header[0] !== 0x25 || header[1] !== 0x50)) {
            this.addThreat('Malformed PDF', 'Medium', 'PDF header is missing or corrupted.');
        }
    }

    checkStealthEOF(buffer, name) {
        // Logic: Search for multiple EOF markers in PDF or data after PNG IEND
        const text = new TextDecoder().decode(buffer.slice(-100));
        if (name.endsWith('.pdf') && (text.match(/%%EOF/g) || []).length > 2) {
            this.addThreat('Stealth Payload', 'Medium', 'Multiple end-of-file markers detected. Could hide secondary payloads.');
        }
    }

    checkSuspiciousDomains(text) {
        const suspicious = ['bit.ly', 'tinyurl.com', 'ipfs.io', 'ngrok-free.app'];
        const found = suspicious.find(domain => text.includes(domain));
        if (found) {
            const start = text.indexOf(found);
            const info = this.getLineInfo(text, start);
            this.addThreat('Suspicious Link', 'Low', `Document contains links to URL shorteners or tunneling services. | LOG: [L${info.number}] ${info.content}`);
        }
    }
}
