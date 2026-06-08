import { getForceColor } from './core.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.displacementScale = 100;
    this.showDeformed = true;
    this.maxForce = 0;
    this.maxMoment = 0;
    this.hasResults = false;
    this.viewMode = 'single';
    this.envelopeData = null;
    this.yieldStress = 235e6;
    this.analysisMode = 'truss';
    this.forceDiagramType = 'moment';
    this.frameResults = null;
    this.modalMode = false;
    this.modalModeShape = null;
    this.modalAmplitude = 0;
    this.modalEnvelope = null;
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
    } else if (this.hasResults && this.analysisMode === 'truss') {
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

    if (this.analysisMode === 'frame' && (member.release1 || member.release2)) {
      this.drawEndRelease(member, node1, node2);
    }

    if (this.analysisMode === 'frame' && member.q !== 0) {
      this.drawUniformLoad(member, node1, node2);
    }

    if (this.viewMode === 'envelope' && envelopeInfo) {
      this.drawEnvelopeLabels(member, node1, node2, envelopeInfo);
    }

    if (this.hasResults && this.showDeformed && this.viewMode === 'single') {
      this.drawDeformedMember(member, node1, node2);
    }

    if (this.hasResults && this.analysisMode === 'frame' && this.frameResults) {
      const mr = this.frameResults.members.find(m => m.id === member.id);
      if (mr) {
        if (this.forceDiagramType === 'moment') {
          this.drawMomentDiagram(member, node1, node2, mr);
        } else if (this.forceDiagramType === 'shear') {
          this.drawShearDiagram(member, node1, node2, mr);
        } else if (this.forceDiagramType === 'axial') {
          this.drawAxialDiagram(member, node1, node2, mr);
        }
      }
    }
  }

  drawEndRelease(member, node1, node2) {
    const dx = node2.x - node1.x;
    const dy = node2.y - node1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    const nx = -dy / len;
    const ny = dx / len;
    const r = 8;

    if (member.release1) {
      const cx = node1.x;
      const cy = node1.y;
      this.ctx.strokeStyle = '#ff9800';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(cx + nx * r, cy + ny * r, r, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.arc(cx - nx * r, cy - ny * r, r, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    if (member.release2) {
      const cx = node2.x;
      const cy = node2.y;
      this.ctx.strokeStyle = '#ff9800';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(cx + nx * r, cy + ny * r, r, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.arc(cx - nx * r, cy - ny * r, r, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  drawUniformLoad(member, node1, node2) {
    const dx = node2.x - node1.x;
    const dy = node2.y - node1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const q = member.q;
    const loadDir = q > 0 ? 1 : -1;
    const absQ = Math.abs(q);
    const arrowLen = Math.min(20, Math.max(8, absQ * 0.002));
    const numArrows = Math.max(3, Math.min(10, Math.floor(len / 25)));

    this.ctx.strokeStyle = '#9c27b0';
    this.ctx.fillStyle = '#9c27b0';
    this.ctx.lineWidth = 1.5;

    const offset = loadDir * 6;
    const baseX1 = node1.x + nx * offset;
    const baseY1 = node1.y + ny * offset;
    const baseX2 = node2.x + nx * offset;
    const baseY2 = node2.y + ny * offset;

    this.ctx.beginPath();
    this.ctx.moveTo(baseX1, baseY1);
    this.ctx.lineTo(baseX2, baseY2);
    this.ctx.stroke();

    for (let i = 0; i <= numArrows; i++) {
      const t = i / numArrows;
      const px = baseX1 + (baseX2 - baseX1) * t;
      const py = baseY1 + (baseY2 - baseY1) * t;
      const tipX = px + nx * arrowLen * loadDir;
      const tipY = py + ny * arrowLen * loadDir;

      this.ctx.beginPath();
      this.ctx.moveTo(px, py);
      this.ctx.lineTo(tipX, tipY);
      this.ctx.stroke();

      const headLen = 5;
      const dirX = nx * loadDir;
      const dirY = ny * loadDir;
      this.ctx.beginPath();
      this.ctx.moveTo(tipX, tipY);
      this.ctx.lineTo(tipX - headLen * dirX + headLen * 0.4 * ux, tipY - headLen * dirY + headLen * 0.4 * uy);
      this.ctx.lineTo(tipX - headLen * dirX - headLen * 0.4 * ux, tipY - headLen * dirY - headLen * 0.4 * uy);
      this.ctx.closePath();
      this.ctx.fill();
    }

    this.ctx.font = '11px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    const midBaseX = (baseX1 + baseX2) / 2 + nx * (arrowLen + 12) * loadDir;
    const midBaseY = (baseY1 + baseY2) / 2 + ny * (arrowLen + 12) * loadDir;
    this.ctx.fillText(`${(absQ / 1000).toFixed(1)} kN/m`, midBaseX, midBaseY);
  }

  drawMomentDiagram(member, node1, node2, memberResult) {
    const dx = node2.x - node1.x;
    const dy = node2.y - node1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const M1 = memberResult.M1;
    const M2 = memberResult.M2;
    const q = memberResult.q || 0;

    const maxM = Math.max(Math.abs(M1), Math.abs(M2), 1e-6);
    const scale = Math.min(60, Math.max(15, 2000 / maxM));

    const numSeg = 20;
    const points = [];

    for (let i = 0; i <= numSeg; i++) {
      const t = i / numSeg;
      const L = member.length * 0.01;
      const x = t * L;

      let M;
      if (Math.abs(q) > 1e-10) {
        M = M1 * (1 - t) + M2 * t + q * x * (L - x) / 2;
      } else {
        M = M1 * (1 - t) + M2 * t;
      }

      const px = node1.x + dx * t;
      const py = node1.y + dy * t;
      const offsetY = -M * scale;

      points.push({
        px: px + nx * offsetY,
        py: py + ny * offsetY,
        M
      });
    }

    this.ctx.fillStyle = 'rgba(76, 175, 80, 0.3)';
    this.ctx.strokeStyle = '#4caf50';
    this.ctx.lineWidth = 2;

    this.ctx.beginPath();
    this.ctx.moveTo(node1.x, node1.y);
    for (const p of points) {
      this.ctx.lineTo(p.px, p.py);
    }
    this.ctx.lineTo(node2.x, node2.y);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.font = 'bold 10px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#2e7d32';
    if (Math.abs(M1) > maxM * 0.05) {
      const labelOff1 = -M1 * scale;
      this.ctx.fillText(`${(M1 / 1000).toFixed(1)}`, node1.x + nx * (labelOff1 + (M1 > 0 ? 12 : -12)), node1.y + ny * (labelOff1 + (M1 > 0 ? 12 : -12)));
    }
    if (Math.abs(M2) > maxM * 0.05) {
      const labelOff2 = -M2 * scale;
      this.ctx.fillText(`${(M2 / 1000).toFixed(1)}`, node2.x + nx * (labelOff2 + (M2 > 0 ? 12 : -12)), node2.y + ny * (labelOff2 + (M2 > 0 ? 12 : -12)));
    }
  }

  drawShearDiagram(member, node1, node2, memberResult) {
    const dx = node2.x - node1.x;
    const dy = node2.y - node1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const V1 = memberResult.V1;
    const V2 = memberResult.V2;
    const q = memberResult.q || 0;

    const maxV = Math.max(Math.abs(V1), Math.abs(V2), 1e-6);
    const scale = Math.min(60, Math.max(15, 2000 / maxV));

    const numSeg = 20;
    const points = [];

    for (let i = 0; i <= numSeg; i++) {
      const t = i / numSeg;
      let V;
      if (Math.abs(q) > 1e-10) {
        V = V1 - q * t * member.length * 0.01;
      } else {
        V = V1 * (1 - t) + V2 * t;
      }

      const px = node1.x + dx * t;
      const py = node1.y + dy * t;
      const offsetY = -V * scale;

      points.push({
        px: px + nx * offsetY,
        py: py + ny * offsetY,
        V
      });
    }

    this.ctx.fillStyle = 'rgba(33, 150, 243, 0.3)';
    this.ctx.strokeStyle = '#2196f3';
    this.ctx.lineWidth = 2;

    this.ctx.beginPath();
    this.ctx.moveTo(node1.x, node1.y);
    for (const p of points) {
      this.ctx.lineTo(p.px, p.py);
    }
    this.ctx.lineTo(node2.x, node2.y);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.font = 'bold 10px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#1565c0';
    if (Math.abs(V1) > maxV * 0.05) {
      const labelOff1 = -V1 * scale;
      this.ctx.fillText(`${(V1 / 1000).toFixed(1)}`, node1.x + nx * (labelOff1 + (V1 > 0 ? 12 : -12)), node1.y + ny * (labelOff1 + (V1 > 0 ? 12 : -12)));
    }
    if (Math.abs(V2) > maxV * 0.05) {
      const labelOff2 = -V2 * scale;
      this.ctx.fillText(`${(V2 / 1000).toFixed(1)}`, node2.x + nx * (labelOff2 + (V2 > 0 ? 12 : -12)), node2.y + ny * (labelOff2 + (V2 > 0 ? 12 : -12)));
    }
  }

  drawAxialDiagram(member, node1, node2, memberResult) {
    const dx = node2.x - node1.x;
    const dy = node2.y - node1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    const nx = -dy / len;
    const ny = dx / len;

    const N1 = memberResult.N1;
    const N2 = memberResult.N2;
    const maxN = Math.max(Math.abs(N1), Math.abs(N2), 1e-6);
    const scale = Math.min(60, Math.max(15, 2000 / maxN));

    const off1 = -N1 * scale;
    const off2 = -N2 * scale;

    this.ctx.fillStyle = 'rgba(244, 67, 54, 0.3)';
    this.ctx.strokeStyle = '#f44336';
    this.ctx.lineWidth = 2;

    this.ctx.beginPath();
    this.ctx.moveTo(node1.x, node1.y);
    this.ctx.lineTo(node1.x + nx * off1, node1.y + ny * off1);
    this.ctx.lineTo(node2.x + nx * off2, node2.y + ny * off2);
    this.ctx.lineTo(node2.x, node2.y);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.font = 'bold 10px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#c62828';
    if (Math.abs(N1) > maxN * 0.05) {
      this.ctx.fillText(`${(N1 / 1000).toFixed(1)}`, node1.x + nx * (off1 + (N1 > 0 ? 12 : -12)), node1.y + ny * (off1 + (N1 > 0 ? 12 : -12)));
    }
    if (Math.abs(N2) > maxN * 0.05) {
      this.ctx.fillText(`${(N2 / 1000).toFixed(1)}`, node2.x + nx * (off2 + (N2 > 0 ? 12 : -12)), node2.y + ny * (off2 + (N2 > 0 ? 12 : -12)));
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

    if (node.support === 'fixed') {
      this.ctx.strokeStyle = '#333';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(x - 15, y + 15);
      this.ctx.lineTo(x + 15, y + 15);
      this.ctx.stroke();

      for (let i = -12; i <= 12; i += 6) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + i, y + 15);
        this.ctx.lineTo(x + i - 5, y + 22);
        this.ctx.stroke();
      }
    } else if (node.support === 'pinned') {
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

  drawModeShapeEnvelope(nodes, members, nodeMap, modeShape, scale) {
    this.ctx.save();
    this.ctx.globalAlpha = 0.25;
    this.ctx.strokeStyle = '#9c27b0';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 4]);

    for (const sign of [1, -1]) {
      this.ctx.beginPath();
      let first = true;
      for (const member of members) {
        const n1 = nodeMap.get(member.node1Id);
        const n2 = nodeMap.get(member.node2Id);
        if (!n1 || !n2) continue;

        const ms1 = modeShape.find(m => m.nodeId === n1.id);
        const ms2 = modeShape.find(m => m.nodeId === n2.id);
        if (!ms1 || !ms2) continue;

        const x1 = n1.x + ms1.dx * scale * sign;
        const y1 = n1.y + ms1.dy * scale * sign;
        const x2 = n2.x + ms2.dx * scale * sign;
        const y2 = n2.y + ms2.dy * scale * sign;

        if (first) {
          this.ctx.moveTo(x1, y1);
          first = false;
        }
        this.ctx.lineTo(x1, y1);
        this.ctx.lineTo(x2, y2);
      }
      this.ctx.stroke();
    }

    this.ctx.setLineDash([]);
    this.ctx.restore();
  }

  drawModeShapeAnimated(nodes, members, nodeMap, modeShape, amplitude, scale) {
    this.ctx.save();
    this.ctx.strokeStyle = '#7b1fa2';
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';

    for (const member of members) {
      const n1 = nodeMap.get(member.node1Id);
      const n2 = nodeMap.get(member.node2Id);
      if (!n1 || !n2) continue;

      const ms1 = modeShape.find(m => m.nodeId === n1.id);
      const ms2 = modeShape.find(m => m.nodeId === n2.id);
      if (!ms1 || !ms2) continue;

      const x1 = n1.x + ms1.dx * scale * amplitude;
      const y1 = n1.y + ms1.dy * scale * amplitude;
      const x2 = n2.x + ms2.dx * scale * amplitude;
      const y2 = n2.y + ms2.dy * scale * amplitude;

      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
    }

    for (const node of nodes) {
      const ms = modeShape.find(m => m.nodeId === node.id);
      if (!ms) continue;

      const x = node.x + ms.dx * scale * amplitude;
      const y = node.y + ms.dy * scale * amplitude;

      this.ctx.fillStyle = '#ce93d8';
      this.ctx.strokeStyle = '#7b1fa2';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 6, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }

    this.ctx.restore();
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

    if (this.modalMode && this.modalModeShape && this.modalEnvelope) {
      this.drawModeShapeEnvelope(nodes, members, nodeMap, this.modalModeShape, this.modalEnvelope);
      this.drawModeShapeAnimated(nodes, members, nodeMap, this.modalModeShape, this.modalAmplitude, this.modalEnvelope);
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
