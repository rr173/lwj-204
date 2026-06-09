import './style.css';
import { Renderer } from './src/renderer.js';
import { createNode, createMember, deepClone } from './src/core.js';
import { solveTruss, solveFrame } from './src/solver.js';
import { solveModal } from './src/modal.js';
import { HistoryManager } from './src/history.js';
import { createWarrenTruss, createDefaultLoadCases, createPortalFrame, createFrameLoadCases, createConstructionStagePreset } from './src/presets.js';
import { TopoOptimizer } from './src/topo.js';

const canvas = document.getElementById('canvas');
const renderer = new Renderer(canvas);
const historyManager = new HistoryManager();

const STORAGE_KEY = 'truss-analyzer-data';
const YIELD_STRESS = 235e6;

let nodes = [];
let members = [];
let hasResults = false;
let maxForce = 0;
let maxMoment = 0;

let analysisMode = 'truss';
let forceDiagramType = 'moment';
let frameResults = null;

let selectedNodes = new Set();
let selectedMembers = new Set();

let modalActive = false;
let modalResults = null;
let currentModalMode = 0;
let modalAnimFrame = null;
let modalAnimTime = 0;
let modalScaleFactor = 50;

let influenceActive = false;
let influenceStep = 'idle';
let influenceSectionMemberId = null;
let influenceSectionT = 0.5;
let influenceSectionX = 0;
let influenceSectionY = 0;
let influenceResponseType = 'axial';
let influenceData = null;
let influenceHoverIdx = -1;

let loadCases = [];
let currentLoadCaseId = null;
let viewMode = 'single';
let envelopeData = null;

let constructionActive = false;
let constructionStages = [];
let currentStageIndex = -1;
let stageDragSrcIndex = null;

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

let sectionStressActive = false;
let sectionStressMemberId = null;
let sectionStressZoom = 1;
let sectionStressPanX = 0;
let sectionStressPanY = 0;
let sectionStressDragging = false;
let sectionStressDragStartX = 0;
let sectionStressDragStartY = 0;
let sectionStressDragStartPanX = 0;
let sectionStressDragStartPanY = 0;

let topoActive = false;
let topoStep = 'idle';
let topoDomain = null;
let topoOptimizer = null;
let topoRunning = false;
let topoTimer = null;
let topoForces = [];
let topoForceDir = 'down';
let topoDragStart = null;
let topoDragEnd = null;

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
      node.m = nodeLoad.m || 0;
    } else {
      node.fx = 0;
      node.fy = 0;
      node.m = 0;
    }
  });
  if (analysisMode === 'frame' && loadCase.memberLoads) {
    members.forEach(member => {
      const ml = loadCase.memberLoads[member.id];
      if (ml) {
        member.q = ml.q || 0;
      } else {
        member.q = 0;
      }
    });
  }
}

function saveCurrentLoadCaseFromNodes() {
  const lc = getCurrentLoadCase();
  if (!lc) return;
  lc.nodeLoads = {};
  nodes.forEach(node => {
    lc.nodeLoads[node.id] = { fx: node.fx || 0, fy: node.fy || 0, m: node.m || 0 };
  });
  if (analysisMode === 'frame') {
    if (!lc.memberLoads) lc.memberLoads = {};
    members.forEach(member => {
      lc.memberLoads[member.id] = { q: member.q || 0 };
    });
  }
}

function createLoadCase(name) {
  const id = 'lc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const lc = {
    id,
    name,
    nodeLoads: {},
    memberLoads: {},
    solved: false,
    results: null
  };
  nodes.forEach(node => {
    lc.nodeLoads[node.id] = { fx: 0, fy: 0, m: 0 };
  });
  members.forEach(member => {
    lc.memberLoads[member.id] = { q: 0 };
  });
  return lc;
}

function addLoadCase(name) {
  const lc = createLoadCase(name);
  loadCases.push(lc);
  currentLoadCaseId = lc.id;
  applyLoadCaseToNodes(lc);
  hasResults = false;
  renderer.hasResults = false;
  frameResults = null;
  renderer.frameResults = null;
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
      frameResults = null;
      renderer.frameResults = null;
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
    frameResults = null;
    renderer.frameResults = null;
  }
  viewMode = 'single';
  renderer.viewMode = 'single';
  updateViewModeButtons();
  updateLoadCaseList();
  render();
  updateResultsDisplay();
  if (sectionStressActive) {
    if (hasResults && frameResults) {
      drawSectionStressCloud();
    } else {
      hideSectionStressView();
    }
  }
}

function restoreResults(results) {
  if (!results) return;
  results.nodes.forEach(rn => {
    const node = nodes.find(n => n.id === rn.id);
    if (node) {
      node.dx = rn.dx;
      node.dy = rn.dy;
      node.dtheta = rn.dtheta || 0;
    }
  });
  if (analysisMode === 'frame' && results.members && results.members[0] && results.members[0].M1 !== undefined) {
    results.members.forEach(rm => {
      const member = members.find(m => m.id === rm.id);
      if (member) {
        member.axialForce = rm.axialForce;
        member.stress = rm.stress;
      }
    });
    frameResults = results;
    renderer.frameResults = results;
    maxForce = results.maxForce || 0;
    maxMoment = results.maxMoment || 0;
    renderer.maxForce = maxForce;
    renderer.maxMoment = maxMoment;
  } else {
    results.members.forEach(rm => {
      const member = members.find(m => m.id === rm.id);
      if (member) {
        member.axialForce = rm.axialForce;
        member.stress = rm.stress;
      }
    });
    frameResults = null;
    renderer.frameResults = null;
    maxForce = results.maxForce;
    maxMoment = 0;
    renderer.maxForce = maxForce;
    renderer.maxMoment = 0;
  }
  hasResults = true;
  renderer.hasResults = true;
}

function solveCurrentLoadCase() {
  try {
    saveCurrentLoadCaseFromNodes();
    let result;
    if (analysisMode === 'frame') {
      result = solveFrame(nodes, members);
      frameResults = result;
      renderer.frameResults = result;
      maxForce = result.maxForce;
      maxMoment = result.maxMoment;
      renderer.maxForce = maxForce;
      renderer.maxMoment = maxMoment;

      result.members.forEach(rm => {
        const member = members.find(m => m.id === rm.id);
        if (member) {
          member.axialForce = rm.axialForce;
          member.stress = rm.stress;
        }
      });
    } else {
      result = solveTruss(nodes, members);
      frameResults = null;
      renderer.frameResults = null;
      maxForce = result.maxForce;
      maxMoment = 0;
      renderer.maxForce = maxForce;
      renderer.maxMoment = 0;
    }

    hasResults = true;
    renderer.hasResults = true;

    const lc = getCurrentLoadCase();
    if (lc) {
      lc.solved = true;
      lc.results = deepClone(result);
    }

    updateLoadCaseList();
    updateEnvelopeIfNeeded();
    updateResultsDisplay();
    render();
    if (sectionStressActive) drawSectionStressCloud();
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
      let result;
      if (analysisMode === 'frame') {
        result = solveFrame(nodes, members);
      } else {
        result = solveTruss(nodes, members);
      }
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

function setAnalysisMode(mode) {
  if (analysisMode === mode) return;
  if (modalActive) exitModalMode();
  if (influenceActive) exitInfluenceMode();
  if (sectionStressActive) hideSectionStressView();
  analysisMode = mode;
  renderer.analysisMode = mode;

  hasResults = false;
  renderer.hasResults = false;
  frameResults = null;
  renderer.frameResults = null;
  envelopeData = null;
  renderer.envelopeData = null;

  loadCases.forEach(lc => {
    lc.solved = false;
    lc.results = null;
  });

  const frameSection = document.getElementById('frame-diagram-section');
  if (mode === 'frame') {
    frameSection.style.display = 'block';
  } else {
    frameSection.style.display = 'none';
  }

  updateAnalysisModeButtons();
  updateLoadCaseList();
  render();
  updateResultsDisplay();
  saveToStorage();
}

function setForceDiagramType(type) {
  forceDiagramType = type;
  renderer.forceDiagramType = type;
  updateForceDiagramButtons();
  render();
}

function updateAnalysisModeButtons() {
  document.getElementById('btn-mode-truss').classList.toggle('active', analysisMode === 'truss');
  document.getElementById('btn-mode-frame').classList.toggle('active', analysisMode === 'frame');
}

function updateForceDiagramButtons() {
  document.getElementById('btn-diagram-moment').classList.toggle('active', forceDiagramType === 'moment');
  document.getElementById('btn-diagram-shear').classList.toggle('active', forceDiagramType === 'shear');
  document.getElementById('btn-diagram-axial').classList.toggle('active', forceDiagramType === 'axial');
}

function startModalAnalysis() {
  if (influenceActive) exitInfluenceMode();
  const numModes = parseInt(document.getElementById('modal-num-modes').value) || 5;

  try {
    modalResults = solveModal(nodes, members, analysisMode, numModes);
    modalActive = true;
    currentModalMode = 0;
    renderer.modalMode = true;

    document.getElementById('modal-section').style.display = 'block';
    document.getElementById('modal-scale-label').style.display = 'flex';
    document.getElementById('results-section').style.display = 'none';
    document.getElementById('btn-modal').classList.add('active');

    updateModalFreqList();
    startModalAnimation();
    updateStatus(`模态分析完成: 求得 ${modalResults.modes.length} 阶模态`);
  } catch (e) {
    alert('模态分析失败: ' + e.message);
    updateStatus('模态分析失败: ' + e.message);
  }
}

function exitModalMode() {
  modalActive = false;
  renderer.modalMode = false;
  renderer.modalModeShape = null;
  renderer.modalAmplitude = 0;
  renderer.modalEnvelope = null;

  if (modalAnimFrame) {
    cancelAnimationFrame(modalAnimFrame);
    modalAnimFrame = null;
  }

  document.getElementById('modal-section').style.display = 'none';
  document.getElementById('modal-scale-label').style.display = 'none';
  document.getElementById('results-section').style.display = 'block';
  document.getElementById('btn-modal').classList.remove('active');

  render();
}

function updateModalFreqList() {
  if (!modalResults || !modalResults.modes.length) return;

  const container = document.getElementById('modal-freq-list');
  container.innerHTML = '';

  modalResults.modes.forEach((mode, idx) => {
    const item = document.createElement('div');
    item.className = 'modal-freq-item';
    if (idx === currentModalMode) item.classList.add('active');

    const numSpan = document.createElement('span');
    numSpan.className = 'mode-number';
    numSpan.textContent = `${mode.modeNumber}`;

    const freqSpan = document.createElement('span');
    freqSpan.className = 'freq-value';
    freqSpan.textContent = `${mode.frequency.toFixed(2)} Hz`;

    item.appendChild(numSpan);
    item.appendChild(freqSpan);

    item.onclick = () => {
      currentModalMode = idx;
      updateModalFreqList();
    };

    container.appendChild(item);
  });
}

function startModalAnimation() {
  if (modalAnimFrame) {
    cancelAnimationFrame(modalAnimFrame);
  }

  let lastTime = 0;
  modalAnimTime = 0;

  function animate(timestamp) {
    if (!modalActive || !modalResults || !modalResults.modes.length) {
      modalAnimFrame = null;
      return;
    }

    if (lastTime === 0) lastTime = timestamp;
    const delta = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    modalAnimTime += delta;

    const mode = modalResults.modes[currentModalMode];
    if (!mode) {
      modalAnimFrame = requestAnimationFrame(animate);
      return;
    }

    const visualFreq = 1.5;
    const amplitude = Math.sin(2 * Math.PI * visualFreq * modalAnimTime);

    renderer.modalModeShape = mode.nodeModeShapes;
    renderer.modalAmplitude = amplitude;
    renderer.modalEnvelope = modalScaleFactor;

    render();

    modalAnimFrame = requestAnimationFrame(animate);
  }

  modalAnimFrame = requestAnimationFrame(animate);
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
        A: m.A,
        I: m.I,
        release1: m.release1,
        release2: m.release2,
        q: m.q,
        rho: m.rho,
        h: m.h
      })),
      loadCases: loadCases,
      currentLoadCaseId,
      analysisMode,
      constructionStages
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
      m: 0,
      dx: 0,
      dy: 0,
      dtheta: 0,
      selected: false
    }));

    members = data.members.map(m => ({
      ...m,
      I: m.I || 1e-5,
      release1: m.release1 || false,
      release2: m.release2 || false,
      q: m.q || 0,
      rho: m.rho || 7850,
      h: m.h || 0.2,
      axialForce: 0,
      stress: 0,
      selected: false
    }));

    loadCases = data.loadCases;
    currentLoadCaseId = data.currentLoadCaseId || loadCases[0].id;
    analysisMode = data.analysisMode || 'truss';
    renderer.analysisMode = analysisMode;
    constructionStages = data.constructionStages || [];

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

function getStageCumulativeMemberIds(stageIndex) {
  const ids = new Set();
  for (let i = 0; i <= stageIndex && i < constructionStages.length; i++) {
    constructionStages[i].memberIds.forEach(id => ids.add(id));
  }
  return ids;
}

function getStageAvailableMemberIds(stageIndex) {
  return getStageCumulativeMemberIds(stageIndex);
}

function addConstructionStage(name) {
  if (!name || !name.trim()) return;
  const stage = {
    id: 'cs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    name: name.trim(),
    memberIds: [],
    nodeLoads: {},
    memberLoads: {},
    solved: false,
    incrementalResults: null
  };
  constructionStages.push(stage);
  currentStageIndex = constructionStages.length - 1;
  updateStageList();
  updateStageDetail();
  updateTimeline();
  saveToStorage();
}

function deleteConstructionStage(stageId) {
  const idx = constructionStages.findIndex(s => s.id === stageId);
  if (idx < 0) return;
  constructionStages.splice(idx, 1);
  if (constructionStages.length === 0) {
    currentStageIndex = -1;
    exitConstructionMode();
  } else {
    if (currentStageIndex >= constructionStages.length) {
      currentStageIndex = constructionStages.length - 1;
    }
    constructionStages.forEach(s => { s.solved = false; s.incrementalResults = null; });
    updateStageList();
    updateStageDetail();
    updateTimeline();
    applyStageVisualization();
  }
  saveToStorage();
}

function renameConstructionStage(stageId, newName) {
  const stage = constructionStages.find(s => s.id === stageId);
  if (stage) {
    stage.name = newName;
    updateStageList();
    saveToStorage();
  }
}

function moveConstructionStage(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || fromIdx >= constructionStages.length) return;
  if (toIdx < 0 || toIdx >= constructionStages.length) return;
  const [stage] = constructionStages.splice(fromIdx, 1);
  constructionStages.splice(toIdx, 0, stage);
  constructionStages.forEach(s => { s.solved = false; s.incrementalResults = null; });
  if (currentStageIndex === fromIdx) currentStageIndex = toIdx;
  updateStageList();
  updateStageDetail();
  updateTimeline();
  saveToStorage();
}

function toggleStageMember(stageId, memberId) {
  const stage = constructionStages.find(s => s.id === stageId);
  if (!stage) return;
  const idx = stage.memberIds.indexOf(memberId);
  if (idx >= 0) {
    stage.memberIds.splice(idx, 1);
  } else {
    stage.memberIds.push(memberId);
  }
  constructionStages.forEach(s => { s.solved = false; s.incrementalResults = null; });
  updateStageDetail();
  updateStageList();
  saveToStorage();
}

function setStageNodeLoad(stageId, nodeId, fx, fy, m) {
  const stage = constructionStages.find(s => s.id === stageId);
  if (!stage) return;
  if (!stage.nodeLoads) stage.nodeLoads = {};
  stage.nodeLoads[nodeId] = { fx: fx || 0, fy: fy || 0, m: m || 0 };
  const idx = constructionStages.indexOf(stage);
  for (let i = idx; i < constructionStages.length; i++) {
    constructionStages[i].solved = false;
    constructionStages[i].incrementalResults = null;
  }
  saveToStorage();
}

function setStageMemberLoad(stageId, memberId, q) {
  const stage = constructionStages.find(s => s.id === stageId);
  if (!stage) return;
  if (!stage.memberLoads) stage.memberLoads = {};
  stage.memberLoads[memberId] = { q: q || 0 };
  const idx = constructionStages.indexOf(stage);
  for (let i = idx; i < constructionStages.length; i++) {
    constructionStages[i].solved = false;
    constructionStages[i].incrementalResults = null;
  }
  saveToStorage();
}

function solveConstructionStages() {
  if (constructionStages.length === 0) {
    alert('请先创建施工阶段');
    return;
  }

  const savedFx = {};
  const savedFy = {};
  const savedM = {};
  const savedQ = {};
  nodes.forEach(n => { savedFx[n.id] = n.fx; savedFy[n.id] = n.fy; savedM[n.id] = n.m; });
  members.forEach(m => { savedQ[m.id] = m.q; });

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < constructionStages.length; i++) {
    const stage = constructionStages[i];
    const cumulativeIds = getStageCumulativeMemberIds(i);
    const subMembers = members.filter(m => cumulativeIds.has(m.id));

    const usedNodeIds = new Set();
    subMembers.forEach(m => { usedNodeIds.add(m.node1Id); usedNodeIds.add(m.node2Id); });
    const subNodes = nodes.filter(n => usedNodeIds.has(n.id));

    if (subMembers.length === 0 || subNodes.length === 0) {
      stage.solved = false;
      stage.incrementalResults = null;
      failCount++;
      continue;
    }

    nodes.forEach(n => { n.fx = 0; n.fy = 0; n.m = 0; });
    members.forEach(m => { m.q = 0; });

    if (stage.nodeLoads) {
      for (const nodeId in stage.nodeLoads) {
        const node = nodes.find(n => n.id === parseInt(nodeId));
        if (node && usedNodeIds.has(node.id)) {
          node.fx = stage.nodeLoads[nodeId].fx || 0;
          node.fy = stage.nodeLoads[nodeId].fy || 0;
          node.m = stage.nodeLoads[nodeId].m || 0;
        }
      }
    }

    if (analysisMode === 'frame' && stage.memberLoads) {
      for (const memberId in stage.memberLoads) {
        const member = members.find(m => m.id === parseInt(memberId));
        if (member && cumulativeIds.has(member.id)) {
          member.q = stage.memberLoads[memberId].q || 0;
        }
      }
    }

    try {
      let result;
      if (analysisMode === 'frame') {
        result = solveFrame(subNodes, subMembers);
      } else {
        result = solveTruss(subNodes, subMembers);
      }
      stage.solved = true;
      stage.incrementalResults = deepClone(result);
      successCount++;
    } catch (e) {
      stage.solved = false;
      stage.incrementalResults = null;
      failCount++;
    }
  }

  nodes.forEach(n => { n.fx = savedFx[n.id]; n.fy = savedFy[n.id]; n.m = savedM[n.id]; });
  members.forEach(m => { m.q = savedQ[m.id]; });

  const lc = getCurrentLoadCase();
  if (lc && lc.solved && lc.results) {
    restoreResults(lc.results);
  } else {
    hasResults = false;
    renderer.hasResults = false;
    frameResults = null;
    renderer.frameResults = null;
  }

  applyStageVisualization();
  updateStageList();
  updateStageResults();
  updateTimeline();
  saveToStorage();
  updateStatus(`阶段求解完成: 成功 ${successCount} 个, 失败 ${failCount} 个`);
}

function getCumulativeStageResults(stageIndex) {
  if (stageIndex < 0 || stageIndex >= constructionStages.length) return null;

  const cumulativeNodeDisplacements = {};
  const cumulativeMemberForces = {};

  for (let i = 0; i <= stageIndex; i++) {
    const stage = constructionStages[i];
    if (!stage.solved || !stage.incrementalResults) return null;

    stage.incrementalResults.nodes.forEach(rn => {
      if (!cumulativeNodeDisplacements[rn.id]) {
        cumulativeNodeDisplacements[rn.id] = { dx: 0, dy: 0, dtheta: 0 };
      }
      cumulativeNodeDisplacements[rn.id].dx += rn.dx || 0;
      cumulativeNodeDisplacements[rn.id].dy += rn.dy || 0;
      cumulativeNodeDisplacements[rn.id].dtheta += rn.dtheta || 0;
    });

    stage.incrementalResults.members.forEach(rm => {
      if (!cumulativeMemberForces[rm.id]) {
        cumulativeMemberForces[rm.id] = { axialForce: 0, stress: 0, N1: 0, V1: 0, M1: 0, N2: 0, V2: 0, M2: 0, q: 0 };
      }
      cumulativeMemberForces[rm.id].axialForce += rm.axialForce || 0;
      cumulativeMemberForces[rm.id].stress += rm.stress || 0;
      cumulativeMemberForces[rm.id].N1 += rm.N1 || 0;
      cumulativeMemberForces[rm.id].V1 += rm.V1 || 0;
      cumulativeMemberForces[rm.id].M1 += rm.M1 || 0;
      cumulativeMemberForces[rm.id].N2 += rm.N2 || 0;
      cumulativeMemberForces[rm.id].V2 += rm.V2 || 0;
      cumulativeMemberForces[rm.id].M2 += rm.M2 || 0;
    });
  }

  return { cumulativeNodeDisplacements, cumulativeMemberForces };
}

function applyStageVisualization() {
  if (!constructionActive || currentStageIndex < 0) {
    renderer.constructionStageInfo = null;
    return;
  }

  const cumulativeIds = getStageCumulativeMemberIds(currentStageIndex);
  const allSolvedUpToCurrent = constructionStages.slice(0, currentStageIndex + 1).every(s => s.solved);

  const cumulativeNodeLoads = {};
  const cumulativeMemberLoads = {};
  for (let i = 0; i <= currentStageIndex; i++) {
    const stg = constructionStages[i];
    if (stg.nodeLoads) {
      for (const nid in stg.nodeLoads) {
        if (!cumulativeNodeLoads[nid]) cumulativeNodeLoads[nid] = { fx: 0, fy: 0, m: 0 };
        cumulativeNodeLoads[nid].fx += stg.nodeLoads[nid].fx || 0;
        cumulativeNodeLoads[nid].fy += stg.nodeLoads[nid].fy || 0;
        cumulativeNodeLoads[nid].m += stg.nodeLoads[nid].m || 0;
      }
    }
    if (analysisMode === 'frame' && stg.memberLoads) {
      for (const mid in stg.memberLoads) {
        if (!cumulativeMemberLoads[mid]) cumulativeMemberLoads[mid] = { q: 0 };
        cumulativeMemberLoads[mid].q += stg.memberLoads[mid].q || 0;
      }
    }
  }

  const savedNodeLoads = {};
  const savedMemberLoads = {};
  nodes.forEach(n => { savedNodeLoads[n.id] = { fx: n.fx, fy: n.fy, m: n.m }; });
  members.forEach(m => { savedMemberLoads[m.id] = { q: m.q }; });

  nodes.forEach(n => {
    const sl = cumulativeNodeLoads[n.id];
    if (sl) { n.fx = sl.fx; n.fy = sl.fy; n.m = sl.m; }
    else { n.fx = 0; n.fy = 0; n.m = 0; }
  });
  members.forEach(m => {
    if (cumulativeIds.has(m.id)) {
      const ml = cumulativeMemberLoads[m.id];
      m.q = ml ? ml.q : 0;
    } else {
      m.q = 0;
    }
  });

  const savedDx = {};
  const savedDy = {};
  const savedDtheta = {};
  nodes.forEach(n => { savedDx[n.id] = n.dx; savedDy[n.id] = n.dy; savedDtheta[n.id] = n.dtheta; });
  const savedAxial = {};
  const savedStress = {};
  members.forEach(m => { savedAxial[m.id] = m.axialForce; savedStress[m.id] = m.stress; });

  const cumulative = allSolvedUpToCurrent ? getCumulativeStageResults(currentStageIndex) : null;

  if (cumulative) {
    nodes.forEach(n => {
      const cd = cumulative.cumulativeNodeDisplacements[n.id];
      if (cd) {
        n.dx = cd.dx;
        n.dy = cd.dy;
        n.dtheta = cd.dtheta;
      } else {
        n.dx = 0;
        n.dy = 0;
        n.dtheta = 0;
      }
    });

    members.forEach(m => {
      const cf = cumulative.cumulativeMemberForces[m.id];
      if (cf) {
        m.axialForce = cf.axialForce;
        m.stress = cf.stress;
      } else {
        m.axialForce = 0;
        m.stress = 0;
      }
    });

    if (analysisMode === 'frame') {
      const memberResults = [];
      let maxForce = 0;
      let maxMoment = 0;
      members.forEach(m => {
        const cf = cumulative.cumulativeMemberForces[m.id];
        if (cf && cumulativeIds.has(m.id)) {
          const ml = cumulativeMemberLoads[m.id];
          const qVal = ml ? ml.q : 0;
          memberResults.push({
            id: m.id,
            axialForce: cf.axialForce,
            stress: cf.stress,
            N1: cf.N1, V1: cf.V1, M1: cf.M1,
            N2: cf.N2, V2: cf.V2, M2: cf.M2,
            q: qVal
          });
          maxForce = Math.max(maxForce, Math.abs(cf.N1), Math.abs(cf.N2), Math.abs(cf.V1), Math.abs(cf.V2));
          maxMoment = Math.max(maxMoment, Math.abs(cf.M1), Math.abs(cf.M2));
        } else {
          memberResults.push({
            id: m.id, axialForce: 0, stress: 0,
            N1: 0, V1: 0, M1: 0, N2: 0, V2: 0, M2: 0, q: 0
          });
        }
      });
      frameResults = { nodes: [], members: memberResults, maxForce, maxMoment };
      renderer.frameResults = frameResults;
      renderer.maxForce = maxForce;
      renderer.maxMoment = maxMoment;
    }

    hasResults = true;
    renderer.hasResults = true;
    let globalMaxForce = 0;
    members.forEach(m => {
      if (cumulativeIds.has(m.id)) {
        globalMaxForce = Math.max(globalMaxForce, Math.abs(m.axialForce));
      }
    });
    maxForce = globalMaxForce;
    renderer.maxForce = maxForce;
  } else {
    nodes.forEach(n => { n.dx = 0; n.dy = 0; n.dtheta = 0; });
    members.forEach(m => { m.axialForce = 0; m.stress = 0; });
    hasResults = false;
    renderer.hasResults = false;
    frameResults = null;
    renderer.frameResults = null;
  }

  renderer.constructionStageInfo = {
    activeMemberIds: cumulativeIds,
    currentStageIndex,
    _savedNodeLoads: savedNodeLoads,
    _savedMemberLoads: savedMemberLoads,
    _savedDx: savedDx,
    _savedDy: savedDy,
    _savedDtheta: savedDtheta,
    _savedAxial: savedAxial,
    _savedStress: savedStress
  };
}

function enterConstructionMode() {
  if (modalActive) exitModalMode();
  if (influenceActive) exitInfluenceMode();
  constructionActive = true;
  document.getElementById('btn-construction').classList.add('active');
  document.getElementById('timeline-container').classList.remove('hidden');
  if (constructionStages.length > 0 && currentStageIndex < 0) {
    currentStageIndex = 0;
  }
  applyStageVisualization();
  updateStageList();
  updateStageDetail();
  updateTimeline();
  render();
  updateResultsDisplay();
}

function exitConstructionMode() {
  constructionActive = false;
  const info = renderer.constructionStageInfo;
  if (info) {
    if (info._savedNodeLoads) {
      nodes.forEach(n => {
        const sl = info._savedNodeLoads[n.id];
        if (sl) { n.fx = sl.fx; n.fy = sl.fy; n.m = sl.m; }
      });
    }
    if (info._savedMemberLoads) {
      members.forEach(m => {
        const ml = info._savedMemberLoads[m.id];
        if (ml) { m.q = ml.q; }
      });
    }
    if (info._savedDx) {
      nodes.forEach(n => {
        n.dx = info._savedDx[n.id] || 0;
        n.dy = info._savedDy[n.id] || 0;
        n.dtheta = info._savedDtheta[n.id] || 0;
      });
    }
    if (info._savedAxial) {
      members.forEach(m => {
        m.axialForce = info._savedAxial[m.id] || 0;
        m.stress = info._savedStress[m.id] || 0;
      });
    }
  }
  currentStageIndex = -1;
  renderer.constructionStageInfo = null;
  document.getElementById('btn-construction').classList.remove('active');
  document.getElementById('timeline-container').classList.add('hidden');

  const lc = getCurrentLoadCase();
  if (lc && lc.solved && lc.results) {
    restoreResults(lc.results);
  } else {
    hasResults = false;
    renderer.hasResults = false;
    frameResults = null;
    renderer.frameResults = null;
  }
  render();
  updateResultsDisplay();
  if (sectionStressActive) hideSectionStressView();
}

function updateStageList() {
  const container = document.getElementById('stage-list');
  container.innerHTML = '';

  constructionStages.forEach((stage, idx) => {
    const item = document.createElement('div');
    item.className = 'stage-item' +
      (idx === currentStageIndex ? ' active' : '') +
      (stage.solved ? ' solved' : ' unsolved');
    item.draggable = true;
    item.dataset.index = idx;

    const handle = document.createElement('span');
    handle.className = 'stage-drag-handle';
    handle.textContent = '⠿';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'stage-name';
    nameSpan.textContent = stage.name;
    nameSpan.ondblclick = (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = stage.name;
      nameSpan.innerHTML = '';
      nameSpan.appendChild(input);
      input.focus();
      input.select();
      input.onblur = () => {
        const newName = input.value.trim() || stage.name;
        renameConstructionStage(stage.id, newName);
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { nameSpan.textContent = stage.name; }
      };
    };

    const statusSpan = document.createElement('span');
    statusSpan.className = 'stage-status';
    statusSpan.textContent = stage.solved ? '✓' : '—';

    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'stage-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = '删除阶段';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`确定删除阶段"${stage.name}"吗？`)) {
        deleteConstructionStage(stage.id);
      }
    };

    item.onclick = () => {
      currentStageIndex = idx;
      applyStageVisualization();
      updateStageList();
      updateStageDetail();
      updateTimeline();
      render();
      updateStageResults();
    };

    item.ondragstart = (e) => {
      stageDragSrcIndex = idx;
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    };

    item.ondragend = () => {
      item.classList.remove('dragging');
      stageDragSrcIndex = null;
      container.querySelectorAll('.stage-item').forEach(el => el.classList.remove('drag-over'));
    };

    item.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over');
    };

    item.ondragleave = () => {
      item.classList.remove('drag-over');
    };

    item.ondrop = (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const toIdx = parseInt(item.dataset.index);
      if (stageDragSrcIndex !== null && stageDragSrcIndex !== toIdx) {
        moveConstructionStage(stageDragSrcIndex, toIdx);
      }
    };

    item.appendChild(handle);
    item.appendChild(nameSpan);
    item.appendChild(statusSpan);
    item.appendChild(deleteBtn);
    container.appendChild(item);
  });
}

function updateStageDetail() {
  const container = document.getElementById('stage-detail');
  if (currentStageIndex < 0 || currentStageIndex >= constructionStages.length) {
    container.style.display = 'none';
    return;
  }

  const stage = constructionStages[currentStageIndex];
  container.style.display = 'block';

  const usedNodeIds = new Set();
  stage.memberIds.forEach(mid => {
    const member = members.find(m => m.id === mid);
    if (member) {
      usedNodeIds.add(member.node1Id);
      usedNodeIds.add(member.node2Id);
    }
  });

  let html = `<h4>阶段: ${stage.name}</h4>`;

  html += '<h4>本阶段新增杆件</h4>';
  html += '<div class="stage-member-checks">';
  members.forEach(m => {
    const isChecked = stage.memberIds.includes(m.id);
    const cumulativeIds = getStageCumulativeMemberIds(currentStageIndex);
    const isAvailable = true;
    html += `<label class="stage-member-check${isAvailable ? '' : ' disabled'}">
      <input type="checkbox" ${isChecked ? 'checked' : ''} ${isAvailable ? '' : 'disabled'}
        onchange="window._toggleStageMember('${stage.id}', ${m.id})" />
      杆件 #${m.id}
    </label>`;
  });
  html += '</div>';

  html += '<div class="stage-load-section">';
  html += '<h4>本阶段荷载</h4>';

  if (analysisMode === 'frame') {
    html += '<h4 style="font-size:11px;color:#666;margin-top:4px;">杆件均布荷载</h4>';
    stage.memberIds.forEach(mid => {
      const ml = (stage.memberLoads && stage.memberLoads[mid]) || { q: 0 };
      const member = members.find(m => m.id === mid);
      if (member) {
        html += `<div class="stage-load-item">
          <span>杆件#${mid} q=</span>
          <input type="number" value="${ml.q || 0}" step="1000"
            onchange="window._setStageMemberLoad('${stage.id}', ${mid}, this.value)" />
          <span>N/m</span>
        </div>`;
      }
    });
  }

  html += '<h4 style="font-size:11px;color:#666;margin-top:6px;">节点力</h4>';
  usedNodeIds.forEach(nid => {
    const nl = (stage.nodeLoads && stage.nodeLoads[nid]) || { fx: 0, fy: 0, m: 0 };
    html += `<div class="stage-load-item">
      <span>节点#${nid}</span>
      <span>Fx=</span>
      <input type="number" value="${nl.fx || 0}" step="1000"
        onchange="window._setStageNodeLoad('${stage.id}', ${nid}, 'fx', this.value)" />
      <span>Fy=</span>
      <input type="number" value="${nl.fy || 0}" step="1000"
        onchange="window._setStageNodeLoad('${stage.id}', ${nid}, 'fy', this.value)" />
      ${analysisMode === 'frame' ? `<span>M=</span><input type="number" value="${nl.m || 0}" step="100"
        onchange="window._setStageNodeLoad('${stage.id}', ${nid}, 'm', this.value)" />` : ''}
    </div>`;
  });

  html += '</div>';

  container.innerHTML = html;
}

function updateStageResults() {
  const section = document.getElementById('stage-results-section');
  const container = document.getElementById('stage-results-content');

  if (!constructionActive || currentStageIndex < 0 ||
      !constructionStages[currentStageIndex].solved) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  const stage = constructionStages[currentStageIndex];
  const cumulative = getCumulativeStageResults(currentStageIndex);

  let html = `<div style="font-size:12px;color:#1565c0;font-weight:600;margin-bottom:6px;">
    阶段 ${currentStageIndex + 1}: ${stage.name} — 累积结果</div>`;

  if (cumulative) {
    html += '<div style="font-size:11px;color:#666;margin-bottom:4px;">节点累积位移</div>';
    for (const nid in cumulative.cumulativeNodeDisplacements) {
      const cd = cumulative.cumulativeNodeDisplacements[nid];
      html += `<div class="result-item">节点#${nid}: dx=${(cd.dx * 1000).toFixed(4)}mm, dy=${(cd.dy * 1000).toFixed(4)}mm`;
      if (analysisMode === 'frame') {
        html += `, θ=${(cd.dtheta * 1000).toFixed(4)}mrad`;
      }
      html += '</div>';
    }

    if (analysisMode === 'frame') {
      html += '<div style="font-size:11px;color:#666;margin-top:6px;margin-bottom:4px;">杆件累积内力</div>';
      const cumulativeIds = getStageCumulativeMemberIds(currentStageIndex);
      for (const mid in cumulative.cumulativeMemberForces) {
        if (!cumulativeIds.has(parseInt(mid))) continue;
        const cf = cumulative.cumulativeMemberForces[mid];
        html += `<div class="result-item"><strong>杆件#${mid}</strong><br/>
          1端: N=${(cf.N1 / 1000).toFixed(2)}kN, V=${(cf.V1 / 1000).toFixed(2)}kN, M=${(cf.M1 / 1000).toFixed(2)}kN·m<br/>
          2端: N=${(cf.N2 / 1000).toFixed(2)}kN, V=${(cf.V2 / 1000).toFixed(2)}kN, M=${(cf.M2 / 1000).toFixed(2)}kN·m</div>`;
      }
    }
  }

  container.innerHTML = html;
}

function updateTimeline() {
  const slider = document.getElementById('timeline-slider');
  const label = document.getElementById('timeline-stage-name');
  const container = document.getElementById('timeline-container');

  if (!constructionActive || constructionStages.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  slider.max = constructionStages.length - 1;
  slider.value = currentStageIndex >= 0 ? currentStageIndex : 0;

  if (currentStageIndex >= 0 && currentStageIndex < constructionStages.length) {
    label.textContent = constructionStages[currentStageIndex].name;
  } else {
    label.textContent = '';
  }
}

function enterTopoMode() {
  if (modalActive) exitModalMode();
  if (influenceActive) exitInfluenceMode();
  if (constructionActive) exitConstructionMode();
  if (sectionStressActive) hideSectionStressView();

  topoActive = true;
  topoStep = 'drawDomain';
  topoDomain = null;
  topoOptimizer = null;
  topoRunning = false;
  topoForces = [];

  renderer.topoData = null;
  renderer.topoDragRect = null;
  renderer.topoHoverDensity = null;

  document.getElementById('topo-section').style.display = 'block';
  document.getElementById('btn-topo').classList.add('active');
  document.getElementById('topo-setup').style.display = 'block';
  document.getElementById('topo-edge-config').style.display = 'none';
  document.getElementById('topo-force-config').style.display = 'none';
  document.getElementById('topo-progress').style.display = 'none';
  document.getElementById('topo-result').style.display = 'none';
  document.getElementById('topo-start').disabled = true;
  document.getElementById('topo-step-hint').textContent = '1. 在画布上拖拽出设计域矩形';

  document.getElementById('topo-fix-left').checked = false;
  document.getElementById('topo-fix-right').checked = false;
  document.getElementById('topo-fix-top').checked = false;
  document.getElementById('topo-fix-bottom').checked = false;
  document.getElementById('topo-force-list').innerHTML = '';

  canvas.style.cursor = 'crosshair';
  render();
  updateStatus('拓扑优化模式: 请在画布上拖拽出矩形设计域');
}

function exitTopoMode() {
  stopTopoOptimization();
  topoActive = false;
  topoStep = 'idle';
  topoDomain = null;
  topoOptimizer = null;
  topoRunning = false;
  topoForces = [];

  renderer.topoData = null;
  renderer.topoDragRect = null;
  renderer.topoHoverDensity = null;

  document.getElementById('topo-section').style.display = 'none';
  document.getElementById('btn-topo').classList.remove('active');
  canvas.style.cursor = 'crosshair';
  render();
}

function restartTopoOptimization() {
  stopTopoOptimization();
  topoOptimizer = null;
  topoRunning = false;

  renderer.topoHoverDensity = null;

  document.getElementById('topo-setup').style.display = 'block';
  document.getElementById('topo-edge-config').style.display = 'block';
  document.getElementById('topo-force-config').style.display = 'block';
  document.getElementById('topo-progress').style.display = 'none';
  document.getElementById('topo-result').style.display = 'none';
  document.getElementById('topo-step-hint').textContent = '2. 调整参数后重新开始优化';

  topoStep = 'addForce';
  canvas.style.cursor = 'crosshair';

  updateTopoVisualization();
  checkTopoCanStart();
  render();
  updateStatus('已重置优化结果，可调整参数后重新开始');
}

function resetTopoDomain() {
  stopTopoOptimization();
  topoDomain = null;
  topoOptimizer = null;
  topoStep = 'drawDomain';
  topoForces = [];

  renderer.topoData = null;
  renderer.topoDragRect = null;
  renderer.topoHoverDensity = null;

  document.getElementById('topo-setup').style.display = 'block';
  document.getElementById('topo-edge-config').style.display = 'none';
  document.getElementById('topo-force-config').style.display = 'none';
  document.getElementById('topo-progress').style.display = 'none';
  document.getElementById('topo-result').style.display = 'none';
  document.getElementById('topo-start').disabled = true;
  document.getElementById('topo-step-hint').textContent = '1. 在画布上拖拽出设计域矩形';

  document.getElementById('topo-fix-left').checked = false;
  document.getElementById('topo-fix-right').checked = false;
  document.getElementById('topo-fix-top').checked = false;
  document.getElementById('topo-fix-bottom').checked = false;
  document.getElementById('topo-force-list').innerHTML = '';

  canvas.style.cursor = 'crosshair';
  render();
}

function updateTopoForceList() {
  const container = document.getElementById('topo-force-list');
  container.innerHTML = '';
  topoForces.forEach((f, idx) => {
    const item = document.createElement('div');
    item.className = 'topo-force-item';
    const dirLabel = f.fy > 0 ? '↓' : f.fx > 0 ? '→' : '←';
    item.innerHTML = `力${idx + 1}: ${dirLabel} ${(Math.abs(f.fy || f.fx) / 1000).toFixed(1)}kN`;
    const del = document.createElement('span');
    del.className = 'topo-force-item-delete';
    del.textContent = '×';
    del.onclick = (e) => {
      e.stopPropagation();
      topoForces.splice(idx, 1);
      updateTopoForceList();
      updateTopoVisualization();
    };
    item.appendChild(del);
    container.appendChild(item);
  });
}

function getTopoFixedEdges() {
  return {
    left: document.getElementById('topo-fix-left').checked,
    right: document.getElementById('topo-fix-right').checked,
    top: document.getElementById('topo-fix-top').checked,
    bottom: document.getElementById('topo-fix-bottom').checked
  };
}

function updateTopoVisualization() {
  if (!topoDomain) {
    renderer.topoData = null;
    render();
    return;
  }

  const fixedEdges = getTopoFixedEdges();
  const nx = Math.max(20, parseInt(document.getElementById('topo-nx').value) || 40);
  const ny = Math.max(10, parseInt(document.getElementById('topo-ny').value) || 20);
  const elemW = topoDomain.width / nx;
  const elemH = topoDomain.height / ny;

  let density = null;
  if (topoOptimizer) {
    const field = topoOptimizer.getDensityField();
    density = field.density;
  } else {
    density = new Float64Array(nx * ny).fill(parseFloat(document.getElementById('topo-volfrac').value) || 0.4);
  }

  renderer.topoData = {
    nx,
    ny,
    originX: topoDomain.originX,
    originY: topoDomain.originY,
    elemW,
    elemH,
    density,
    fixedEdges,
    forces: topoForces
  };

  render();
}

function startTopoOptimization() {
  if (!topoDomain) return;

  const fixedEdges = getTopoFixedEdges();
  const hasFixed = fixedEdges.left || fixedEdges.right || fixedEdges.top || fixedEdges.bottom;
  if (!hasFixed) {
    alert('请至少选择一条固定边');
    return;
  }
  if (topoForces.length === 0) {
    alert('请至少添加一个集中力');
    return;
  }

  const nx = Math.max(20, parseInt(document.getElementById('topo-nx').value) || 40);
  const ny = Math.max(10, parseInt(document.getElementById('topo-ny').value) || 20);
  document.getElementById('topo-nx').value = nx;
  document.getElementById('topo-ny').value = ny;
  const volFrac = parseFloat(document.getElementById('topo-volfrac').value) || 0.4;

  topoOptimizer = new TopoOptimizer({
    nx,
    ny,
    pixelWidth: topoDomain.width,
    pixelHeight: topoDomain.height,
    originX: topoDomain.originX,
    originY: topoDomain.originY,
    E: 200e9,
    nu: 0.3,
    p: 3,
    volFrac,
    thickness: 1,
    fixedEdges,
    forces: topoForces.map(f => ({
      x: f.x,
      y: f.y,
      fx: f.fx || 0,
      fy: f.fy || 0
    }))
  });

  topoRunning = true;
  document.getElementById('topo-setup').style.display = 'none';
  document.getElementById('topo-progress').style.display = 'block';
  document.getElementById('topo-result').style.display = 'none';

  runTopoIteration();
}

function runTopoIteration() {
  if (!topoRunning || !topoOptimizer) return;

  let iterCount = 0;
  const batchSize = 1;

  const doStep = () => {
    if (!topoRunning || !topoOptimizer) return;

    const canContinue = topoOptimizer.step();
    iterCount++;

    const field = topoOptimizer.getDensityField();
    renderer.topoData = {
      nx: field.nx,
      ny: field.ny,
      originX: field.originX,
      originY: field.originY,
      elemW: field.elemW,
      elemH: field.elemH,
      density: field.density,
      fixedEdges: getTopoFixedEdges(),
      forces: topoForces
    };

    if (iterCount % 5 === 0 || !canContinue) {
      render();
    }

    document.getElementById('topo-iter').textContent = topoOptimizer.iteration;
    document.getElementById('topo-compliance').textContent = topoOptimizer.compliance.toExponential(4);
    document.getElementById('topo-current-vol').textContent = topoOptimizer.currentVolFrac.toFixed(4);
    document.getElementById('topo-max-change').textContent = topoOptimizer.maxChange.toFixed(6);

    if (!canContinue) {
      topoRunning = false;
      document.getElementById('topo-progress').style.display = 'none';
      document.getElementById('topo-result').style.display = 'block';
      document.getElementById('topo-final-iter').textContent = topoOptimizer.iteration;
      document.getElementById('topo-final-compliance').textContent = topoOptimizer.compliance.toExponential(4);
      document.getElementById('topo-final-vol').textContent = topoOptimizer.currentVolFrac.toFixed(4);
      render();
      updateStatus(`拓扑优化完成: ${topoOptimizer.iteration}次迭代, 柔度=${topoOptimizer.compliance.toExponential(4)}`);
      return;
    }

    topoTimer = setTimeout(doStep, 0);
  };

  topoTimer = setTimeout(doStep, 0);
}

function stopTopoOptimization() {
  topoRunning = false;
  if (topoTimer) {
    clearTimeout(topoTimer);
    topoTimer = null;
  }
}

function isInsideTopoDomain(x, y) {
  if (!topoDomain) return false;
  return x >= topoDomain.originX && x <= topoDomain.originX + topoDomain.width &&
    y >= topoDomain.originY && y <= topoDomain.originY + topoDomain.height;
}

function findTopoEdge(x, y) {
  if (!topoDomain) return null;
  const d = topoDomain;
  const tol = 10;
  const x0 = d.originX, y0 = d.originY;
  const x1 = d.originX + d.width, y1 = d.originY + d.height;
  if (x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol) {
    const dLeft = Math.abs(x - x0);
    const dRight = Math.abs(x - x1);
    const dTop = Math.abs(y - y0);
    const dBottom = Math.abs(y - y1);
    const minD = Math.min(dLeft, dRight, dTop, dBottom);
    if (minD <= tol) {
      if (minD === dLeft) return 'left';
      if (minD === dRight) return 'right';
      if (minD === dTop) return 'top';
      return 'bottom';
    }
  }
  return null;
}

function toggleTopoEdge(edge) {
  const cb = document.getElementById('topo-fix-' + edge);
  cb.checked = !cb.checked;
  updateTopoVisualization();
  checkTopoCanStart();
}

function addTopoForce(x, y) {
  const mag = parseFloat(document.getElementById('topo-force-value').value) || 10000;
  let fx = 0, fy = 0;
  if (topoForceDir === 'down') fy = mag;
  else if (topoForceDir === 'left') fx = -mag;
  else if (topoForceDir === 'right') fx = mag;

  topoForces.push({ x, y, fx, fy });
  updateTopoForceList();
  updateTopoVisualization();

  const canStart = topoDomain &&
    (getTopoFixedEdges().left || getTopoFixedEdges().right ||
      getTopoFixedEdges().top || getTopoFixedEdges().bottom) &&
    topoForces.length > 0;
  document.getElementById('topo-start').disabled = !canStart;
}

function checkTopoCanStart() {
  if (!topoDomain) {
    document.getElementById('topo-start').disabled = true;
    return;
  }
  const hasFixed = getTopoFixedEdges().left || getTopoFixedEdges().right ||
    getTopoFixedEdges().top || getTopoFixedEdges().bottom;
  document.getElementById('topo-start').disabled = !(hasFixed && topoForces.length > 0);
}

function init() {
  renderer.resize();

  let loaded = false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      if (!data.analysisMode) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        loaded = loadFromStorage();
      }
    }
  } catch (e) {
    localStorage.removeItem(STORAGE_KEY);
  }

  if (!loaded) {
    const portal = createPortalFrame();
    nodes = portal.nodes;
    members = portal.members;
    analysisMode = 'frame';
    renderer.analysisMode = 'frame';
    loadCases = createFrameLoadCases(nodes, members);
    currentLoadCaseId = loadCases[0].id;
    applyLoadCaseToNodes(getCurrentLoadCase());

    constructionStages = createConstructionStagePreset(members);

    try {
      solveCurrentLoadCase();
    } catch (e) {
      console.warn('初始求解失败:', e.message);
    }

    try {
      startModalAnalysis();
    } catch (e) {
      console.warn('初始模态分析失败:', e.message);
    }
  } else {
    updateEnvelopeIfNeeded();
  }

  const frameSection = document.getElementById('frame-diagram-section');
  frameSection.style.display = analysisMode === 'frame' ? 'block' : 'none';

  historyManager.saveState(nodes, members);

  render();
  updateLoadCaseList();
  updateButtonStates();
  updateResultsDisplay();
  updateAnalysisModeButtons();
  updateForceDiagramButtons();
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
  if (sectionStressActive) hideSectionStressView();
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
    memberIdsToDelete.forEach(memberId => {
      if (lc.memberLoads) delete lc.memberLoads[memberId];
    });
    lc.solved = false;
    lc.results = null;
  });

  selectedNodes.clear();
  selectedMembers.clear();

  hasResults = false;
  renderer.hasResults = false;
  frameResults = null;
  renderer.frameResults = null;

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
    if (analysisMode === 'frame') {
      addMenuItem(menuItems, '设置为固定支座', () => setSupport(node, 'fixed'));
    }
    addMenuSeparator(menuItems);
    addMenuItem(menuItems, '施加外力...', () => showLoadDialog(node));
    addMenuSeparator(menuItems);
    addMenuItem(menuItems, '删除节点', () => deleteNode(node));
  } else if (target.type === 'member') {
    const member = target.element;
    addMenuItem(menuItems, '设置材料属性...', () => showMemberDialog(member));
    addMenuItem(menuItems, '设置密度...', () => showDensityDialog(member));
    if (analysisMode === 'frame') {
      addMenuSeparator(menuItems);
      addMenuItem(menuItems, member.release1 ? '1端: 恢复刚接' : '1端: 释放为铰接', () => toggleEndRelease(member, 'release1'));
      addMenuItem(menuItems, member.release2 ? '2端: 恢复刚接' : '2端: 释放为铰接', () => toggleEndRelease(member, 'release2'));
      addMenuSeparator(menuItems);
      addMenuItem(menuItems, '设置均布荷载...', () => showUniformLoadDialog(member));
    }
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
  frameResults = null;
  renderer.frameResults = null;
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

function toggleEndRelease(member, releaseProp) {
  member[releaseProp] = !member[releaseProp];
  loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
  hasResults = false;
  renderer.hasResults = false;
  frameResults = null;
  renderer.frameResults = null;
  envelopeData = null;
  renderer.envelopeData = null;
  historyManager.saveState(nodes, members);
  render();
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
  frameResults = null;
  renderer.frameResults = null;
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
    if (lc.memberLoads) delete lc.memberLoads[member.id];
    lc.solved = false;
    lc.results = null;
  });

  hasResults = false;
  renderer.hasResults = false;
  frameResults = null;
  renderer.frameResults = null;
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
    ${analysisMode === 'frame' ? `
    <div class="form-group">
      <label>弯矩 M (N·m)</label>
      <input type="number" id="input-m" value="${node.m || 0}" />
    </div>` : ''}
    <p style="font-size:12px;color:#666;">正值向右/向上，负值向左/向下</p>
    <p style="font-size:12px;color:#1976d2;margin-top:8px;">当前工况: ${getCurrentLoadCase()?.name || ''}</p>
  `;

  showModal('施加外力', html, () => {
    node.fx = parseFloat(document.getElementById('input-fx').value) || 0;
    node.fy = parseFloat(document.getElementById('input-fy').value) || 0;
    if (analysisMode === 'frame') {
      node.m = parseFloat(document.getElementById('input-m').value) || 0;
    }
    saveCurrentLoadCaseFromNodes();
    loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
    hasResults = false;
    renderer.hasResults = false;
    frameResults = null;
    renderer.frameResults = null;
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

  let html = `
    <div class="form-group">
      <label>弹性模量 E (GPa)</label>
      <input type="number" id="input-e" value="${eGpa}" step="1" min="0" />
    </div>
    <div class="form-group">
      <label>截面积 A (cm²)</label>
      <input type="number" id="input-a" value="${aCm2}" step="0.1" min="0" />
    </div>
  `;

  if (analysisMode === 'frame') {
    const iCm4 = member.I * 1e8;
    html += `
    <div class="form-group">
      <label>惯性矩 I (cm⁴)</label>
      <input type="number" id="input-i" value="${iCm4}" step="0.1" min="0" />
    </div>
    <div class="form-group">
      <label>截面高度 h (cm)</label>
      <input type="number" id="input-h" value="${(member.h * 100).toFixed(1)}" step="0.5" min="0.1" />
    </div>
    `;
  } else {
    html += `
    <div class="form-group">
      <label>截面高度 h (cm)</label>
      <input type="number" id="input-h" value="${(member.h * 100).toFixed(1)}" step="0.5" min="0.1" />
    </div>
    `;
  }

  html += `
    <div class="form-group">
      <label>密度 ρ (kg/m³)</label>
      <input type="number" id="input-rho" value="${member.rho || 7850}" step="10" min="0" />
    </div>
  `;

  showModal('杆件属性', html, () => {
    member.E = (parseFloat(document.getElementById('input-e').value) || 200) * 1e9;
    member.A = (parseFloat(document.getElementById('input-a').value) || 10) * 1e-4;
    if (analysisMode === 'frame') {
      member.I = (parseFloat(document.getElementById('input-i').value) || 1) * 1e-8;
    }
    const hInput = document.getElementById('input-h');
    if (hInput) {
      member.h = (parseFloat(hInput.value) || 20) * 1e-2;
    }
    member.rho = parseFloat(document.getElementById('input-rho').value) || 7850;
    loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
    hasResults = false;
    renderer.hasResults = false;
    frameResults = null;
    renderer.frameResults = null;
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

function showUniformLoadDialog(member) {
  const html = `
    <div class="form-group">
      <label>均布荷载 q (N/m)</label>
      <input type="number" id="input-q" value="${member.q || 0}" step="100" />
    </div>
    <p style="font-size:12px;color:#666;">正值沿杆件局部y轴正方向（垂直于杆件，向"左"侧）</p>
  `;

  showModal('均布荷载', html, () => {
    member.q = parseFloat(document.getElementById('input-q').value) || 0;
    saveCurrentLoadCaseFromNodes();
    loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
    hasResults = false;
    renderer.hasResults = false;
    frameResults = null;
    renderer.frameResults = null;
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

function showDensityDialog(member) {
  const html = `
    <div class="form-group">
      <label>密度 ρ (kg/m³)</label>
      <input type="number" id="input-density" value="${member.rho || 7850}" step="10" min="0" />
    </div>
    <p style="font-size:12px;color:#666;">钢材默认7850 kg/m³, 修改密度后需重新运行模态分析</p>
  `;

  showModal('设置密度', html, () => {
    member.rho = parseFloat(document.getElementById('input-density').value) || 7850;
    historyManager.saveState(nodes, members);
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

    if (analysisMode === 'frame' && hasResults && frameResults) {
      const mr = frameResults.members.find(m => m.id === member.id);
      if (mr) {
        html += `轴力1: ${(mr.N1 / 1000).toFixed(2)} kN<br/>`;
        html += `剪力1: ${(mr.V1 / 1000).toFixed(2)} kN<br/>`;
        html += `弯矩1: ${(mr.M1 / 1000).toFixed(2)} kN·m<br/>`;
        html += `轴力2: ${(mr.N2 / 1000).toFixed(2)} kN<br/>`;
        html += `剪力2: ${(mr.V2 / 1000).toFixed(2)} kN<br/>`;
        html += `弯矩2: ${(mr.M2 / 1000).toFixed(2)} kN·m<br/>`;
        if (member.q) {
          html += `均布荷载: ${(member.q / 1000).toFixed(1)} kN/m<br/>`;
        }
        html += `长度: ${member.length.toFixed(1)} mm<br/>`;
        if (member.release1) html += `<span style="color:#ff9800;">1端铰接</span><br/>`;
        if (member.release2) html += `<span style="color:#ff9800;">2端铰接</span><br/>`;

        const n1 = nodes.find(n => n.id === member.node1Id);
        const n2 = nodes.find(n => n.id === member.node2Id);
        if (n1 && n2) {
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            const param = pointToLineDistance(pos.x, pos.y, n1.x, n1.y, n2.x, n2.y) > 0 ? -1 : -1;
            const A = pos.x - n1.x;
            const B = pos.y - n1.y;
            const C = n2.x - n1.x;
            const D = n2.y - n1.y;
            const dot = A * C + B * D;
            const lenSq = C * C + D * D;
            let t = lenSq > 0 ? dot / lenSq : 0;
            t = Math.max(0, Math.min(1, t));

            const L = member.length * 0.01;
            const x = t * L;
            const M_at = mr.M1 * (1 - t) + mr.M2 * t + (member.q || 0) * x * (L - x) / 2;
            const V_at = mr.V1 - (member.q || 0) * t * L;
            const N_at = mr.N1 * (1 - t) + mr.N2 * t;

            html += `<br/><strong>位置 t=${(t * 100).toFixed(0)}%:</strong><br/>`;
            html += `M=${(M_at / 1000).toFixed(2)} kN·m<br/>`;
            html += `V=${(V_at / 1000).toFixed(2)} kN<br/>`;
            html += `N=${(N_at / 1000).toFixed(2)} kN`;
          }
        }
      }
    } else if (viewMode === 'envelope' && envelopeData) {
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
      if (analysisMode === 'frame' && member.q) {
        html += `均布荷载: ${(member.q / 1000).toFixed(1)} kN/m<br/>`;
      }
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

  if (analysisMode === 'frame' && frameResults) {
    html += '<div class="result-item"><strong>节点位移</strong></div>';
    nodes.forEach(node => {
      html += `<div class="result-item">`;
      html += `节点 #${node.id}: `;
      html += `dx=${(node.dx * 1000).toFixed(4)}mm, `;
      html += `dy=${(node.dy * 1000).toFixed(4)}mm, `;
      html += `θ=${((node.dtheta || 0) * 1000).toFixed(4)}mrad`;
      html += `</div>`;
    });

    html += '<div class="result-item"><strong>杆端内力</strong></div>';
    frameResults.members.forEach(mr => {
      const member = members.find(m => m.id === mr.id);
      html += `<div class="result-item">`;
      html += `<strong>杆件 #${mr.id}</strong><br/>`;
      html += `1端: N=${(mr.N1 / 1000).toFixed(2)}kN, V=${(mr.V1 / 1000).toFixed(2)}kN, M=${(mr.M1 / 1000).toFixed(2)}kN·m<br/>`;
      html += `2端: N=${(mr.N2 / 1000).toFixed(2)}kN, V=${(mr.V2 / 1000).toFixed(2)}kN, M=${(mr.M2 / 1000).toFixed(2)}kN·m`;
      if (member && member.q) {
        html += `<br/>q=${(member.q / 1000).toFixed(1)}kN/m`;
      }
      html += `</div>`;
    });
  } else {
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
  }

  container.innerHTML = html;
}

function updateButtonStates() {
  document.getElementById('btn-undo').disabled = !historyManager.canUndo();
  document.getElementById('btn-redo').disabled = !historyManager.canRedo();
  document.getElementById('btn-report').disabled = !hasResults && loadCases.filter(lc => lc.solved).length === 0;
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
      m: n.m,
      dx: n.dx,
      dy: n.dy,
      dtheta: n.dtheta
    })),
    members: members.map(m => ({
      id: m.id,
      node1Id: m.node1Id,
      node2Id: m.node2Id,
      length: m.length,
      angle: m.angle,
      E: m.E,
      A: m.A,
      I: m.I,
      release1: m.release1,
      release2: m.release2,
      q: m.q,
      rho: m.rho,
      axialForce: m.axialForce,
      stress: m.stress
    })),
    loadCases: loadCases,
    currentLoadCaseId,
    analysisMode,
    solved: hasResults,
    maxForce: maxForce,
    maxMoment: maxMoment
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${analysisMode === 'frame' ? 'frame' : 'truss'}-analysis.json`;
  a.click();
  URL.revokeObjectURL(url);
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;

  hideContextMenu();

  const pos = getMousePos(e);

  if (influenceActive && influenceStep === 'selectSection') {
    const member = findMemberAt(pos.x, pos.y);
    if (member) {
      selectInfluenceSection(member, pos.x, pos.y);
      return;
    }
  }

  if (influenceActive) return;

  if (topoActive && !topoRunning) {
    if (topoStep === 'drawDomain') {
      topoDragStart = { x: pos.x, y: pos.y };
      topoDragEnd = { x: pos.x, y: pos.y };
      mouseState.isDown = true;
      mouseState.mode = 'topoDragDomain';
      return;
    }
    if (topoDomain) {
      const edge = findTopoEdge(pos.x, pos.y);
      if (edge) {
        toggleTopoEdge(edge);
        return;
      }
    }
    if ((topoStep === 'setEdges' || topoStep === 'addForce') && isInsideTopoDomain(pos.x, pos.y)) {
      addTopoForce(pos.x, pos.y);
      return;
    }
  }

  if (topoActive) return;

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
    if (member.selected && hasResults) {
      showSectionStressView(member);
    } else if (!member.selected && sectionStressMemberId === member.id) {
      hideSectionStressView();
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

  if (!influenceActive && !topoActive) {
    updateTooltip(e);
  }

  if (topoActive && !topoRunning && topoDomain) {
    const edge = findTopoEdge(pos.x, pos.y);
    if (edge) {
      canvas.style.cursor = 'pointer';
      renderer.topoHoverEdge = edge;
    } else if (topoStep === 'setEdges' || topoStep === 'addForce') {
      canvas.style.cursor = isInsideTopoDomain(pos.x, pos.y) ? 'crosshair' : 'default';
      renderer.topoHoverEdge = null;
    } else {
      renderer.topoHoverEdge = null;
    }
  }

  if (topoActive && topoOptimizer && !topoRunning) {
    if (isInsideTopoDomain(pos.x, pos.y)) {
      const info = topoOptimizer.getDensityAt(pos.x, pos.y);
      renderer.topoHoverDensity = info;
    } else {
      renderer.topoHoverDensity = null;
    }
    render();
  }

  if (topoActive && mouseState.mode === 'topoDragDomain' && mouseState.isDown) {
    topoDragEnd = { x: pos.x, y: pos.y };
    renderer.topoDragRect = {
      startX: topoDragStart.x,
      startY: topoDragStart.y,
      endX: topoDragEnd.x,
      endY: topoDragEnd.y
    };
    render();
    return;
  }

  if (influenceActive) return;

  if (topoActive) return;

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
    frameResults = null;
    renderer.frameResults = null;
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

  if (influenceActive) return;

  if (mouseState.mode === 'topoDragDomain' && topoDragStart && topoDragEnd) {
    const x1 = Math.min(topoDragStart.x, topoDragEnd.x);
    const y1 = Math.min(topoDragStart.y, topoDragEnd.y);
    const x2 = Math.max(topoDragStart.x, topoDragEnd.x);
    const y2 = Math.max(topoDragStart.y, topoDragEnd.y);
    const w = x2 - x1;
    const h = y2 - y1;

    if (w > 40 && h > 20) {
      topoDomain = { originX: x1, originY: y1, width: w, height: h };
      topoStep = 'setEdges';
      renderer.topoDragRect = null;

      document.getElementById('topo-edge-config').style.display = 'block';
      document.getElementById('topo-force-config').style.display = 'block';
      document.getElementById('topo-step-hint').textContent = '2. 设置边界条件和力，然后开始优化';

      updateTopoVisualization();
      updateStatus('设计域已创建，请设置边界条件（固定边）和集中力');
    } else {
      renderer.topoDragRect = null;
      render();
      updateStatus('设计域太小，请重新拖拽');
    }

    mouseState.isDown = false;
    mouseState.mode = null;
    topoDragStart = null;
    topoDragEnd = null;
    return;
  }

  if (topoActive) return;

  const pos = getMousePos(e);

  if (mouseState.mode === 'createNode' && !mouseState.hasMoved) {
    const newNode = createNode(pos.x, pos.y);
    nodes.push(newNode);

    loadCases.forEach(lc => {
      lc.nodeLoads[newNode.id] = { fx: 0, fy: 0, m: 0 };
      lc.solved = false;
      lc.results = null;
    });

    hasResults = false;
    renderer.hasResults = false;
    frameResults = null;
    renderer.frameResults = null;
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

        loadCases.forEach(lc => {
          if (!lc.memberLoads) lc.memberLoads = {};
          lc.memberLoads[newMember.id] = { q: 0 };
          lc.solved = false;
          lc.results = null;
        });

        hasResults = false;
        renderer.hasResults = false;
        frameResults = null;
        renderer.frameResults = null;
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
  if (influenceActive) { e.preventDefault(); return; }
  if (topoActive) { e.preventDefault(); return; }
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
  if (influenceActive) return;
  if (topoActive) return;
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
      frameResults = null;
      renderer.frameResults = null;
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
      frameResults = null;
      renderer.frameResults = null;
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

document.getElementById('btn-modal').addEventListener('click', () => {
  if (modalActive) {
    exitModalMode();
  } else {
    startModalAnalysis();
  }
});

document.getElementById('btn-modal-close').addEventListener('click', exitModalMode);

document.getElementById('btn-influence').addEventListener('click', () => {
  if (influenceActive) {
    exitInfluenceMode();
  } else {
    enterInfluenceMode();
  }
});

document.getElementById('btn-influence-exit').addEventListener('click', exitInfluenceMode);

document.getElementById('btn-influence-calc').addEventListener('click', () => {
  influenceResponseType = document.getElementById('influence-response-type').value;
  computeInfluenceLine();
});

document.getElementById('influence-response-type').addEventListener('change', (e) => {
  influenceResponseType = e.target.value;
});

const influenceCanvas = document.getElementById('influence-canvas');
influenceCanvas.addEventListener('mousemove', (e) => {
  if (!influenceData || !influenceData.points.length) return;

  const rect = influenceCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const W = influenceCanvas.width;
  const H = influenceCanvas.height;
  const margin = { left: 60, right: 30, top: 20, bottom: 30 };
  const plotW = W - margin.left - margin.right;

  const pts = influenceData.points;
  const minX = pts[0].x;
  const maxX = pts[pts.length - 1].x;
  const rangeX = maxX - minX || 1;

  if (mx < margin.left || mx > W - margin.right) {
    if (influenceHoverIdx !== -1) {
      influenceHoverIdx = -1;
      renderer.influenceForcePosition = null;
      renderer.influenceResponseValue = null;
      drawInfluenceLine();
      render();
    }
    return;
  }

  const dataX = minX + ((mx - margin.left) / plotW) * rangeX;
  let closestIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(pts[i].x - dataX);
    if (d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  }

  if (closestIdx !== influenceHoverIdx) {
    influenceHoverIdx = closestIdx;
    renderer.influenceForcePosition = { x: pts[closestIdx].x, y: 0 };
    renderer.influenceResponseValue = pts[closestIdx].value;
    drawInfluenceLine();
    render();
  }
});

influenceCanvas.addEventListener('mouseleave', () => {
  if (influenceHoverIdx !== -1) {
    influenceHoverIdx = -1;
    renderer.influenceForcePosition = null;
    renderer.influenceResponseValue = null;
    drawInfluenceLine();
    render();
  }
});

document.getElementById('modal-scale-factor').addEventListener('change', (e) => {
  modalScaleFactor = parseFloat(e.target.value) || 50;
});

document.getElementById('modal-num-modes').addEventListener('change', () => {
  if (modalActive) {
    startModalAnalysis();
  }
});

document.getElementById('btn-view-single').addEventListener('click', () => setViewMode('single'));
document.getElementById('btn-view-envelope').addEventListener('click', () => setViewMode('envelope'));

document.getElementById('btn-mode-truss').addEventListener('click', () => setAnalysisMode('truss'));
document.getElementById('btn-mode-frame').addEventListener('click', () => setAnalysisMode('frame'));

document.getElementById('btn-diagram-moment').addEventListener('click', () => setForceDiagramType('moment'));
document.getElementById('btn-diagram-shear').addEventListener('click', () => setForceDiagramType('shear'));
document.getElementById('btn-diagram-axial').addEventListener('click', () => setForceDiagramType('axial'));

document.getElementById('btn-add-loadcase').addEventListener('click', () => {
  const name = prompt('请输入工况名称:', `工况${loadCases.length + 1}`);
  if (name && name.trim()) {
    addLoadCase(name.trim());
  }
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (confirm('确定要清空所有内容吗？')) {
    if (modalActive) exitModalMode();
    if (influenceActive) exitInfluenceMode();
    if (constructionActive) exitConstructionMode();
    if (topoActive) exitTopoMode();
    constructionStages = [];
    currentStageIndex = -1;
    nodes = [];
    members = [];
    loadCases = [createLoadCase('默认工况')];
    currentLoadCaseId = loadCases[0].id;
    hasResults = false;
    renderer.hasResults = false;
    frameResults = null;
    renderer.frameResults = null;
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
    frameResults = null;
    renderer.frameResults = null;
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
    frameResults = null;
    renderer.frameResults = null;
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

document.getElementById('btn-report').addEventListener('click', generateReport);

document.getElementById('btn-close-report').addEventListener('click', () => {
  document.getElementById('report-overlay').classList.add('hidden');
});

document.getElementById('btn-print-report').addEventListener('click', () => {
  window.print();
});

document.getElementById('scale-factor').addEventListener('change', (e) => {
  renderer.displacementScale = parseFloat(e.target.value) || 100;
  render();
});

document.getElementById('btn-section-stress-close').addEventListener('click', hideSectionStressView);

const sectionStressCanvas = document.getElementById('section-stress-canvas');
sectionStressCanvas.addEventListener('mousemove', (e) => {
  updateSectionStressTooltip(e);
  if (sectionStressDragging) {
    const dx = e.clientX - sectionStressDragStartX;
    const dy = e.clientY - sectionStressDragStartY;
    sectionStressPanX = sectionStressDragStartPanX + dx;
    sectionStressPanY = sectionStressDragStartPanY + dy;
    drawSectionStressCloud();
  }
});

sectionStressCanvas.addEventListener('mouseleave', () => {
  document.getElementById('section-stress-tooltip').classList.add('hidden');
  sectionStressDragging = false;
});

sectionStressCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  sectionStressDragging = true;
  sectionStressDragStartX = e.clientX;
  sectionStressDragStartY = e.clientY;
  sectionStressDragStartPanX = sectionStressPanX;
  sectionStressDragStartPanY = sectionStressPanY;
  e.preventDefault();
});

window.addEventListener('mouseup', (e) => {
  if (sectionStressDragging) {
    sectionStressDragging = false;
  }
});

sectionStressCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const oldZoom = sectionStressZoom;
  sectionStressZoom = Math.max(0.5, Math.min(5, sectionStressZoom * delta));

  const rect = sectionStressCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const margin = { left: 55, right: 20, top: 25, bottom: 35 };
  const plotMX = mx - margin.left - sectionStressPanX;
  const plotMY = my - margin.top - sectionStressPanY;

  const zoomRatio = sectionStressZoom / oldZoom;
  sectionStressPanX -= plotMX * (zoomRatio - 1);
  sectionStressPanY -= plotMY * (zoomRatio - 1);

  drawSectionStressCloud();
}, { passive: false });

window.addEventListener('resize', () => {
  renderer.resize();
  if (influenceActive) {
    resizeInfluenceCanvas();
    if (influenceData) drawInfluenceLine();
  }
  if (sectionStressActive) {
    resizeSectionStressCanvas();
    drawSectionStressCloud();
  }
  render();
});

function updateStatus(text) {
  const status = document.getElementById('status-bar');
  status.textContent = text;
  setTimeout(() => {
    status.textContent = '';
  }, 3000);
}

function enterInfluenceMode() {
  if (modalActive) exitModalMode();
  if (!loadCases.some(lc => lc.solved)) {
    alert('请先至少求解一个工况后再进入影响线模式');
    return;
  }
  influenceActive = true;
  influenceStep = 'selectSection';
  influenceSectionMemberId = null;
  influenceData = null;
  influenceHoverIdx = -1;
  renderer.influenceActive = true;
  renderer.influenceSectionMemberId = null;
  renderer.influenceSectionT = 0.5;
  renderer.influenceForcePosition = null;
  renderer.influenceResponseValue = null;

  document.getElementById('influence-panel').classList.remove('hidden');
  document.getElementById('btn-influence').classList.add('active');
  document.getElementById('influence-section-label').textContent = '点击杆件选择';
  document.getElementById('btn-influence-calc').disabled = true;

  const selectEl = document.getElementById('influence-response-type');
  selectEl.innerHTML = '';
  if (analysisMode === 'truss') {
    const opt = document.createElement('option');
    opt.value = 'axial';
    opt.textContent = '轴力';
    selectEl.appendChild(opt);
    influenceResponseType = 'axial';
  } else {
    const optA = document.createElement('option');
    optA.value = 'axial';
    optA.textContent = '轴力';
    selectEl.appendChild(optA);
    const optS = document.createElement('option');
    optS.value = 'shear';
    optS.textContent = '剪力';
    selectEl.appendChild(optS);
    const optM = document.createElement('option');
    optM.value = 'moment';
    optM.textContent = '弯矩';
    selectEl.appendChild(optM);
    influenceResponseType = 'moment';
  }

  resizeInfluenceCanvas();
  updateStatus('影响线模式: 请点击一根杆件选择观测截面');
  render();
}

function exitInfluenceMode() {
  influenceActive = false;
  influenceStep = 'idle';
  influenceSectionMemberId = null;
  influenceData = null;
  influenceHoverIdx = -1;
  renderer.influenceActive = false;
  renderer.influenceSectionMemberId = null;
  renderer.influenceForcePosition = null;
  renderer.influenceResponseValue = null;

  document.getElementById('influence-panel').classList.add('hidden');
  document.getElementById('btn-influence').classList.remove('active');
  render();
}

function resizeInfluenceCanvas() {
  const c = document.getElementById('influence-canvas');
  const panel = document.getElementById('influence-panel');
  const header = panel.querySelector('.influence-panel-header');
  c.width = panel.clientWidth;
  c.height = panel.clientHeight - header.offsetHeight;
}

function selectInfluenceSection(member, clickX, clickY) {
  const n1 = nodes.find(n => n.id === member.node1Id);
  const n2 = nodes.find(n => n.id === member.node2Id);
  if (!n1 || !n2) return;

  const dx = n2.x - n1.x;
  const dy = n2.y - n1.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((clickX - n1.x) * dx + (clickY - n1.y) * dy) / lenSq : 0.5;
  t = Math.max(0.01, Math.min(0.99, t));

  influenceSectionMemberId = member.id;
  influenceSectionT = t;
  influenceSectionX = n1.x + dx * t;
  influenceSectionY = n1.y + dy * t;
  influenceStep = 'ready';

  renderer.influenceSectionMemberId = member.id;
  renderer.influenceSectionT = t;

  const label = `杆件#${member.id} t=${(t * 100).toFixed(0)}%`;
  document.getElementById('influence-section-label').textContent = label;
  document.getElementById('btn-influence-calc').disabled = false;

  updateStatus(`观测截面已选: ${label}，选择响应量后点击"计算"`);
  render();
}

function computeInfluenceLine() {
  if (!influenceSectionMemberId) return;

  const sortedNodes = [...nodes].sort((a, b) => a.x - b.x);
  if (sortedNodes.length < 2) {
    alert('节点数不足，无法计算影响线');
    return;
  }

  const points = [];
  for (let i = 0; i < sortedNodes.length - 1; i++) {
    const nA = sortedNodes[i];
    const nB = sortedNodes[i + 1];
    const numInterp = 10;
    for (let j = 0; j <= numInterp; j++) {
      if (i > 0 && j === 0) continue;
      const t = j / numInterp;
      points.push({
        x: nA.x + (nB.x - nA.x) * t,
        nodeAId: nA.id,
        nodeBId: nB.id,
        t
      });
    }
  }

  const savedNodeLoads = {};
  nodes.forEach(n => {
    savedNodeLoads[n.id] = { fx: n.fx || 0, fy: n.fy || 0, m: n.m || 0 };
  });
  const savedMemberLoads = {};
  members.forEach(m => {
    savedMemberLoads[m.id] = { q: m.q || 0 };
  });

  influenceData = {
    points: [],
    responseType: influenceResponseType,
    sectionMemberId: influenceSectionMemberId,
    sectionT: influenceSectionT
  };

  const unitForce = 1000;

  for (const pt of points) {
    nodes.forEach(n => { n.fx = 0; n.fy = 0; n.m = 0; });
    members.forEach(m => { m.q = 0; });

    const nA = nodes.find(n => n.id === pt.nodeAId);
    const nB = nodes.find(n => n.id === pt.nodeBId);
    if (nA && nB && pt.t > 0 && pt.t < 1) {
      const ratioB = pt.t;
      const ratioA = 1 - pt.t;
      nA.fy = -unitForce * ratioA;
      nB.fy = -unitForce * ratioB;
    } else {
      const targetNode = pt.t === 0 ? nA : nB;
      if (targetNode) targetNode.fy = -unitForce;
    }

    let result;
    try {
      if (analysisMode === 'frame') {
        result = solveFrame(nodes, members);
      } else {
        result = solveTruss(nodes, members);
      }
    } catch (e) {
      influenceData.points.push({ x: pt.x, value: 0 });
      continue;
    }

    let value = 0;
    const mr = result.members.find(m => m.id === influenceSectionMemberId);
    if (mr) {
      if (analysisMode === 'truss') {
        value = mr.axialForce;
      } else {
        const t = influenceSectionT;
        const L = members.find(m => m.id === influenceSectionMemberId).length * 0.01;
        if (influenceResponseType === 'axial') {
          value = mr.N1 * (1 - t) + mr.N2 * t;
        } else if (influenceResponseType === 'shear') {
          value = mr.V1 * (1 - t) + mr.V2 * t;
        } else if (influenceResponseType === 'moment') {
          const x = t * L;
          value = mr.M1 * (1 - t) + mr.M2 * t;
        }
      }
    }

    influenceData.points.push({ x: pt.x, value });
  }

  nodes.forEach(n => {
    const saved = savedNodeLoads[n.id];
    if (saved) { n.fx = saved.fx; n.fy = saved.fy; n.m = saved.m; }
  });
  members.forEach(m => {
    const saved = savedMemberLoads[m.id];
    if (saved) { m.q = saved.q; }
  });

  const lc = getCurrentLoadCase();
  if (lc && lc.solved && lc.results) {
    restoreResults(lc.results);
  }

  influenceHoverIdx = -1;
  renderer.influenceForcePosition = null;
  renderer.influenceResponseValue = null;
  renderer._influenceResponseType = influenceResponseType;

  drawInfluenceLine();
  render();
  updateStatus('影响线计算完成');
}

function drawInfluenceLine() {
  if (!influenceData || !influenceData.points.length) return;

  const c = document.getElementById('influence-canvas');
  const ctx = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  if (W <= 0 || H <= 0) return;

  ctx.clearRect(0, 0, W, H);

  const margin = { left: 60, right: 30, top: 20, bottom: 30 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  if (plotW <= 0 || plotH <= 0) return;

  const pts = influenceData.points;
  const minX = pts[0].x;
  const maxX = pts[pts.length - 1].x;
  const rangeX = maxX - minX || 1;

  let maxVal = 0;
  let minVal = 0;
  for (const p of pts) {
    if (p.value > maxVal) maxVal = p.value;
    if (p.value < minVal) minVal = p.value;
  }
  const absMax = Math.max(Math.abs(maxVal), Math.abs(minVal), 1e-10);
  const valRange = Math.max(maxVal - minVal, absMax * 0.1);
  const valCenter = (maxVal + minVal) / 2;
  const halfRange = Math.max(valRange / 2, absMax * 0.6);

  const mapX = (x) => margin.left + ((x - minX) / rangeX) * plotW;
  const mapY = (v) => margin.top + plotH / 2 - (v / (halfRange * 2)) * plotH;

  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, mapY(0));
  ctx.lineTo(W - margin.right, mapY(0));
  ctx.stroke();

  for (let i = 1; i <= 4; i++) {
    const v = halfRange * 2 * (i / 4) * (i % 2 === 0 ? 1 : -1);
    const y = mapY(v);
    if (y > margin.top && y < margin.top + plotH) {
      ctx.strokeStyle = '#f0f0f0';
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(W - margin.right, y);
      ctx.stroke();
    }
  }

  const zeroY = mapY(0);

  ctx.beginPath();
  ctx.moveTo(mapX(pts[0].x), zeroY);
  for (let i = 0; i < pts.length; i++) {
    ctx.lineTo(mapX(pts[i].x), mapY(pts[i].value));
  }
  ctx.lineTo(mapX(pts[pts.length - 1].x), zeroY);
  ctx.closePath();

  ctx.save();
  ctx.clip();

  ctx.fillStyle = 'rgba(144, 202, 249, 0.4)';
  ctx.fillRect(margin.left, mapY(halfRange * 2), plotW, mapY(0) - mapY(halfRange * 2));

  ctx.fillStyle = 'rgba(239, 154, 154, 0.4)';
  ctx.fillRect(margin.left, mapY(0), plotW, mapY(-halfRange * 2) - mapY(0));

  ctx.restore();

  ctx.beginPath();
  ctx.strokeStyle = '#00695c';
  ctx.lineWidth = 2;
  for (let i = 0; i < pts.length; i++) {
    const px = mapX(pts[i].x);
    const py = mapY(pts[i].value);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  let maxPt = pts[0], minPt = pts[0];
  for (const p of pts) {
    if (p.value > maxPt.value) maxPt = p;
    if (p.value < minPt.value) minPt = p;
  }

  const drawAnnotation = (pt, label, color) => {
    const px = mapX(pt.x);
    const py = mapY(pt.value);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, margin.top);
    ctx.lineTo(px, margin.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    const valText = analysisMode === 'truss'
      ? `${(pt.value / 1000).toFixed(3)} kN`
      : influenceResponseType === 'moment'
        ? `${(pt.value / 1000).toFixed(3)} kN·m`
        : `${(pt.value / 1000).toFixed(3)} kN`;
    const yPos = py < margin.top + plotH / 2 ? py - 8 : py + 14;
    ctx.fillText(valText, px, yPos);
    ctx.font = '10px sans-serif';
    ctx.fillText(`x=${(pt.x * 0.01).toFixed(2)}m`, px, yPos + 13);
  };

  if (maxPt.value > 1e-10) drawAnnotation(maxPt, '最大值', '#1565c0');
  if (minPt.value < -1e-10) drawAnnotation(minPt, '最小值', '#c62828');

  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#666';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${(maxVal / 1000).toFixed(2)}`, margin.left - 6, mapY(maxVal));
  ctx.fillText(`${(minVal / 1000).toFixed(2)}`, margin.left - 6, mapY(minVal));
  ctx.fillText('0', margin.left - 6, zeroY);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xLabel = analysisMode === 'truss'
    ? '轴力 (kN)'
    : influenceResponseType === 'moment'
      ? '弯矩 (kN·m)'
      : influenceResponseType === 'shear'
        ? '剪力 (kN)'
        : '轴力 (kN)';
  ctx.fillText(xLabel, margin.left + plotW / 2, margin.top + plotH + 14);

  ctx.textBaseline = 'bottom';
  ctx.fillText('荷载位置 →', margin.left + plotW / 2, margin.top - 4);

  if (influenceHoverIdx >= 0 && influenceHoverIdx < pts.length) {
    const hp = pts[influenceHoverIdx];
    const hx = mapX(hp.x);
    const hy = mapY(hp.value);

    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#00695c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, margin.top);
    ctx.lineTo(hx, margin.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#00695c';
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fill();

    const hoverValText = analysisMode === 'truss'
      ? `${(hp.value / 1000).toFixed(3)} kN`
      : influenceResponseType === 'moment'
        ? `${(hp.value / 1000).toFixed(3)} kN·m`
        : `${(hp.value / 1000).toFixed(3)} kN`;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#004d40';
    ctx.fillText(hoverValText, hx + 8, hy - 4);
  }
}

function getSectionStressColor(stress, maxAbsStress) {
  if (maxAbsStress < 1e-6) return 'rgb(224,224,224)';
  const norm = Math.min(Math.abs(stress) / maxAbsStress, 1);
  if (stress >= 0) {
    const r = Math.round(224 - norm * 120);
    const g = Math.round(224 - norm * 80);
    const b = Math.round(224 + norm * 31);
    return `rgb(${r},${g},${b})`;
  } else {
    const r = Math.round(224 + norm * 30);
    const g = Math.round(224 - norm * 100);
    const b = Math.round(224 - norm * 120);
    return `rgb(${r},${g},${b})`;
  }
}

function showSectionStressView(member) {
  if (!hasResults) return;
  if (analysisMode !== 'frame') return;
  sectionStressActive = true;
  sectionStressMemberId = member.id;
  sectionStressZoom = 1;
  sectionStressPanX = 0;
  sectionStressPanY = 0;

  const panel = document.getElementById('section-stress-panel');
  panel.classList.remove('hidden');

  document.getElementById('section-stress-member-label').textContent =
    `杆件 #${member.id}  L=${(member.length * 0.01).toFixed(3)}m  h=${(member.h * 100).toFixed(1)}cm`;

  resizeSectionStressCanvas();
  drawSectionStressCloud();
}

function hideSectionStressView() {
  sectionStressActive = false;
  sectionStressMemberId = null;
  document.getElementById('section-stress-panel').classList.add('hidden');
}

function resizeSectionStressCanvas() {
  const c = document.getElementById('section-stress-canvas');
  const panel = document.getElementById('section-stress-panel');
  const header = panel.querySelector('.section-stress-header');
  const colorbar = panel.querySelector('.section-stress-colorbar');
  c.width = panel.clientWidth;
  c.height = panel.clientHeight - header.offsetHeight - colorbar.offsetHeight;
}

function computeMemberStressField(member, mr, numLengthSeg, numHeightSeg) {
  const L = member.length * 0.01;
  const h = member.h;
  const I = member.I;
  const A = member.A;
  const q = mr.q || 0;
  const M1 = mr.M1;
  const M2 = mr.M2;
  const N1 = mr.N1;
  const N2 = mr.N2;

  const field = [];

  for (let i = 0; i <= numLengthSeg; i++) {
    const t = i / numLengthSeg;
    const x = t * L;
    const row = [];

    let M, N;
    if (Math.abs(q) > 1e-10) {
      M = M1 * (1 - t) + M2 * t + q * x * (L - x) / 2;
    } else {
      M = M1 * (1 - t) + M2 * t;
    }
    N = N1 * (1 - t) + N2 * t;

    const sigmaAxial = N / A;

    for (let j = 0; j <= numHeightSeg; j++) {
      const s = j / numHeightSeg;
      const y = h / 2 - s * h;
      const sigmaBending = I > 0 ? M * y / I : 0;
      row.push(sigmaAxial + sigmaBending);
    }
    field.push(row);
  }

  return field;
}

function drawSectionStressCloud() {
  if (!sectionStressActive || !sectionStressMemberId) return;

  const member = members.find(m => m.id === sectionStressMemberId);
  if (!member) { hideSectionStressView(); return; }

  let mr = null;
  if (frameResults) {
    mr = frameResults.members.find(m => m.id === member.id);
  }

  if (!mr) { hideSectionStressView(); return; }

  const c = document.getElementById('section-stress-canvas');
  const ctx = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  if (W <= 0 || H <= 0) return;

  ctx.clearRect(0, 0, W, H);

  const L = member.length * 0.01;
  const h = member.h;

  const numLSeg = 60;
  const numHSeg = 30;
  const field = computeMemberStressField(member, mr, numLSeg, numHSeg);

  let maxAbsStress = 0;
  for (const row of field) {
    for (const s of row) {
      if (Math.abs(s) > maxAbsStress) maxAbsStress = Math.abs(s);
    }
  }
  if (maxAbsStress < 1e-3) maxAbsStress = 1;

  const margin = { left: 55, right: 20, top: 25, bottom: 35 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  const zoom = sectionStressZoom;
  const panX = sectionStressPanX;
  const panY = sectionStressPanY;

  const cellW = (plotW / numLSeg) * zoom;
  const cellH = (plotH / numHSeg) * zoom;

  const baseOffX = margin.left + panX;
  const baseOffY = margin.top + panY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotW, plotH);
  ctx.clip();

  for (let i = 0; i < numLSeg; i++) {
    for (let j = 0; j < numHSeg; j++) {
      const s0 = field[i][j];
      const s1 = field[i + 1][j];
      const s2 = field[i][j + 1];
      const s3 = field[i + 1][j + 1];
      const avg = (s0 + s1 + s2 + s3) / 4;

      const x = baseOffX + i * cellW;
      const y = baseOffY + j * cellH;

      ctx.fillStyle = getSectionStressColor(avg, maxAbsStress);
      ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5);

      if (Math.abs(avg) > YIELD_STRESS) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellW + 0.5, cellH + 0.5);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,235,59,0.7)';
        ctx.lineWidth = 1;
        const stripeW = 5;
        for (let d = -Math.max(cellW, cellH) * 2; d < Math.max(cellW, cellH) * 2; d += stripeW * 2) {
          ctx.beginPath();
          ctx.moveTo(x + d, y);
          ctx.lineTo(x + d + cellH, y + cellH);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  ctx.restore();

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    baseOffX,
    baseOffY,
    numLSeg * cellW,
    numHSeg * cellH
  );

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4, 4]);
  const neutralY = baseOffY + (numHSeg / 2) * cellH;
  if (neutralY > margin.top && neutralY < margin.top + plotH) {
    ctx.beginPath();
    ctx.moveTo(baseOffX, neutralY);
    ctx.lineTo(baseOffX + numLSeg * cellW, neutralY);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.fillStyle = '#b0bec5';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';

  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const x = baseOffX + t * numLSeg * cellW;
    if (x >= margin.left && x <= margin.left + plotW) {
      const val = (t * L).toFixed(2);
      ctx.fillText(`${val}`, x, margin.top + plotH + 12);
    }
  }

  ctx.textAlign = 'right';
  for (let j = 0; j <= 4; j++) {
    const s = j / 4;
    const y = baseOffY + s * numHSeg * cellH;
    if (y >= margin.top && y <= margin.top + plotH) {
      const yVal = (h / 2 - s * h) * 1000;
      ctx.fillText(`${yVal.toFixed(0)}`, margin.left - 5, y + 3);
    }
  }

  ctx.fillStyle = '#78909c';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('x (m)', margin.left + plotW / 2, H - 4);

  ctx.save();
  ctx.translate(10, margin.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('y (mm)', 0, 0);
  ctx.restore();

  document.getElementById('colorbar-label-max').textContent =
    `+${(maxAbsStress / 1e6).toFixed(1)} MPa`;
  document.getElementById('colorbar-label-min').textContent =
    `-${(maxAbsStress / 1e6).toFixed(1)} MPa`;
}

function updateSectionStressTooltip(e) {
  if (!sectionStressActive || !sectionStressMemberId) return;

  const member = members.find(m => m.id === sectionStressMemberId);
  if (!member) return;

  let mr = null;
  if (frameResults) {
    mr = frameResults.members.find(m => m.id === member.id);
  }
  if (!mr) return;

  const c = document.getElementById('section-stress-canvas');
  const rect = c.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const W = c.width;
  const H = c.height;
  const margin = { left: 55, right: 20, top: 25, bottom: 35 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  if (mx < margin.left || mx > margin.left + plotW || my < margin.top || my > margin.top + plotH) {
    document.getElementById('section-stress-tooltip').classList.add('hidden');
    return;
  }

  const L = member.length * 0.01;
  const h = member.h;
  const numLSeg = 60;
  const numHSeg = 30;
  const zoom = sectionStressZoom;
  const cellW = (plotW / numLSeg) * zoom;
  const cellH = (plotH / numHSeg) * zoom;

  const plotMX = mx - margin.left - sectionStressPanX;
  const plotMY = my - margin.top - sectionStressPanY;

  const ti = plotMX / cellW;
  const tj = plotMY / cellH;

  if (ti < 0 || ti > numLSeg || tj < 0 || tj > numHSeg) {
    document.getElementById('section-stress-tooltip').classList.add('hidden');
    return;
  }

  const t = ti / numLSeg;
  const s = tj / numHSeg;
  const x = t * L;
  const y = h / 2 - s * h;

  const q = mr.q || 0;
  let M, N;
  if (Math.abs(q) > 1e-10) {
    M = mr.M1 * (1 - t) + mr.M2 * t + q * x * (L - x) / 2;
  } else {
    M = mr.M1 * (1 - t) + mr.M2 * t;
  }
  N = mr.N1 * (1 - t) + mr.N2 * t;

  const sigmaAxial = N / member.A;
  const sigmaBending = member.I > 0 ? M * y / member.I : 0;
  const sigma = sigmaAxial + sigmaBending;

  const tooltip = document.getElementById('section-stress-tooltip');
  const panel = document.getElementById('section-stress-panel');
  const panelRect = panel.getBoundingClientRect();
  const tipX = e.clientX - panelRect.left + 15;
  const tipY = e.clientY - panelRect.top + 15;

  const isYielding = Math.abs(sigma) > YIELD_STRESS;

  let html = `<strong>x=${x.toFixed(3)}m  y=${(y * 1000).toFixed(1)}mm</strong><br/>`;
  html += `σ = ${(sigma / 1e6).toFixed(2)} MPa<br/>`;
  html += `<small>σ轴力=${(sigmaAxial / 1e6).toFixed(2)}  σ弯矩=${(sigmaBending / 1e6).toFixed(2)}</small><br/>`;
  html += `<small>距中性轴=${(y * 1000).toFixed(1)}mm</small>`;
  if (isYielding) {
    html += `<br/><span style="color:#ffc107;font-weight:bold;">⚠ 超过屈服强度 ${YIELD_STRESS / 1e6} MPa</span>`;
  }

  tooltip.innerHTML = html;
  tooltip.style.left = tipX + 'px';
  tooltip.style.top = tipY + 'px';
  tooltip.classList.remove('hidden');
}

function calcFrameMaxStress(rm, member) {
  const axialStress1 = Math.abs(rm.N1) / member.A;
  const axialStress2 = Math.abs(rm.N2) / member.A;
  const maxAxialStress = Math.max(axialStress1, axialStress2);
  const maxM = Math.max(Math.abs(rm.M1), Math.abs(rm.M2));
  if (member.I > 0 && member.A > 0) {
    const r = Math.sqrt(member.I / member.A);
    const yMax = r * 2;
    const bendingStress = maxM * yMax / member.I;
    return maxAxialStress + bendingStress;
  }
  return maxAxialStress;
}

function generateReport() {
  const solvedCases = loadCases.filter(lc => lc.solved && lc.results);
  if (solvedCases.length === 0 && !hasResults) return;

  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const modeLabel = analysisMode === 'frame' ? '刚架' : '桁架';
  const supportLabel = (s) => s === 'pinned' ? '固定铰支座' : s === 'roller' ? '滚动支座' : s === 'fixed' ? '固定支座' : '自由';
  const supportConstraint = (s) => s === 'pinned' ? 'X, Y' : s === 'roller' ? 'Y' : s === 'fixed' ? 'X, Y, θ' : '—';

  let tableNum = 0;
  const tn = () => ++tableNum;

  let html = '';

  html += `<div class="report-page">`;
  html += `<h1>${modeLabel}结构计算书</h1>`;
  html += `<div class="report-date">生成日期：${dateStr} ${timeStr}　　分析模式：${modeLabel}</div>`;

  html += `<h2>一、结构概况</h2>`;

  html += `<div class="table-title">表${tn()}　节点坐标</div>`;
  html += `<table><thead><tr><th>节点号</th><th>X (mm)</th><th>Y (mm)</th><th>支座类型</th></tr></thead><tbody>`;
  nodes.forEach(n => {
    html += `<tr><td>${n.id}</td><td>${n.x.toFixed(1)}</td><td>${n.y.toFixed(1)}</td><td>${supportLabel(n.support)}</td></tr>`;
  });
  html += `</tbody></table>`;

  html += `<div class="table-title">表${tn()}　杆件连接</div>`;
  html += `<table><thead><tr><th>杆件号</th><th>起始节点</th><th>终止节点</th><th>长度 (mm)</th></tr></thead><tbody>`;
  members.forEach(m => {
    html += `<tr><td>${m.id}</td><td>${m.node1Id}</td><td>${m.node2Id}</td><td>${m.length.toFixed(1)}</td></tr>`;
  });
  html += `</tbody></table>`;

  html += `<div class="table-title">表${tn()}　支座条件</div>`;
  const supportNodes = nodes.filter(n => n.support !== 'free');
  html += `<table><thead><tr><th>节点号</th><th>支座类型</th><th>约束自由度</th></tr></thead><tbody>`;
  if (supportNodes.length === 0) {
    html += `<tr><td colspan="3">无约束节点</td></tr>`;
  } else {
    supportNodes.forEach(n => {
      html += `<tr><td>${n.id}</td><td>${supportLabel(n.support)}</td><td>${supportConstraint(n.support)}</td></tr>`;
    });
  }
  html += `</tbody></table>`;

  html += `<div class="table-title">表${tn()}　材料参数</div>`;
  if (analysisMode === 'frame') {
    html += `<table><thead><tr><th>杆件号</th><th>E (GPa)</th><th>A (cm²)</th><th>I (cm⁴)</th><th>1端释放</th><th>2端释放</th></tr></thead><tbody>`;
    members.forEach(m => {
      html += `<tr><td>${m.id}</td><td>${(m.E / 1e9).toFixed(1)}</td><td>${(m.A * 1e4).toFixed(2)}</td><td>${(m.I * 1e8).toFixed(2)}</td><td>${m.release1 ? '铰接' : '刚接'}</td><td>${m.release2 ? '铰接' : '刚接'}</td></tr>`;
    });
  } else {
    html += `<table><thead><tr><th>杆件号</th><th>E (GPa)</th><th>A (cm²)</th></tr></thead><tbody>`;
    members.forEach(m => {
      html += `<tr><td>${m.id}</td><td>${(m.E / 1e9).toFixed(1)}</td><td>${(m.A * 1e4).toFixed(2)}</td></tr>`;
    });
  }
  html += `</tbody></table>`;

  html += `<h2>二、荷载信息</h2>`;
  html += `<p>共 ${loadCases.length} 个工况</p>`;

  loadCases.forEach((lc, lcIdx) => {
    html += `<div class="loadcase-subtitle">工况${lcIdx + 1}：${lc.name}</div>`;

    const loadedNodes = [];
    nodes.forEach(n => {
      const nl = lc.nodeLoads[n.id];
      if (nl && (Math.abs(nl.fx) > 1e-6 || Math.abs(nl.fy) > 1e-6 || Math.abs(nl.m || 0) > 1e-6)) {
        loadedNodes.push({ id: n.id, fx: nl.fx, fy: nl.fy, m: nl.m || 0 });
      }
    });

    html += `<div class="table-title">表${tn()}　节点荷载</div>`;
    if (analysisMode === 'frame') {
      html += `<table><thead><tr><th>节点号</th><th>Fx (kN)</th><th>Fy (kN)</th><th>M (kN·m)</th></tr></thead><tbody>`;
      if (loadedNodes.length === 0) {
        html += `<tr><td colspan="4">无节点荷载</td></tr>`;
      } else {
        loadedNodes.forEach(n => {
          html += `<tr><td>${n.id}</td><td>${(n.fx / 1000).toFixed(3)}</td><td>${(n.fy / 1000).toFixed(3)}</td><td>${(n.m / 1000).toFixed(3)}</td></tr>`;
        });
      }
    } else {
      html += `<table><thead><tr><th>节点号</th><th>Fx (kN)</th><th>Fy (kN)</th></tr></thead><tbody>`;
      if (loadedNodes.length === 0) {
        html += `<tr><td colspan="3">无节点荷载</td></tr>`;
      } else {
        loadedNodes.forEach(n => {
          html += `<tr><td>${n.id}</td><td>${(n.fx / 1000).toFixed(3)}</td><td>${(n.fy / 1000).toFixed(3)}</td></tr>`;
        });
      }
    }
    html += `</tbody></table>`;

    if (analysisMode === 'frame' && lc.memberLoads) {
      const loadedMembers = [];
      members.forEach(m => {
        const ml = lc.memberLoads[m.id];
        if (ml && Math.abs(ml.q || 0) > 1e-6) {
          loadedMembers.push({ id: m.id, q: ml.q });
        }
      });
      if (loadedMembers.length > 0) {
        html += `<div class="table-title">表${tn()}　杆件均布荷载</div>`;
        html += `<table><thead><tr><th>杆件号</th><th>q (kN/m)</th></tr></thead><tbody>`;
        loadedMembers.forEach(m => {
          html += `<tr><td>${m.id}</td><td>${(m.q / 1000).toFixed(2)}</td></tr>`;
        });
        html += `</tbody></table>`;
      }
    }
  });

  html += `</div>`;

  html += `<div class="report-page">`;
  html += `<h2>三、求解结果</h2>`;

  solvedCases.forEach((lc, lcIdx) => {
    html += `<div class="loadcase-subtitle">工况${lcIdx + 1}：${lc.name}</div>`;

    html += `<div class="table-title">表${tn()}　节点位移</div>`;
    if (analysisMode === 'frame') {
      html += `<table><thead><tr><th>节点号</th><th>dx (mm)</th><th>dy (mm)</th><th>dθ (mrad)</th></tr></thead><tbody>`;
      lc.results.nodes.forEach(rn => {
        html += `<tr><td>${rn.id}</td><td>${(rn.dx * 1000).toFixed(4)}</td><td>${(rn.dy * 1000).toFixed(4)}</td><td>${((rn.dtheta || 0) * 1000).toFixed(4)}</td></tr>`;
      });
    } else {
      html += `<table><thead><tr><th>节点号</th><th>dx (mm)</th><th>dy (mm)</th><th>合位移 (mm)</th></tr></thead><tbody>`;
      lc.results.nodes.forEach(rn => {
        const d = Math.sqrt(rn.dx * rn.dx + rn.dy * rn.dy) * 1000;
        html += `<tr><td>${rn.id}</td><td>${(rn.dx * 1000).toFixed(4)}</td><td>${(rn.dy * 1000).toFixed(4)}</td><td>${d.toFixed(4)}</td></tr>`;
      });
    }
    html += `</tbody></table>`;

    html += `<div class="table-title">表${tn()}　杆件内力</div>`;
    if (analysisMode === 'frame') {
      html += `<table><thead><tr><th>杆件号</th><th>N₁ (kN)</th><th>V₁ (kN)</th><th>M₁ (kN·m)</th><th>N₂ (kN)</th><th>V₂ (kN)</th><th>M₂ (kN·m)</th><th>最大应力 (MPa)</th></tr></thead><tbody>`;
      lc.results.members.forEach(rm => {
        const member = members.find(m => m.id === rm.id);
        const maxCombinedStress = member ? calcFrameMaxStress(rm, member) : 0;
        html += `<tr><td>${rm.id}</td><td>${(rm.N1 / 1000).toFixed(2)}</td><td>${(rm.V1 / 1000).toFixed(2)}</td><td>${(rm.M1 / 1000).toFixed(2)}</td><td>${(rm.N2 / 1000).toFixed(2)}</td><td>${(rm.V2 / 1000).toFixed(2)}</td><td>${(rm.M2 / 1000).toFixed(2)}</td><td>${(maxCombinedStress / 1e6).toFixed(2)}</td></tr>`;
      });
    } else {
      html += `<table><thead><tr><th>杆件号</th><th>轴力 (kN)</th><th>性质</th><th>应力 (MPa)</th></tr></thead><tbody>`;
      lc.results.members.forEach(rm => {
        const nature = rm.axialForce > 1e-6 ? '拉' : rm.axialForce < -1e-6 ? '压' : '零力';
        html += `<tr><td>${rm.id}</td><td>${(rm.axialForce / 1000).toFixed(3)}</td><td>${nature}</td><td>${(rm.stress / 1e6).toFixed(2)}</td></tr>`;
      });
    }
    html += `</tbody></table>`;
  });

  if (solvedCases.length > 1) {
    const env = envelopeData || calculateEnvelope();
    if (env) {
      html += `<h2>四、包络分析</h2>`;
      html += `<p>共 ${solvedCases.length} 个已求解工况的包络极值</p>`;

      html += `<div class="table-title">表${tn()}　杆件包络内力</div>`;
      html += `<table><thead><tr><th>杆件号</th><th>最大拉力 (kN)</th><th>拉力工况</th><th>最大压力 (kN)</th><th>压力工况</th><th>最大应力 (MPa)</th></tr></thead><tbody>`;
      members.forEach(m => {
        const info = env.get(m.id);
        if (info) {
          const maxStress = Math.max(Math.abs(info.maxTensionStress), Math.abs(info.maxCompressionStress));
          html += `<tr><td>${m.id}</td><td>${(info.maxTension / 1000).toFixed(2)}</td><td>${info.maxTensionCase || '—'}</td><td>${(Math.abs(info.maxCompression) / 1000).toFixed(2)}</td><td>${info.maxCompressionCase || '—'}</td><td>${(maxStress / 1e6).toFixed(2)}</td></tr>`;
        }
      });
      html += `</tbody></table>`;

      let globalMaxStress = 0;
      let globalMaxStressMemberId = null;
      for (const [mid, info] of env.entries()) {
        const ms = Math.max(Math.abs(info.maxTensionStress), Math.abs(info.maxCompressionStress));
        if (ms > globalMaxStress) {
          globalMaxStress = ms;
          globalMaxStressMemberId = mid;
        }
      }
      const safetyFactor = globalMaxStress > 0 ? (YIELD_STRESS / globalMaxStress).toFixed(2) : '—';
      html += `<p>包络最大应力：${(globalMaxStress / 1e6).toFixed(2)} MPa（杆件 #${globalMaxStressMemberId}）</p>`;
      html += `<p>屈服强度：${(YIELD_STRESS / 1e6).toFixed(0)} MPa（Q235钢）</p>`;
      html += `<p>安全系数：${safetyFactor}</p>`;
    }
  }

  html += `<h2>${solvedCases.length > 1 ? '五' : '四'}、结论</h2>`;

  const allFailedMembers = [];
  let globalMaxStress = 0;
  let globalMaxStressMemberId = null;

  if (solvedCases.length > 1) {
    const env = envelopeData || calculateEnvelope();
    if (env) {
      for (const [mid, info] of env.entries()) {
        const maxStress = Math.max(Math.abs(info.maxTensionStress), Math.abs(info.maxCompressionStress));
        if (maxStress > globalMaxStress) {
          globalMaxStress = maxStress;
          globalMaxStressMemberId = mid;
        }
        if (maxStress > YIELD_STRESS) {
          const member = members.find(m => m.id === mid);
          const ratio = (maxStress / YIELD_STRESS).toFixed(2);
          const forceType = Math.abs(info.maxTensionStress) >= Math.abs(info.maxCompressionStress) ? '拉' : '压';
          const caseName = Math.abs(info.maxTensionStress) >= Math.abs(info.maxCompressionStress) ? info.maxTensionCase : info.maxCompressionCase;
          allFailedMembers.push({ member, stress: maxStress, ratio, forceType, caseName });
        }
      }
    }
  } else {
    if (analysisMode === 'frame') {
      const currentCase = solvedCases[0] || getCurrentLoadCase();
      if (currentCase && currentCase.results) {
        currentCase.results.members.forEach(rm => {
          const member = members.find(m => m.id === rm.id);
          if (member) {
            const s = calcFrameMaxStress(rm, member);
            if (s > globalMaxStress) {
              globalMaxStress = s;
              globalMaxStressMemberId = rm.id;
            }
            if (s > YIELD_STRESS) {
              const ratio = (s / YIELD_STRESS).toFixed(2);
              allFailedMembers.push({ member, stress: s, ratio, forceType: '组合', caseName: currentCase.name || '' });
            }
          }
        });
      }
    } else {
      members.forEach(m => {
        if (Math.abs(m.stress) > globalMaxStress) {
          globalMaxStress = Math.abs(m.stress);
          globalMaxStressMemberId = m.id;
        }
        if (Math.abs(m.stress) > YIELD_STRESS) {
          const ratio = (Math.abs(m.stress) / YIELD_STRESS).toFixed(2);
          const forceType = m.stress > 0 ? '拉' : '压';
          allFailedMembers.push({ member: m, stress: Math.abs(m.stress), ratio, forceType, caseName: getCurrentLoadCase()?.name || '' });
        }
      });
    }
  }

  const safetyFactor = globalMaxStress > 0 ? (YIELD_STRESS / globalMaxStress).toFixed(2) : '—';
  html += `<p>最大应力：${(globalMaxStress / 1e6).toFixed(2)} MPa${globalMaxStressMemberId ? '（杆件 #' + globalMaxStressMemberId + '）' : ''}</p>`;
  html += `<p>屈服强度：${(YIELD_STRESS / 1e6).toFixed(0)} MPa（Q235钢）</p>`;
  html += `<p>安全系数：${safetyFactor}</p>`;

  html += `<div class="conclusion-box">`;
  html += `<div class="conclusion-title">强度校核结论</div>`;
  if (allFailedMembers.length === 0) {
    html += `<p class="pass">✓ 所有杆件应力均在屈服强度（${(YIELD_STRESS / 1e6).toFixed(0)} MPa）以内，结构满足强度要求。</p>`;
  } else {
    html += `<p class="fail">✗ 以下 ${allFailedMembers.length} 根杆件应力超过屈服强度（${(YIELD_STRESS / 1e6).toFixed(0)} MPa），不满足强度要求：</p>`;
    html += `<ul>`;
    allFailedMembers.forEach(item => {
      html += `<li class="fail">杆件 #${item.member.id}：应力 ${(item.stress / 1e6).toFixed(2)} MPa（${item.forceType}），超限比 ${item.ratio}${item.caseName ? '，来自工况：' + item.caseName : ''}</li>`;
    });
    html += `</ul>`;
  }
  html += `</div>`;

  html += `</div>`;

  document.getElementById('report-content').innerHTML = html;
  document.getElementById('report-overlay').classList.remove('hidden');
}

window._toggleStageMember = function(stageId, memberId) {
  toggleStageMember(stageId, memberId);
};

window._setStageNodeLoad = function(stageId, nodeId, dof, value) {
  const stage = constructionStages.find(s => s.id === stageId);
  if (!stage) return;
  if (!stage.nodeLoads) stage.nodeLoads = {};
  if (!stage.nodeLoads[nodeId]) stage.nodeLoads[nodeId] = { fx: 0, fy: 0, m: 0 };
  stage.nodeLoads[nodeId][dof] = parseFloat(value) || 0;
  const idx = constructionStages.indexOf(stage);
  for (let i = idx; i < constructionStages.length; i++) {
    constructionStages[i].solved = false;
    constructionStages[i].incrementalResults = null;
  }
  updateStageList();
  applyStageVisualization();
  render();
  saveToStorage();
};

window._setStageMemberLoad = function(stageId, memberId, value) {
  const stage = constructionStages.find(s => s.id === stageId);
  if (!stage) return;
  if (!stage.memberLoads) stage.memberLoads = {};
  stage.memberLoads[memberId] = { q: parseFloat(value) || 0 };
  const idx = constructionStages.indexOf(stage);
  for (let i = idx; i < constructionStages.length; i++) {
    constructionStages[i].solved = false;
    constructionStages[i].incrementalResults = null;
  }
  updateStageList();
  applyStageVisualization();
  render();
  saveToStorage();
};

document.querySelectorAll('.panel-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const tabName = tab.dataset.tab;
    document.getElementById('tab-' + tabName).classList.add('active');
  });
});

document.getElementById('btn-construction').addEventListener('click', () => {
  if (constructionActive) {
    exitConstructionMode();
  } else {
    enterConstructionMode();
  }
});

document.getElementById('btn-topo').addEventListener('click', () => {
  if (topoActive) {
    exitTopoMode();
  } else {
    enterTopoMode();
  }
});

document.getElementById('topo-start').addEventListener('click', startTopoOptimization);
document.getElementById('topo-reset-domain').addEventListener('click', resetTopoDomain);
document.getElementById('topo-stop').addEventListener('click', stopTopoOptimization);
document.getElementById('topo-exit').addEventListener('click', exitTopoMode);
document.getElementById('topo-result-exit').addEventListener('click', exitTopoMode);
document.getElementById('topo-restart').addEventListener('click', restartTopoOptimization);
document.getElementById('topo-clear-forces').addEventListener('click', () => {
  topoForces = [];
  updateTopoForceList();
  updateTopoVisualization();
  checkTopoCanStart();
});

document.querySelectorAll('.topo-force-dir').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.topo-force-dir').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    topoForceDir = btn.dataset.dir;
  });
});

['topo-fix-left', 'topo-fix-right', 'topo-fix-top', 'topo-fix-bottom'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    if (topoDomain) {
      updateTopoVisualization();
      checkTopoCanStart();
    }
  });
});

['topo-volfrac', 'topo-nx', 'topo-ny'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    if (topoDomain) updateTopoVisualization();
  });
});

document.getElementById('btn-add-stage').addEventListener('click', () => {
  const name = prompt('请输入阶段名称:', `阶段${constructionStages.length + 1}`);
  if (name && name.trim()) {
    addConstructionStage(name.trim());
    if (!constructionActive) {
      enterConstructionMode();
    }
  }
});

document.getElementById('btn-solve-stages').addEventListener('click', () => {
  solveConstructionStages();
});

document.getElementById('timeline-slider').addEventListener('input', (e) => {
  const idx = parseInt(e.target.value);
  if (idx >= 0 && idx < constructionStages.length) {
    currentStageIndex = idx;
    applyStageVisualization();
    updateStageList();
    updateStageDetail();
    updateTimeline();
    updateStageResults();
    render();
  }
});

init();
