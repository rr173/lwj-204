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
    this.bucklingMode = false;
    this.bucklingModeShape = null;
    this.bucklingAmplitude = 0;
    this.bucklingEnvelope = null;
    this.influenceActive = false;
    this.influenceSectionMemberId = null;
    this.influenceSectionT = 0.5;
    this.influenceForcePosition = null;
    this.influenceResponseValue = null;
    this.constructionStageInfo = null;
    this.topoData = null;
    this.topoDragRect = null;
    this.topoHoverDensity = null;
    this.topoHoverEdge = null;
    this.compareData = null;
    this.pushoverActive = false;
    this.pushoverHinges = [];
    this.pushoverHighlightStep = -1;
    this._hoveredHinge = null;
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

    if (this.constructionStageInfo) {
      const isActive = this.constructionStageInfo.activeMemberIds.has(member.id);
      if (!isActive) {
        this.ctx.strokeStyle = '#ccc';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([6, 4]);
        this.ctx.beginPath();
        this.ctx.moveTo(node1.x, node1.y);
        this.ctx.lineTo(node2.x, node2.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.ctx.font = '10px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = '#bbb';
        const mx = (node1.x + node2.x) / 2;
        const my = (node1.y + node2.y) / 2;
        this.ctx.fillText(`#${member.id}`, mx, my - 6);
        return;
      }
    }

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

    if (this.hasResults && this.showDeformed && this.viewMode === 'single' && !this.bucklingMode) {
      this.drawDeformedMember(member, node1, node2);
    }

    if (this.hasResults && this.analysisMode === 'frame' && this.frameResults && !this.bucklingMode) {
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
    if (this.constructionStageInfo) {
      const activeNodeIds = new Set();
      this._membersRef.forEach(m => {
        if (this.constructionStageInfo.activeMemberIds.has(m.id)) {
          activeNodeIds.add(m.node1Id);
          activeNodeIds.add(m.node2Id);
        }
      });
      if (!activeNodeIds.has(node.id)) {
        this.ctx.fillStyle = '#e0e0e0';
        this.ctx.strokeStyle = '#ccc';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, 6, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        return;
      }
    }

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

  drawBucklingShapeEnvelope(nodes, members, nodeMap, modeShape, scale) {
    this.ctx.save();
    this.ctx.globalAlpha = 0.25;
    this.ctx.strokeStyle = '#d84315';
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

  drawBucklingShapeAnimated(nodes, members, nodeMap, modeShape, amplitude, scale) {
    this.ctx.save();
    this.ctx.strokeStyle = '#bf360c';
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

      this.ctx.fillStyle = '#ffab91';
      this.ctx.strokeStyle = '#bf360c';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 6, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  drawInfluenceSectionMarker(nodeMap) {
    if (!this.influenceActive || !this.influenceSectionMemberId) return;

    const allMembers = this._membersRef;
    if (!allMembers) return;
    const mem = allMembers.find(m => m.id === this.influenceSectionMemberId);
    if (!mem) return;

    const node1 = nodeMap.get(mem.node1Id);
    const node2 = nodeMap.get(mem.node2Id);
    if (!node1 || !node2) return;

    const t = this.influenceSectionT;
    const sx = node1.x + (node2.x - node1.x) * t;
    const sy = node1.y + (node2.y - node1.y) * t;

    const dx = node2.x - node1.x;
    const dy = node2.y - node1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    const nx = -dy / len;
    const ny = dx / len;
    const triSize = 10;

    this.ctx.fillStyle = '#00695c';
    this.ctx.strokeStyle = '#004d40';
    this.ctx.lineWidth = 2;

    this.ctx.beginPath();
    this.ctx.moveTo(sx + nx * triSize, sy + ny * triSize);
    this.ctx.lineTo(sx - nx * triSize * 0.5 + dx / len * triSize * 0.5, sy - ny * triSize * 0.5 + dy / len * triSize * 0.5);
    this.ctx.lineTo(sx - nx * triSize * 0.5 - dx / len * triSize * 0.5, sy - ny * triSize * 0.5 - dy / len * triSize * 0.5);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
  }

  drawInfluenceForceArrow(nodeMap) {
    if (!this.influenceActive || !this.influenceForcePosition) return;

    const px = this.influenceForcePosition.x;
    let py = this.influenceForcePosition.y;

    const allMembers = this._membersRef;
    if (allMembers) {
      let bestY = null;
      for (const mem of allMembers) {
        const n1 = nodeMap.get(mem.node1Id);
        const n2 = nodeMap.get(mem.node2Id);
        if (!n1 || !n2) continue;
        const minX = Math.min(n1.x, n2.x);
        const maxX = Math.max(n1.x, n2.x);
        if (px >= minX - 1 && px <= maxX + 1) {
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const lenSq = dx * dx + dy * dy;
          if (lenSq < 1) continue;
          let t = ((px - n1.x) * dx) / lenSq;
          t = Math.max(0, Math.min(1, t));
          const yAt = n1.y + dy * t;
          if (bestY === null || yAt < bestY) bestY = yAt;
        }
      }
      if (bestY !== null) py = bestY;
    }

    const arrowStartY = py - 50;
    const arrowEndY = py - 5;

    this.ctx.strokeStyle = '#d32f2f';
    this.ctx.fillStyle = '#d32f2f';
    this.ctx.lineWidth = 3;

    this.ctx.beginPath();
    this.ctx.moveTo(px, arrowStartY);
    this.ctx.lineTo(px, arrowEndY);
    this.ctx.stroke();

    const headLen = 10;
    this.ctx.beginPath();
    this.ctx.moveTo(px, arrowEndY);
    this.ctx.lineTo(px - headLen * 0.5, arrowEndY - headLen);
    this.ctx.lineTo(px + headLen * 0.5, arrowEndY - headLen);
    this.ctx.closePath();
    this.ctx.fill();

    this.ctx.font = 'bold 11px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#d32f2f';
    this.ctx.fillText('1 kN', px, arrowStartY - 6);

    if (this.influenceResponseValue != null && this.influenceSectionMemberId) {
      if (!allMembers) return;
      const mem = allMembers.find(m => m.id === this.influenceSectionMemberId);
      if (!mem) return;
      const node1 = nodeMap.get(mem.node1Id);
      const node2 = nodeMap.get(mem.node2Id);
      if (!node1 || !node2) return;

      const t = this.influenceSectionT;
      const sx = node1.x + (node2.x - node1.x) * t;
      const sy = node1.y + (node2.y - node1.y) * t;

      const val = this.influenceResponseValue;
      const unit = this.analysisMode === 'truss' ? 'kN'
        : (this._influenceResponseType === 'moment' ? 'kN·m' : 'kN');
      const valText = `${(val / 1000).toFixed(3)} ${unit}`;

      this.ctx.font = 'bold 12px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = '#004d40';
      this.ctx.fillText(valText, sx, sy - 20);
    }
  }

  render(nodes, members, extras = {}) {
    this.clear();

    if (this.compareData) {
      this.drawCompareView();
      return;
    }

    this.drawGrid();

    this._membersRef = members;

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

    if (this.bucklingMode && this.bucklingModeShape && this.bucklingEnvelope) {
      this.drawBucklingShapeEnvelope(nodes, members, nodeMap, this.bucklingModeShape, this.bucklingEnvelope);
      this.drawBucklingShapeAnimated(nodes, members, nodeMap, this.bucklingModeShape, this.bucklingAmplitude, this.bucklingEnvelope);
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

    if (this.influenceActive) {
      this.drawInfluenceSectionMarker(nodeMap);
      this.drawInfluenceForceArrow(nodeMap);
    }

    if (this.topoData || this.topoDragRect) {
      this.drawTopoVisualization();
    }

    if (this.pushoverActive) {
      this.drawPushoverHinges(nodes, members, nodeMap);
    }
  }

  drawTopoVisualization() {
    if (this.topoDragRect) {
      const r = this.topoDragRect;
      const x = Math.min(r.startX, r.endX);
      const y = Math.min(r.startY, r.endY);
      const w = Math.abs(r.endX - r.startX);
      const h = Math.abs(r.endY - r.startY);

      this.ctx.strokeStyle = '#00838f';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([8, 4]);
      this.ctx.strokeRect(x, y, w, h);
      this.ctx.setLineDash([]);

      this.ctx.fillStyle = 'rgba(0, 131, 143, 0.08)';
      this.ctx.fillRect(x, y, w, h);

      this.ctx.font = '12px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = '#00838f';
      this.ctx.fillText('设计域', x + w / 2, y + h / 2);
    }

    if (this.topoData) {
      const d = this.topoData;
      const ctx = this.ctx;

      for (let ej = 0; ej < d.ny; ej++) {
        for (let ei = 0; ei < d.nx; ei++) {
          const rho = d.density[ej * d.nx + ei];
          const v = Math.floor(255 * (1 - rho));
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(
            d.originX + ei * d.elemW,
            d.originY + ej * d.elemH,
            d.elemW + 0.5,
            d.elemH + 0.5
          );
        }
      }

      ctx.strokeStyle = '#00838f';
      ctx.lineWidth = 2;
      ctx.strokeRect(d.originX, d.originY, d.nx * d.elemW, d.ny * d.elemH);

      if (d.fixedEdges) {
        ctx.strokeStyle = '#2e7d32';
        ctx.lineWidth = 4;
        const x0 = d.originX;
        const y0 = d.originY;
        const x1 = d.originX + d.nx * d.elemW;
        const y1 = d.originY + d.ny * d.elemH;

        if (d.fixedEdges.left) {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0, y1);
          ctx.stroke();
          for (let yy = y0; yy < y1; yy += 8) {
            ctx.beginPath();
            ctx.moveTo(x0, yy);
            ctx.lineTo(x0 - 6, yy + 6);
            ctx.stroke();
          }
        }
        if (d.fixedEdges.right) {
          ctx.beginPath();
          ctx.moveTo(x1, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          for (let yy = y0; yy < y1; yy += 8) {
            ctx.beginPath();
            ctx.moveTo(x1, yy);
            ctx.lineTo(x1 + 6, yy + 6);
            ctx.stroke();
          }
        }
        if (d.fixedEdges.top) {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y0);
          ctx.stroke();
          for (let xx = x0; xx < x1; xx += 8) {
            ctx.beginPath();
            ctx.moveTo(xx, y0);
            ctx.lineTo(xx + 6, y0 - 6);
            ctx.stroke();
          }
        }
        if (d.fixedEdges.bottom) {
          ctx.beginPath();
          ctx.moveTo(x0, y1);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          for (let xx = x0; xx < x1; xx += 8) {
            ctx.beginPath();
            ctx.moveTo(xx, y1);
            ctx.lineTo(xx + 6, y1 + 6);
            ctx.stroke();
          }
        }
      }

      if (this.topoHoverEdge && d.fixedEdges) {
        ctx.strokeStyle = 'rgba(255, 152, 0, 0.7)';
        ctx.lineWidth = 6;
        ctx.setLineDash([6, 3]);
        const x0 = d.originX;
        const y0 = d.originY;
        const x1 = d.originX + d.nx * d.elemW;
        const y1 = d.originY + d.ny * d.elemH;
        if (this.topoHoverEdge === 'left') { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke(); }
        if (this.topoHoverEdge === 'right') { ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
        if (this.topoHoverEdge === 'top') { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke(); }
        if (this.topoHoverEdge === 'bottom') { ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke(); }
        ctx.setLineDash([]);
      }

      if (d.forces && d.forces.length > 0) {
        for (const f of d.forces) {
          const fx = f.fx || 0;
          const fy = f.fy || 0;
          const mag = Math.sqrt(fx * fx + fy * fy);
          if (mag < 1e-6) continue;

          const arrowLen = Math.min(40, Math.max(15, mag * 0.003));
          const nx = fx / mag;
          const ny = fy / mag;

          const startX = f.x - nx * 5;
          const startY = f.y - ny * 5;
          const endX = startX + nx * arrowLen;
          const endY = startY + ny * arrowLen;

          ctx.strokeStyle = '#d32f2f';
          ctx.fillStyle = '#d32f2f';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';

          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();

          const headLength = 10;
          const angle = Math.atan2(ny, nx);
          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();

          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${(mag / 1000).toFixed(1)}kN`, startX + nx * (arrowLen + 15), startY + ny * (arrowLen + 15));
        }
      }

      if (this.topoHoverDensity) {
        const h = this.topoHoverDensity;
        const hx = d.originX + h.ei * d.elemW;
        const hy = d.originY + h.ej * d.elemH;

        ctx.strokeStyle = '#ff6f00';
        ctx.lineWidth = 2;
        ctx.strokeRect(hx, hy, d.elemW, d.elemH);

        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ff6f00';
        ctx.fillText(`ρ=${h.density.toFixed(3)}`, hx + d.elemW + 4, hy + d.elemH / 2 + 4);
      }
    }
  }

  drawCompareView() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cd = this.compareData;
    if (!cd || !cd.schemeA || !cd.schemeB) return;

    const halfW = Math.floor(w / 2);

    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, halfW, h);
    ctx.clip();
    this.drawCompareScheme(cd.schemeA, cd.diff, 'left', halfW, h);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(halfW, 0, halfW, h);
    ctx.clip();
    ctx.translate(halfW, 0);
    this.drawCompareScheme(cd.schemeB, cd.diff, 'right', halfW, h);
    ctx.restore();

    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(halfW, 0);
    ctx.lineTo(halfW, h);
    ctx.stroke();

    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#333';
    ctx.fillText(`方案 A: ${cd.schemeA.name}`, halfW / 2, 20);
    ctx.fillText(`方案 B: ${cd.schemeB.name}`, halfW + halfW / 2, 20);

    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#999';
    ctx.fillText(cd.schemeA.timestamp, halfW / 2, 36);
    ctx.fillText(cd.schemeB.timestamp, halfW + halfW / 2, 36);
  }

  drawCompareScheme(scheme, diff, side, areaW, areaH) {
    const ctx = this.ctx;
    const gridSize = 50;
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1;
    for (let x = 0; x < areaW; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, areaH);
      ctx.stroke();
    }
    for (let y = 0; y < areaH; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(areaW, y);
      ctx.stroke();
    }

    const nodeMap = new Map();
    scheme.nodes.forEach(n => nodeMap.set(n.id, n));

    for (const member of scheme.members) {
      const n1 = nodeMap.get(member.node1Id);
      const n2 = nodeMap.get(member.node2Id);
      if (!n1 || !n2) continue;

      const isSectionChanged = diff.memberSectionChanged.has(member.id);
      const isMaterialChanged = diff.memberMaterialChanged.has(member.id);
      const isAdded = (side === 'left' && diff.memberAddedA.has(member.id)) ||
                      (side === 'right' && diff.memberAddedB.has(member.id));

      if (isSectionChanged) {
        ctx.strokeStyle = '#ff9800';
        ctx.lineWidth = 8;
        ctx.setLineDash([]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(n1.x, n1.y);
        ctx.lineTo(n2.x, n2.y);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,152,0,0.4)';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(n1.x, n1.y);
        ctx.lineTo(n2.x, n2.y);
        ctx.stroke();
      } else if (isMaterialChanged) {
        ctx.strokeStyle = '#1565c0';
        ctx.lineWidth = 6;
        ctx.setLineDash([10, 5]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(n1.x, n1.y);
        ctx.lineTo(n2.x, n2.y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (isAdded) {
        ctx.strokeStyle = side === 'left' ? 'rgba(33,150,243,0.5)' : 'rgba(244,67,54,0.5)';
        ctx.lineWidth = 5;
        ctx.setLineDash([6, 4]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(n1.x, n1.y);
        ctx.lineTo(n2.x, n2.y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 4;
        ctx.setLineDash([]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(n1.x, n1.y);
        ctx.lineTo(n2.x, n2.y);
        ctx.stroke();
      }

      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#666';
      const mx = (n1.x + n2.x) / 2;
      const my = (n1.y + n2.y) / 2;
      ctx.fillText(`#${member.id}`, mx, my - 8);
    }

    for (const node of scheme.nodes) {
      const isSupportChanged = diff.nodeSupportChanged.has(node.id);
      const isAdded = (side === 'left' && diff.nodeAddedA.has(node.id)) ||
                      (side === 'right' && diff.nodeAddedB.has(node.id));

      this.drawCompareSupport(node);

      if (isSupportChanged) {
        ctx.strokeStyle = '#fdd835';
        ctx.lineWidth = 3;
        ctx.fillStyle = 'rgba(255,235,59,0.3)';
        ctx.beginPath();
        ctx.arc(node.x, node.y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = '#f9a825';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(node.x, node.y, 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = isAdded ? 'rgba(244,67,54,0.6)' : '#fff';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#666';
      ctx.fillText(`#${node.id}`, node.x, node.y - 14);
    }
  }

  drawCompareSupport(node) {
    const ctx = this.ctx;
    if (node.support === 'free') return;
    const x = node.x;
    const y = node.y;

    if (node.support === 'fixed') {
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 15, y + 15);
      ctx.lineTo(x + 15, y + 15);
      ctx.stroke();
      for (let i = -12; i <= 12; i += 6) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + 15);
        ctx.lineTo(x + i - 5, y + 22);
        ctx.stroke();
      }
    } else if (node.support === 'pinned') {
      ctx.fillStyle = '#4caf50';
      ctx.strokeStyle = '#2e7d32';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y + 15);
      ctx.lineTo(x - 12, y + 30);
      ctx.lineTo(x + 12, y + 30);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (let i = -10; i <= 10; i += 5) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + 30);
        ctx.lineTo(x + i - 3, y + 36);
        ctx.stroke();
      }
    } else if (node.support === 'roller') {
      ctx.fillStyle = '#2196f3';
      ctx.strokeStyle = '#1565c0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y + 12);
      ctx.lineTo(x - 15, y + 25);
      ctx.lineTo(x + 15, y + 25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x - 8, y + 30, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 8, y + 30, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawPushoverHinges(nodes, members, nodeMap) {
    if (!this.pushoverHinges || this.pushoverHinges.length === 0) return;

    const memberMap = new Map();
    members.forEach(m => memberMap.set(m.id, m));

    this.pushoverHinges.forEach(hinge => {
      const mem = memberMap.get(hinge.memberId);
      if (!mem) return;

      let hingeNode;
      if (hinge.end === 1) {
        hingeNode = nodeMap.get(mem.node1Id);
      } else {
        hingeNode = nodeMap.get(mem.node2Id);
      }
      if (!hingeNode) return;

      let hx = hingeNode.x;
      let hy = hingeNode.y;
      if (hingeNode.dx !== undefined && this.showDeformed) {
        hx += hingeNode.dx * this.displacementScale;
        hy += hingeNode.dy * this.displacementScale;
      }

      const isNew = this.pushoverHighlightStep >= 0 &&
        hinge.step === this.pushoverHighlightStep;

      const r = isNew ? 10 : 7;

      this.ctx.beginPath();
      this.ctx.arc(hx, hy, r, 0, Math.PI * 2);
      this.ctx.fillStyle = isNew ? '#ff1744' : '#e53935';
      this.ctx.fill();
      this.ctx.strokeStyle = isNew ? '#b71c1c' : '#c62828';
      this.ctx.lineWidth = isNew ? 3 : 2;
      this.ctx.stroke();

      if (isNew) {
        this.ctx.beginPath();
        this.ctx.arc(hx, hy, r + 4, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'rgba(255, 23, 68, 0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([3, 3]);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }

      hinge._screenX = hx;
      hinge._screenY = hy;
      hinge._radius = r;
    });
  }

  findHingeAtScreenPos(x, y) {
    if (!this.pushoverHinges) return null;
    for (let i = this.pushoverHinges.length - 1; i >= 0; i--) {
      const h = this.pushoverHinges[i];
      if (h._screenX === undefined) continue;
      const dx = x - h._screenX;
      const dy = y - h._screenY;
      if (Math.sqrt(dx * dx + dy * dy) <= (h._radius || 7) + 3) {
        return h;
      }
    }
    return null;
  }

  static drawCapacityCurve(canvas, capacityCurve, options = {}) {
    if (!canvas || !capacityCurve || capacityCurve.length === 0) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const padding = { left: 60, right: 30, top: 25, bottom: 45 };
    const plotW = W - padding.left - padding.right;
    const plotH = H - padding.top - padding.bottom;

    let maxDisp = 0, maxShear = 0;
    capacityCurve.forEach(p => {
      if (p.topDisplacement > maxDisp) maxDisp = p.topDisplacement;
      if (p.baseShear > maxShear) maxShear = p.baseShear;
    });
    if (maxDisp < 0.001) maxDisp = 0.001;
    if (maxShear < 1) maxShear = 1;
    maxDisp *= 1.1;
    maxShear *= 1.1;

    const dispToX = d => padding.left + (d / maxDisp) * plotW;
    const shearToY = s => padding.top + plotH - (s / maxShear) * plotH;

    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = '#f5f5f5';
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#999';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const numYTicks = 5;
    for (let i = 0; i <= numYTicks; i++) {
      const s = (maxShear / numYTicks) * i;
      const y = shearToY(s);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(W - padding.right, y);
      ctx.stroke();
      ctx.fillText(`${(s / 1000).toFixed(1)}`, padding.left - 6, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const numXTicks = 5;
    for (let i = 0; i <= numXTicks; i++) {
      const d = (maxDisp / numXTicks) * i;
      const x = dispToX(d);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, H - padding.bottom);
      ctx.stroke();
      ctx.fillText(`${(d * 1000).toFixed(0)}`, x, H - padding.bottom + 6);
    }

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, H - padding.bottom);
    ctx.lineTo(W - padding.right, H - padding.bottom);
    ctx.stroke();

    ctx.fillStyle = '#333';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('顶点位移 (mm)', W / 2, H - 12);
    ctx.save();
    ctx.translate(14, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('基底剪力 (kN)', 0, 0);
    ctx.restore();

    if (capacityCurve.length < 2) return;

    const grad = ctx.createLinearGradient(padding.left, 0, W - padding.right, 0);
    grad.addColorStop(0, '#1565c0');
    grad.addColorStop(0.5, '#ff9800');
    grad.addColorStop(1, '#e53935');

    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    capacityCurve.forEach((p, i) => {
      const x = dispToX(p.topDisplacement);
      const y = shearToY(p.baseShear);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    capacityCurve.forEach(p => {
      if (p.isCollapse) {
        const x = dispToX(p.topDisplacement);
        const y = shearToY(p.baseShear);
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(244, 67, 54, 0.2)';
        ctx.fill();
        ctx.strokeStyle = '#f44336';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#c62828';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('倒塌点', x + 12, y - 5);
      }
    });

    capacityCurve.forEach(p => {
      if (p.isHingeFormation && p.newHinges && p.newHinges.length > 0) {
        const x = dispToX(p.topDisplacement);
        const y = shearToY(p.baseShear);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ff9800';
        ctx.fill();
        ctx.strokeStyle = '#e65100';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const names = p.newHinges.map(h => `#${h.memberId}${h.end === 1 ? '左' : '右'}`).join(',');
        ctx.fillStyle = '#e65100';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(names, x, y - 12);
      }
    });

    if (options.highlightStep !== undefined && options.highlightStep >= 0) {
      const p = capacityCurve[options.highlightStep];
      if (p) {
        const x = dispToX(p.topDisplacement);
        const y = shearToY(p.baseShear);
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(33, 150, 243, 0.3)';
        ctx.fill();
        ctx.strokeStyle = '#2196f3';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(33, 150, 243, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, H - padding.bottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(padding.left, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  static findCapacityCurvePoint(canvas, capacityCurve, mouseX, mouseY) {
    if (!canvas || !capacityCurve) return -1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const padding = { left: 60, right: 30, top: 25, bottom: 45 };
    const plotW = W - padding.left - padding.right;
    const plotH = H - padding.top - padding.bottom;

    let maxDisp = 0, maxShear = 0;
    capacityCurve.forEach(p => {
      if (p.topDisplacement > maxDisp) maxDisp = p.topDisplacement;
      if (p.baseShear > maxShear) maxShear = p.baseShear;
    });
    maxDisp *= 1.1;
    maxShear *= 1.1;

    if (maxDisp < 0.001 || maxShear < 1) return -1;

    const dispToX = d => padding.left + (d / maxDisp) * plotW;
    const shearToY = s => padding.top + plotH - (s / maxShear) * plotH;

    let nearestIdx = -1;
    let minDist = 12;

    capacityCurve.forEach((p, i) => {
      const x = dispToX(p.topDisplacement);
      const y = shearToY(p.baseShear);
      const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
      if (dist < minDist) {
        minDist = dist;
        nearestIdx = i;
      }
    });

    return nearestIdx;
  }
}
