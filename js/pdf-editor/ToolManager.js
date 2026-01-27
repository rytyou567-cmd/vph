/**
 * ToolManager.js
 * 
 * ROLE:
 * Manages all drawing interactions on the PDF canvas.
 * Handles the "Canvas Stack" architecture where each tool type has its own dedicated layer 
 * to allow specific z-indexing (e.g., Highlighter is below text, Pencil is above).
 * 
 * ARCHITECTURE (Bottom to Top):
 * 1. PDF.js Canvas (Base PDF)
 * 2. Highlighter Layer (Canvas)
 * 3. Pencil Layer (Canvas)
 * 4. Arrow/Shape Layer (Canvas)
 * 5. Whiteout Layer (Canvas)
 * 6. Interaction Canvas (Temp layer for live drawing)
 * 7. Annotation Layer (HTML Text overlay)
 */
import { Utils } from './Utils.js';

export class ToolManager {
    constructor(stateManager) {
        this.currentTool = 'select';
        this.stateManager = stateManager;
        this.layers = {}; // Per-wrapper storage if needed, or we find them dynamically
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        this.currentCtx = null;
        this.currentLayerCanvas = null;
        this.preDrawState = null;
    }

    setTool(tool) {
        this.currentTool = tool;
        // UI Updates are handled by UIManager observing this or via callback
        document.dispatchEvent(new CustomEvent('tool-changed', { detail: { tool } }));

        // Handle Edit Mode Toggle
        const wrappers = document.querySelectorAll('.pdf-page-wrapper');
        if (tool === 'edit-text') {
            wrappers.forEach(w => w.classList.add('edit-text-mode'));
            this.enableTextEditing(true);
        } else {
            wrappers.forEach(w => w.classList.remove('edit-text-mode'));
            this.enableTextEditing(false);
        }
    }

    /**
     * Initializes the Layer Stack on top of a rendered PDF page.
     * Called by PDFEditor when a page finishes rendering.
     * @param {HTMLElement} pageWrapper - The container .pdf-page-wrapper
     * @param {number} width - Page width in pixels
     * @param {number} height - Page height in pixels
     */
    setupLayers(pageWrapper, width, height) {
        // 3. Stack Container
        const stackContainer = document.createElement('div');
        stackContainer.className = 'canvas-stack';
        stackContainer.style.width = width + 'px';
        stackContainer.style.height = height + 'px';
        pageWrapper.appendChild(stackContainer);

        const currentLayers = {};
        ['highlighter', 'pencil', 'arrow', 'whiteout'].forEach(name => {
            const layerCanvas = document.createElement('canvas');
            layerCanvas.className = 'layer-canvas ' + name + '-layer';
            layerCanvas.width = width;
            layerCanvas.height = height;
            stackContainer.appendChild(layerCanvas);
            currentLayers[name] = layerCanvas;
        });

        // 4. Interaction Canvas
        const interactCanvas = document.createElement('canvas');
        interactCanvas.className = 'interaction-canvas';
        interactCanvas.width = width;
        interactCanvas.height = height;
        stackContainer.appendChild(interactCanvas);

        // 5. Annotation Layer
        const annotationLayer = document.createElement('div');
        annotationLayer.className = 'annotation-layer';
        pageWrapper.appendChild(annotationLayer);

        this.attachEvents(interactCanvas, currentLayers, annotationLayer);

        // Re-apply edit text mode if active
        if (this.currentTool === 'edit-text') {
            pageWrapper.classList.add('edit-text-mode');
            this.enableTextEditing(true, pageWrapper);
        }
    }

    // ... (attachEvents, getLayerContext methods skipped)...

    enableTextEditing(enable, context = document) {
        const spans = context.querySelectorAll('.textLayer > span');
        spans.forEach(span => {
            span.contentEditable = enable;
            // Setup events if enabled
            if (enable) {
                // Remove old listener if exists to prevent duplicates
                span.onclick = (e) => {
                    e.stopPropagation();
                    this.showTextEditToolbar(span);
                };
                // Add input listener to track text content changes
                span.oninput = () => {
                    span.classList.add('pdflib-edited-text');
                };
            } else {
                span.onclick = null;
                span.oninput = null;
            }
        });

        // Hide toolbar if disabling globally
        if (!enable && context === document) {
            this.removeTextToolbar();
        }
    }

    attachEvents(interactCanvas, layers, annotationLayer) {
        interactCanvas.addEventListener('mousedown', (e) => this.startDraw(e, interactCanvas, layers));
        interactCanvas.addEventListener('mousemove', (e) => this.draw(e, interactCanvas));
        interactCanvas.addEventListener('mouseup', (e) => this.endDraw(e, interactCanvas, layers));

        interactCanvas.addEventListener('click', (e) => {
            if (this.currentTool === 'text') {
                this.addText(e, annotationLayer);
            }
        });
    }

    getLayerContext(layers) {
        const t = this.currentTool;
        if (t === 'pencil') return layers['pencil'].getContext('2d');
        if (t === 'highlighter') return layers['highlighter'].getContext('2d');
        if (t === 'arrow') return layers['arrow'].getContext('2d');
        if (t === 'eraser-whiteout') return layers['whiteout'].getContext('2d');

        // Eraser Subtools
        if (t === 'eraser-edit-pencil') return layers['pencil'].getContext('2d');
        if (t === 'eraser-edit-highlighter') return layers['highlighter'].getContext('2d');
        if (t === 'eraser-edit-arrow') return layers['arrow'].getContext('2d');
        if (t === 'eraser-edit-whiteout') return layers['whiteout'].getContext('2d');
        return null;
    }

    getLayerCanvas(layers) {
        const t = this.currentTool;
        if (t === 'pencil') return layers['pencil'];
        if (t === 'highlighter') return layers['highlighter'];
        if (t === 'arrow') return layers['arrow'];
        if (t === 'eraser-whiteout') return layers['whiteout'];

        if (t === 'eraser-edit-pencil') return layers['pencil'];
        if (t === 'eraser-edit-highlighter') return layers['highlighter'];
        if (t === 'eraser-edit-arrow') return layers['arrow'];
        if (t === 'eraser-edit-whiteout') return layers['whiteout'];
        return null;
    }

    startDraw(e, canvas, layers) {
        if (['pencil', 'arrow', 'highlighter', 'eraser-whiteout',
            'eraser-edit-pencil', 'eraser-edit-highlighter', 'eraser-edit-arrow', 'eraser-edit-whiteout'].includes(this.currentTool)) {

            this.isDrawing = true;
            const pos = Utils.getRelativeCoords(e, canvas);
            this.lastX = pos.x;
            this.lastY = pos.y;
            this.currentPath = [{ x: pos.x, y: pos.y }];

            this.currentCtx = this.getLayerContext(layers);
            this.currentLayerCanvas = this.getLayerCanvas(layers);
            this.interactCanvas = canvas;
            this.interactCtx = canvas.getContext('2d');

            if (this.currentCtx && this.currentLayerCanvas) {
                this.preDrawState = this.currentLayerCanvas.toDataURL();
                this.currentCtx.beginPath();
                this.currentCtx.moveTo(this.lastX, this.lastY);
            }
        }
    }

    draw(e, canvas) {
        if (!this.isDrawing || !this.interactCtx) return;
        const pos = Utils.getRelativeCoords(e, canvas);
        this.currentPath.push({ x: pos.x, y: pos.y });

        const sizeInput = document.getElementById('eraser-size');
        const size = sizeInput ? sizeInput.value : 20;

        if (this.currentTool === 'pencil') {
            const size = document.getElementById('pen-size')?.value || 2;
            const color = document.getElementById('pen-color')?.value || '#000000';
            const ctx = this.currentCtx;
            ctx.lineWidth = size;
            ctx.lineCap = 'round';
            ctx.strokeStyle = color;
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        } else if (this.currentTool === 'highlighter') {
            const size = document.getElementById('highlighter-size')?.value || 15;
            const colorHex = document.getElementById('highlighter-color')?.value || '#ffff00';
            const opacity = document.getElementById('highlighter-opacity')?.value || 0.3;

            // Convert hex to rgba
            const rgb = Utils.hexToPdfRgb(colorHex);
            const r = Math.round(rgb.r * 255);
            const g = Math.round(rgb.g * 255);
            const b = Math.round(rgb.b * 255);

            // We draw the "preview" on interaction canvas to see live changes
            // But to avoid transparency overlap on the main layer, we'll only 
            // commit to the main layer on endDraw.
            this.interactCtx.clearRect(0, 0, canvas.width, canvas.height);
            this.interactCtx.lineWidth = size;
            this.interactCtx.lineCap = 'round';
            this.interactCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
            this.interactCtx.beginPath();
            this.interactCtx.moveTo(this.currentPath[0].x, this.currentPath[0].y);
            for (let i = 1; i < this.currentPath.length; i++) {
                this.interactCtx.lineTo(this.currentPath[i].x, this.currentPath[i].y);
            }
            this.interactCtx.stroke();
        } else if (this.currentTool === 'eraser-whiteout') {
            const ctx = this.currentCtx;
            ctx.lineWidth = size;
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'white';
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        } else if (this.currentTool.startsWith('eraser-edit-')) {
            const ctx = this.currentCtx;
            ctx.lineWidth = size;
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    endDraw(e, canvas) {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        if (this.currentTool === 'highlighter' && this.interactCanvas && this.currentCtx) {
            // Commit the preview to the actual layer
            this.currentCtx.drawImage(this.interactCanvas, 0, 0);
            this.interactCtx.clearRect(0, 0, this.interactCanvas.width, this.interactCanvas.height);
        }

        if (this.currentTool === 'arrow') {
            const pos = Utils.getRelativeCoords(e, canvas);
            this.drawArrow(this.currentCtx, this.lastX, this.lastY, pos.x, pos.y);
        }

        if (this.currentLayerCanvas) {
            const postDrawState = this.currentLayerCanvas.toDataURL();
            this.stateManager.pushAction({
                type: 'canvas',
                canvas: this.currentLayerCanvas,
                oldData: this.preDrawState,
                newData: postDrawState
            });
        }

        this.currentPath = [];
    }

    drawArrow(ctx, fromX, fromY, toX, toY) {
        const headlen = 10;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const angle = Math.atan2(dy, dx);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'red';
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    }

    addText(e, layer) {
        // UI Defaults
        const fontSizeInput = document.getElementById('text-font-size');
        const colorInput = document.getElementById('text-color');
        const bgTransparentInput = document.getElementById('text-bg-transparent');
        const bgColorInput = document.getElementById('text-bg-color');

        const fontSize = fontSizeInput ? fontSizeInput.value + 'px' : '16px';
        const color = colorInput ? colorInput.value : 'black';
        const isTransparent = bgTransparentInput ? bgTransparentInput.checked : true;
        const bgColor = isTransparent ? 'transparent' : (bgColorInput ? bgColorInput.value : 'white');

        const pos = Utils.getRelativeCoords(e, layer);

        // 1. Create Wrapper (Draggable Container)
        const wrapper = document.createElement('div');
        wrapper.className = 'text-wrapper';
        wrapper.style.position = 'absolute';
        wrapper.style.left = pos.x + 'px';
        wrapper.style.top = pos.y + 'px';
        wrapper.style.minWidth = '50px';
        wrapper.style.minHeight = '30px';
        wrapper.style.cursor = 'move';
        wrapper.style.border = '1px dashed #ccc'; // Dashed line to show it's selected/editable initially
        wrapper.style.zIndex = '30';

        // 2. Create ContentEditable Area
        const input = document.createElement('div');
        input.contentEditable = true;
        input.className = 'text-content';
        input.style.width = '100%';
        input.style.height = '100%';
        input.style.fontSize = fontSize;
        input.style.color = color;
        input.style.backgroundColor = bgColor;
        input.style.outline = 'none';
        input.style.overflow = 'hidden';
        input.innerText = 'Text';

        wrapper.appendChild(input);

        // 3. Add Resize Handles
        const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        directions.forEach(dir => {
            const handle = document.createElement('div');
            handle.className = 'resize-handle handle-' + dir;
            handle.dataset.dir = dir;
            wrapper.appendChild(handle);
        });

        layer.appendChild(wrapper);

        // 4. Attach Events (Drag & Resize) - Reusing Logic?
        // Ideally we should import Utils if we moved logic there, or ImageManager logic.
        // For self-containment in this refactor step without big breaking changes, we replicate valid logic tailored for text.
        this.makeTextDraggable(wrapper);
        this.makeTextResizable(wrapper);

        // Focus and Select All
        input.focus();
        // Select all text
        const range = document.createRange();
        range.selectNodeContents(input);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        // Record Action
        this.stateManager.pushAction({ type: 'add', element: wrapper, parent: layer });

        // Show Toolbar
        this.showAddedTextToolbar(wrapper);
    }

    showAddedTextToolbar(wrapper) {
        this.removeTextToolbar();

        const content = wrapper.querySelector('.text-content');
        if (!content) return;

        // 1. Save Initial State for Cancel
        wrapper._initialState = {
            color: content.style.color,
            backgroundColor: content.style.backgroundColor,
            text: content.innerText
        };

        // 2. Create Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'image-toolbar text-edit-toolbar';
        toolbar.id = 'active-added-text-toolbar';
        toolbar.style.position = 'absolute';
        toolbar.style.zIndex = '100';
        // toolbar.onmousedown = (e) => e.stopPropagation(); // Replaced by drag logic

        // Enable Dragging
        this.setupToolbarDrag(toolbar);

        const rect = wrapper.getBoundingClientRect();
        const pageWrapper = wrapper.closest('.pdf-page-wrapper');
        const wrapperRect = pageWrapper.getBoundingClientRect();

        const top = rect.top - wrapperRect.top - 45;
        const left = rect.left - wrapperRect.left;

        toolbar.style.top = top + 'px';
        toolbar.style.left = left + 'px';

        // 3. Toolbar Items
        const compStyle = window.getComputedStyle(content);

        // Text Color
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = Utils.rgbToHex(compStyle.color) || '#000000';
        colorInput.title = "Text Color";
        colorInput.style.cssText = 'width:30px; height:20px; border:none; padding:0; cursor:pointer;';
        colorInput.oninput = (e) => {
            content.style.color = e.target.value;
        };
        toolbar.appendChild(colorInput);

        // Background Color
        const bgInput = document.createElement('input');
        bgInput.type = 'color';
        bgInput.value = Utils.rgbToHex(compStyle.backgroundColor) || '#ffffff';
        bgInput.title = "Background Color";
        bgInput.style.cssText = 'width:30px; height:20px; border:none; padding:0; cursor:pointer;';
        bgInput.oninput = (e) => {
            content.style.backgroundColor = e.target.value;
        };
        toolbar.appendChild(bgInput);

        // Initialize flex properties if not present
        if (!content.style.display || content.style.display !== 'flex') {
            content.style.display = 'flex';
            content.style.flexDirection = 'column';
            content.style.justifyContent = 'flex-start'; // Vertical
            content.style.alignItems = 'flex-start';     // Horizontal
            content.style.textAlign = 'left';
        }

        // Horizontal Alignment Button
        const hAlignBtn = document.createElement('button');
        hAlignBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M3,3H21V5H3V3M7,7H17V9H7V7M3,11H21V13H3V11M7,15H17V17H7V15M3,19H21V21H3V19Z" />
            </svg>`;
        hAlignBtn.title = "Horizontal Align";
        hAlignBtn.onclick = (e) => {
            e.stopPropagation();
            const current = content.style.alignItems;
            if (current === 'flex-start') {
                content.style.alignItems = 'center';
                content.style.textAlign = 'center';
            } else if (current === 'center') {
                content.style.alignItems = 'flex-end';
                content.style.textAlign = 'right';
            } else {
                content.style.alignItems = 'flex-start';
                content.style.textAlign = 'left';
            }
        };
        toolbar.appendChild(hAlignBtn);

        // Vertical Alignment Button
        const vAlignBtn = document.createElement('button');
        vAlignBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" style="transform: rotate(90deg);">
                <path fill="currentColor" d="M3,3H21V5H3V3M7,7H17V9H7V7M3,11H21V13H3V11M7,15H17V17H7V15M3,19H21V21H3V19Z" />
            </svg>`;
        vAlignBtn.title = "Vertical Align";
        vAlignBtn.onclick = (e) => {
            e.stopPropagation();
            const current = content.style.justifyContent;
            if (current === 'flex-start') {
                content.style.justifyContent = 'center';
            } else if (current === 'center') {
                content.style.justifyContent = 'flex-end';
            } else {
                content.style.justifyContent = 'flex-start';
            }
        };
        toolbar.appendChild(vAlignBtn);

        // Confirm (Tick)
        const tickBtn = document.createElement('button');
        tickBtn.innerHTML = '✔';
        tickBtn.style.color = 'green';
        tickBtn.title = 'Done';
        tickBtn.onclick = (e) => {
            e.stopPropagation();
            wrapper.style.border = 'none'; // Remove dashed border
            this.removeTextToolbar();
        };
        toolbar.appendChild(tickBtn);

        // Cancel/Delete (Cross)
        const crossBtn = document.createElement('button');
        crossBtn.innerHTML = '✘';
        crossBtn.style.color = 'red';
        crossBtn.title = 'Delete';
        crossBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm('Delete this text box?')) {
                wrapper.remove();
                this.stateManager.pushAction({ type: 'delete', element: wrapper });
                this.removeTextToolbar();
            }
        };
        toolbar.appendChild(crossBtn);

        pageWrapper.appendChild(toolbar);

        // Update toolbar position on drag
        const originalMove = document.onmousemove;
        // Wait, makeTextDraggable uses its own event listeners. 
        // I should probably just reposition it in a more robust way periodically or on demand.
    }

    repositionToolbar(elmnt) {
        const toolbar = document.getElementById('active-added-text-toolbar');
        if (!toolbar) return;

        const rect = elmnt.getBoundingClientRect();
        const pageWrapper = elmnt.closest('.pdf-page-wrapper');
        const wrapperRect = pageWrapper.getBoundingClientRect();

        const top = rect.top - wrapperRect.top - 45;
        const left = rect.left - wrapperRect.left;

        toolbar.style.top = top + 'px';
        toolbar.style.left = left + 'px';
    }

    makeTextDraggable(elmnt) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        elmnt.onmousedown = (e) => {
            e.stopPropagation();
            if (e.target.classList.contains('resize-handle')) return;

            // Show toolbar if clicked
            this.showAddedTextToolbar(elmnt);
            elmnt.style.border = '1px dashed #1890ff'; // Highlight while active

            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        };

        const elementDrag = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
            elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
            this.repositionToolbar(elmnt);
        };

        const closeDragElement = () => {
            document.onmouseup = null;
            document.onmousemove = null;
        };
    }

    makeTextResizable(elmnt) {
        const handles = elmnt.querySelectorAll('.resize-handle');
        const minSize = 20;

        handles.forEach(handle => {
            handle.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation(); // Stop drag
                this.showAddedTextToolbar(elmnt); // Show toolbar on resize too

                const dir = handle.dataset.dir;
                let startX = e.clientX;
                let startY = e.clientY;
                let startWidth = parseInt(getComputedStyle(elmnt).width, 10);
                let startHeight = parseInt(getComputedStyle(elmnt).height, 10);
                let startLeft = elmnt.offsetLeft;
                let startTop = elmnt.offsetTop;

                document.onmousemove = (e) => {
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;

                    if (dir.includes('e')) elmnt.style.width = Math.max(minSize, startWidth + dx) + 'px';
                    if (dir.includes('s')) elmnt.style.height = Math.max(minSize, startHeight + dy) + 'px';
                    if (dir.includes('w')) {
                        const newW = Math.max(minSize, startWidth - dx);
                        elmnt.style.width = newW + 'px';
                        elmnt.style.left = (startLeft + (startWidth - newW)) + 'px';
                    }
                    if (dir.includes('n')) {
                        const newH = Math.max(minSize, startHeight - dy);
                        elmnt.style.height = newH + 'px';
                        elmnt.style.top = (startTop + (startHeight - newH)) + 'px';
                    }
                    this.repositionToolbar(elmnt);
                };

                document.onmouseup = () => {
                    document.onmousemove = null;
                    document.onmouseup = null;
                };
            };
        });
    }



    showTextEditToolbar(span) {
        this.removeTextToolbar();

        // 1. Save Initial State for Cancel
        span._initialState = {
            color: span.style.color,
            backgroundColor: span.style.backgroundColor,
            text: span.innerText, // Save text content too
            wasEdited: span.classList.contains('pdflib-edited-text')
        };

        // 2. Create Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'image-toolbar text-edit-toolbar'; // Reuse image-toolbar styles
        toolbar.id = 'active-text-toolbar';
        toolbar.style.position = 'absolute';
        toolbar.style.zIndex = '100';
        // toolbar.onmousedown = (e) => e.stopPropagation(); // Replaced by drag logic

        // Enable Dragging
        this.setupToolbarDrag(toolbar);

        // Position Logic
        // We need to append to the document body or a fixed container to avoid overflow issues, 
        // OR append to the parent wrapper but handle z-index.
        // Let's append to the span's parent (textLayer) or wrapper.
        const wrapper = span.closest('.pdf-page-wrapper');
        const rect = span.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();

        // Calculate relative position top-left
        const top = rect.top - wrapperRect.top - 45; // 40px above
        const left = rect.left - wrapperRect.left;

        toolbar.style.top = top + 'px';
        toolbar.style.left = left + 'px';

        // 3. Toolbar Items

        // Font Color
        const colorWrapper = document.createElement('div');
        colorWrapper.title = "Text Color";
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        // Get current computed color if style is empty
        const compStyle = window.getComputedStyle(span);
        colorInput.value = Utils.rgbToHex(compStyle.color) || '#000000';
        colorInput.style.width = '30px';
        colorInput.style.height = '20px';
        colorInput.style.border = 'none';
        colorInput.style.padding = '0';
        colorInput.oninput = (e) => {
            span.style.color = e.target.value;
            span.classList.add('pdflib-edited-text');
        };
        colorWrapper.appendChild(colorInput);
        toolbar.appendChild(colorWrapper);

        // Background Color
        const bgWrapper = document.createElement('div');
        bgWrapper.title = "Background Color";
        const bgInput = document.createElement('input');
        bgInput.type = 'color';
        bgInput.value = Utils.rgbToHex(compStyle.backgroundColor) || '#ffffff';
        bgInput.style.width = '30px';
        bgInput.style.height = '20px';
        bgInput.style.border = 'none';
        bgInput.style.padding = '0';

        // Checkbox for transparent? Or just assume if they pick a color it sets it.
        // Let's add a small 'T' button for transparent


        bgInput.oninput = (e) => {
            span.style.backgroundColor = e.target.value;
            span.classList.add('pdflib-edited-text');
        };
        bgWrapper.appendChild(bgInput);
        toolbar.appendChild(bgWrapper);


        // Confirm (Tick)
        const tickBtn = document.createElement('button');
        tickBtn.innerHTML = '✔';
        tickBtn.style.color = 'green';
        tickBtn.title = 'Apply Changes';
        tickBtn.onclick = (e) => {
            e.stopPropagation();
            this.removeTextToolbar();
            // Class already added on input
        };
        toolbar.appendChild(tickBtn);

        // Cancel (Cross)
        const crossBtn = document.createElement('button');
        crossBtn.innerHTML = '✘';
        crossBtn.style.color = 'red';
        crossBtn.onclick = (e) => {
            e.stopPropagation();
            // Revert
            if (span._initialState) {
                span.style.color = span._initialState.color;
                span.style.backgroundColor = span._initialState.backgroundColor;
                span.innerText = span._initialState.text;
                if (!span._initialState.wasEdited) {
                    span.classList.remove('pdflib-edited-text');
                }
            }
            this.removeTextToolbar();
        };
        toolbar.appendChild(crossBtn);

        wrapper.appendChild(toolbar);
    }

    removeTextToolbar() {
        const existing = document.querySelectorAll('.text-edit-toolbar');
        existing.forEach(el => el.remove());
    }

    clearAll() {
        // 1. Clear Canvases
        const wrappers = document.querySelectorAll('.pdf-page-wrapper');
        wrappers.forEach(wrapper => {
            const canvases = wrapper.querySelectorAll('.layer-canvas');
            canvases.forEach(canvas => {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            });
        });

        // 2. Remove Added Text (New Text Boxes)
        // Distinguished by class .text-wrapper
        document.querySelectorAll('.text-wrapper').forEach(el => {
            el.remove();
            // Also logic to start fresh tracks in state manager?
            // "Clear All" usually implies a hard reset of annotations.
        });

        // 3. Remove Added Images
        document.querySelectorAll('.image-wrapper').forEach(el => {
            el.remove();
        });
        this.stateManager.clear(); // Reset history if desired? Or just push a clear action?
        // User said "deletes all the changes done". A hard reset seems implied.

        // 4. Revert Text Edits
        document.querySelectorAll('.pdflib-edited-text').forEach(span => {
            if (span._initialState) {
                span.style.color = span._initialState.color;
                span.style.backgroundColor = span._initialState.backgroundColor;
                span.innerText = span._initialState.text;
            }
            span.classList.remove('pdflib-edited-text');
        });
    }

    setupToolbarDrag(toolbar) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        toolbar.onmousedown = (e) => {
            // Prevent drag if clicking inputs or buttons
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                e.stopPropagation(); // Allow click to pass to element
                return;
            }

            e.preventDefault();
            e.stopPropagation(); // Prevent canvas interactions

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = parseFloat(toolbar.style.left || 0);
            initialTop = parseFloat(toolbar.style.top || 0);

            toolbar.style.cursor = 'grabbing';

            document.onmousemove = (e) => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                toolbar.style.left = (initialLeft + dx) + 'px';
                toolbar.style.top = (initialTop + dy) + 'px';
            };

            document.onmouseup = () => {
                isDragging = false;
                toolbar.style.cursor = 'default';
                document.onmousemove = null;
                document.onmouseup = null;
            };
        };
    }
}
