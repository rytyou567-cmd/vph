/**
 * UIManager.js
 * 
 * ROLE:
 * Manages the Sidebar UI, Thumbnail generation, and Page Reordering interactions.
 * It does NOT handle the main canvas (that's Viewer.js), but ensures the sidebar 
 * stays in sync with the document state.
 * 
 * WORKFLOW:
 * 1. `renderSidebar`: Generates thumbnails using PDF.js.
 * 2. `enableDragAndDrop`: Attaches Drag & Drop events to thumbnails.
 * 3. `syncPageOrder`: Rearranges the actual main .pdf-page-wrappers logic in the DOM 
 *    to match the new visual order in the sidebar.
 */
export class UIManager {
    constructor() {
        this.sidebarContainer = document.getElementById('sidebarItems');
    }

    renderSidebar(pdfDoc, onThumbnailClick) {
        this.sidebarContainer.innerHTML = '';
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            pdfDoc.getPage(i).then(page => {
                const viewport = page.getViewport({ scale: 0.2 });
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                this.createThumbnailItem(canvas, i, onThumbnailClick);
                page.render({ canvasContext: ctx, viewport: viewport });
            });
        }
        // Initialize simple drag and drop (using SortableJS would be better but vanilla is fine)
        this.enableDragAndDrop();
    }

    addThumbnail(pageNumber, width, height, onClick) {
        const item = document.createElement('div');
        item.style.width = '100px';
        item.style.height = (100 * (height / width)) + 'px';
        item.style.backgroundColor = 'white';
        item.style.border = '1px solid #ccc';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'center';
        item.innerText = 'New Page';

        this.createThumbnailItem(item, pageNumber, onClick, true); // true for wrapper content
    }

    createThumbnailItem(content, pageNum, onClick, isElement = false) {
        const item = document.createElement('div');
        item.className = 'thumbnail-item';
        item.draggable = true;
        item.dataset.pageNumber = pageNum;

        // Delete Button
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '×';
        delBtn.className = 'delete-page-btn';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm('Delete this page?')) {
                this.deletePage(item, pageNum);
            }
        };
        item.appendChild(delBtn);

        // Content
        const contentContainer = document.createElement('div');
        contentContainer.className = 'thumb-content';
        contentContainer.onclick = () => onClick(pageNum);

        if (isElement) {
            contentContainer.appendChild(content);
        } else {
            contentContainer.appendChild(content); // Canvas
        }

        item.appendChild(contentContainer);
        this.sidebarContainer.appendChild(item);
    }

    deletePage(item, pageNum) {
        // Remove thumbnail
        item.remove();
        // Remove Page Wrapper
        const wrapper = document.querySelector(`.pdf-page-wrapper[data-page-number="${pageNum}"]`);
        if (wrapper) wrapper.remove();

        // Remove Merge Button (Separator)
        const mergeBtn = document.getElementById('merge-btn-' + pageNum);
        if (mergeBtn) {
            const separator = mergeBtn.closest('.merge-separator');
            if (separator) separator.remove();
        }
    }

    enableDragAndDrop() {
        let draggedItem = null;

        this.sidebarContainer.addEventListener('dragstart', (e) => {
            draggedItem = e.target.closest('.thumbnail-item');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', draggedItem.innerHTML); // Firefox needs data
            draggedItem.style.opacity = '0.5';
        });

        this.sidebarContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const target = e.target.closest('.thumbnail-item');
            if (target && target !== draggedItem) {
                // Determine mouse position relative to target
                const rect = target.getBoundingClientRect();
                const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
                this.sidebarContainer.insertBefore(draggedItem, next ? target.nextSibling : target);
            }
        });

        this.sidebarContainer.addEventListener('dragend', () => {
            if (draggedItem) draggedItem.style.opacity = '1';
            draggedItem = null;
            this.syncPageOrder();
        });
    }

    /**
     * Synchronizes the main view DOM order with the sidebar thumbnail order.
     * This is critical for saving the PDF in correct sequence.
     */
    syncPageOrder() {
        // Reorder .pdf-page-wrapper elements based on sidebar order
        const mainContainer = document.getElementById('pdfContainer');
        const thumbs = document.querySelectorAll('.thumbnail-item');

        thumbs.forEach(thumb => {
            const pageNum = thumb.dataset.pageNumber;
            const wrapper = document.querySelector(`.pdf-page-wrapper[data-page-number="${pageNum}"]`);
            if (wrapper) {
                mainContainer.appendChild(wrapper); // Appending moves it to the end, effectively reordering
            }
        });
    }

    toggleSidebar() {
        const sb = document.querySelector('.sidebar');
        sb.classList.toggle('active');

        // Force redraw for canvas resize if needed, though mostly visual
        if (sb.classList.contains('active')) {
            sb.style.display = 'flex'; // Ensure flex layout
        } else {
            // Optional: wait for animation to finish before hiding? 
            // CSS handles width: 0 which effectively hides it without display:none breaking transitions
        }
    }

    updateToolUI(tool) {
        document.querySelectorAll('.tool-btn, .dropdown-btn').forEach(b => b.classList.remove('active'));

        if (tool.startsWith('eraser-')) {
            const btn = document.getElementById('tool-eraser-btn');
            if (btn) btn.classList.add('active');

            // Also highlight the specific dropdown item
            const subBtn = document.getElementById('tool-' + tool);
            if (subBtn) subBtn.classList.add('active');

            const opts = document.getElementById('eraser-options');
            if (opts) opts.style.display = 'flex';
        } else {
            const btn = document.getElementById('tool-' + tool);
            if (btn) btn.classList.add('active');
            const opts = document.getElementById('eraser-options');
            if (opts) opts.style.display = 'none';
        }
    }
}
