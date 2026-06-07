import './style.css';
import { Renderer } from './src/renderer.js';
import { createNode, createMember, deepClone } from './src/core.js';
import { solveTruss } from './src/solver.js';
import { HistoryManager } from './src/history.js';
import { createWarrenTruss } from './src/presets.js';

const canvas = document.getElementById('canvas');
const renderer = new Renderer(canvas);
const historyManager = new HistoryManager();

let nodes = [];
let members = [];
let hasResults = false;
let maxForce = 0;

let selectedNodes = new Set();
let selectedMembers = new Set();

let mouseState = {
  isDown: false,
  startX: 0,
  startY: 0,
  mode: null,
  dragNode: null,
  createMemberStart: null,
  hasMoved: false
};

let selectionBox = null;
let previewLine = null;
let hoveredMember = null;
let contextMenuTarget = null;

function init() {
  renderer.resize();
  
  const warren = createWarrenTruss();
  nodes = warren.nodes;
  members = warren.members;
  
  historyManager.saveState(nodes, members);
  
  try {
    const result = solveTruss(nodes, members);
    maxForce = result.maxForce;
    hasResults = true;
    renderer.hasResults = true;
    renderer.maxForce = maxForce;
    updateResultsDisplay();
  } catch (e) {
    console.warn('初始求解失败:', e.message);
  }
  
  render();
  updateButtonStates();
}

function render() {
  renderer.render(nodes, members, {
    selectionBox,
    previewLine
  });
}

function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function findNodeAt(x, y, tolerance = 15) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const dx = node.x - x;
    const dy = node.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < tolerance) {
      return node;
    }
  }
  return null;
}

function findMemberAt(x, y, tolerance = 8) {
  for (let i = members.length - 1; i >= 0; i--) {
    const member = members[i];
    const n1 = nodes.find(n => n.id === member.node1Id);
    const n2 = nodes.find(n => n.id === member.node2Id);
    if (!n1 || !n2) continue;
    
    const dist = pointToLineDistance(x, y, n1.x, n1.y, n2.x, n2.y);
    if (dist < tolerance) {
      return member;
    }
  }
  return null;
}

function pointToLineDistance(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  
  if (lenSq !== 0) param = dot / lenSq;
  
  let xx, yy;
  
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  
  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

function clearSelection() {
  nodes.forEach(n => n.selected = false);
  members.forEach(m => m.selected = false);
  selectedNodes.clear();
  selectedMembers.clear();
}

function selectInBox(box) {
  const minX = Math.min(box.startX, box.endX);
  const maxX = Math.max(box.startX, box.endX);
  const minY = Math.min(box.startY, box.endY);
  const maxY = Math.max(box.startY, box.endY);
  
  nodes.forEach(node => {
    if (node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY) {
      node.selected = true;
      selectedNodes.add(node.id);
    }
  });
  
  members.forEach(member => {
    const n1 = nodes.find(n => n.id === member.node1Id);
    const n2 = nodes.find(n => n.id === member.node2Id);
    if (!n1 || !n2) return;
    
    const midX = (n1.x + n2.x) / 2;
    const midY = (n1.y + n2.y) / 2;
    
    if (midX >= minX && midX <= maxX && midY >= minY && midY <= maxY) {
      member.selected = true;
      selectedMembers.add(member.id);
    }
  });
}

function updateMemberGeometry(member) {
  const n1 = nodes.find(n => n.id === member.node1Id);
  const n2 = nodes.find(n => n.id === member.node2Id);
  if (!n1 || !n2) return;
  
  const dx = n2.x - n1.x;
  const dy = n2.y - n1.y;
  member.length = Math.sqrt(dx * dx + dy * dy);
  member.angle = Math.atan2(dy, dx);
}

function deleteSelected() {
  if (selectedNodes.size === 0 && selectedMembers.size === 0) return;
  
  const memberIdsToDelete = new Set(selectedMembers);
  nodes.forEach(node => {
    if (selectedNodes.has(node.id)) {
      members.forEach(member => {
        if (member.node1Id === node.id || member.node2Id === node.id) {
          memberIdsToDelete.add(member.id);
        }
      });
    }
  });
  
  nodes = nodes.filter(n => !selectedNodes.has(n.id));
  members = members.filter(m => !memberIdsToDelete.has(m.id));
  
  selectedNodes.clear();
  selectedMembers.clear();
  
  hasResults = false;
  renderer.hasResults = false;
  
  historyManager.saveState(nodes, members);
  updateButtonStates();
  render();
  updateResultsDisplay();
}

function showContextMenu(e, target) {
  e.preventDefault();
  
  contextMenuTarget = target;
  
  const menu = document.getElementById('context-menu');
  const menuItems = menu.querySelector('.menu-items');
  menuItems.innerHTML = '';
  
  const pos = getMousePos(e);
  
  if (target.type === 'node') {
    const node = target.element;
    
    addMenuItem(menuItems, '设置为自由', () => setSupport(node, 'free'));
    addMenuItem(menuItems, '设置为固定铰支座', () => setSupport(node, 'pinned'));
    addMenuItem(menuItems, '设置为滚动支座', () => setSupport(node, 'roller'));
    addMenuSeparator(menuItems);
    addMenuItem(menuItems, '施加外力...', () => showLoadDialog(node));
    addMenuSeparator(menuItems);
    addMenuItem(menuItems, '删除节点', () => deleteNode(node));
  } else if (target.type === 'member') {
    const member = target.element;
    addMenuItem(menuItems, '设置材料属性...', () => showMemberDialog(member));
    addMenuSeparator(menuItems);
    addMenuItem(menuItems, '删除杆件', () => deleteMember(member));
  }
  
  menu.style.left = pos.x + 'px';
  menu.style.top = pos.y + 'px';
  menu.classList.remove('hidden');
}

function hideContextMenu() {
  document.getElementById('context-menu').classList.add('hidden');
  contextMenuTarget = null;
}

function addMenuItem(container, label, callback) {
  const item = document.createElement('div');
  item.className = 'menu-item';
  item.textContent = label;
  item.onclick = () => {
    callback();
    hideContextMenu();
  };
  container.appendChild(item);
}

function addMenuSeparator(container) {
  const sep = document.createElement('div');
  sep.className = 'menu-separator';
  container.appendChild(sep);
}

function setSupport(node, type) {
  node.support = type;
  hasResults = false;
  renderer.hasResults = false;
  historyManager.saveState(nodes, members);
  updateButtonStates();
  render();
  updateResultsDisplay();
}

function deleteNode(node) {
  nodes = nodes.filter(n => n.id !== node.id);
  members = members.filter(m => m.node1Id !== node.id && m.node2Id !== node.id);
  hasResults = false;
  renderer.hasResults = false;
  historyManager.saveState(nodes, members);
  updateButtonStates();
  render();
  updateResultsDisplay();
}

function deleteMember(member) {
  members = members.filter(m => m.id !== member.id);
  hasResults = false;
  renderer.hasResults = false;
  historyManager.saveState(nodes, members);
  updateButtonStates();
  render();
  updateResultsDisplay();
}

function showModal(title, bodyHtml, onConfirm) {
  const modal = document.getElementById('modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  modal.classList.remove('hidden');
  
  const confirmBtn = document.getElementById('modal-confirm');
  const cancelBtn = document.getElementById('modal-cancel');
  
  const cleanup = () => {
    modal.classList.add('hidden');
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
  };
  
  confirmBtn.onclick = () => {
    onConfirm();
    cleanup();
  };
  
  cancelBtn.onclick = cleanup;
}

function showLoadDialog(node) {
  const html = `
    <div class="form-row">
      <div class="form-group">
        <label>水平力 Fx (N)</label>
        <input type="number" id="input-fx" value="${node.fx || 0}" />
      </div>
      <div class="form-group">
        <label>竖向力 Fy (N)</label>
        <input type="number" id="input-fy" value="${node.fy || 0}" />
      </div>
    </div>
    <p style="font-size:12px;color:#666;">正值向右/向上，负值向左/向下</p>
  `;
  
  showModal('施加外力', html, () => {
    node.fx = parseFloat(document.getElementById('input-fx').value) || 0;
    node.fy = parseFloat(document.getElementById('input-fy').value) || 0;
    hasResults = false;
    renderer.hasResults = false;
    historyManager.saveState(nodes, members);
    updateButtonStates();
    render();
    updateResultsDisplay();
  });
}

function showMemberDialog(member) {
  const eGpa = member.E / 1e9;
  const aCm2 = member.A * 1e4;
  
  const html = `
    <div class="form-group">
      <label>弹性模量 E (GPa)</label>
      <input type="number" id="input-e" value="${eGpa}" step="1" min="0" />
    </div>
    <div class="form-group">
      <label>截面积 A (cm²)</label>
      <input type="number" id="input-a" value="${aCm2}" step="0.1" min="0" />
    </div>
  `;
  
  showModal('杆件属性', html, () => {
    member.E = (parseFloat(document.getElementById('input-e').value) || 200) * 1e9;
    member.A = (parseFloat(document.getElementById('input-a').value) || 10) * 1e-4;
    hasResults = false;
    renderer.hasResults = false;
    historyManager.saveState(nodes, members);
    updateButtonStates();
    render();
    updateResultsDisplay();
  });
}

function updateTooltip(e) {
  const tooltip = document.getElementById('tooltip');
  const pos = getMousePos(e);
  
  const member = findMemberAt(pos.x, pos.y);
  hoveredMember = member;
  
  if (member && hasResults) {
    const n1 = nodes.find(n => n.id === member.node1Id);
    const n2 = nodes.find(n => n.id === member.node2Id);
    
    const force = member.axialForce;
    const stress = member.stress;
    const yieldStress = 235e6;
    const isYielding = Math.abs(stress) > yieldStress;
    
    let html = `<strong>杆件 #${member.id}</strong><br/>`;
    html += `轴力: ${(force / 1000).toFixed(2)} kN (${force > 0 ? '拉力' : force < 0 ? '压力' : '零力'})<br/>`;
    html += `应力: ${(stress / 1e6).toFixed(2)} MPa<br/>`;
    html += `长度: ${member.length.toFixed(1)} mm<br/>`;
    if (isYielding) {
      html += `<span style="color:#ff5252;font-weight:bold;">⚠ 已屈服!</span>`;
    }
    
    tooltip.innerHTML = html;
    tooltip.style.left = (pos.x + 15) + 'px';
    tooltip.style.top = (pos.y + 15) + 'px';
    tooltip.classList.remove('hidden');
  } else {
    tooltip.classList.add('hidden');
  }
}

function updateResultsDisplay() {
  const container = document.getElementById('results-content');
  
  if (!hasResults) {
    container.innerHTML = '点击"求解"按钮开始计算';
    return;
  }
  
  let html = '';
  
  html += '<div class="result-item"><strong>节点位移</strong></div>';
  nodes.forEach(node => {
    html += `<div class="result-item">`;
    html += `节点 #${node.id}: `;
    html += `dx=${(node.dx * 1000).toFixed(4)} mm, `;
    html += `dy=${(node.dy * 1000).toFixed(4)} mm`;
    html += `</div>`;
  });
  
  html += '<div class="result-item"><strong>杆件轴力</strong></div>';
  members.forEach(member => {
    const force = member.axialForce;
    html += `<div class="result-item">`;
    html += `杆件 #${member.id}: `;
    html += `${(force / 1000).toFixed(2)} kN `;
    html += `(${force > 0 ? '拉' : force < 0 ? '压' : '零'})`;
    html += `</div>`;
  });
  
  container.innerHTML = html;
}

function updateButtonStates() {
  document.getElementById('btn-undo').disabled = !historyManager.canUndo();
  document.getElementById('btn-redo').disabled = !historyManager.canRedo();
}

function exportJSON() {
  const data = {
    nodes: nodes.map(n => ({
      id: n.id,
      x: n.x,
      y: n.y,
      support: n.support,
      fx: n.fx,
      fy: n.fy,
      dx: n.dx,
      dy: n.dy
    })),
    members: members.map(m => ({
      id: m.id,
      node1Id: m.node1Id,
      node2Id: m.node2Id,
      length: m.length,
      angle: m.angle,
      E: m.E,
      A: m.A,
      axialForce: m.axialForce,
      stress: m.stress
    })),
    solved: hasResults,
    maxForce: maxForce
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'truss-analysis.json';
  a.click();
  URL.revokeObjectURL(url);
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  
  hideContextMenu();
  
  const pos = getMousePos(e);
  mouseState.isDown = true;
  mouseState.startX = pos.x;
  mouseState.startY = pos.y;
  mouseState.hasMoved = false;
  
  const node = findNodeAt(pos.x, pos.y);
  const member = !node ? findMemberAt(pos.x, pos.y) : null;
  
  if (e.shiftKey) {
    mouseState.mode = 'select';
    selectionBox = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
  } else if (node) {
    if (e.ctrlKey || e.metaKey) {
      node.selected = !node.selected;
      if (node.selected) {
        selectedNodes.add(node.id);
      } else {
        selectedNodes.delete(node.id);
      }
      mouseState.mode = null;
    } else {
      clearSelection();
      node.selected = true;
      selectedNodes.add(node.id);
      mouseState.mode = 'drag';
      mouseState.dragNode = node;
    }
  } else if (member) {
    if (e.ctrlKey || e.metaKey) {
      member.selected = !member.selected;
      if (member.selected) {
        selectedMembers.add(member.id);
      } else {
        selectedMembers.delete(member.id);
      }
    } else {
      clearSelection();
      member.selected = true;
      selectedMembers.add(member.id);
    }
    mouseState.mode = null;
  } else {
    clearSelection();
    mouseState.mode = 'createNode';
  }
  
  render();
});

canvas.addEventListener('mousemove', (e) => {
  const pos = getMousePos(e);
  
  updateTooltip(e);
  
  if (!mouseState.isDown) return;
  
  mouseState.hasMoved = true;
  
  const dx = pos.x - mouseState.startX;
  const dy = pos.y - mouseState.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (mouseState.mode === 'drag' && mouseState.dragNode) {
    const node = mouseState.dragNode;
    node.x = pos.x;
    node.y = pos.y;
    
    members.forEach(member => {
      if (member.node1Id === node.id || member.node2Id === node.id) {
        updateMemberGeometry(member);
      }
    });
    
    hasResults = false;
    renderer.hasResults = false;
  } else if (mouseState.mode === 'select') {
    selectionBox.endX = pos.x;
    selectionBox.endY = pos.y;
  } else if (mouseState.mode === 'createNode' && dist > 5) {
    const startNode = findNodeAt(mouseState.startX, mouseState.startY, 20);
    if (startNode) {
      mouseState.mode = 'createMember';
      mouseState.createMemberStart = startNode;
    }
  }
  
  if (mouseState.mode === 'createMember' && mouseState.createMemberStart) {
    previewLine = {
      startNode: mouseState.createMemberStart,
      endX: pos.x,
      endY: pos.y
    };
  }
  
  render();
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  
  const pos = getMousePos(e);
  
  if (mouseState.mode === 'createNode' && !mouseState.hasMoved) {
    const newNode = createNode(pos.x, pos.y);
    nodes.push(newNode);
    hasResults = false;
    renderer.hasResults = false;
    historyManager.saveState(nodes, members);
    updateButtonStates();
  } else if (mouseState.mode === 'createMember' && mouseState.createMemberStart) {
    const endNode = findNodeAt(pos.x, pos.y);
    if (endNode && endNode.id !== mouseState.createMemberStart.id) {
      const exists = members.some(m => 
        (m.node1Id === mouseState.createMemberStart.id && m.node2Id === endNode.id) ||
        (m.node1Id === endNode.id && m.node2Id === mouseState.createMemberStart.id)
      );
      
      if (!exists) {
        const newMember = createMember(mouseState.createMemberStart, endNode);
        members.push(newMember);
        hasResults = false;
        renderer.hasResults = false;
        historyManager.saveState(nodes, members);
        updateButtonStates();
      }
    }
  } else if (mouseState.mode === 'select') {
    selectInBox(selectionBox);
  } else if (mouseState.mode === 'drag' && mouseState.hasMoved) {
    historyManager.saveState(nodes, members);
    updateButtonStates();
    updateResultsDisplay();
  }
  
  mouseState.isDown = false;
  mouseState.mode = null;
  mouseState.dragNode = null;
  mouseState.createMemberStart = null;
  selectionBox = null;
  previewLine = null;
  
  render();
  updateResultsDisplay();
});

canvas.addEventListener('contextmenu', (e) => {
  const pos = getMousePos(e);
  const node = findNodeAt(pos.x, pos.y);
  const member = !node ? findMemberAt(pos.x, pos.y) : null;
  
  if (node) {
    showContextMenu(e, { type: 'node', element: node });
  } else if (member) {
    showContextMenu(e, { type: 'member', element: member });
  }
});

canvas.addEventListener('dblclick', (e) => {
  const pos = getMousePos(e);
  const node = findNodeAt(pos.x, pos.y);
  const member = !node ? findMemberAt(pos.x, pos.y) : null;
  
  if (node) {
    showLoadDialog(node);
  } else if (member) {
    showMemberDialog(member);
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.context-menu')) {
    hideContextMenu();
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    const prev = historyManager.undo(nodes, members);
    if (prev) {
      nodes = prev.nodes;
      members = prev.members;
      hasResults = false;
      renderer.hasResults = false;
      clearSelection();
      updateButtonStates();
      render();
      updateResultsDisplay();
    }
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    const next = historyManager.redo(nodes, members);
    if (next) {
      nodes = next.nodes;
      members = next.members;
      hasResults = false;
      renderer.hasResults = false;
      clearSelection();
      updateButtonStates();
      render();
      updateResultsDisplay();
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!e.target.matches('input, textarea')) {
      e.preventDefault();
      deleteSelected();
    }
  } else if (e.key === 'Escape') {
    clearSelection();
    hideContextMenu();
    render();
  }
});

document.getElementById('btn-solve').addEventListener('click', () => {
  try {
    const result = solveTruss(nodes, members);
    maxForce = result.maxForce;
    hasResults = true;
    renderer.hasResults = true;
    renderer.maxForce = maxForce;
    updateResultsDisplay();
    render();
    updateStatus('求解成功!');
  } catch (e) {
    alert('求解失败: ' + e.message);
    updateStatus('求解失败: ' + e.message);
  }
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (confirm('确定要清空所有内容吗？')) {
    nodes = [];
    members = [];
    hasResults = false;
    renderer.hasResults = false;
    clearSelection();
    historyManager.reset();
    historyManager.saveState(nodes, members);
    updateButtonStates();
    render();
    updateResultsDisplay();
  }
});

document.getElementById('btn-undo').addEventListener('click', () => {
  const prev = historyManager.undo(nodes, members);
  if (prev) {
    nodes = prev.nodes;
    members = prev.members;
    hasResults = false;
    renderer.hasResults = false;
    clearSelection();
    updateButtonStates();
    render();
    updateResultsDisplay();
  }
});

document.getElementById('btn-redo').addEventListener('click', () => {
  const next = historyManager.redo(nodes, members);
  if (next) {
    nodes = next.nodes;
    members = next.members;
    hasResults = false;
    renderer.hasResults = false;
    clearSelection();
    updateButtonStates();
    render();
    updateResultsDisplay();
  }
});

document.getElementById('btn-export').addEventListener('click', exportJSON);

document.getElementById('scale-factor').addEventListener('change', (e) => {
  renderer.displacementScale = parseFloat(e.target.value) || 100;
  render();
});

window.addEventListener('resize', () => {
  renderer.resize();
  render();
});

function updateStatus(text) {
  const status = document.getElementById('status-bar');
  status.textContent = text;
  setTimeout(() => {
    status.textContent = '';
  }, 3000);
}

init();
