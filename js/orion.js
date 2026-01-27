/**
 * ORION: JSON-to-SVG Data Visualizer
 * ViewPorts Data Suite
 * 
 * ROLE:
 * Universal JSON/log visualizer with intelligent schema detection.
 * Converts raw network logs, firewall data, or arbitrary JSON into interactive SVG network topologies.
 * 
 * ARCHITECTURE:
 * - Adaptive Parser: Automatically detects structure (firewall logs, network traffic, generic JSON)
 * - Layout Engine: Tree hierarchy + force-directed positioning
 * - Interactive SVG: Pan, zoom, drag nodes, animated particle flows
 * - Multi-Viz Modes: Network map, threat radar, log topology, hex grid, flow diagram
 * 
 * KEY WORKFLOWS:
 * 1. INGESTION: Paste JSON/logs → Parse (JSON.parse or TCPdump regex)
 * 2. NORMALIZATION: Extract nodes/connections from arbitrary structure via recursive search
 * 3. LAYOUT: Build hierarchical tree (routers at top) or force layout
 * 4. RENDERING: Generate SVG with animated particles, threat indicators, interactive nodes
 * 5. INTERACTION: Mouse drag to pan/move nodes, scroll to zoom, real-time updates
 * 
 * VISUALIZATION MODES:
 * - NETWORK: Hierarchical network topology with live packet animation
 * - THREAT: Same as network but emphasizes anomalous/threat connections (red pulses)
 * - LOG: Network map optimized for firewall/router logs
 * - RADAR: Polar plot for numeric data
 * - HEX: Hexagonal grid heatmap
 * - FLOW: Bezier flow lines with animated particles
 */

const ORION = (() => {
    let elements = {};
    let currentData = null;
    let transform = { x: 0, y: 0, k: 1 };
    let nodePositions = {};
    let dragData = { active: false, node: null, startX: 0, startY: 0, type: 'pan' };

    /**
     * INITIALIZATION: Binds DOM elements and establishes the global resize observer
     */
    function init(config) {
        elements = {
            dataArea: document.getElementById(config.dataAreaId),
            chartContainer: document.getElementById(config.chartId),
            chartTypeSelect: document.getElementById(config.chartTypeId),
            scanBtn: document.getElementById(config.scanBtnId)
        };

        setupEventListeners();
        window.addEventListener('resize', () => {
            if (currentData) renderChart();
        });
    }

    /**
     * EVENT HANDLERS: Configures interaction listeners (pan, zoom, drag, and mode switching)
     */
    function setupEventListeners() {
        elements.scanBtn.onclick = scanData;

        elements.chartTypeSelect.onchange = () => {
            // Reset transform when switching modes
            transform = { x: 0, y: 0, k: 1 };
            renderChart();
        };

        elements.chartContainer.onwheel = (e) => {
            if (!['network', 'threat', 'log'].includes(elements.chartTypeSelect.value)) return;
            e.preventDefault();
            const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
            transform.k *= scaleFactor;
            renderChart();
        };

        elements.chartContainer.onmousedown = (e) => {
            if (!['network', 'threat', 'log'].includes(elements.chartTypeSelect.value)) return;
            const nodeGrp = e.target.closest('.orion-node');
            if (nodeGrp) {
                dragData = { active: true, node: nodeGrp.dataset.id, startX: e.clientX, startY: e.clientY, type: 'node' };
            } else {
                dragData = { active: true, startX: e.clientX, startY: e.clientY, type: 'pan' };
            }
        };

        window.onmousemove = (e) => {
            if (!dragData.active || !['network', 'threat', 'log'].includes(elements.chartTypeSelect.value)) return;
            const dx = (e.clientX - dragData.startX) / transform.k;
            const dy = (e.clientY - dragData.startY) / transform.k;

            if (dragData.type === 'node' && dragData.node) {
                const pos = nodePositions[dragData.node];
                if (pos) {
                    pos.x += dx;
                    pos.y += dy;
                }
            } else if (dragData.type === 'pan') {
                transform.x += dx * transform.k;
                transform.y += dy * transform.k;
            }

            dragData.startX = e.clientX;
            dragData.startY = e.clientY;
            renderChart();
        };

        window.onmouseup = () => {
            dragData.active = false;
        };

        elements.chartContainer.onmouseleave = () => {
            // Optional: Stop dragging if mouse leaves the container area
            dragData.active = false;
        };
    }

    /**
     * INGESTION ENGINE: Validates raw input and determines the appropriate parser (JSON vs TCPdump)
     * 
     * WORKFLOW:
     * 1. Extract raw data from textarea
     * 2. Detect encoding (JSON/Text)
     * 3. Trigger Normalization pipeline
     * 4. Reset transform state and trigger render
     */
    function scanData() {
        const raw = elements.dataArea.value.trim();
        if (!raw) return;

        try {
            let parsed = null;
            if (raw.startsWith('{') || raw.startsWith('[')) {
                parsed = JSON.parse(raw);
            } else {
                parsed = parseRawPackets(raw);
            }

            currentData = normalizeData(parsed);

            // Reset view state on new scan
            nodePositions = {};
            transform = { x: 0, y: 0, k: 1 };
            renderChart();
        } catch (e) {
            console.error(e);
            alert('Data Stream Corruption: Invalid encoding in core segment.');
        }
    }

    /**
     * DATA NORMALIZATION: Transitions heterogeneous input into a unified Network Topology schema
     * 
     * ROLE:
     * High-tolerance parser that can extract "nodes" and "connections" from almost any JSON structure
     * using fuzzy key matching and recursive deep harvesting.
     */
    function normalizeData(data) {
        const result = {
            nodes: [],
            connections: [],
            clusters: []
        };

        // Helper: Recursive search for arrays by key
        /**
         * DEEP HARVEST: Recursively scans object trees for arrays matching specific keyword sets
         * @param {object} obj - Object to scan
         * @param {string[]} keys - Keywords to look for (e.g. 'nodes', 'hosts')
         * @returns {any[]} Found array data
         */
        function deepHarvest(obj, keys, visited = new Set()) {
            if (!obj || typeof obj !== 'object' || visited.has(obj)) return [];
            visited.add(obj);

            for (const k of keys) {
                if (Array.isArray(obj[k])) return obj[k];
            }

            for (const key in obj) {
                const found = deepHarvest(obj[key], keys, visited);
                if (found.length > 0) return found;
            }
            return [];
        }

        // 1. Schema Detection (Specialized layouts)
        if (data.firewallLog) {
            const nodeSet = new Map();
            data.firewallLog.forEach(log => {
                [log.sourceIP, log.destinationIP].forEach(ip => {
                    if (!nodeSet.has(ip)) {
                        nodeSet.set(ip, {
                            id: ip, label: ip, ip: ip,
                            type: (ip.includes('192.168') || ip.startsWith('10.')) ? (ip.endsWith('.1') ? 'router' : 'desktop') : 'cloud'
                        });
                    }
                });
                result.connections.push({
                    source: log.sourceIP, destination: log.destinationIP,
                    port: log.destinationPort, flags: log.protocol + (log.action === 'DENY' ? ' [DENIED]' : ''),
                    status: (log.action === 'DENY' || log.threatDetected) ? 'anomaly' : 'normal',
                    threat: log.threatDetected || false
                });
            });
            result.nodes = Array.from(nodeSet.values());
            return { networkTraffic: result };
        }

        // Explicit match for unified format
        if (data.networkTraffic) return data;
        if (data.threatMapping) return { networkTraffic: data.threatMapping }; // Flatten for unified rendering

        // 2. Harvesting Nodes (Looking for common array keys anywhere in the doc)
        const nodeKeys = ['nodes', 'devices', 'hosts', 'entities', 'servers', 'points', 'topology'];
        let rawNodes = deepHarvest(data, nodeKeys);

        if (rawNodes.length === 0 && Array.isArray(data)) {
            rawNodes = data;
        } else if (rawNodes.length === 0) {
            // Last resort: find ANY array that contains objects with 'id' or 'name'
            const allArrays = [];
            const findArrays = (obj, visited = new Set()) => {
                if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
                visited.add(obj);
                if (Array.isArray(obj)) allArrays.push(obj);
                else Object.values(obj).forEach(v => findArrays(v, visited));
            };
            findArrays(data);
            rawNodes = allArrays.find(arr => arr.some(item => typeof item === 'object' && (item.id || item.uid || item.name))) || [];
        }

        rawNodes.forEach((item, idx) => {
            const isObj = typeof item === 'object' && item !== null;
            const id = isObj ? (item.id || item.uid || item.name || item.ip || `node_${idx}`) : String(item);
            const label = isObj ? (item.label || item.name || item.title || id) : id;

            let status = (isObj && item.status) || 'active';
            if (isObj) {
                const riskKeys = ['error', 'fail', 'compromised', 'breach', 'alert', 'warn'];
                Object.keys(item).forEach(k => {
                    if (riskKeys.some(rk => k.toLowerCase().includes(rk))) {
                        if (item[k] === true || String(item[k]).toLowerCase().includes('fail') || String(item[k]).toLowerCase().includes('high')) {
                            status = 'compromised';
                        }
                    }
                });
            }

            result.nodes.push({
                ...(isObj ? item : {}),
                id: String(id),
                label: String(label),
                type: (isObj && item.type) || (isObj && item.role) || (String(label).toLowerCase().includes('router') ? 'router' : 'desktop'),
                status: status
            });
        });

        // 3. Harvesting Connections
        const connKeys = ['connections', 'links', 'edges', 'traffic', 'paths', 'relations', 'flows'];
        let rawConns = deepHarvest(data, connKeys);

        rawConns.forEach(conn => {
            if (typeof conn !== 'object') return;
            const src = conn.source || conn.from || conn.src || conn.start || conn.origin;
            const dst = conn.destination || conn.to || conn.dst || conn.target || conn.end;
            if (src && dst) {
                result.connections.push({
                    ...conn,
                    source: String(src),
                    destination: String(dst),
                    status: conn.status || 'normal'
                });
            }
        });

        // 4. Recursive Property Discovery (Inside nodes)
        result.nodes.forEach(node => {
            Object.entries(node).forEach(([key, value]) => {
                const k = key.toLowerCase();
                if (k === 'id' || k === 'label') return;

                if (['source', 'from'].includes(k)) result.connections.push({ source: String(value), destination: node.id });
                if (['destination', 'to', 'target'].includes(k)) result.connections.push({ source: node.id, destination: String(value) });

                if (Array.isArray(value) && (k.includes('conn') || k.includes('link') || k.includes('friend') || k.includes('neighbor'))) {
                    value.forEach(v => {
                        const targetId = typeof v === 'object' ? (v.id || v.uid || v.name) : v;
                        if (targetId) result.connections.push({ source: node.id, destination: String(targetId) });
                    });
                }
            });
        });

        // 5. Harvesting Clusters
        const clusterKeys = ['clusters', 'groups', 'zones', 'segments'];
        result.clusters = deepHarvest(data, clusterKeys);

        if (result.clusters.length === 0 && result.nodes.length > 0) {
            // Auto-Cluster by Type
            const typeGroups = {};
            result.nodes.forEach(node => {
                const type = node.type || 'desktop';
                if (!typeGroups[type]) typeGroups[type] = [];
                typeGroups[type].push(node.id);
            });
            result.clusters = Object.entries(typeGroups).map(([type, ids]) => ({
                clusterID: type,
                clusterName: type.toUpperCase(),
                nodes: ids,
                threatLevel: type === 'router' ? 'high' : 'low',
                color: type === 'router' ? 'red' : 'green'
            }));
        }

        // 6. Self-Healing (Create nodes for any referenced ID)
        const nodeMap = new Set(result.nodes.map(n => n.id));
        const healedNodes = [];
        result.connections.forEach(conn => {
            [conn.source, conn.destination].forEach(id => {
                if (!nodeMap.has(id)) {
                    healedNodes.push({
                        id: id,
                        label: id,
                        ip: id.includes('.') ? id : '',
                        type: id.toLowerCase().includes('router') ? 'router' : 'desktop',
                        status: 'active'
                    });
                    nodeMap.add(id);
                }
            });
        });
        result.nodes.push(...healedNodes);

        // 7. Dedup
        result.connections = result.connections.filter((conn, index, self) =>
            index === self.findIndex((t) => (t.source === conn.source && t.destination === conn.destination))
        );

        return { networkTraffic: result };
    }

    /**
     * TREE BUILDER: Generates a parent-child adjacency map for hierarchical layout
     * @param {object[]} nodes - Normalized nodes
     * @param {object[]} connections - Normalized links
     * @returns {object} { levels, childrenMap, roots } mapping
     */
    function buildTreeHierarchy(nodes, connections) {
        // Build adjacency map
        const childrenMap = new Map();
        const parentMap = new Map();

        nodes.forEach(n => {
            childrenMap.set(n.id, []);
            parentMap.set(n.id, null);
        });

        connections.forEach(conn => {
            if (childrenMap.has(conn.source) && nodes.find(n => n.id === conn.destination)) {
                childrenMap.get(conn.source).push(conn.destination);
                if (!parentMap.get(conn.destination)) {
                    parentMap.set(conn.destination, conn.source);
                }
            }
        });

        // Find root nodes (nodes with no parents, or routers/servers)
        const roots = [];
        nodes.forEach(node => {
            if (!parentMap.get(node.id) || node.type === 'router' || node.type === 'firewall') {
                roots.push(node.id);
                parentMap.set(node.id, null);
            }
        });

        // If no roots found, use first node
        if (roots.length === 0 && nodes.length > 0) {
            roots.push(nodes[0].id);
        }

        // Build levels
        const levels = [];
        const visited = new Set();

        /**
         * DEPTH RECURSION: Assigns nodes to levels (depth) for tree rendering
         */
        function buildLevel(nodeIds, depth) {
            if (nodeIds.length === 0) return;
            if (!levels[depth]) levels[depth] = [];

            nodeIds.forEach(id => {
                if (!visited.has(id)) {
                    visited.add(id);
                    levels[depth].push(id);

                    const children = childrenMap.get(id) || [];
                    const unvisitedChildren = children.filter(c => !visited.has(c));
                    if (unvisitedChildren.length > 0) {
                        buildLevel(unvisitedChildren, depth + 1);
                    }
                }
            });
        }

        buildLevel(roots, 0);

        // Add any remaining unvisited nodes to the last level
        const remaining = nodes.filter(n => !visited.has(n.id)).map(n => n.id);
        if (remaining.length > 0) {
            levels.push(remaining);
        }

        return { levels, childrenMap, roots };
    }

    /**
     * POSITION CALCULATOR: Maps hierarchical levels to 2D coordinates
     * Organizes nodes in rows (levels) with centered or distributed spacing.
     */
    function calculateTreePositions(hierarchy, w, h) {
        const positions = {};
        const { levels } = hierarchy;
        const levelHeight = Math.min(h / (levels.length + 1), 150);
        const topPadding = 80;

        levels.forEach((levelNodes, depth) => {
            const y = topPadding + (depth * levelHeight);
            const totalWidth = w - 160; // padding on sides
            const spacing = levelNodes.length > 1 ? totalWidth / (levelNodes.length - 1) : 0;
            const startX = levelNodes.length === 1 ? w / 2 : 80;

            levelNodes.forEach((nodeId, index) => {
                positions[nodeId] = {
                    x: levelNodes.length === 1 ? w / 2 : startX + (index * spacing),
                    y: y
                };
            });
        });

        return positions;
    }

    /**
     * PACKET PARSER: Forensic TCPdump analyzer
     * Uses regex to extract IP and Flags from raw network trace strings.
     */
    function parseRawPackets(text) {
        const lines = text.split('\n');
        const nodes = new Map();
        const connections = [];

        // Regex for TCPdump style: 17:23:45.123456 IP 192.168.1.10.47001 > 192.168.1.20.80: Flags [S]
        const regex = /(\d{2}:\d{2}:\d{2}\.\d+) IP ([\d\.]+)\.(\d+) > ([\d\.]+)\.(\d+): Flags \[([^\]]+)\]/i;

        lines.forEach((line, idx) => {
            const match = line.match(regex);
            if (match) {
                const [_, time, srcIP, srcPort, destIP, destPort, flags] = match;

                // Track Unique Nodes
                [srcIP, destIP].forEach(ip => {
                    if (!nodes.has(ip)) {
                        nodes.set(ip, {
                            id: ip,
                            label: ip,
                            ip: ip,
                            type: ip.endsWith('.1') ? 'router' : (idx < 5 ? 'server' : 'desktop')
                        });
                    }
                });

                // Track Connection
                connections.push({
                    source: srcIP,
                    destination: destIP,
                    port: destPort,
                    flags: getFlagDescription(flags),
                    packets: [{
                        timestamp: time,
                        status: flags.includes('R') ? 'anomaly' : 'normal',
                        details: `Flags: [${flags}]`
                    }]
                });
            }
        });

        return {
            networkTraffic: {
                nodes: Array.from(nodes.values()),
                connections: connections
            }
        };
    }

    /**
     * RENDER ORCHESTRATOR: Switches between SVG visualization modules based on UI selection
     */
    function renderChart() {
        if (!currentData) return;
        const type = elements.chartTypeSelect.value;
        const w = elements.chartContainer.clientWidth || 800;
        const h = elements.chartContainer.clientHeight || 600;

        let innerContent = "";
        if (type === 'radar') innerContent = getRadarContent(w, h);
        else if (type === 'hex') innerContent = getHexContent(w, h);
        else if (type === 'flow') innerContent = getFlowContent(w, h);
        else if (type === 'network') {
            renderNetworkMap(w, h);
            return;
        } else if (type === 'threat') {
            renderThreatMap(w, h);
            return;
        } else if (type === 'log') {
            renderLogMap(w, h);
            return;
        }

        let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="cursor: ${['network', 'threat', 'log'].includes(type) ? (dragData.active ? 'grabbing' : 'grab') : 'default'}">`;
        if (['network', 'threat', 'log'].includes(type)) {
            svg += `<g transform="translate(${transform.x}, ${transform.y}) scale(${transform.k})">`;
        } else {
            svg += `<g>`;
        }
        svg += innerContent;
        svg += `</g></svg>`;
        elements.chartContainer.innerHTML = svg;
    }

    /**
     * RADAR VIZ: Generates a polar plot for multidimensional data comparison
     */
    function getRadarContent(w, h) {
        const values = Array.isArray(currentData) ? currentData.slice(0, 10) : Object.values(currentData).slice(0, 10);
        const centerX = w / 2;
        const centerY = h / 2;
        const radius = Math.min(w, h) / 2.5;

        let content = "";
        // Background Grid
        for (let i = 1; i <= 5; i++) {
            content += `<circle cx="${centerX}" cy="${centerY}" r="${(radius / 5) * i}" fill="none" stroke="rgba(0,150,255,0.2)" stroke-width="1" />`;
        }

        // Axes
        const angles = values.length;
        for (let i = 0; i < angles; i++) {
            const angle = (Math.PI * 2 / angles) * i;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            content += `<line x1="${centerX}" y1="${centerY}" x2="${x}" y2="${y}" stroke="rgba(0,150,255,0.3)" />`;
        }

        // Data Polygon
        let points = "";
        values.forEach((v, i) => {
            const val = typeof v === 'number' ? v : (typeof v === 'object' ? Object.values(v)[0] : 50);
            const normalized = Math.min(Math.max(val, 0), 100) / 100;
            const angle = (Math.PI * 2 / angles) * i;
            const x = centerX + Math.cos(angle) * radius * normalized;
            const y = centerY + Math.sin(angle) * radius * normalized;
            points += `${x},${y} `;
            content += `<circle cx="${x}" cy="${y}" r="3" fill="#0096ff" />`;
        });

        content += `<polygon points="${points}" fill="rgba(0,150,255,0.2)" stroke="#0096ff" stroke-width="2" />`;
        return content;
    }

    /**
     * HEX VIZ: Generates a hexagonal background grid / heatmap
     */
    function getHexContent(w, h) {
        const hexSize = 30;
        const cols = Math.floor(w / (hexSize * 2));
        const rows = Math.floor(h / (hexSize * 1.5));
        let content = "";

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = c * hexSize * 1.75 + (r % 2 === 0 ? 0 : hexSize * 0.85);
                const y = r * hexSize * 1.5;
                const opacity = Math.random() * 0.5 + 0.1;
                content += `<path d="${getHexPath(x, y, hexSize)}" fill="rgba(0,150,255,${opacity})" stroke="rgba(0,150,255,0.4)" />`;
            }
        }
        return content;
    }

    function getHexPath(x, y, s) {
        let path = "M";
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            path += `${x + s * Math.cos(angle)},${y + s * Math.sin(angle)} `;
        }
        return path + "Z";
    }

    /**
     * FLOW VIZ: Generates Bezier curves with animated particles traveling between endpoints
     */
    function getFlowContent(w, h) {
        let content = "";
        const lines = 10;
        for (let i = 0; i < lines; i++) {
            const y = (h / lines) * i + 20;
            const path = `M 50 ${y} Q ${w / 2} ${y + (Math.random() * 40 - 20)} ${w - 50} ${y}`;
            content += `<path d="${path}" fill="none" stroke="rgba(0,150,255,0.4)" stroke-width="2" />`;
            content += `<circle r="4" fill="#0096ff">
                <animateMotion path="${path}" dur="${Math.random() * 2 + 1}s" repeatCount="indefinite" />
            </circle>`;
        }
        return content;
    }

    /**
     * NETWORK MAP: Renders a hierarchical tree visualization of network topology
     * Features live path animations and interactive node placement.
     */
    function renderNetworkMap(w, h) {
        if (!currentData || !currentData.networkTraffic) return;

        const nodes = currentData.networkTraffic.nodes || [];
        const connections = currentData.networkTraffic.connections || [];

        if (nodes.length === 0) {
            elements.chartContainer.innerHTML = '<div style="color:#0096ff; padding:20px;">[ORION ERR] UNIFIED DATA STREAM IS EMPTY. SCAN ABORTED.</div>';
            return;
        }

        const type = elements.chartTypeSelect.value;
        let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="cursor: ${type === 'network' ? (dragData.active ? 'grabbing' : 'grab') : 'default'}">`;
        svg += `<g transform="translate(${transform.x}, ${transform.y}) scale(${transform.k})">`;

        const centerX = w / 2;
        const centerY = h / 2;

        // Build Tree Structure
        nodes.forEach((node, i) => {
            if (!nodePositions[node.id]) {
                // Build hierarchical tree layout
                const hierarchy = buildTreeHierarchy(nodes, connections);
                const treePositions = calculateTreePositions(hierarchy, w, h);

                // Merge with nodePositions
                Object.assign(nodePositions, treePositions);
            }
            const pos = nodePositions[node.id];
            node.x = pos.x;
            node.y = pos.y;
        });

        const nodeMap = {};
        nodes.forEach(n => nodeMap[n.id] = n);

        // Draw Connections
        connections.forEach((conn, idx) => {
            const source = nodeMap[conn.source];
            const target = nodeMap[conn.destination];
            if (source && target) {
                const pathId = `flow_${conn.source}_${conn.destination}_${idx}`;
                const d = `M ${source.x} ${source.y} L ${target.x} ${target.y}`;

                // Connection Line
                svg += `<path id="${pathId}" d="${d}" stroke="rgba(0,150,255,0.2)" stroke-width="1" stroke-dasharray="4,2" fill="none" />`;

                // Detect Anomaly in connection
                const packets = conn.packets || [];
                const hasAnomaly = packets.some(p => p.status === 'anomaly');
                const isThreat = packets.some(p => p.threat);
                const particleColor = isThreat ? '#ff0000' : (hasAnomaly ? '#ff1e1e' : '#0096ff');

                // Kinetic Labels (Text that moves with the data)
                if (conn.port || conn.flags) {
                    const label = `${conn.port ? 'P' + conn.port : ''} ${conn.flags ? conn.flags : ''}`.trim();
                    const travelTime = 3;
                    svg += `
                    <text fill="${particleColor}" font-size="7" font-family="Rajdhani" font-weight="bold" text-anchor="middle" dy="-5" pointer-events="none">
                        <textPath href="#${pathId}" startOffset="0%">
                            ${label}
                            <animate attributeName="startOffset" from="0%" to="100%" dur="${travelTime}s" repeatCount="indefinite" />
                        </textPath>
                    </text>`;

                    // Specific Particle synced to text
                    svg += `
                    <circle r="3" fill="${particleColor}" pointer-events="none">
                        <animateMotion dur="${travelTime}s" repeatCount="indefinite">
                            <mpath href="#${pathId}" />
                        </animateMotion>
                        ${(isThreat || hasAnomaly) ? `<animate attributeName="r" values="${isThreat ? '4;7;4' : '2;4;2'}" dur="0.4s" repeatCount="indefinite" />` : ''}
                    </circle>`;
                }

                // Additional Background Data Pulses
                for (let j = 0; j < 2; j++) {
                    svg += `
                    <circle r="${isThreat ? 2 : 1.5}" fill="${particleColor}" opacity="0.4" pointer-events="none">
                        <animateMotion dur="${isThreat ? 1 : (2 + Math.random() * 2)}s" repeatCount="indefinite" begin="${j * 1}s">
                            <mpath href="#${pathId}" />
                        </animateMotion>
                    </circle>`;
                }
            }
        });

        // Draw Nodes
        nodes.forEach(node => {
            const type = node.type || (node.id.toLowerCase().includes('server') ? 'server' : 'desktop');
            const nodeShape = getNodeShape(type, node.status);
            const statusColor = node.status === 'compromised' ? '#ff1e1e' : '#0096ff';

            svg += `
            <g class="orion-node" data-id="${node.id}" transform="translate(${node.x}, ${node.y})" style="cursor: move">
                ${nodeShape}
                <g transform="translate(-12, -12) scale(0.6)">
                    ${getNodeIcon(type)}
                </g>
                <text x="0" y="35" fill="${statusColor}" font-family="Rajdhani" font-size="10" text-anchor="middle" font-weight="bold" pointer-events="none">${node.label || node.id}</text>
                <text x="0" y="45" fill="rgba(0,150,255,0.6)" font-family="Rajdhani" font-size="8" text-anchor="middle" pointer-events="none">${node.ip || ''}</text>
            </g>`;
        });

        svg += `</g></svg>`;
        elements.chartContainer.innerHTML = svg;
    }

    /**
     * SHAPE GENERATOR: Returns SVG vector data for various device categories (Router, Server, etc.)
     * Includes "glow" filters and "compromised" state animations.
     */
    function getNodeShape(type, status) {
        const isCompromised = status === 'compromised';
        const baseColor = isCompromised ? '#ff1e1e' : '#0096ff';
        const glowColor = isCompromised ? 'rgba(255,30,30,0.4)' : 'rgba(0,150,255,0.4)';

        const shapes = {
            router: `
                <defs>
                    <filter id="glow-${type}-${status || 'normal'}">
                        <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                <polygon points="0,-22 19,-11 19,11 0,22 -19,11 -19,-11" 
                    fill="rgba(0,5,15,0.95)" 
                    stroke="${baseColor}" 
                    stroke-width="2" 
                    filter="url(#glow-${type}-${status || 'normal'})" />
                <polygon points="0,-18 15,-9 15,9 0,18 -15,9 -15,-9" 
                    fill="none" 
                    stroke="${baseColor}" 
                    stroke-width="0.5" 
                    opacity="0.3" />
                ${isCompromised ? `<polygon points="0,-22 19,-11 19,11 0,22 -19,11 -19,-11" fill="none" stroke="${baseColor}" stroke-width="1" opacity="0.8">
                    <animate attributeName="opacity" values="0.2;0.8;0.2" dur="1.5s" repeatCount="indefinite" />
                </polygon>` : ''}`,

            firewall: `
                <defs>
                    <filter id="glow-${type}-${status || 'normal'}">
                        <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                <path d="M 0,-20 L 12,-12 L 20,0 L 12,12 L 0,20 L -12,12 L -20,0 L -12,-12 Z" 
                    fill="rgba(0,5,15,0.95)" 
                    stroke="${baseColor}" 
                    stroke-width="2.5" 
                    filter="url(#glow-${type}-${status || 'normal'})" />
                <path d="M 0,-16 L 10,-10 L 16,0 L 10,10 L 0,16 L -10,10 L -16,0 L -10,-10 Z" 
                    fill="none" 
                    stroke="${baseColor}" 
                    stroke-width="0.5" 
                    opacity="0.4" />
                ${isCompromised ? `<path d="M 0,-20 L 12,-12 L 20,0 L 12,12 L 0,20 L -12,12 L -20,0 L -12,-12 Z" fill="none" stroke="${baseColor}" stroke-width="1.5" opacity="0.9">
                    <animate attributeName="stroke-width" values="1.5;3;1.5" dur="1s" repeatCount="indefinite" />
                </path>` : ''}`,

            server: `
                <defs>
                    <filter id="glow-${type}-${status || 'normal'}">
                        <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                    <linearGradient id="serverGrad-${status || 'normal'}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:${baseColor};stop-opacity:0.8" />
                        <stop offset="100%" style="stop-color:${baseColor};stop-opacity:0.2" />
                    </linearGradient>
                </defs>
                <rect x="-18" y="-22" width="36" height="44" rx="3"
                    fill="rgba(0,5,15,0.95)" 
                    stroke="url(#serverGrad-${status || 'normal'})" 
                    stroke-width="2" 
                    filter="url(#glow-${type}-${status || 'normal'})" />
                <line x1="-18" y1="-8" x2="18" y2="-8" stroke="${baseColor}" stroke-width="0.5" opacity="0.3" />
                <line x1="-18" y1="6" x2="18" y2="6" stroke="${baseColor}" stroke-width="0.5" opacity="0.3" />
                ${isCompromised ? `<rect x="-18" y="-22" width="36" height="44" rx="3" fill="none" stroke="${baseColor}" stroke-width="1" opacity="0.8">
                    <animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.2s" repeatCount="indefinite" />
                </rect>` : ''}`,

            cloud: `
                <defs>
                    <filter id="glow-${type}-${status || 'normal'}">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                <ellipse cx="0" cy="0" rx="24" ry="18" 
                    fill="rgba(0,5,15,0.9)" 
                    stroke="${baseColor}" 
                    stroke-width="2" 
                    filter="url(#glow-${type}-${status || 'normal'})" />
                <ellipse cx="0" cy="0" rx="20" ry="15" 
                    fill="none" 
                    stroke="${baseColor}" 
                    stroke-width="0.5" 
                    opacity="0.3" />`,

            desktop: `
                <defs>
                    <filter id="glow-${type}-${status || 'normal'}">
                        <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                <rect x="-20" y="-18" width="40" height="36" rx="4"
                    fill="rgba(0,5,15,0.9)" 
                    stroke="${baseColor}" 
                    stroke-width="1.5" 
                    filter="url(#glow-${type}-${status || 'normal'})" />
                <rect x="-16" y="-14" width="32" height="28" rx="2"
                    fill="none" 
                    stroke="${baseColor}" 
                    stroke-width="0.5" 
                    opacity="0.3" />`,

            switch: `
                <defs>
                    <filter id="glow-${type}-${status || 'normal'}">
                        <feGaussianBlur stdDeviation="1.8" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                <rect x="-22" y="-16" width="44" height="32" rx="2"
                    fill="rgba(0,5,15,0.95)" 
                    stroke="${baseColor}" 
                    stroke-width="1.5" 
                    filter="url(#glow-${type}-${status || 'normal'})" />
                <line x1="-22" y1="-5" x2="22" y2="-5" stroke="${baseColor}" stroke-width="0.5" opacity="0.3" />
                <line x1="-22" y1="5" x2="22" y2="5" stroke="${baseColor}" stroke-width="0.5" opacity="0.3" />`
        };

        return shapes[type] || shapes.desktop;
    }

    /**
     * ICON GENERATOR: Returns raw SVG path data for device icons
     */
    function getNodeIcon(type) {
        const icons = {
            router: '<path fill="#0096ff" d="M20,13H4V11H20V13M20,17H4V15H20V17M20,9H4V7H20V9M10,3L12,5L14,3H10M10,21L12,19L14,21H10Z"/>',
            switch: '<path fill="#0096ff" d="M15,9H5V5H15V9M19,9H17V5H19V9M15,19H5V15H15V19M19,19H17V15H19V19M15,14H5V10H15V14M19,14H17V10H19V14Z"/>',
            firewall: '<path fill="#0096ff" d="M22,11V9H18V5H11V3h7V1H6V3H2v2h4v4H2v2h4v4H2v2h4v4H2v2h20V19h-4v-4h4v-2h-4v-4H22z M16,19h-5v-4h5V19z M16,13h-5V9h5V13z M9,15h-5v-4h5V15z M9,9h-5V5h5V9z"/>',
            laptop: '<path fill="#0096ff" d="M20,18H22V20H2V18H4V5H20V18M18,7H6V16H18V7Z"/>',
            desktop: '<path fill="#0096ff" d="M21,14H3V4H21V11M23,16H1V14H23V16M13,20H11V16H13V20M12,22L10,20H14L12,22Z"/>',
            mobile: '<path fill="#0096ff" d="M17,19H7V5H17M17,1H7C5.89,1 5,1.89 5,3V21C5,22.11 5.89,23 7,23H17C18.11,23 19,22.11 19,21V3C19,1.89 18.11,1 17,1Z"/>',
            printer: '<path fill="#0096ff" d="M18,3H6V7H18M19,12A1,1 0 0,1 18,11A1,1 0 0,1 19,10A1,1 0 0,1 20,11A1,1 0 0,1 19,12M16,19H8V14H16M19,8H5C3.34,8 2,9.34 2,11V17H6V21H18V17H22V11C22,9.34 20.66,8 19,8Z"/>',
            camera: '<path fill="#0096ff" d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M19,5H15.83L14.42,3.58C14.03,3.23 13.53,3 13,3H11C10.47,3 9.97,3.23 9.58,3.58L8.17,5H5A2,2 0 0,0 3,7V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7A2,2 0 0,0 19,5Z"/>',
            access_point: '<path fill="#0096ff" d="M4.93,4.93L6.34,6.34C4.88,7.8 4,9.8 4,12C4,14.2 4.88,16.2 6.34,17.66L4.93,19.07C3.12,17.26 2,14.76 2,12C2,9.24 3.12,6.74 4.93,4.93M19.07,4.93C20.88,6.74 22,9.24 22,12C22,14.76 20.88,17.26 19.07,19.07L17.66,17.66C19.12,16.2 20,14.2 20,12C20,9.8 19.12,7.8 17.66,6.34L19.07,4.93M7.76,7.76L9.17,9.17C8.42,9.92 8,10.92 8,12C8,13.08 8.42,14.08 9.17,14.83L7.76,16.24C6.67,15.15 6,13.65 6,12C6,10.35 6.67,8.85 7.76,7.76M16.24,7.76C17.33,8.85 18,10.35 18,12C18,13.65 17.33,15.15 16.24,16.24L14.83,14.83C15.58,14.08 16,13.08 16,12C16,10.92 15.58,9.92 14.83,9.17L16.24,7.76M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10Z"/>',
            server: '<path fill="#0096ff" d="M19,15H5V13H19V15M19,19H5V17H19V19M19,11H5V9H19V11M5,7V5H19V7H5M3,2V22H21V2H3Z"/>',
            cloud: '<path fill="#0096ff" d="M17.5,19c-3.037,0-5.5-2.463-5.5-5.5c0-0.45,0.054-0.887,0.158-1.304C10.517,11.23,9,9.29,9,7c0-2.761,2.239-5,5-5 c1.536,0,2.909,0.693,3.832,1.779C18.423,3.284,19.176,3,20,3c2.209,0,4,1.791,4,4c0,0.224-0.019,0.443-0.054,0.658 C25.322,8.604,26,10.222,26,12c0,3.314-2.686,6-6,6h-1H17.5z"/>',
            iot: '<path fill="#0096ff" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/>'
        };
        return icons[type] || '<circle cx="12" cy="12" r="8" fill="#0096ff" />';
    }

    /**
     * PROTOCOL DECODER: Translates single-letter TCP flags into human-readable strings
     */
    function getFlagDescription(flags) {
        const map = {
            'S': 'SYNCHRONIZE',
            'P': 'PUSH',
            'R': 'RESET',
            'F': 'FINISH',
            'A': 'ACKNOWLEDGE',
            '.': 'ACKNOWLEDGE'
        };
        // Clean flags
        return Array.from(flags).map(f => map[f] || f).filter((v, i, a) => a.indexOf(v) === i).join('|');
    }

    /**
     * LOG BRIDGE: Renders a temporal flow diagram optimized for firewall logs
     * Positions source IPs on the left and destination IPs on the right.
     */
    function renderLogMap(w, h) {
        if (!currentData || !currentData.networkTraffic) return;

        const nodes = currentData.networkTraffic.nodes || [];
        const connections = currentData.networkTraffic.connections || [];

        if (nodes.length === 0) {
            elements.chartContainer.innerHTML = '<div style="color:#0096ff; padding:20px;">[ORION ERR] TEMPORAL LOG BRIDGE REQUIRES SOURCE NODES. CHECK INPUT.</div>';
            return;
        }

        const type = elements.chartTypeSelect.value;

        let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="cursor: ${dragData.active ? 'grabbing' : 'grab'}">`;
        svg += `<g transform="translate(${transform.x}, ${transform.y}) scale(${transform.k})">`;

        // Position Nodes in two vertical banks (Source/Target columns)
        const midNodes = Math.ceil(nodes.length / 2);
        nodes.forEach((node, i) => {
            if (!nodePositions[node.id]) {
                const isLeft = i < midNodes;
                const columnX = isLeft ? 100 : w - 100;
                const columnCount = isLeft ? midNodes : (nodes.length - midNodes);
                const rowY = (h / (columnCount || 1)) * ((isLeft ? i : i - midNodes) + 0.5);
                nodePositions[node.id] = { x: columnX, y: rowY };
            }
            const pos = nodePositions[node.id];
            node.x = pos.x;
            node.y = pos.y;
        });

        const nodeMap = {};
        nodes.forEach(n => nodeMap[n.id] = n);

        // Draw Log Connections as linear bridges
        connections.forEach((conn, idx) => {
            const source = nodeMap[conn.source];
            const target = nodeMap[conn.destination];
            if (source && target) {
                const pathId = `log_${idx}`;
                // Draw a horizontal-ish path across the central temporal zone
                const d = `M ${source.x} ${source.y} C ${w / 2} ${source.y}, ${w / 2} ${target.y}, ${target.x} ${target.y}`;

                svg += `<path id="${pathId}" d="${d}" stroke="rgba(0,150,255,0.1)" stroke-width="1" fill="none" />`;

                // Log Pulses (Faster and more frequent)
                const isAnomaly = conn.status === 'anomaly';
                const color = isAnomaly ? '#ff1e1e' : '#0096ff';

                for (let j = 0; j < 3; j++) {
                    svg += `
                    <circle r="2" fill="${color}">
                        <animateMotion dur="${0.5 + Math.random()}" repeatCount="indefinite" begin="${j * 0.3}s">
                            <mpath href="#${pathId}" />
                        </animateMotion>
                        ${isAnomaly ? `<animate attributeName="r" values="2;4;2" dur="0.2s" repeatCount="indefinite" />` : ''}
                    </circle>`;
                }

                // Show metadata as floating labels in the central zone
                if (conn.port || conn.flags) {
                    const label = `${conn.port || ''} ${conn.flags || ''}`.trim();
                    svg += `
                    <text fill="${color}" font-size="6" font-family="Rajdhani" font-weight="bold" opacity="0.6">
                        <textPath href="#${pathId}" startOffset="50%">
                            ${label}
                            <animate attributeName="startOffset" from="20%" to="80%" dur="2s" repeatCount="indefinite" />
                        </textPath>
                    </text>`;
                }
            }
        });

        // Draw Nodes
        nodes.forEach(node => {
            const deviceType = node.type || 'desktop';
            svg += `
            <g class="orion-node" data-id="${node.id}" transform="translate(${node.x - 20}, ${node.y - 20})" style="cursor: move">
                <rect width="40" height="40" fill="rgba(0,5,15,0.9)" stroke="#0096ff" stroke-width="1" rx="2" />
                <g transform="scale(0.7) translate(5, 5)">
                    ${getNodeIcon(deviceType)}
                </g>
                <text x="${node.x < w / 2 ? -10 : 50}" y="20" fill="#0096ff" font-family="Rajdhani" font-size="9" font-weight="bold" text-anchor="${node.x < w / 2 ? 'end' : 'start'}">${node.label}</text>
            </g>`;
        });

        svg += `</g></svg>`;
        elements.chartContainer.innerHTML = svg;
    }

    /**
     * THREAT RADAR: Highlights anomalous clusters and high-risk nodes (Red Pulse)
     */
    function renderThreatMap(w, h) {
        if (!currentData || !currentData.networkTraffic) return;

        const nodes = currentData.networkTraffic.nodes || [];
        const clusters = currentData.networkTraffic.clusters || [];

        if (nodes.length === 0) {
            elements.chartContainer.innerHTML = '<div style="color:#0096ff; padding:20px;">[ERROR] Universal Graph Engine: Zero valid nodes detected in segment.</div>';
            return;
        }

        const nodeMap = {};

        let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="cursor: ${dragData.active ? 'grabbing' : 'grab'}">`;
        svg += `<g transform="translate(${transform.x}, ${transform.y}) scale(${transform.k})">`;

        const centerX = w / 2;
        const centerY = h / 2;

        // Position Nodes
        nodes.forEach((node, i) => {
            if (!nodePositions[node.id]) {
                const angle = (Math.PI * 2 / nodes.length) * i;
                const distance = Math.min(w, h) / 3;
                nodePositions[node.id] = {
                    x: centerX + Math.cos(angle) * distance,
                    y: centerY + Math.sin(angle) * distance
                };
            }
            const pos = nodePositions[node.id];
            node.x = pos.x;
            node.y = pos.y;
            nodeMap[node.id] = node;
        });

        // Draw Clusters (Background Glows)
        clusters.forEach(cluster => {
            const memberNodes = cluster.nodes.map(id => nodeMap[id]).filter(n => n);
            if (memberNodes.length === 0) return;

            // Calculate center of cluster
            const avgX = memberNodes.reduce((sum, n) => sum + n.x, 0) / memberNodes.length;
            const avgY = memberNodes.reduce((sum, n) => sum + n.y, 0) / memberNodes.length;

            // Calculate radius to enclose all nodes + padding
            let maxDist = 40;
            memberNodes.forEach(n => {
                const dist = Math.sqrt((n.x - avgX) ** 2 + (n.y - avgY) ** 2);
                if (dist + 40 > maxDist) maxDist = dist + 40;
            });

            const color = cluster.color === 'red' ? 'rgba(255,0,0,0.1)' : 'rgba(0,255,100,0.1)';
            const stroke = cluster.color === 'red' ? 'rgba(255,0,0,0.3)' : 'rgba(0,255,100,0.3)';

            svg += `<circle cx="${avgX}" cy="${avgY}" r="${maxDist}" fill="${color}" stroke="${stroke}" stroke-width="2" stroke-dasharray="8,4" />`;
            svg += `<text x="${avgX}" y="${avgY - maxDist - 5}" fill="${cluster.color === 'red' ? '#ff1e1e' : '#00ff64'}" font-family="Rajdhani" font-size="12" font-weight="bold" text-anchor="middle" style="text-transform: uppercase;">[ ${cluster.clusterName} ]</text>`;
        });

        // Draw Nodes
        nodes.forEach(node => {
            const isCompromised = node.status === 'compromised';
            const threatLevel = node.threatLevel || (isCompromised ? 'high' : 'low');
            const threatColor = threatLevel === 'critical' || threatLevel === 'high' ? '#ff1e1e' : '#00ff64';
            const type = node.type || (node.label.toLowerCase().includes('router') ? 'router' :
                (node.label.toLowerCase().includes('server') ? 'server' :
                    (node.label.toLowerCase().includes('iot') ? 'iot' : 'desktop')));

            svg += `
            <g class="orion-node" data-id="${node.id}" transform="translate(${node.x - 20}, ${node.y - 20})" style="cursor: move">
                <rect width="40" height="40" fill="rgba(0,5,15,0.9)" stroke="${threatColor}" stroke-width="1.5" rx="4" />
                ${isCompromised ? `<rect width="44" height="44" x="-2" y="-2" fill="none" stroke="${threatColor}" stroke-width="1" rx="6" opacity="0.6">
                    <animate attributeName="opacity" values="0.6;0;0.6" dur="1s" repeatCount="indefinite" />
                    <animate attributeName="transform" type="scale" from="1" to="1.1" dur="1s" repeatCount="indefinite" />
                </rect>` : ''}
                <g transform="scale(0.8) translate(5, 5)">
                    ${getNodeIcon(type)}
                </g>
                <text x="20" y="55" fill="${threatColor}" font-family="Rajdhani" font-size="10" text-anchor="middle" font-weight="bold" pointer-events="none">${node.label}</text>
                <text x="20" y="65" fill="rgba(255,255,255,0.5)" font-family="Rajdhani" font-size="8" text-anchor="middle" pointer-events="none">${node.ip || ''}</text>
            </g>`;
        });

        svg += `</g></svg>`;
        elements.chartContainer.innerHTML = svg;
    }

    /**
     * RESET: Purges all data streams and resets SVG transforms
     */
    function reset() {
        elements.dataArea.value = '';
        elements.chartContainer.innerHTML = '';
        currentData = null;
        nodePositions = {};
        transform = { x: 0, y: 0, k: 1 };
    }

    return { init, reset };
})();

window.ORION = ORION;
