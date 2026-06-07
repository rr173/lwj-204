import { getForceColor } from './core.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.displacementScale = 100;
    this.showDeformed = true;
    this.maxForce = 0;
    this.hasResults = false;
    this.viewMode = 'single';
    this.envelopeData = null;
    this.yieldStress = 235e6;
  }
  
  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }
  
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  
  drawGrid() {
    const gridSize = 50;
    this.ctx.strokeStyle = '#e0e0e0';
    this.ctx.lineWidth = 1;
    
    for (let x = 0; x < this.canvas.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }
    
    for (let y = 0; y < this.canvas.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
  }
  
  drawMember(member, nodeMap) {
    const node1 = nodeMap.get(member.node1Id);
    const node2 = nodeMap.get(member.node2Id);
    if (!node1 || !node2) return;
    
    let color = '#333';
    let isOverLimit = false;
    let envelopeMaxForce = null;
    let envelopeInfo = null;
    
    if (this.viewMode === 'envelope' && this.envelopeData) {
      envelopeInfo = this.envelopeData.get(member.id);
      if (envelopeInfo) {
        envelopeMaxForce = Math.max(Math.abs(envelopeInfo.maxTension), Math.abs(envelopeInfo.maxCompression));
        color = getForceColor(
          Math.abs(envelopeInfo.maxTension) >= Math.abs(envelopeInfo.maxCompression) 
            ? envelopeInfo.maxTension 
            : envelopeInfo.maxCompression,
          this.maxForce
        );
        const maxStress = Math.max(Math.abs(envelopeInfo.maxTensionStress), Math.abs(envelopeInfo.maxCompressionStress));
        isOverLimit = maxStress > this.yieldStress;
      }
    } else if (this.hasResults) {
      color = getForceColor(member.axialForce, this.maxForce);
      isOverLimit = Math.abs(member.stress) > this.yieldStress;
    }
    
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = member.selected ? 6 : 4;
    this.ctx.lineCap = 'round';
    
    if (isOverLimit) {
      this.ctx.setLineDash([8, 4]);
      this.ctx.lineWidth = member.selected ? 8 : 6;
      this.ctx.strokeStyle = '#ffc107';
    }
    
    this.ctx.beginPath();
    this.ctx.moveTo(node1.x, node1.y);
    this.ctx.lineTo(node2.x, node2.y);
    this.ctx.stroke();
    
    this.ctx.setLineDash([]);
    this.ctx.lineWidth = member.selected ? 6 : 4;
    
    if (!isOverLimit || this.viewMode !== 'envelope') {
      this.ctx.strokeStyle = color;
      this.ctx.beginPath();
      this.ctx.moveTo(node1.x, node1.y);
      this.ctx.lineTo(node2.x, node2.y);
      this.ctx.stroke();
    }
    
    if (this.viewMode === 'envelope' && envelopeInfo) {
      this.drawEnvelopeLabels(member, node1, node2, envelopeInfo);
    }
    
    if (this.hasResults && this.showDeformed && this.viewMode === 'single') {
      this.drawDeformedMember(member, node1, node2);
    }
  }
  
  drawEnvelopeLabels(member, node1, node2, envelopeInfo) {
    const midX = (node1.x + node2.x) / 2;
    const midY = (node1.y + node2.y) / 2;
    
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = 'bold 11px sans-serif';
    
    const tensionText = `${(envelopeInfo.maxTension / 1000).toFixed(2)} kN 拉`;
    const compressionText = `${(Math.abs(envelopeInfo.maxCompression) / 1000).toFixed(2)} kN 压`;
    
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.fillRect(midX - 50, midY - 20, 100, 36);
    
    this.ctx.fillStyle = '#1565c0';
    this.ctx.fillText(tensionText, midX, midY - 8);
    
    this.ctx.fillStyle = '#c62828';
    this.ctx.fillText(compressionText, midX, midY + 10);
  }
  
  drawDeformedMember(member, node1, node2) {
    const x1 = node1.x + node1.dx * this.displacementScale;
    const y1 = node1.y + node1.dy * this.displacementScale;
    const x2 = node2.x + node2.dx * this.displacementScale;
    const y2 = node2.y + node2.dy * this.displacementScale;
    
    this.ctx.strokeStyle = 'rgba(100, 100, 100, 0.6)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 4]);
    
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
    
    this.ctx.setLineDash([]);
  }
  
  drawNode(node) {
    this.ctx.fillStyle = node.selected ? '#ff9800' : '#fff';
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 2;
    
    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, node.selected ? 10 : 8, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
    
    if (this.hasResults && this.showDeformed) {
      this.drawDeformedNode(node);
    }
  }
  
  drawDeformedNode(node) {
    const x = node.x + node.dx * this.displacementScale;
    const y = node.y + node.dy * this.displacementScale;
    
    this.ctx.fillStyle = 'rgba(100, 100, 100, 0.6)';
    this.ctx.strokeStyle = 'rgba(80, 80, 80, 0.6)';
    this.ctx.lineWidth = 1;
    
    this.ctx.beginPath();
    this.ctx.arc(x, y, 5, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
  }
  
  drawSupport(node) {
    if (node.support === 'free') return;
    
    const x = node.x;
    const y = node.y;
    
    if (node.support === 'pinned') {
      this.ctx.fillStyle = '#4caf50';
      this.ctx.strokeStyle = '#2e7d32';
      this.ctx.lineWidth = 2;
      
      this.ctx.beginPath();
      this.ctx.moveTo(x, y + 15);
      this.ctx.lineTo(x - 12, y + 30);
      this.ctx.lineTo(x + 12, y + 30);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();
      
      for (let i = -10; i <= 10; i += 5) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + i, y + 30);
        this.ctx.lineTo(x + i - 3, y + 36);
        this.ctx.stroke();
      }
    } else if (node.support === 'roller') {
      this.ctx.fillStyle = '#2196f3';
      this.ctx.strokeStyle = '#1565c0';
      this.ctx.lineWidth = 2;
      
      this.ctx.beginPath();
      this.ctx.moveTo(x, y + 12);
      this.ctx.lineTo(x - 15, y + 25);
      this.ctx.lineTo(x + 15, y + 25);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();
      
      this.ctx.fillStyle = '#fff';
      this.ctx.beginPath();
      this.ctx.arc(x - 8, y + 30, 5, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
      
      this.ctx.beginPath();
      this.ctx.arc(x + 8, y + 30, 5, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }
  }
  
  drawLoad(node) {
    if (Math.abs(node.fx) < 1e-6 && Math.abs(node.fy) < 1e-6) return;
    
    const x = node.x;
    const y = node.y;
    const scale = 0.003;
    
    const fx = node.fx * scale;
    const fy = node.fy * scale;
    
    const magnitude = Math.sqrt(fx * fx + fy * fy);
    if (magnitude < 1) return;
    
    const arrowLength = Math.min(magnitude, 60);
    const nx = fx / magnitude;
    const ny = fy / magnitude;
    
    const startX = x - nx * 15;
    const startY = y - ny * 15;
    const endX = startX + nx * arrowLength;
    const endY = startY + ny * arrowLength;
    
    this.ctx.strokeStyle = '#f44336';
    this.ctx.fillStyle = '#f44336';
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';
    
    this.ctx.beginPath();
    this.ctx.moveTo(startX, startY);
    this.ctx.lineTo(endX, endY);
    this.ctx.stroke();
    
    const headLength = 12;
    const angle = Math.atan2(ny, nx);
    
    this.ctx.beginPath();
    this.ctx.moveTo(endX, endY);
    this.ctx.lineTo(
      endX - headLength * Math.cos(angle - Math.PI / 6),
      endY - headLength * Math.sin(angle - Math.PI / 6)
    );
    this.ctx.lineTo(
      endX - headLength * Math.cos(angle + Math.PI / 6),
      endY - headLength * Math.sin(angle + Math.PI / 6)
    );
    this.ctx.closePath();
    this.ctx.fill();
  }
  
  drawSelectionBox(box) {
    if (!box) return;
    
    this.ctx.strokeStyle = '#1976d2';
    this.ctx.fillStyle = 'rgba(25, 118, 210, 0.1)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([5, 3]);
    
    const x = Math.min(box.startX, box.endX);
    const y = Math.min(box.startY, box.endY);
    const w = Math.abs(box.endX - box.startX);
    const h = Math.abs(box.endY - box.startY);
    
    this.ctx.fillRect(x, y, w, h);
    this.ctx.strokeRect(x, y, w, h);
    
    this.ctx.setLineDash([]);
  }
  
  drawPreviewLine(startNode, endX, endY) {
    if (!startNode) return;
    
    this.ctx.strokeStyle = 'rgba(25, 118, 210, 0.5)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 4]);
    
    this.ctx.beginPath();
    this.ctx.moveTo(startNode.x, startNode.y);
    this.ctx.lineTo(endX, endY);
    this.ctx.stroke();
    
    this.ctx.setLineDash([]);
  }
  
  render(nodes, members, extras = {}) {
    this.clear();
    this.drawGrid();
    
    const nodeMap = new Map();
    nodes.forEach(n => nodeMap.set(n.id, n));
    
    for (const member of members) {
      this.drawMember(member, nodeMap);
    }
    
    for (const node of nodes) {
      this.drawSupport(node);
      this.drawLoad(node);
    }
    
    for (const node of nodes) {
      this.drawNode(node);
    }
    
    if (extras.selectionBox) {
      this.drawSelectionBox(extras.selectionBox);
    }
    
    if (extras.previewLine) {
      this.drawPreviewLine(
        extras.previewLine.startNode,
        extras.previewLine.endX,
        extras.previewLine.endY
      );
    }
  }
}
