/**
 * StateManager.js
 * 
 * ROLE:
 * Handles the Undo/Redo history stack for the editor.
 * Implements the Command Pattern, where every user action (draw, move, resize) 
 * is stored as an 'Action Object' that can be reversed or re-applied.
 * 
 * ACTION TYPES:
 * - 'add': Element appended to DOM.
 * - 'remove': Element removed from DOM.
 * - 'modify': Style/Property change (Move, Resize).
 * - 'canvas': Bitmap change on a drawing layer.
 */
export class StateManager {
    constructor() {
        this.actionStack = [];
        this.redoStack = [];
    }

    pushAction(action) {
        this.actionStack.push(action);
        this.redoStack = []; // Clear redo on new action
    }

    undo() {
        if (this.actionStack.length === 0) return null;
        const action = this.actionStack.pop();
        this.redoStack.push(action);
        this.applyUndo(action);
        return action;
    }

    redo() {
        if (this.redoStack.length === 0) return null;
        const action = this.redoStack.pop();
        this.actionStack.push(action);
        this.applyRedo(action);
        return action;
    }

    /**
     * Reverses an action based on its type.
     * @param {object} action - The action object popped from the stack.
     */
    applyUndo(action) {
        if (action.type === 'add') {
            // Undo Add = Remove
            action.element.remove();
        } else if (action.type === 'remove') {
            // Undo Remove = Re-append
            action.parent.appendChild(action.element);
        } else if (action.type === 'canvas') {
            // Restore previous bitmap state
            this.restoreCanvas(action.canvas, action.oldData);
        } else if (action.type === 'modify') {
            // Restore previous styles/props
            if (action.prop === 'style') {
                if (action.oldLeft) action.element.style.left = action.oldLeft;
                if (action.oldTop) action.element.style.top = action.oldTop;
                if (action.oldWidth) action.element.style.width = action.oldWidth;
                if (action.oldHeight) action.element.style.height = action.oldHeight;
            }
        }
    }

    applyRedo(action) {
        if (action.type === 'add') {
            action.parent.appendChild(action.element);
        } else if (action.type === 'remove') {
            action.element.remove();
        } else if (action.type === 'canvas') {
            this.restoreCanvas(action.canvas, action.newData);
        } else if (action.type === 'modify') {
            if (action.prop === 'style') {
                if (action.newLeft) action.element.style.left = action.newLeft;
                if (action.newTop) action.element.style.top = action.newTop;
                if (action.newWidth) action.element.style.width = action.newWidth;
                if (action.newHeight) action.element.style.height = action.newHeight;
            }
        }
    }

    restoreCanvas(canvas, dataUrl) {
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = dataUrl;
    }

    clear() {
        this.actionStack = [];
        this.redoStack = [];
    }
}
