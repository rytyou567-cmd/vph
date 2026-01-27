/**
 * Viewer.js
 * 
 * ROLE:
 * Wraps the `pdf.js` library to handle the Rendering Pipeline.
 * Responsible for:
 * 1. Loading the PDF document.
 * 2. Iterating through pages and rendering them to HTML5 Canvases.
 * 3. Managing the Viewport scaling.
 * 4. Injecting "Merge Buttons" between pages for file insertion.
 */
export class Viewer {
    constructor(pdfLib, container, sidebarFn, onMergeFn) {
        this.pdfLib = pdfLib;
        this.container = container;
        this.sidebarFn = sidebarFn;
        this.onMergeFn = onMergeFn; // New Callback
        this.pdfDoc = null;
        this.scale = 1.0;
        this.pageRendering = false;
        this.globalPageCount = 0;
    }

    async loadDocument(dataUrl) {
        try {
            const loadingTask = this.pdfLib.getDocument(dataUrl);
            this.pdfDoc = await loadingTask.promise;
            this.globalPageCount = this.pdfDoc.numPages;
            await this.renderAllPages();
            if (this.sidebarFn) await this.sidebarFn(this.pdfDoc);
        } catch (error) {
            console.error('Error loading PDF:', error);
            alert('Error loading PDF: ' + error.message);
        }
    }

    async renderAllPages() {
        this.container.innerHTML = ''; // Clear
        for (let i = 1; i <= this.pdfDoc.numPages; i++) {
            await this.renderPage(i);

            // Inject Merge Button AFTER each page (i is 1-based)
            this.injectMergeButton(i);
        }
    }

    injectMergeButton(pageIndex) {
        const separator = document.createElement('div');
        separator.className = 'merge-separator';
        separator.title = 'Insert PDF here';

        const btn = document.createElement('button');
        btn.className = 'merge-btn';
        btn.id = 'merge-btn-' + pageIndex;
        btn.innerHTML = '<span>+</span> Insert PDF';

        btn.onclick = () => {
            if (this.onMergeFn) this.onMergeFn(pageIndex);
        };

        separator.appendChild(btn);
        this.container.appendChild(separator);
    }

    async renderPage(num) {
        const page = await this.pdfDoc.getPage(num);
        const viewport = page.getViewport({ scale: this.scale });

        // Wrapper
        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'pdf-page-wrapper';
        pageWrapper.style.width = viewport.width + 'px';
        pageWrapper.style.height = viewport.height + 'px';
        pageWrapper.dataset.pageNumber = num;
        pageWrapper.dataset.originalPageIndex = num - 1; // 0-based index for PDF-Lib
        this.container.appendChild(pageWrapper);

        // PDF Content Canvas (The Base Image)
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.className = 'pdf-canvas';
        pageWrapper.appendChild(canvas);

        // Execute Render Task
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;

        // Text Layer
        const textContent = await page.getTextContent();
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        pageWrapper.appendChild(textLayerDiv);

        const textLayer = this.pdfLib.renderTextLayer({
            textContent: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        });
        await textLayer.promise;

        // Initialize Layer Stack (delegated to main controller or handled here if pure display)
        // We will emit an event or call a callback to let the ToolManager setup layers
        const event = new CustomEvent('page-rendered', {
            detail: { wrapper: pageWrapper, width: viewport.width, height: viewport.height }
        });
        document.dispatchEvent(event);
    }

    addNewPage() {
        this.globalPageCount++;
        let width = 595, height = 842;

        const firstPage = document.querySelector('.pdf-page-wrapper');
        if (firstPage) {
            width = parseFloat(firstPage.style.width);
            height = parseFloat(firstPage.style.height);
        }

        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'pdf-page-wrapper new-page';
        pageWrapper.style.width = width + 'px';
        pageWrapper.style.height = height + 'px';
        pageWrapper.style.backgroundColor = 'white';
        pageWrapper.style.marginBottom = '20px';
        pageWrapper.style.position = 'relative';
        pageWrapper.dataset.pageNumber = this.globalPageCount;
        pageWrapper.dataset.originalPageIndex = '-1'; // New Page Flag

        this.container.appendChild(pageWrapper);

        // White Base Canvas
        const baseCanvas = document.createElement('canvas');
        baseCanvas.width = width;
        baseCanvas.height = height;
        baseCanvas.style.display = 'block';
        const ctx = baseCanvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        pageWrapper.appendChild(baseCanvas);

        // Notify to add layers
        const event = new CustomEvent('page-rendered', {
            detail: { wrapper: pageWrapper, width: width, height: height }
        });
        document.dispatchEvent(event);

        // Scroll
        setTimeout(() => pageWrapper.scrollIntoView({ behavior: 'smooth' }), 100);

        return { width, height, pageNum: this.globalPageCount };
    }
}
