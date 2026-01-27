/**
 * ImageManager.js
 * 
 * ROLE:
 * Manages the lifecycle of user-added images (signatures, logos, stamps) on the PDF canvas.
 * It handles the DOM creation of "Image Wrappers" which sit *above* the PDF canvas layer,
 * providing interactivity like Dragging, Resizing, Rotation, and Cropping.
 * 
 * CORE WORKFLOW:
 * 1. `handleImageUpload`: Reads a user file -> DataURL.
 * 2. `addImageToCanvas`: Creates a DOM `<div>` wrapper containing the image.
 *    - Injects Resize/Rotation handles into the wrapper.
 *    - Binds Mouse Events for interactivity.
 * 3. `selectImage`: Shows a context toolbar (Opacity, Crop, Duplicate).
 * 4. `enterCropMode`: Switches the wrapper to "Masking Mode" where the inner image is moved relative to the outer container to simulate cropping.
 * 
 * STATE MANAGEMENT:
 * - Pushes actions ('add', 'remove', 'modify') to `StateManager` for Undo/Redo.
 */
import { Utils } from './Utils.js';

export class ImageManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
    }

    /**
     * Event Handler: Triggered when user selects a file via input.
     */
    handleImageUpload(e) {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (evt) => {
                this.addImageToCanvas(evt.target.result);
            };
            reader.readAsDataURL(file);
        }
        e.target.value = ''; // Reset to allow re-uploading same file
    }

    /**
     * Core Method: Creates an interactive Image Wrapper and injects it into the DOM.
     * @param {string} imgSrc - Base64 DataURL of the image.
     */
    addImageToCanvas(imgSrc) {
        // 1. Create Wrapper (The playable area)
        const wrapper = document.createElement('div');
        wrapper.className = 'image-wrapper';
        wrapper.style.left = '50px';
        wrapper.style.top = '50px';
        wrapper.style.position = 'absolute';
        wrapper.style.zIndex = '20'; // Above PDF canvas (z-index 10 usually)
        wrapper.style.cursor = 'move';

        // Initial Size (placeholder, updated on load)
        wrapper.style.width = '100px';
        wrapper.style.height = '100px';

        // 2. Inner Box (The Mask)
        // Critical for Cropping: The wrapper defines the visible area, 'inner' helps mask it.
        const inner = document.createElement('div');
        inner.className = 'image-content-box';
        inner.style.width = '100%';
        inner.style.height = '100%';
        inner.style.position = 'relative';
        inner.style.overflow = 'hidden'; // Masks the image during cropping
        wrapper.appendChild(inner);

        const img = new Image();
        img.onload = () => {
            // 3. Canvas Rendering (Better performance than <img> for opacity/manipulation)
            const canvas = document.createElement('canvas');
            canvas.className = 'draggable-image';
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            // 4. Smart Scaling
            // If image is huge (>300px), scale it down to fit view initially.
            let w = img.width;
            let h = img.height;
            if (w > 300) {
                const ratio = 300 / w;
                w = 300;
                h = h * ratio;
            }
            wrapper.style.width = w + 'px';
            wrapper.style.height = h + 'px';

            inner.appendChild(canvas); // Append to inner mask
            this.addHandles(wrapper);

            // 5. Attach Interactivity Logic
            this.makeDraggable(wrapper);
            this.makeResizable(wrapper);
            this.makeRotatable(wrapper);

            // 6. Injection
            // Finds the active page container (annotation-layer) to append to.
            const container = document.querySelector('.annotation-layer');
            if (container) {
                container.appendChild(wrapper);
                this.stateManager.pushAction({ type: 'add', element: wrapper, parent: container });

                // Auto-select newly added image
                this.selectImage(wrapper);
            }
        };
        img.src = imgSrc;
    }

    /**
     * Adds the 8 cardinal resize handles + 1 rotation handle to the wrapper.
     */
    addHandles(wrapper) {
        const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        directions.forEach(dir => {
            const handle = document.createElement('div');
            handle.className = 'resize-handle handle-' + dir;
            handle.dataset.dir = dir;
            wrapper.appendChild(handle);
        });

        const rotHandle = document.createElement('div');
        rotHandle.className = 'resize-handle handle-rotate'; // Usually top-center stick
        wrapper.appendChild(rotHandle);
    }

    selectImage(wrapper) {
        // Deselect others
        document.querySelectorAll('.image-wrapper').forEach(w => w.classList.remove('selected'));

        wrapper.classList.add('selected');
        this.showImageToolbar(wrapper);
    }

    /**
     * Builds and displays the Floating Context Toolbar (Crop, Opacity, etc.)
     */
    showImageToolbar(wrapper) {
        this.removeImageToolbar(); // Clear existing

        // Check if we are in crop mode; if so, show crop toolbar instead
        if (wrapper.classList.contains('cropping')) {
            this.showCropToolbar(wrapper);
            return;
        }

        const toolbar = document.createElement('div');
        toolbar.className = 'image-toolbar';
        toolbar.id = 'active-image-toolbar';

        // STOP PROPAGATION: Critical to prevent dragging the image when clicking toolbar buttons
        toolbar.onmousedown = (e) => e.stopPropagation();

        // [Toolbar Button Generation Code Omitted for Brevity - Standard DOM creation]
        // ... (Crop, Opacity, Replace, Duplicate, Link, Delete, Done)

        // 1. Crop (Enter Mask Mode)
        const cropBtn = document.createElement('button');
        cropBtn.innerText = 'Crop';
        cropBtn.title = 'Crop Image';
        cropBtn.onclick = (e) => {
            e.stopPropagation();
            this.enterCropMode(wrapper);
        };
        toolbar.appendChild(cropBtn);

        // 2. Opacity Control
        const opacityWrapper = document.createElement('div');
        opacityWrapper.style.display = 'flex';
        opacityWrapper.style.alignItems = 'center';
        opacityWrapper.title = "Opacity";
        const opacityLabel = document.createElement('span');
        opacityLabel.innerText = 'Opacity';
        opacityLabel.style.fontSize = '12px';
        opacityLabel.style.marginRight = '5px';
        opacityLabel.style.cursor = 'default';
        opacityWrapper.appendChild(opacityLabel);

        const opacityInput = document.createElement('input');
        opacityInput.type = 'range';
        opacityInput.min = '0';
        opacityInput.max = '1';
        opacityInput.step = '0.1';
        opacityInput.value = wrapper.querySelector('canvas').style.opacity || '1';
        opacityInput.style.width = '60px';
        opacityInput.oninput = (e) => {
            wrapper.querySelector('canvas').style.opacity = e.target.value;
        };
        opacityWrapper.appendChild(opacityInput);
        toolbar.appendChild(opacityWrapper);

        // 3. Replace Image
        const replaceBtn = document.createElement('button');
        replaceBtn.innerText = 'Replace';
        replaceBtn.title = 'Replace with new file';
        replaceBtn.onclick = (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (evt) => {
                if (evt.target.files.length > 0) {
                    this.replaceImageSource(wrapper, evt.target.files[0]);
                }
            };
            input.click();
        };
        toolbar.appendChild(replaceBtn);

        // 4. Duplicate
        const dupBtn = document.createElement('button');
        dupBtn.innerText = 'Duplicate';
        dupBtn.onclick = (e) => {
            e.stopPropagation();
            this.duplicateImage(wrapper);
        };
        toolbar.appendChild(dupBtn);

        // 5. Link (Hyperlink)
        const linkBtn = document.createElement('button');
        linkBtn.innerText = 'Link';
        linkBtn.style.backgroundColor = wrapper.dataset.link ? '#e6f7ff' : '';
        linkBtn.onclick = (e) => {
            e.stopPropagation();
            const url = prompt("Enter URL for this image:", wrapper.dataset.link || 'https://');
            if (url) {
                wrapper.dataset.link = url;
                linkBtn.style.backgroundColor = '#e6f7ff';
            } else if (url === '') {
                delete wrapper.dataset.link;
                linkBtn.style.backgroundColor = '';
            }
        };
        toolbar.appendChild(linkBtn);

        // 6. Delete
        const delBtn = document.createElement('button');
        delBtn.innerText = '✘';
        delBtn.style.color = 'red';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            wrapper.remove();
            this.removeImageToolbar();
            this.stateManager.pushAction({ type: 'remove', element: wrapper, parent: wrapper.parentElement });
        };
        toolbar.appendChild(delBtn);

        // 7. Done
        const tickBtn = document.createElement('button');
        tickBtn.innerHTML = '✔';
        tickBtn.style.color = 'green';
        tickBtn.onclick = (e) => {
            e.stopPropagation();
            wrapper.classList.remove('selected');
            this.removeImageToolbar();
        };
        toolbar.appendChild(tickBtn);

        wrapper.appendChild(toolbar);
    }

    /**
     * Shows Confirm/Cancel buttons when in Crop Mode.
     */
    showCropToolbar(wrapper) {
        this.removeImageToolbar();

        const toolbar = document.createElement('div');
        toolbar.className = 'image-toolbar';
        toolbar.id = 'active-image-toolbar';
        toolbar.onmousedown = (e) => e.stopPropagation();

        // Confirm
        const confirmBtn = document.createElement('button');
        confirmBtn.innerHTML = '✔';
        confirmBtn.title = 'Save Crop';
        confirmBtn.style.color = 'green';
        confirmBtn.onclick = (e) => {
            e.stopPropagation();
            this.confirmCrop(wrapper);
        };
        toolbar.appendChild(confirmBtn);

        // Cancel
        const cancelBtn = document.createElement('button');
        cancelBtn.innerHTML = '✘';
        cancelBtn.title = 'Cancel Crop';
        cancelBtn.style.color = 'red';
        cancelBtn.onclick = (e) => {
            e.stopPropagation();
            this.cancelCrop(wrapper);
        };
        toolbar.appendChild(cancelBtn);

        wrapper.appendChild(toolbar);
    }

    replaceImageSource(wrapper, file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = wrapper.querySelector('canvas');
                // Update canvas dimensions and redraw
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
            }
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    duplicateImage(originalWrapper) {
        // Deep clone the DOM element (copies handles, styles)
        const clone = originalWrapper.cloneNode(true);

        // Offset position slightly so user sees the copy
        const currentLeft = parseFloat(originalWrapper.style.left);
        const currentTop = parseFloat(originalWrapper.style.top);
        clone.style.left = (currentLeft + 20) + 'px';
        clone.style.top = (currentTop + 20) + 'px';
        clone.classList.remove('selected');

        // Remove active toolbar from the clone
        const tb = clone.querySelector('.image-toolbar');
        if (tb) tb.remove();

        originalWrapper.parentElement.appendChild(clone);

        // CRITICAL: COPY CANVAS CONTENT
        // cloneNode() DOES NOT copy the bitmap data of a <canvas>, only the element.
        // We must manually redraw the original canvas content onto the clone's canvas.
        const origCanvas = originalWrapper.querySelector('canvas');
        const cloneCanvas = clone.querySelector('canvas');
        if (origCanvas && cloneCanvas) {
            const ctx = cloneCanvas.getContext('2d');
            ctx.drawImage(origCanvas, 0, 0);
        }

        // Re-attach interactive listeners (events are not cloned)
        this.makeDraggable(clone);
        this.makeResizable(clone);
        this.makeRotatable(clone);

        this.stateManager.pushAction({ type: 'add', element: clone, parent: originalWrapper.parentElement });
        this.selectImage(clone);
    }

    /**
     * Workflow: Enter Crop Mode
     * 1. Saves current state (dimensions) to allow reversion.
     * 2. Sets wrapper to 'cropping' mode.
     * 3. Converts Wrapper dimensions to fixed pixels (snapshot) for stable editing.
     * 4. Updates interactions: Wrapper becomes STATIC, Inner Canvas becomes MOVABLE/RESIZABLE.
     */
    enterCropMode(wrapper) {
        const inner = wrapper.querySelector('.image-content-box') || wrapper;
        const canvas = wrapper.querySelector('canvas');

        // Store pre-crop state
        wrapper._preCropState = {
            left: canvas.style.left,
            top: canvas.style.top,
            width: canvas.style.width,
            height: canvas.style.height,
            position: canvas.style.position
        };

        wrapper.classList.add('cropping');
        inner.style.overflow = 'hidden'; // Ensure masking is active
        wrapper.style.cursor = 'default'; // Wrapper stops moving

        // Logic: To crop, we actually move/resize the *image inside the box*,
        // while the box stays put. This visually looks like changing the viewport.
        const wrapperRect = wrapper.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();

        // Convert to absolute pixels relative to wrapper for editing
        canvas.style.position = 'absolute';
        canvas.style.left = (canvasRect.left - wrapperRect.left) + 'px';
        canvas.style.top = (canvasRect.top - wrapperRect.top) + 'px';
        canvas.style.width = canvasRect.width + 'px';
        canvas.style.height = canvasRect.height + 'px';

        this.showCropToolbar(wrapper);
    }

    confirmCrop(wrapper) {
        const inner = wrapper.querySelector('.image-content-box') || wrapper;
        const canvas = wrapper.querySelector('canvas');

        wrapper.classList.remove('cropping');

        // Convert pixel positions back to Percentages relative to the wrapper.
        // This ensures the crop scales correctly if the user resizes the wrapper later.
        const wrapperRect = wrapper.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();

        const leftPct = ((canvasRect.left - wrapperRect.left) / wrapperRect.width) * 100;
        const topPct = ((canvasRect.top - wrapperRect.top) / wrapperRect.height) * 100;
        const widthPct = (canvasRect.width / wrapperRect.width) * 100;
        const heightPct = (canvasRect.height / wrapperRect.height) * 100;

        canvas.style.position = 'absolute';
        canvas.style.left = leftPct + '%';
        canvas.style.top = topPct + '%';
        canvas.style.width = widthPct + '%';
        canvas.style.height = heightPct + '%';

        wrapper.style.cursor = 'move';
        inner.style.overflow = 'hidden'; // Keep masked

        delete wrapper._preCropState; // clear history
        this.showImageToolbar(wrapper);
    }

    cancelCrop(wrapper) {
        const inner = wrapper.querySelector('.image-content-box') || wrapper;
        const canvas = wrapper.querySelector('canvas');

        // Revert to saved state
        if (wrapper._preCropState) {
            canvas.style.left = wrapper._preCropState.left;
            canvas.style.top = wrapper._preCropState.top;
            canvas.style.width = wrapper._preCropState.width;
            canvas.style.height = wrapper._preCropState.height;
            canvas.style.position = wrapper._preCropState.position;
            delete wrapper._preCropState;
        }

        wrapper.classList.remove('cropping');
        wrapper.style.cursor = 'move';
        inner.style.overflow = 'hidden';

        this.showImageToolbar(wrapper);
    }

    toggleCropMode(wrapper) {
        this.enterCropMode(wrapper);
    }

    removeImageToolbar() {
        const existing = document.querySelectorAll('.image-toolbar');
        existing.forEach(t => t.remove());
    }

    /**
     * Interaction Logic: Draggable
     * Makes the element movable via mouse drag.
     */
    makeDraggable(elmnt) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        elmnt.onmousedown = (e) => {
            if (e.target.classList.contains('resize-handle')) return; // Allow resize to take over

            e.preventDefault();
            this.selectImage(elmnt);

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

            // In Crop Mode, we move the *inner canvas*, not the wrapper
            if (elmnt.classList.contains('cropping')) {
                const canvas = elmnt.querySelector('canvas');
                canvas.style.top = (canvas.offsetTop - pos2) + "px";
                canvas.style.left = (canvas.offsetLeft - pos1) + "px";
            } else {
                // Normal Mode: Move the wrapper
                elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
                elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
            }
        };

        const closeDragElement = () => {
            document.onmouseup = null;
            document.onmousemove = null;
        };
    }

    /**
     * Interaction Logic: Resizable
     * Changes Width/Height based on mouse delta from specific handles.
     */
    makeResizable(elmnt) {
        const handles = elmnt.querySelectorAll('.resize-handle');
        const minSize = 20;

        handles.forEach(handle => {
            if (handle.classList.contains('handle-rotate')) return;

            handle.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const dir = handle.dataset.dir; // n, s, e, w, ne, nw...
                let startX = e.clientX;
                let startY = e.clientY;
                let startWidth = parseInt(getComputedStyle(elmnt).width, 10);
                let startHeight = parseInt(getComputedStyle(elmnt).height, 10);
                let startLeft = elmnt.offsetLeft;
                let startTop = elmnt.offsetTop;

                document.onmousemove = (e) => {
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;

                    // East (Width)
                    if (dir.includes('e')) elmnt.style.width = Math.max(minSize, startWidth + dx) + 'px';

                    // South (Height)
                    if (dir.includes('s')) elmnt.style.height = Math.max(minSize, startHeight + dy) + 'px';

                    // West (Left + Width)
                    if (dir.includes('w')) {
                        const newW = Math.max(minSize, startWidth - dx);
                        elmnt.style.width = newW + 'px';
                        // Adjust left position to anchor right side
                        elmnt.style.left = (startLeft + (startWidth - newW)) + 'px';
                    }

                    // North (Top + Height)
                    if (dir.includes('n')) {
                        const newH = Math.max(minSize, startHeight - dy);
                        elmnt.style.height = newH + 'px';
                        elmnt.style.top = (startTop + (startHeight - newH)) + 'px';
                    }
                };

                document.onmouseup = () => {
                    document.onmousemove = null;
                    document.onmouseup = null;
                };
            };
        });
    }

    /**
     * Interaction Logic: Rotatable
     * Calculates angle between center of element and mouse pointer.
     */
    makeRotatable(elmnt) {
        const handle = elmnt.querySelector('.handle-rotate');
        if (!handle) return;

        handle.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const rect = elmnt.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            document.onmousemove = (e) => {
                // Calculate angle in radians
                const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
                // Convert to degrees and adjust (handle is at top -90deg, or similar offset)
                const degree = angle * (180 / Math.PI) + 90;
                elmnt.style.transform = `rotate(${degree}deg)`;
            };

            document.onmouseup = () => {
                document.onmousemove = null;
                document.onmouseup = null;
            };
        };
    }
}
