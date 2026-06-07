import './style.css';
import { Renderer } from './src/renderer.js';
import { createNode, createMember, deepClone } from './src/core.js';
import { solveTruss } from './src/solver.js';
import { HistoryManager } from './src/history.js';
import { createWarrenTruss, createDefaultLoadCases } from './src/presets.js';

const canvas = document.getElementById('canvas');
const renderer = new Renderer(canvas);
const historyManager = new HistoryManager();

const STORAGE_KEY = 'truss-analyzer-data';
const YIELD_STRESS = 235e6;

let nodes = [];
let members = [];
let hasResults = false;
let maxForce = 0;

let selectedNodes = new Set();
let selectedMembers = new Set();

let loadCases = [];
let currentLoadCaseId = null;
let viewMode = 'single';
let envelopeData = null;

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

function getCurrentLoadCase() {
  return loadCases.find(lc => lc.id === currentLoadCaseId);
}

function applyLoadCaseToNodes(loadCase) {
  if (!loadCase) return;
  nodes.forEach(node => {
    const nodeLoad = loadCase.nodeLoads[node.id];
    if (nodeLoad) {
      node.fx = nodeLoad.fx || 0;
      node.fy = nodeLoad.fy || 0;
    } else {
      node.fx = 0;
      node.fy = 0;
    }
  });
}

function saveCurrentLoadCaseFromNodes() {
  const lc = getCurrentLoadCase();
  if (!lc) return;
  lc.nodeLoads = {};
  nodes.forEach(node => {
    lc.nodeLoads[node.id] = { fx: node.fx || 0, fy: node.fy || 0 };
  });
}

function createLoadCase(name) {
  const id = 'lc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  return {
    id,
    name,
    nodeLoads: {},
    solved: false,
    results: null
  };
}

function addLoadCase(name) {
  const lc = createLoadCase(name);
  loadCases.push(lc);
  currentLoadCaseId = lc.id;
  applyLoadCaseToNodes(lc);
  hasResults = false;
  renderer.hasResults = false;
  updateLoadCaseList();
  saveToStorage();
  render();
  updateResultsDisplay();
}

function deleteLoadCase(id) {
  if (loadCases.length <= 1) {
    alert('至少保留一个工况');
    return;
  }
  const index = loadCases.findIndex(lc => lc.id === id);
  loadCases.splice(index, 1);
  if (currentLoadCaseId === id) {
    currentLoadCaseId = loadCases[0].id;
    applyLoadCaseToNodes(getCurrentLoadCase());
    const lc = getCurrentLoadCase();
    if (lc.solved && lc.results) {
      restoreResults(lc.results);
    } else {
      hasResults = false;
      renderer.hasResults = false;
    }
  }
  updateLoadCaseList();
  updateEnvelopeIfNeeded();
  saveToStorage();
  render();
  updateResultsDisplay();
}

function renameLoadCase(id, newName) {
  const lc = loadCases.find(lc => lc.id === id);
  if (lc) {
    lc.name = newName;
    updateLoadCaseList();
    saveToStorage();
  }
}

function switchLoadCase(id) {
  saveCurrentLoadCaseFromNodes();
  currentLoadCaseId = id;
  applyLoadCaseToNodes(getCurrentLoadCase());
  const lc = getCurrentLoadCase();
  if (lc.solved && lc.results) {
    restoreResults(lc.results);
  } else {
    hasResults = false;
    renderer.hasResults = false;
  }
  viewMode = 'single';
  renderer.viewMode = 'single';
  updateViewModeButtons();
  updateLoadCaseList();
  render();
  updateResultsDisplay();
}

function restoreResults(results) {
  if (!results) return;
  results.nodes.forEach(rn => {
    const node = nodes.find(n => n.id === rn.id);
    if (node) {
      node.dx = rn.dx;
      node.dy = rn.dy;
    }
  });
  results.members.forEach(rm => {
    const member = members.find(m => m.id === rm.id);
    if (member) {
      member.axialForce = rm.axialForce;
      member.stress = rm.stress;
    }
  });
  maxForce = results.maxForce;
  hasResults = true;
  renderer.hasResults = true;
  renderer.maxForce = maxForce;
}

function solveCurrentLoadCase() {
  try {
    saveCurrentLoadCaseFromNodes();
    const result = solveTruss(nodes, members);
    maxForce = result.maxForce;
    hasResults = true;
    renderer.hasResults = true;
    renderer.maxForce = maxForce;
    
    const lc = getCurrentLoadCase();
    if (lc) {
      lc.solved = true;
      lc.results = deepClone(result);
    }
    
    updateLoadCaseList();
    updateEnvelopeIfNeeded();
    updateResultsDisplay();
    render();
    updateStatus('求解成功!');
    saveToStorage();
  } catch (e) {
    alert('求解失败: ' + e.message);
    updateStatus('求解失败: ' + e.message);
  }
}

function solveAllLoadCases() {
  let successCount = 0;
  let failCount = 0;
  
  const originalLoadCaseId = currentLoadCaseId;
  
  for (const lc of loadCases) {
    try {
      currentLoadCaseId = lc.id;
      applyLoadCaseToNodes(lc);
      const result = solveTruss(nodes, members);
      lc.solved = true;
      lc.results = deepClone(result);
      successCount++;
    } catch (e) {
      lc.solved = false;
      lc.results = null;
      failCount++;
    }
  }
  
  currentLoadCaseId = originalLoadCaseId;
  applyLoadCaseToNodes(getCurrentLoadCase());
  const lc = getCurrentLoadCase();
  if (lc.solved && lc.results) {
    restoreResults(lc.results);
  }
  
  updateLoadCaseList();
  updateEnvelopeIfNeeded();
  updateResultsDisplay();
  render();
  updateStatus(`批量求解完成: 成功 ${successCount} 个, 失败 ${failCount} 个`);
  saveToStorage();
}

function calculateEnvelope() {
  const solvedCases = loadCases.filter(lc => lc.solved && lc.results);
  if (solvedCases.length === 0) {
    envelopeData = null;
    return null;
  }
  
  const envelope = new Map();
  
  members.forEach(member => {
    let maxTension = -Infinity;
    let maxCompression = Infinity;
    let maxTensionStress = 0;
    let maxCompressionStress = 0;
    let maxTensionCase = null;
    let maxCompressionCase = null;
    
    solvedCases.forEach(lc => {
      const memberResult = lc.results.members.find(m => m.id === member.id);
      if (memberResult) {
        if (memberResult.axialForce > 0 && memberResult.axialForce > maxTension) {
          maxTension = memberResult.axialForce;
          maxTensionStress = memberResult.stress;
          maxTensionCase = lc.name;
        }
        if (memberResult.axialForce < 0 && memberResult.axialForce < maxCompression) {
          maxCompression = memberResult.axialForce;
          maxCompressionStress = memberResult.stress;
          maxCompressionCase = lc.name;
        }
      }
    });
    
    if (maxTension === -Infinity) maxTension = 0;
    if (maxCompression === Infinity) maxCompression = 0;
    
    envelope.set(member.id, {
      maxTension,
      maxCompression,
      maxTensionStress,
      maxCompressionStress,
      maxTensionCase,
      maxCompressionCase
    });
  });
  
  return envelope;
}

function updateEnvelopeIfNeeded() {
  envelopeData = calculateEnvelope();
  if (envelopeData) {
    let globalMaxForce = 0;
    for (const info of envelopeData.values()) {
      globalMaxForce = Math.max(globalMaxForce, Math.abs(info.maxTension), Math.abs(info.maxCompression));
    }
    renderer.envelopeData = envelopeData;
    if (viewMode === 'envelope') {
      renderer.maxForce = globalMaxForce;
    }
  } else {
    renderer.envelopeData = null;
  }
  updateEnvelopeDisplay();
}

function setViewMode(mode) {
  viewMode = mode;
  renderer.viewMode = mode;
  
  if (mode === 'envelope') {
    updateEnvelopeIfNeeded();
    if (envelopeData) {
      let globalMaxForce = 0;
      for (const info of envelopeData.values()) {
        globalMaxForce = Math.max(globalMaxForce, Math.abs(info.maxTension), Math.abs(info.maxCompression));
      }
      renderer.maxForce = globalMaxForce;
    }
    document.getElementById('envelope-section').style.display = 'block';
  } else {
    document.getElementById('envelope-section').style.display = 'none';
    if (hasResults) {
      renderer.maxForce = maxForce;
    }
  }
  
  updateViewModeButtons();
  updateEnvelopeDisplay();
  render();
  updateResultsDisplay();
}

function updateViewModeButtons() {
  document.getElementById('btn-view-single').classList.toggle('active', viewMode === 'single');
  document.getElementById('btn-view-envelope').classList.toggle('active', viewMode === 'envelope');
}

function updateLoadCaseList() {
  const container = document.getElementById('loadcase-list');
  container.innerHTML = '';
  
  loadCases.forEach(lc => {
    const item = document.createElement('div');
    item.className = 'loadcase-item';
    if (lc.id === currentLoadCaseId) item.classList.add('active');
    if (lc.solved) item.classList.add('solved');
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'loadcase-name';
    nameSpan.textContent = lc.name;
    nameSpan.ondblclick = (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = lc.name;
      nameSpan.innerHTML = '';
      nameSpan.appendChild(input);
      input.focus();
      input.select();
      input.onblur = () => {
        const newName = input.value.trim() || lc.name;
        renameLoadCase(lc.id, newName);
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          nameSpan.textContent = lc.name;
        }
      };
    };
    
    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'loadcase-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = '删除工况';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`确定删除工况"${lc.name}"吗？`)) {
        deleteLoadCase(lc.id);
      }
    };
    
    item.onclick = () => switchLoadCase(lc.id);
    item.appendChild(nameSpan);
    item.appendChild(deleteBtn);
    container.appendChild(item);
  });
}

function updateEnvelopeDisplay() {
  const summary = document.getElementById('envelope-summary');
  const overlimitList = document.getElementById('overlimit-list');
  
  if (!envelopeData || viewMode !== 'envelope') {
    summary.innerHTML = '';
    overlimitList.innerHTML = '';
    return;
  }
  
  const solvedCount = loadCases.filter(lc => lc.solved).length;
  summary.innerHTML = `已求解 ${solvedCount} 个工况，共 ${members.length} 根杆件`;
  
  const overlimitMembers = [];
  for (const [memberId, info] of envelopeData.entries()) {
    const member = members.find(m => m.id === memberId);
    const maxStress = Math.max(Math.abs(info.maxTensionStress), Math.abs(info.maxCompressionStress));
    if (maxStress > YIELD_STRESS) {
      const safetyFactor = YIELD_STRESS / maxStress;
      overlimitMembers.push({
        member,
        info,
        maxStress,
        safetyFactor
      });
    }
  }
  
  if (overlimitMembers.length > 0) {
    let html = '<h4>⚠ 应力超限杆件</h4>';
    overlimitMembers.forEach(item => {
      const forceType = Math.abs(item.info.maxTensionStress) >= Math.abs(item.info.maxCompressionStress) 
        ? '拉力' : '压力';
      const caseName = Math.abs(item.info.maxTensionStress) >= Math.abs(item.info.maxCompressionStress)
        ? item.info.maxTensionCase : item.info.maxCompressionCase;
      html += `<div class="overlimit-item">`;
      html += `<strong>杆件 #${item.member.id}</strong><br/>`;
      html += `最大应力: ${(item.maxStress / 1e6).toFixed(2)} MPa (${forceType})<br/>`;
      html += `安全系数: ${item.safetyFactor.toFixed(3)}<br/>`;
      html += `<small>来自工况: ${caseName}</small>`;
      html += `</div>`;
    });
    overlimitList.innerHTML = html;
  } else {
    overlimitList.innerHTML = '<div style="font-size:12px;color:#4caf50;padding:8px 0;">✓ 所有杆件应力均在安全范围内</div>';
  }
}

function saveToStorage() {
  try {
    const data = {
      nodes: nodes.map(n => ({
        id: n.id,
        x: n.x,
        y: n.y,
        support: n.support
      })),
      members: members.map(m => ({
        id: m.id,
        node1Id: m.node1Id,
        node2Id: m.node2Id,
        length: m.length,
        angle: m.angle,
        E: m.E,
        A: m.A
      })),
      loadCases: loadCases,
      currentLoadCaseId
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('保存到localStorage失败:', e);
  }
}

function loadFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return false;
    
    const data = JSON.parse(stored);
    if (!data.nodes || !data.members || !data.loadCases || data.loadCases.length === 0) {
      return false;
    }
    
    nodes = data.nodes.map(n => ({
      ...n,
      fx: 0,
      fy: 0,
      dx: 0,
      dy: 0,
      selected: false
    }));
    
    members = data.members.map(m => ({
      ...m,
      axialForce: 0,
      stress: 0,
      selected: false
    }));
    
    loadCases = data.loadCases;
    currentLoadCaseId = data.currentLoadCaseId || loadCases[0].id;
    
    applyLoadCaseToNodes(getCurrentLoadCase());
    
    const lc = getCurrentLoadCase();
    if (lc.solved && lc.results) {
      restoreResults(lc.results);
    }
    
    return true;
  } catch (e) {
    console.warn('从localStorage加载失败:', e);
    return false;
  }
}

function init() {
  renderer.resize();
  
  const loaded = loadFromStorage();
  
  if (!loaded) {
    const warren = createWarrenTruss();
    nodes = warren.nodes;
    members = warren.members;
    loadCases = createDefaultLoadCases(nodes);
    currentLoadCaseId = loadCases[0].id;
    applyLoadCaseToNodes(getCurrentLoadCase());
    
    try {
      solveAllLoadCases();
    } catch (e) {
      console.warn('初始求解失败:', e.message);
    }
  } else {
    updateEnvelopeIfNeeded();
  }
  
  historyManager.saveState(nodes, members);
  
  render();
  updateLoadCaseList();
  updateButtonStates();
  updateResultsDisplay();
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
  
  loadCases.forEach(lc => {
    selectedNodes.forEach(nodeId => {
      delete lc.nodeLoads[nodeId];
    });
    lc.solved = false;
    lc.results = null;
  });
  
  selectedNodes.clear();
  selectedMembers.clear();
  
  hasResults = false;
  renderer.hasResults = false;
  
  envelopeData = null;
  renderer.envelopeData = null;
  
  historyManager.saveState(nodes, members);
  updateLoadCaseList();
  updateButtonStates();
  render();
  updateResultsDisplay();
  updateEnvelopeDisplay();
  saveToStorage();
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
  loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
  hasResults = false;
  renderer.hasResults = false;
  envelopeData = null;
  renderer.envelopeData = null;
  historyManager.saveState(nodes, members);
  updateLoadCaseList();
  updateButtonStates();
  render();
  updateResultsDisplay();
  updateEnvelopeDisplay();
  saveToStorage();
}

function deleteNode(node) {
  nodes = nodes.filter(n => n.id !== node.id);
  members = members.filter(m => m.node1Id !== node.id && m.node2Id !== node.id);
  
  loadCases.forEach(lc => {
    delete lc.nodeLoads[node.id];
    lc.solved = false;
    lc.results = null;
  });
  
  hasResults = false;
  renderer.hasResults = false;
  envelopeData = null;
  renderer.envelopeData = null;
  historyManager.saveState(nodes, members);
  updateLoadCaseList();
  updateButtonStates();
  render();
  updateResultsDisplay();
  updateEnvelopeDisplay();
  saveToStorage();
}

function deleteMember(member) {
  members = members.filter(m => m.id !== member.id);
  
  loadCases.forEach(lc => {
    lc.solved = false;
    lc.results = null;
  });
  
  hasResults = false;
  renderer.hasResults = false;
  envelopeData = null;
  renderer.envelopeData = null;
  historyManager.saveState(nodes, members);
  updateLoadCaseList();
  updateButtonStates();
  render();
  updateResultsDisplay();
  updateEnvelopeDisplay();
  saveToStorage();
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
    <p style="font-size:12px;color:#1976d2;margin-top:8px;">当前工况: ${getCurrentLoadCase()?.name || ''}</p>
  `;
  
  showModal('施加外力', html, () => {
    node.fx = parseFloat(document.getElementById('input-fx').value) || 0;
    node.fy = parseFloat(document.getElementById('input-fy').value) || 0;
    saveCurrentLoadCaseFromNodes();
    loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
    hasResults = false;
    renderer.hasResults = false;
    envelopeData = null;
    renderer.envelopeData = null;
    historyManager.saveState(nodes, members);
    updateLoadCaseList();
    updateButtonStates();
    render();
    updateResultsDisplay();
    updateEnvelopeDisplay();
    saveToStorage();
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
    loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
    hasResults = false;
    renderer.hasResults = false;
    envelopeData = null;
    renderer.envelopeData = null;
    historyManager.saveState(nodes, members);
    updateLoadCaseList();
    updateButtonStates();
    render();
    updateResultsDisplay();
    updateEnvelopeDisplay();
    saveToStorage();
  });
}

function updateTooltip(e) {
  const tooltip = document.getElementById('tooltip');
  const pos = getMousePos(e);
  
  const member = findMemberAt(pos.x, pos.y);
  hoveredMember = member;
  
  if (member) {
    let html = `<strong>杆件 #${member.id}</strong><br/>`;
    
    if (viewMode === 'envelope' && envelopeData) {
      const info = envelopeData.get(member.id);
      if (info) {
        const maxStress = Math.max(Math.abs(info.maxTensionStress), Math.abs(info.maxCompressionStress));
        const isOverLimit = maxStress > YIELD_STRESS;
        
        html += `<span style="color:#1565c0;">最大拉力: ${(info.maxTension / 1000).toFixed(2)} kN</span><br/>`;
        html += `<small style="color:#666;">来自工况: ${info.maxTensionCase}</small><br/>`;
        html += `<span style="color:#c62828;">最大压力: ${(Math.abs(info.maxCompression) / 1000).toFixed(2)} kN</span><br/>`;
        html += `<small style="color:#666;">来自工况: ${info.maxCompressionCase}</small><br/>`;
        html += `最大应力: ${(maxStress / 1e6).toFixed(2)} MPa<br/>`;
        html += `长度: ${member.length.toFixed(1)} mm<br/>`;
        if (isOverLimit) {
          const sf = YIELD_STRESS / maxStress;
          html += `<span style="color:#ff5252;font-weight:bold;">⚠ 应力超限! 安全系数: ${sf.toFixed(3)}</span>`;
        }
      }
    } else if (hasResults) {
      const force = member.axialForce;
      const stress = member.stress;
      const isYielding = Math.abs(stress) > YIELD_STRESS;
      
      html += `轴力: ${(force / 1000).toFixed(2)} kN (${force > 0 ? '拉力' : force < 0 ? '压力' : '零力'})<br/>`;
      html += `应力: ${(stress / 1e6).toFixed(2)} MPa<br/>`;
      html += `长度: ${member.length.toFixed(1)} mm<br/>`;
      if (isYielding) {
        const sf = YIELD_STRESS / Math.abs(stress);
        html += `<span style="color:#ff5252;font-weight:bold;">⚠ 已屈服! 安全系数: ${sf.toFixed(3)}</span>`;
      }
    } else {
      html += `长度: ${member.length.toFixed(1)} mm<br/>`;
      html += `<span style="color:#999;">未求解</span>`;
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
  
  if (viewMode === 'envelope') {
    if (!envelopeData) {
      container.innerHTML = '请先对至少一个工况进行求解';
      return;
    }
    
    let html = '';
    html += '<div class="result-item"><strong>包络结果</strong></div>';
    html += `<div class="result-item" style="color:#666;">显示所有工况的极值</div>`;
    
    members.forEach(member => {
      const info = envelopeData.get(member.id);
      if (!info) return;
      
      const maxAbsForce = Math.max(Math.abs(info.maxTension), Math.abs(info.maxCompression));
      const maxForceType = Math.abs(info.maxTension) >= Math.abs(info.maxCompression) ? '拉' : '压';
      
      html += `<div class="result-item">`;
      html += `杆件 #${member.id}: `;
      html += `拉${(info.maxTension / 1000).toFixed(2)}kN / `;
      html += `压${(Math.abs(info.maxCompression) / 1000).toFixed(2)}kN`;
      html += `</div>`;
    });
    
    container.innerHTML = html;
    return;
  }
  
  if (!hasResults) {
    container.innerHTML = '点击"求解当前工况"按钮开始计算';
    return;
  }
  
  let html = '';
  
  html += '<div class="result-item"><strong>当前工况</strong></div>';
  html += `<div class="result-item" style="color:#1976d2;">${getCurrentLoadCase()?.name || ''}</div>`;
  
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
    loadCases: loadCases,
    currentLoadCaseId,
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
    } else if (node.selected) {
      mouseState.mode = 'drag';
      mouseState.dragNode = node;
    } else {
      clearSelection();
      node.selected = true;
      selectedNodes.add(node.id);
      mouseState.mode = 'pending';
      mouseState.pendingNode = node;
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
  
  if (mouseState.mode === 'pending' && mouseState.pendingNode && dist > 5) {
    mouseState.mode = 'createMember';
    mouseState.createMemberStart = mouseState.pendingNode;
    mouseState.pendingNode = null;
  }
  
  if (mouseState.mode === 'drag' && mouseState.dragNode) {
    const node = mouseState.dragNode;
    node.x = pos.x;
    node.y = pos.y;
    
    members.forEach(member => {
      if (member.node1Id === node.id || member.node2Id === node.id) {
        updateMemberGeometry(member);
      }
    });
    
    loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
    hasResults = false;
    renderer.hasResults = false;
    envelopeData = null;
    renderer.envelopeData = null;
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
    
    loadCases.forEach(lc => {
      lc.nodeLoads[newNode.id] = { fx: 0, fy: 0 };
      lc.solved = false;
      lc.results = null;
    });
    
    hasResults = false;
    renderer.hasResults = false;
    envelopeData = null;
    renderer.envelopeData = null;
    historyManager.saveState(nodes, members);
    updateLoadCaseList();
    updateButtonStates();
    saveToStorage();
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
        
        loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
        hasResults = false;
        renderer.hasResults = false;
        envelopeData = null;
        renderer.envelopeData = null;
        historyManager.saveState(nodes, members);
        updateLoadCaseList();
        updateButtonStates();
        saveToStorage();
      }
    }
  } else if (mouseState.mode === 'select') {
    selectInBox(selectionBox);
  } else if (mouseState.mode === 'drag' && mouseState.hasMoved) {
    historyManager.saveState(nodes, members);
    updateLoadCaseList();
    updateButtonStates();
    updateResultsDisplay();
    updateEnvelopeDisplay();
    saveToStorage();
  }
  
  mouseState.isDown = false;
  mouseState.mode = null;
  mouseState.dragNode = null;
  mouseState.createMemberStart = null;
  mouseState.pendingNode = null;
  selectionBox = null;
  previewLine = null;
  
  render();
  updateResultsDisplay();
  updateEnvelopeDisplay();
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
      loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
      hasResults = false;
      renderer.hasResults = false;
      envelopeData = null;
      renderer.envelopeData = null;
      clearSelection();
      updateLoadCaseList();
      updateButtonStates();
      render();
      updateResultsDisplay();
      updateEnvelopeDisplay();
      saveToStorage();
    }
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    const next = historyManager.redo(nodes, members);
    if (next) {
      nodes = next.nodes;
      members = next.members;
      loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
      hasResults = false;
      renderer.hasResults = false;
      envelopeData = null;
      renderer.envelopeData = null;
      clearSelection();
      updateLoadCaseList();
      updateButtonStates();
      render();
      updateResultsDisplay();
      updateEnvelopeDisplay();
      saveToStorage();
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

document.getElementById('btn-solve').addEventListener('click', solveCurrentLoadCase);
document.getElementById('btn-solve-all').addEventListener('click', solveAllLoadCases);

document.getElementById('btn-view-single').addEventListener('click', () => setViewMode('single'));
document.getElementById('btn-view-envelope').addEventListener('click', () => setViewMode('envelope'));

document.getElementById('btn-add-loadcase').addEventListener('click', () => {
  const name = prompt('请输入工况名称:', `工况${loadCases.length + 1}`);
  if (name && name.trim()) {
    addLoadCase(name.trim());
  }
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (confirm('确定要清空所有内容吗？')) {
    nodes = [];
    members = [];
    loadCases = [createLoadCase('默认工况')];
    currentLoadCaseId = loadCases[0].id;
    hasResults = false;
    renderer.hasResults = false;
    envelopeData = null;
    renderer.envelopeData = null;
    viewMode = 'single';
    renderer.viewMode = 'single';
    clearSelection();
    historyManager.reset();
    historyManager.saveState(nodes, members);
    updateViewModeButtons();
    updateLoadCaseList();
    updateButtonStates();
    render();
    updateResultsDisplay();
    updateEnvelopeDisplay();
    saveToStorage();
  }
});

document.getElementById('btn-undo').addEventListener('click', () => {
  const prev = historyManager.undo(nodes, members);
  if (prev) {
    nodes = prev.nodes;
    members = prev.members;
    loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
    hasResults = false;
    renderer.hasResults = false;
    envelopeData = null;
    renderer.envelopeData = null;
    clearSelection();
    updateLoadCaseList();
    updateButtonStates();
    render();
    updateResultsDisplay();
    updateEnvelopeDisplay();
    saveToStorage();
  }
});

document.getElementById('btn-redo').addEventListener('click', () => {
  const next = historyManager.redo(nodes, members);
  if (next) {
    nodes = next.nodes;
    members = next.members;
    loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
    hasResults = false;
    renderer.hasResults = false;
    envelopeData = null;
    renderer.envelopeData = null;
    clearSelection();
    updateLoadCaseList();
    updateButtonStates();
    render();
    updateResultsDisplay();
    updateEnvelopeDisplay();
    saveToStorage();
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
