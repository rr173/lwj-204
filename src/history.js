import { deepClone } from './core.js';

export class HistoryManager {
  constructor(maxSize = 50) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxSize = maxSize;
  }
  
  saveState(nodes, members) {
    const state = {
      nodes: deepClone(nodes),
      members: deepClone(members)
    };
    
    this.undoStack.push(state);
    this.redoStack = [];
    
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
  }
  
  undo(currentNodes, currentMembers) {
    if (this.undoStack.length <= 1) return null;
    
    const current = {
      nodes: deepClone(currentNodes),
      members: deepClone(currentMembers)
    };
    this.redoStack.push(current);
    
    const previous = this.undoStack.pop();
    return previous;
  }
  
  redo(currentNodes, currentMembers) {
    if (this.redoStack.length === 0) return null;
    
    const current = {
      nodes: deepClone(currentNodes),
      members: deepClone(currentMembers)
    };
    this.undoStack.push(current);
    
    const next = this.redoStack.pop();
    return next;
  }
  
  canUndo() {
    return this.undoStack.length > 1;
  }
  
  canRedo() {
    return this.redoStack.length > 0;
  }
  
  reset() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
