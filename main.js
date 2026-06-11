import './style.css';
import { Renderer } from './src/renderer.js';
import { createNode, createMember, deepClone } from './src/core.js';
import { solveTruss, solveFrame } from './src/solver.js';
import { solveModal } from './src/modal.js';
import { solveBuckling } from './src/buckling.js';
import { HistoryManager } from './src/history.js';
import { createWarrenTruss, createDefaultLoadCases, createPortalFrame, createFrameLoadCases, createConstructionStagePreset } from './src/presets.js';
import { TopoOptimizer } from './src/topo.js';
import { SECTIONS, searchSections, sortSections, selectOptimalSection, getSectionByName, YIELD_STRENGTH, SAFETY_FACTOR, calculateMaxMoment } from './src/sections.js';
import { PushoverAnalyzer, calculatePlasticMoment } from './src/pushover.js';

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

let bucklingActive = false;
let bucklingResults = null;
let currentBucklingMode = 0;
let bucklingAnimFrame = null;
let bucklingAnimTime = 0;
let bucklingScaleFactor = 50;

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

let compareActive = false;
let compareSchemes = [];
let compareLeftId = null;
let compareRightId = null;
let compareDiff = null;
let compareMetrics = null;

let currentSectionTab = 'general';
let sectionFilterCategory = 'all';
let sectionSortBy = 'name';
let sectionSortAscending = true;
let sectionSearchQuery = '';
let autoSelectResults = null;

let pushoverActive = false;
let pushoverAnalyzer = null;
let pushoverRunning = false;
let pushoverCurrentStep = -1;
let pushoverTimer = null;
let pushoverSavedNodes = null;
let pushoverSavedMembers = null;
let pushoverSavedFrameResults = null;
let pushoverSavedHasResults = false;
let pushoverSavedShowDeformed = false;
let pushoverSavedViewMode = 'single';
let pushoverSavedCurrentSectionTab = 'cases';
let pushoverPanelVisible = false;
let _pushoverResizeTimer = null;

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
    updateAutoSelectButtonState();
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
  updateAutoSelectButtonState();
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
  if (bucklingActive) exitBucklingMode();
  if (influenceActive) exitInfluenceMode();
  if (sectionStressActive) hideSectionStressView();
  if (pushoverActive) exitPushoverMode();
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
  updatePushoverButtonStates();
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

function startBucklingAnalysis() {
  if (!hasResults && !getCurrentLoadCaseSolved()) {
    alert('请先进行静力分析！屈曲分析需要轴力结果来组装几何刚度矩阵。');
    return;
  }

  if (influenceActive) exitInfluenceMode();
  if (modalActive) exitModalMode();

  const numModes = parseInt(document.getElementById('buckling-num-modes').value) || 3;

  try {
    const axialForces = getMemberAxialForces();
    bucklingResults = solveBuckling(nodes, members, axialForces, analysisMode, numModes);
    bucklingActive = true;
    currentBucklingMode = 0;
    renderer.bucklingMode = true;

    document.getElementById('buckling-section').style.display = 'block';
    document.getElementById('buckling-scale-label').style.display = 'flex';
    document.getElementById('results-section').style.display = 'none';
    document.getElementById('btn-buckling').classList.add('active');

    updateBucklingLambdaList();
    startBucklingAnimation();
    updateStatus(`屈曲分析完成: 求得 ${bucklingResults.modes.length} 阶屈曲模态`);
  } catch (e) {
    alert('屈曲分析失败: ' + e.message);
    updateStatus('屈曲分析失败: ' + e.message);
  }
}

function exitBucklingMode() {
  bucklingActive = false;
  renderer.bucklingMode = false;
  renderer.bucklingModeShape = null;
  renderer.bucklingAmplitude = 0;
  renderer.bucklingEnvelope = null;

  if (bucklingAnimFrame) {
    cancelAnimationFrame(bucklingAnimFrame);
    bucklingAnimFrame = null;
  }

  document.getElementById('buckling-section').style.display = 'none';
  document.getElementById('buckling-scale-label').style.display = 'none';
  document.getElementById('results-section').style.display = 'block';
  document.getElementById('btn-buckling').classList.remove('active');

  render();
}

function getCurrentLoadCaseSolved() {
  const lc = getCurrentLoadCase();
  return lc && lc.solved;
}

function getMemberAxialForces() {
  const axialForces = new Map();
  if (analysisMode === 'frame' && frameResults) {
    frameResults.members.forEach(mr => {
      const avgN = (Math.abs(mr.N1) + Math.abs(mr.N2)) / 2;
      const sign = (mr.N1 + mr.N2) < 0 ? -1 : 1;
      axialForces.set(mr.id, sign * avgN);
    });
  } else if (hasResults) {
    members.forEach(m => {
      axialForces.set(m.id, m.axialForce || 0);
    });
  }
  return axialForces;
}

function updateBucklingLambdaList() {
  if (!bucklingResults || !bucklingResults.modes.length) return;

  const container = document.getElementById('buckling-lambda-list');
  container.innerHTML = '';

  const hasCritical = bucklingResults.modes.some(m => m.lambda < 1);
  const warningDiv = document.getElementById('buckling-warning');
  warningDiv.style.display = hasCritical ? 'block' : 'none';

  bucklingResults.modes.forEach((mode, idx) => {
    const item = document.createElement('div');
    item.className = 'buckling-lambda-item';
    if (idx === currentBucklingMode) item.classList.add('active');
    if (mode.lambda < 1) item.classList.add('critical');

    const numSpan = document.createElement('span');
    numSpan.className = 'mode-number';
    numSpan.textContent = `第${mode.modeNumber}阶`;

    const lambdaSpan = document.createElement('span');
    lambdaSpan.className = 'lambda-value';
    if (mode.lambda < 1) lambdaSpan.classList.add('critical-val');
    lambdaSpan.textContent = `λ = ${mode.lambda.toFixed(4)}`;

    item.appendChild(numSpan);
    item.appendChild(lambdaSpan);

    item.onclick = () => {
      currentBucklingMode = idx;
      updateBucklingLambdaList();
    };

    container.appendChild(item);
  });

  updateBucklingEffectiveLengths();
}

function updateBucklingEffectiveLengths() {
  const container = document.getElementById('buckling-effective-lengths');
  const listContainer = document.getElementById('buckling-effective-list');

  if (!bucklingResults || !bucklingResults.memberEffectiveLengths || bucklingResults.memberEffectiveLengths.size === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  listContainer.innerHTML = '';

  bucklingResults.memberEffectiveLengths.forEach((info, memberId) => {
    const item = document.createElement('div');
    item.className = 'buckling-effective-item';

    const idSpan = document.createElement('span');
    idSpan.className = 'member-id';
    idSpan.textContent = `杆件#${memberId}`;

    const valSpan = document.createElement('span');
    valSpan.className = 'mu-value';
    valSpan.textContent = `μ=${info.mu.toFixed(2)}, Pcr=${(info.Pcr / 1000).toFixed(1)} kN`;

    item.appendChild(idSpan);
    item.appendChild(valSpan);
    listContainer.appendChild(item);
  });
}

function startBucklingAnimation() {
  if (bucklingAnimFrame) {
    cancelAnimationFrame(bucklingAnimFrame);
  }

  let lastTime = 0;
  bucklingAnimTime = 0;

  function animate(timestamp) {
    if (!bucklingActive || !bucklingResults || !bucklingResults.modes.length) {
      bucklingAnimFrame = null;
      return;
    }

    if (lastTime === 0) lastTime = timestamp;
    const delta = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    bucklingAnimTime += delta;

    const mode = bucklingResults.modes[currentBucklingMode];
    if (!mode) {
      bucklingAnimFrame = requestAnimationFrame(animate);
      return;
    }

    const visualFreq = 1.2;
    const amplitude = Math.sin(2 * Math.PI * visualFreq * bucklingAnimTime);

    renderer.bucklingModeShape = mode.nodeModeShapes;
    renderer.bucklingAmplitude = amplitude;
    renderer.bucklingEnvelope = bucklingScaleFactor;

    render();

    bucklingAnimFrame = requestAnimationFrame(animate);
  }

  bucklingAnimFrame = requestAnimationFrame(animate);
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
        h: m.h,
        sectionName: m.sectionName
      })),
      loadCases: loadCases,
      currentLoadCaseId,
      analysisMode,
      constructionStages,
      compareSchemes
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
      sectionName: m.sectionName || null,
      axialForce: 0,
      stress: 0,
      selected: false
    }));

    loadCases = data.loadCases;
    currentLoadCaseId = data.currentLoadCaseId || loadCases[0].id;
    analysisMode = data.analysisMode || 'truss';
    renderer.analysisMode = analysisMode;
    constructionStages = data.constructionStages || [];
    compareSchemes = data.compareSchemes || [];

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
  if (bucklingActive) exitBucklingMode();
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
  if (bucklingActive) exitBucklingMode();
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

function saveScheme(name) {
  if (!name || !name.trim()) return;
  if (compareSchemes.length >= 5) {
    alert('最多保存5个方案，请先删除旧方案');
    return;
  }
  const scheme = {
    id: 'sch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    name: name.trim(),
    timestamp: new Date().toLocaleString('zh-CN'),
    analysisMode,
    nodes: deepClone(nodes.map(n => ({
      id: n.id, x: n.x, y: n.y, support: n.support
    }))),
    members: deepClone(members.map(m => ({
      id: m.id, node1Id: m.node1Id, node2Id: m.node2Id,
      length: m.length, angle: m.angle,
      E: m.E, A: m.A, I: m.I, h: m.h, rho: m.rho,
      release1: m.release1, release2: m.release2, q: m.q
    }))),
    loadCases: deepClone(loadCases),
    currentLoadCaseId,
    results: hasResults ? deepClone({
      maxForce,
      maxMoment,
      nodes: nodes.map(n => ({ id: n.id, dx: n.dx, dy: n.dy, dtheta: n.dtheta })),
      members: members.map(m => ({ id: m.id, axialForce: m.axialForce, stress: m.stress })),
      frameResults
    }) : null
  };
  compareSchemes.push(scheme);
  updateSchemeList();
  saveToStorage();
  if (compareActive && compareSchemes.length >= 2) {
    if (!compareLeftId) compareLeftId = compareSchemes[0].id;
    if (!compareRightId) compareRightId = compareSchemes.find(s => s.id !== compareLeftId)?.id || null;
    runCompare();
  }
  updateStatus(`方案"${scheme.name}"已保存`);
}

function deleteScheme(id) {
  const idx = compareSchemes.findIndex(s => s.id === id);
  if (idx < 0) return;
  const name = compareSchemes[idx].name;
  compareSchemes.splice(idx, 1);
  if (compareLeftId === id) compareLeftId = null;
  if (compareRightId === id) compareRightId = null;
  updateSchemeList();
  saveToStorage();
  updateStatus(`方案"${name}"已删除`);
}

function computeDiff(schemeA, schemeB) {
  const diff = {
    memberSectionChanged: new Set(),
    memberMaterialChanged: new Set(),
    nodeSupportChanged: new Set(),
    memberAddedA: new Set(),
    memberAddedB: new Set(),
    nodeAddedA: new Set(),
    nodeAddedB: new Set()
  };
  const memberMapA = new Map();
  const memberMapB = new Map();
  schemeA.members.forEach(m => memberMapA.set(m.id, m));
  schemeB.members.forEach(m => memberMapB.set(m.id, m));
  for (const m of schemeA.members) {
    if (!memberMapB.has(m.id)) {
      diff.memberAddedA.add(m.id);
    } else {
      const mb = memberMapB.get(m.id);
      const sectionChanged = Math.abs(m.A - mb.A) > 1e-10 || Math.abs(m.I - mb.I) > 1e-10 || Math.abs(m.h - mb.h) > 1e-10;
      if (sectionChanged) diff.memberSectionChanged.add(m.id);
      const materialChanged = Math.abs(m.E - mb.E) > 1e3;
      if (materialChanged) diff.memberMaterialChanged.add(m.id);
    }
  }
  for (const m of schemeB.members) {
    if (!memberMapA.has(m.id)) {
      diff.memberAddedB.add(m.id);
    }
  }
  const nodeMapA = new Map();
  const nodeMapB = new Map();
  schemeA.nodes.forEach(n => nodeMapA.set(n.id, n));
  schemeB.nodes.forEach(n => nodeMapB.set(n.id, n));
  for (const n of schemeA.nodes) {
    if (!nodeMapB.has(n.id)) {
      diff.nodeAddedA.add(n.id);
    } else {
      const nb = nodeMapB.get(n.id);
      if (n.support !== nb.support) diff.nodeSupportChanged.add(n.id);
    }
  }
  for (const n of schemeB.nodes) {
    if (!nodeMapA.has(n.id)) {
      diff.nodeAddedB.add(n.id);
    }
  }
  return diff;
}

function computeSchemeMetrics(scheme) {
  const PIXEL_TO_METER = 0.01;
  let totalWeight = 0;
  let maxDisplacement = 0;
  let maxStress = 0;
  let minSafetyFactor = Infinity;
  for (const m of scheme.members) {
    const lengthM = m.length * PIXEL_TO_METER;
    const volume = m.A * lengthM;
    const rho = m.rho || 7850;
    totalWeight += rho * volume * 9.81;
  }
  if (scheme.results) {
    for (const n of scheme.results.nodes) {
      const disp = Math.sqrt((n.dx || 0) * (n.dx || 0) + (n.dy || 0) * (n.dy || 0));
      if (disp > maxDisplacement) maxDisplacement = disp;
    }
    for (const m of scheme.results.members) {
      const s = Math.abs(m.stress || 0);
      if (s > maxStress) maxStress = s;
      if (s > 1e-6) {
        const sf = YIELD_STRESS / s;
        if (sf < minSafetyFactor) minSafetyFactor = sf;
      }
    }
  }
  if (minSafetyFactor === Infinity) minSafetyFactor = 0;
  return { totalWeight, maxDisplacement, maxStress, minSafetyFactor };
}

function enterCompareMode() {
  if (modalActive) exitModalMode();
  if (bucklingActive) exitBucklingMode();
  if (influenceActive) exitInfluenceMode();
  if (constructionActive) exitConstructionMode();
  if (topoActive) exitTopoMode();
  if (sectionStressActive) hideSectionStressView();
  compareActive = true;
  if (compareSchemes.length >= 2) {
    if (!compareLeftId && compareSchemes.length > 0) compareLeftId = compareSchemes[0].id;
    if (!compareRightId && compareSchemes.length > 1) compareRightId = compareSchemes[1].id;
    if (compareLeftId === compareRightId && compareSchemes.length > 1) {
      compareRightId = compareSchemes.find(s => s.id !== compareLeftId)?.id || null;
    }
    runCompare();
  } else {
    renderer.compareData = null;
  }
  document.getElementById('compare-section').style.display = 'block';
  document.getElementById('btn-compare').classList.add('active');
  updateSchemeList();
  render();
  updateStatus(compareSchemes.length >= 2 ? '方案对比模式: 结构不可编辑，选择两个方案进行对比' : '方案对比模式: 请先保存至少2个方案');
}

function exitCompareMode() {
  compareActive = false;
  compareDiff = null;
  compareMetrics = null;
  compareLeftId = null;
  compareRightId = null;
  renderer.compareData = null;
  document.getElementById('compare-section').style.display = 'none';
  document.getElementById('btn-compare').classList.remove('active');
  document.getElementById('compare-metrics').style.display = 'none';
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
}

function runCompare() {
  const schemeA = compareSchemes.find(s => s.id === compareLeftId);
  const schemeB = compareSchemes.find(s => s.id === compareRightId);
  if (!schemeA || !schemeB) {
    compareDiff = null;
    compareMetrics = null;
    renderer.compareData = null;
    return;
  }
  compareDiff = computeDiff(schemeA, schemeB);
  const metricsA = computeSchemeMetrics(schemeA);
  const metricsB = computeSchemeMetrics(schemeB);
  compareMetrics = { left: metricsA, right: metricsB };
  renderer.compareData = {
    schemeA,
    schemeB,
    diff: compareDiff,
    metrics: compareMetrics
  };
  updateCompareMetrics();
  render();
}

function updateSchemeList() {
  const container = document.getElementById('scheme-list');
  if (!container) return;
  const countEl = document.getElementById('scheme-count');
  if (countEl) countEl.textContent = `${compareSchemes.length}/5`;
  container.innerHTML = '';
  compareSchemes.forEach(sch => {
    const item = document.createElement('div');
    item.className = 'scheme-item';
    const isLeft = sch.id === compareLeftId;
    const isRight = sch.id === compareRightId;
    if (isLeft) item.classList.add('left-selected');
    if (isRight) item.classList.add('right-selected');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'scheme-name';
    nameSpan.textContent = sch.name;
    const tagSpan = document.createElement('span');
    tagSpan.className = 'scheme-tags';
    if (isLeft) tagSpan.innerHTML += '<span class="scheme-tag tag-left">A</span>';
    if (isRight) tagSpan.innerHTML += '<span class="scheme-tag tag-right">B</span>';
    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'scheme-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = '删除方案';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteScheme(sch.id);
      if (compareActive) runCompare();
    };
    item.onclick = () => {
      if (!compareActive) return;
      if (!compareLeftId || (compareLeftId === sch.id && compareRightId)) {
        compareLeftId = sch.id;
      } else if (!compareRightId || compareRightId === sch.id) {
        compareRightId = sch.id;
      } else {
        compareRightId = sch.id;
      }
      if (compareLeftId === compareRightId) {
        const other = compareSchemes.find(s => s.id !== compareLeftId);
        if (other) compareRightId = other.id;
      }
      updateSchemeList();
      runCompare();
    };
    item.appendChild(nameSpan);
    item.appendChild(tagSpan);
    item.appendChild(deleteBtn);
    container.appendChild(item);
  });
}

function updateCompareMetrics() {
  const container = document.getElementById('compare-metrics');
  if (!container || !compareMetrics) return;
  container.style.display = 'block';
  const l = compareMetrics.left;
  const r = compareMetrics.right;
  const fmt = (v, unit) => `${v.toFixed(2)} ${unit}`;
  const diffPct = (a, b) => {
    if (Math.abs(a) < 1e-12) return b > 0 ? '+∞%' : '0%';
    const pct = ((b - a) / Math.abs(a)) * 100;
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}%`;
  };
  const diffClass = (a, b, lowerBetter = false) => {
    if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) return 'diff-neutral';
    const pct = Math.abs(a) < 1e-12 ? 999 : ((b - a) / Math.abs(a)) * 100;
    if (Math.abs(pct) < 0.5) return 'diff-neutral';
    if (lowerBetter) return pct < 0 ? 'diff-better' : 'diff-worse';
    return pct > 0 ? 'diff-better' : 'diff-worse';
  };
  container.innerHTML = `
    <h4>关键指标对比</h4>
    <table class="compare-table">
      <thead>
        <tr><th>指标</th><th>方案 A</th><th>方案 B</th><th>变化</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>总重量</td>
          <td>${fmt(l.totalWeight, 'N')}</td>
          <td>${fmt(r.totalWeight, 'N')}</td>
          <td class="${diffClass(l.totalWeight, r.totalWeight, true)}">${diffPct(l.totalWeight, r.totalWeight)}</td>
        </tr>
        <tr>
          <td>最大位移</td>
          <td>${(l.maxDisplacement * 1000).toFixed(4)} mm</td>
          <td>${(r.maxDisplacement * 1000).toFixed(4)} mm</td>
          <td class="${diffClass(l.maxDisplacement, r.maxDisplacement, true)}">${diffPct(l.maxDisplacement, r.maxDisplacement)}</td>
        </tr>
        <tr>
          <td>最大应力</td>
          <td>${(l.maxStress / 1e6).toFixed(2)} MPa</td>
          <td>${(r.maxStress / 1e6).toFixed(2)} MPa</td>
          <td class="${diffClass(l.maxStress, r.maxStress, true)}">${diffPct(l.maxStress, r.maxStress)}</td>
        </tr>
        <tr>
          <td>最小安全系数</td>
          <td>${l.minSafetyFactor.toFixed(3)}</td>
          <td>${r.minSafetyFactor.toFixed(3)}</td>
          <td class="${diffClass(l.minSafetyFactor, r.minSafetyFactor, false)}">${diffPct(l.minSafetyFactor, r.minSafetyFactor)}</td>
        </tr>
      </tbody>
    </table>
    <div class="compare-legend">
      <span class="compare-legend-item"><span class="legend-line orange-bold"></span> 截面变化</span>
      <span class="compare-legend-item"><span class="legend-circle yellow"></span> 支座变化</span>
      <span class="compare-legend-item"><span class="legend-line blue-dash"></span> 材料变化</span>
    </div>
  `;
}

function switchPanelTab(tabName) {
  currentSectionTab = tabName;
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === 'tab-' + tabName);
  });
  if (tabName === 'section') {
    renderSectionList();
    updateSelectedMembersSectionInfo();
    updateAutoSelectButtonState();
  }
}

function getFilteredAndSortedSections() {
  let sections = [...SECTIONS];
  if (sectionFilterCategory !== 'all') {
    sections = sections.filter(s => s.category === sectionFilterCategory);
  }
  if (sectionSearchQuery) {
    const lower = sectionSearchQuery.toLowerCase();
    sections = sections.filter(s => 
      s.name.toLowerCase().includes(lower) || 
      s.category.toLowerCase().includes(lower)
    );
  }
  sections = sortSections(sections, sectionSortBy, sectionSortAscending);
  return sections;
}

function renderSectionList() {
  const container = document.getElementById('section-list');
  if (!container) return;

  const sections = getFilteredAndSortedSections();
  
  if (sections.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:16px;font-size:11px;">无匹配截面</div>';
    return;
  }

  let html = '';
  for (const section of sections) {
    html += `
      <div class="section-item" data-section="${section.name}">
        <div class="section-item-header">
          <span class="section-item-name">${section.name}</span>
          <span class="section-item-category">${section.category}</span>
        </div>
        <div class="section-item-params">
          <span>A=${(section.A * 1e4).toFixed(2)}cm²</span>
          <span>I=${(section.Ix * 1e8).toFixed(2)}cm⁴</span>
          <span>h=${(section.h * 100).toFixed(1)}cm</span>
          <span>${section.weight.toFixed(1)}kg/m</span>
        </div>
        <button class="section-apply-btn" data-section="${section.name}">应用到选中杆件</button>
      </div>
    `;
  }
  container.innerHTML = html;

  container.querySelectorAll('.section-apply-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const sectionName = btn.dataset.section;
      applySectionToSelectedMembers(sectionName);
    };
  });

  container.querySelectorAll('.section-item').forEach(item => {
    item.onclick = () => {
      const sectionName = item.dataset.section;
      applySectionToSelectedMembers(sectionName);
    };
  });
}

function applySectionToSelectedMembers(sectionName) {
  if (selectedMembers.size === 0) {
    alert('请先选择杆件');
    return;
  }

  const section = getSectionByName(sectionName);
  if (!section) return;

  let changed = false;
  for (const memberId of selectedMembers) {
    const member = members.find(m => m.id === memberId);
    if (member) {
      member.A = section.A;
      member.I = section.Ix;
      member.h = section.h;
      member.sectionName = sectionName;
      changed = true;
    }
  }

  if (changed) {
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
    updateSelectedMembersSectionInfo();
    saveToStorage();
    updateStatus(`已将截面 ${sectionName} 应用到 ${selectedMembers.size} 根杆件`);
  }
}

function updateSelectedMembersSectionInfo() {
  const container = document.getElementById('selected-members-section-info');
  if (!container) return;

  if (selectedMembers.size === 0) {
    container.innerHTML = '<div class="no-selection-hint">未选中杆件</div>';
    return;
  }

  let html = '';
  for (const memberId of selectedMembers) {
    const member = members.find(m => m.id === memberId);
    if (!member) continue;

    const sectionName = member.sectionName || '自定义';
    const isCustom = !member.sectionName;
    
    html += `
      <div class="selected-member-section-item">
        <div class="member-id">杆件 #${memberId}</div>
        <div class="section-name ${isCustom ? 'custom' : ''}">${sectionName}</div>
        <div class="section-params">
          A=${(member.A * 1e4).toFixed(2)}cm²
          I=${(member.I * 1e8).toFixed(2)}cm⁴
          h=${(member.h * 100).toFixed(1)}cm
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

function updateAutoSelectButtonState() {
  const btn = document.getElementById('btn-auto-select');
  const hint = document.getElementById('auto-select-hint');
  if (!btn || !hint) return;

  const canAutoSelect = hasResults && members.length > 0;
  btn.disabled = !canAutoSelect;
  
  if (!canAutoSelect) {
    hint.style.display = 'block';
    hint.textContent = '请先求解工况';
  } else {
    hint.style.display = 'none';
  }
}

function runAutoSelect() {
  if (!hasResults) {
    alert('请先求解工况');
    return;
  }

  const results = [];
  let successCount = 0;
  let failCount = 0;
  let totalWeightBefore = 0;
  let totalWeightAfter = 0;
  const PIXEL_TO_METER = 0.01;

  for (const member of members) {
    const lengthM = member.length * PIXEL_TO_METER;
    const weightBefore = (member.sectionName ? (getSectionByName(member.sectionName)?.weight || 0) : member.A * 7850) * lengthM;
    totalWeightBefore += weightBefore;

    let axialForce = member.axialForce || 0;
    let maxMoment = 0;

    if (analysisMode === 'frame' && frameResults) {
      const mr = frameResults.members.find(m => m.id === member.id);
      if (mr) {
        axialForce = mr.axialForce || 0;
        const q = mr.q !== undefined ? mr.q : (member.q || 0);
        maxMoment = calculateMaxMoment(mr.M1 || 0, mr.M2 || 0, q, lengthM);
      }
    }

    const result = selectOptimalSection(axialForce, maxMoment, YIELD_STRENGTH, SAFETY_FACTOR);
    
    if (result) {
      const weightAfter = result.section.weight * lengthM;
      totalWeightAfter += weightAfter;
      successCount++;
      results.push({
        memberId: member.id,
        section: result.section,
        maxStress: result.maxStress,
        utilization: result.utilization,
        safetyMargin: result.safetyMargin,
        axialForce,
        maxMoment
      });

      member.A = result.section.A;
      member.I = result.section.Ix;
      member.h = result.section.h;
      member.sectionName = result.section.name;
    } else {
      failCount++;
      results.push({
        memberId: member.id,
        section: null,
        error: '无满足要求的截面',
        axialForce,
        maxMoment
      });
    }
  }

  loadCases.forEach(lc => { lc.solved = false; lc.results = null; });
  hasResults = false;
  renderer.hasResults = false;
  frameResults = null;
  renderer.frameResults = null;
  envelopeData = null;
  renderer.envelopeData = null;

  try {
    solveCurrentLoadCase();
  } catch (e) {
    console.warn('自动选型后重新求解失败:', e.message);
  }

  autoSelectResults = results;
  renderAutoSelectResults(successCount, failCount, totalWeightBefore, totalWeightAfter);
  historyManager.saveState(nodes, members);
  saveToStorage();
  render();
  updateSelectedMembersSectionInfo();
}

function renderAutoSelectResults(successCount, failCount, weightBefore, weightAfter) {
  const resultsDiv = document.getElementById('auto-select-results');
  const summaryDiv = resultsDiv.querySelector('.auto-select-summary');
  const listDiv = document.getElementById('auto-select-list');
  
  if (!resultsDiv || !summaryDiv || !listDiv) return;

  resultsDiv.style.display = 'block';
  
  const weightSaved = weightBefore - weightAfter;
  const weightSavedPct = weightBefore > 0 ? (weightSaved / weightBefore * 100).toFixed(1) : 0;
  
  summaryDiv.innerHTML = `
    成功选型 ${successCount} 根${failCount > 0 ? `，失败 ${failCount} 根` : ''}<br/>
    <small>减重: ${weightSaved.toFixed(1)} kg (${weightSavedPct}%)</small>
  `;

  let html = '';
  for (const r of autoSelectResults) {
    if (r.section) {
      html += `
        <div class="auto-select-item" data-member="${r.memberId}">
          <div class="auto-select-item-header">
            <span class="auto-select-item-member">杆件 #${r.memberId}</span>
            <span class="auto-select-item-section">${r.section.name}</span>
          </div>
          <div class="auto-select-item-details">
            <span>利用率: ${(r.utilization * 100).toFixed(1)}%</span>
            <span>裕度: ${r.safetyMargin === Infinity ? '∞' : r.safetyMargin.toFixed(1)}%</span>
          </div>
          <div class="auto-select-item-details">
            <span>应力: ${(r.maxStress / 1e6).toFixed(1)} MPa</span>
            <span>${r.section.weight.toFixed(1)} kg/m</span>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="auto-select-item over-limit" data-member="${r.memberId}">
          <div class="auto-select-item-header">
            <span class="auto-select-item-member">杆件 #${r.memberId}</span>
            <span class="auto-select-item-section">选型失败</span>
          </div>
          <div class="auto-select-item-details">
            <span>${r.error}</span>
          </div>
        </div>
      `;
    }
  }
  
  listDiv.innerHTML = html;

  listDiv.querySelectorAll('.auto-select-item').forEach(item => {
    item.onclick = () => {
      const memberId = parseInt(item.dataset.member);
      const r = autoSelectResults.find(x => x.memberId === memberId);
      if (r && r.section) {
        applySectionToMember(memberId, r.section.name);
      }
    };
  });
}

function applyAutoSelectResults() {
  if (!autoSelectResults) return;

  let changed = false;
  for (const r of autoSelectResults) {
    if (r.section) {
      const member = members.find(m => m.id === r.memberId);
      if (member) {
        member.A = r.section.A;
        member.I = r.section.Ix;
        member.h = r.section.h;
        member.sectionName = r.section.name;
        changed = true;
      }
    }
  }

  if (changed) {
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
    updateSelectedMembersSectionInfo();
    saveToStorage();
    updateStatus('自动选型结果已应用到所有杆件');
  }
}

function applySectionToMember(memberId, sectionName) {
  const section = getSectionByName(sectionName);
  if (!section) return;

  const member = members.find(m => m.id === memberId);
  if (!member) return;

  member.A = section.A;
  member.I = section.Ix;
  member.h = section.h;
  member.sectionName = sectionName;

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
  updateSelectedMembersSectionInfo();
  saveToStorage();
  updateStatus(`杆件 #${memberId} 截面已更新为 ${sectionName}`);
}

function initSectionTabEvents() {
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.onclick = () => {
      switchPanelTab(tab.dataset.tab);
    };
  });

  const searchInput = document.getElementById('section-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      sectionSearchQuery = e.target.value;
      renderSectionList();
    };
  }

  document.querySelectorAll('.section-filter-btn').forEach(btn => {
    btn.onclick = () => {
      sectionFilterCategory = btn.dataset.category;
      document.querySelectorAll('.section-filter-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
      renderSectionList();
    };
  });

  const sortSelect = document.getElementById('section-sort-select');
  if (sortSelect) {
    sortSelect.onchange = (e) => {
      sectionSortBy = e.target.value;
      renderSectionList();
    };
  }

  const sortToggleBtn = document.getElementById('btn-sort-toggle');
  if (sortToggleBtn) {
    sortToggleBtn.onclick = () => {
      sectionSortAscending = !sectionSortAscending;
      sortToggleBtn.textContent = sectionSortAscending ? '↑' : '↓';
      renderSectionList();
    };
  }

  const autoSelectBtn = document.getElementById('btn-auto-select');
  if (autoSelectBtn) {
    autoSelectBtn.onclick = () => {
      runAutoSelect();
    };
  }
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

  initSectionTabEvents();

  render();
  updateLoadCaseList();
  updateButtonStates();
  updateResultsDisplay();
  updateAnalysisModeButtons();
  updateForceDiagramButtons();
  updateSchemeList();
  updateAutoSelectButtonState();
  updatePushoverButtonStates();
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
  updateSelectedMembersSectionInfo();
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
  const originalSectionName = member.sectionName || '';
  const originalA = member.A;
  const originalI = member.I;
  const originalH = member.h;

  const sectionDisplay = member.sectionName || '自定义';
  const isCustom = !member.sectionName;

  let html = `
    <div class="form-group">
      <label>截面型号</label>
      <div style="padding:8px 12px;background:${isCustom ? '#f5f5f5' : '#e3f2fd'};border:1px solid ${isCustom ? '#e0e0e0' : '#1976d2'};border-radius:4px;font-size:14px;color:${isCustom ? '#999' : '#1976d2'};font-weight:${isCustom ? 'normal' : '500'};">
        ${isCustom ? '<em>自定义</em>' : sectionDisplay}
      </div>
      <p style="font-size:11px;color:#999;margin-top:4px;">修改A/I/h参数后将变为自定义截面</p>
    </div>
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
    const newA = (parseFloat(document.getElementById('input-a').value) || 10) * 1e-4;
    member.A = newA;
    
    let newI = originalI;
    if (analysisMode === 'frame') {
      newI = (parseFloat(document.getElementById('input-i').value) || 1) * 1e-8;
      member.I = newI;
    }
    
    let newH = originalH;
    const hInput = document.getElementById('input-h');
    if (hInput) {
      newH = (parseFloat(hInput.value) || 20) * 1e-2;
      member.h = newH;
    }
    
    member.rho = parseFloat(document.getElementById('input-rho').value) || 7850;

    const sectionChanged = Math.abs(newA - originalA) > 1e-12 || 
                          Math.abs(newI - originalI) > 1e-12 || 
                          Math.abs(newH - originalH) > 1e-12;
    
    if (sectionChanged && originalSectionName) {
      member.sectionName = null;
    }

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
    updateSelectedMembersSectionInfo();
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

    if (bucklingResults && bucklingResults.memberEffectiveLengths) {
      const bl = bucklingResults.memberEffectiveLengths.get(member.id);
      if (bl) {
        html += `<br/><hr style="border:none;border-top:1px solid #e0e0e0;margin:4px 0;"/>`;
        html += `<span style="color:#bf360c;"><strong>屈曲分析:</strong></span><br/>`;
        html += `有效长度系数 μ = ${bl.mu.toFixed(3)}<br/>`;
        html += `临界力 Pcr = ${(bl.Pcr / 1000).toFixed(2)} kN`;
      }
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

  const hasStaticResults = hasResults || loadCases.some(lc => lc.solved);
  const btnBuckling = document.getElementById('btn-buckling');
  if (btnBuckling) {
    btnBuckling.disabled = !hasStaticResults;
    btnBuckling.title = hasStaticResults ? '屈曲分析' : '请先进行静力分析';
    btnBuckling.style.opacity = hasStaticResults ? '1' : '0.5';
    btnBuckling.style.cursor = hasStaticResults ? 'pointer' : 'not-allowed';
  }
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

function isPortalFramePreset() {
  if (members.length !== 3 || nodes.length !== 4) return false;
  const fixedNodes = nodes.filter(n => n.support === 'fixed');
  return fixedNodes.length === 2;
}

function updatePushoverButtonStates() {
  const btn = document.getElementById('btn-pushover');
  if (btn) {
    btn.classList.toggle('active', pushoverActive);
    btn.disabled = analysisMode !== 'frame';
    btn.title = analysisMode !== 'frame' ? '仅刚架模式可用' : '推覆分析';
    btn.style.opacity = analysisMode !== 'frame' ? '0.5' : '1';
    btn.style.cursor = analysisMode !== 'frame' ? 'not-allowed' : 'pointer';
  }

  const demoSection = document.getElementById('po-demo-section');
  if (demoSection) {
    demoSection.style.display = isPortalFramePreset() ? 'block' : 'none';
  }
}

function enterPushoverMode() {
  if (analysisMode !== 'frame') {
    alert('推覆分析仅在刚架模式下可用');
    return;
  }
  if (modalActive) exitModalMode();
  if (bucklingActive) exitBucklingMode();
  if (influenceActive) exitInfluenceMode();
  if (constructionActive) exitConstructionMode();
  if (topoActive) exitTopoMode();
  if (compareActive) exitCompareMode();
  if (sectionStressActive) hideSectionStressView();

  pushoverActive = true;
  renderer.pushoverActive = true;

  pushoverSavedNodes = deepClone(nodes.map(n => ({
    id: n.id, x: n.x, y: n.y, support: n.support,
    fx: n.fx, fy: n.fy, m: n.m,
    dx: n.dx, dy: n.dy, dtheta: n.dtheta
  })));
  pushoverSavedMembers = deepClone(members.map(m => ({
    id: m.id, node1Id: m.node1Id, node2Id: m.node2Id,
    length: m.length, angle: m.angle,
    E: m.E, A: m.A, I: m.I, h: m.h, rho: m.rho,
    release1: m.release1, release2: m.release2, q: m.q,
    axialForce: m.axialForce, stress: m.stress,
    sectionName: m.sectionName, b: m.b, Wpl: m.Wpl
  })));
  pushoverSavedFrameResults = frameResults ? deepClone(frameResults) : null;
  pushoverSavedHasResults = hasResults;
  pushoverSavedShowDeformed = renderer.showDeformed;
  pushoverSavedViewMode = viewMode;
  pushoverSavedCurrentSectionTab = currentSectionTab;

  document.getElementById('btn-pushover').classList.add('active');
  document.getElementById('pushover-panel').classList.remove('hidden');
  document.getElementById('pushover-timeline-container').classList.remove('hidden');
  pushoverPanelVisible = true;

  switchPanelTab('pushover');

  updatePushoverButtonStates();
  updatePushoverControlsState();
  updatePushoverTimeline();
  drawPushoverCapacityCurve();
  render();
  updateStatus('推覆分析模式: 设置参数后点击"开始推覆"');
}

function exitPushoverMode() {
  stopPushoverAnalysis();
  pushoverActive = false;
  renderer.pushoverActive = false;
  renderer.pushoverHinges = [];
  renderer.pushoverHighlightStep = -1;

  if (pushoverSavedNodes) {
    pushoverSavedNodes.forEach(sn => {
      const n = nodes.find(x => x.id === sn.id);
      if (n) {
        n.x = sn.x; n.y = sn.y;
        n.support = sn.support;
        n.fx = sn.fx; n.fy = sn.fy; n.m = sn.m;
        n.dx = sn.dx; n.dy = sn.dy; n.dtheta = sn.dtheta;
      }
    });
  }
  if (pushoverSavedMembers) {
    pushoverSavedMembers.forEach(sm => {
      const m = members.find(x => x.id === sm.id);
      if (m) {
        m.node1Id = sm.node1Id; m.node2Id = sm.node2Id;
        m.length = sm.length; m.angle = sm.angle;
        m.E = sm.E; m.A = sm.A; m.I = sm.I; m.h = sm.h; m.rho = sm.rho;
        m.release1 = sm.release1; m.release2 = sm.release2; m.q = sm.q;
        m.axialForce = sm.axialForce; m.stress = sm.stress;
        m.sectionName = sm.sectionName; m.b = sm.b; m.Wpl = sm.Wpl;
      }
    });
  }
  frameResults = pushoverSavedFrameResults;
  renderer.frameResults = frameResults;
  hasResults = pushoverSavedHasResults;
  renderer.hasResults = hasResults;
  renderer.showDeformed = pushoverSavedShowDeformed;
  viewMode = pushoverSavedViewMode;
  renderer.viewMode = viewMode;
  if (frameResults) {
    maxForce = frameResults.maxForce || 0;
    maxMoment = frameResults.maxMoment || 0;
    renderer.maxForce = maxForce;
    renderer.maxMoment = maxMoment;
  }

  pushoverAnalyzer = null;
  pushoverCurrentStep = -1;
  pushoverSavedNodes = null;
  pushoverSavedMembers = null;
  pushoverSavedFrameResults = null;

  document.getElementById('btn-pushover').classList.remove('active');
  document.getElementById('pushover-panel').classList.add('hidden');
  document.getElementById('pushover-timeline-container').classList.add('hidden');
  pushoverPanelVisible = false;

  switchPanelTab(pushoverSavedCurrentSectionTab);
  updateViewModeButtons();

  const tooltipEl = document.getElementById('tooltip');
  if (tooltipEl) tooltipEl.classList.add('hidden');
  updatePushoverButtonStates();
  updatePushoverControlsState();
  updateButtonStates();
  render();
  updateResultsDisplay();
  updateStatus('已退出推覆分析模式');
}

function updatePushoverControlsState() {
  const canStart = !pushoverRunning && analysisMode === 'frame';
  document.getElementById('btn-po-start').disabled = !canStart;
  document.getElementById('btn-po-stop').style.display = pushoverRunning ? 'block' : 'none';
  document.getElementById('btn-po-reset').style.display = (pushoverAnalyzer && !pushoverRunning) ? 'block' : 'none';

  const settingsDisabled = pushoverRunning || pushoverAnalyzer !== null;
  document.getElementById('po-pattern').disabled = settingsDisabled;
  document.getElementById('po-direction').disabled = settingsDisabled;
  document.getElementById('po-force-inc').disabled = settingsDisabled;
  document.getElementById('po-max-steps').disabled = settingsDisabled;
  document.getElementById('po-fy').disabled = settingsDisabled;

  document.getElementById('po-progress-section').style.display = pushoverRunning ? 'block' : 'none';
}

function updatePushoverStatusDisplay(stepData) {
  document.getElementById('po-cur-step').textContent = stepData ? stepData.step + 1 : 0;
  document.getElementById('po-cur-shear').textContent = stepData ? (stepData.baseShear / 1000).toFixed(2) : '0';
  document.getElementById('po-cur-disp').textContent = stepData ? (stepData.topDisplacement * 1000).toFixed(2) : '0';
  document.getElementById('po-cur-hinges').textContent = pushoverAnalyzer ? pushoverAnalyzer.hinges.length : 0;
}

function updatePushoverTimeline() {
  const slider = document.getElementById('pushover-timeline-slider');
  const info = document.getElementById('pushover-step-info');
  const max = pushoverAnalyzer ? Math.max(0, pushoverAnalyzer.steps.length - 1) : 0;
  slider.max = max;
  const curStep = pushoverCurrentStep >= 0 ? pushoverCurrentStep : max;
  slider.value = curStep;
  if (pushoverAnalyzer && pushoverAnalyzer.steps.length > 0 && curStep >= 0 && curStep < pushoverAnalyzer.steps.length) {
    const s = pushoverAnalyzer.steps[curStep];
    info.textContent = `步${curStep + 1}/${pushoverAnalyzer.steps.length}  V=${(s.baseShear / 1000).toFixed(1)}kN  Δ=${(s.topDisplacement * 1000).toFixed(1)}mm  铰=${pushoverAnalyzer.getHingesAtStep(curStep).length}`;
  } else {
    info.textContent = `0/0`;
  }
}

function drawPushoverCapacityCurve() {
  const canvas = document.getElementById('pushover-canvas');
  if (!canvas || !pushoverPanelVisible) return;
  const curve = pushoverAnalyzer ? pushoverAnalyzer.capacityCurve : [];
  const highlight = pushoverCurrentStep >= 0 ? pushoverCurrentStep :
    (pushoverAnalyzer && pushoverAnalyzer.steps.length > 0 ? pushoverAnalyzer.steps.length - 1 : -1);
  Renderer.drawCapacityCurve(canvas, curve, { highlightStep: highlight });
}

function applyPushoverStepToScene(stepIndex) {
  if (!pushoverAnalyzer) return;
  if (stepIndex < 0 || stepIndex >= pushoverAnalyzer.steps.length) return;

  const step = pushoverAnalyzer.getStep(stepIndex);
  if (!step) return;

  step.nodes.forEach(sn => {
    const n = nodes.find(x => x.id === sn.id);
    if (n) {
      n.fx = sn.fx; n.fy = sn.fy; n.m = sn.m;
      n.dx = sn.dx; n.dy = sn.dy; n.dtheta = sn.dtheta || 0;
    }
  });

  step.members.forEach(sm => {
    const m = members.find(x => x.id === sm.id);
    if (m) {
      m.axialForce = sm.axialForce; m.stress = sm.stress;
    }
  });

  const hingesAtStep = pushoverAnalyzer.getHingesAtStep(stepIndex);
  members.forEach(m => {
    const h1 = hingesAtStep.find(h => h.memberId === m.id && h.end === 1);
    const h2 = hingesAtStep.find(h => h.memberId === m.id && h.end === 2);
    m.release1 = h1 ? true : (pushoverSavedMembers.find(s => s.id === m.id)?.release1 || false);
    m.release2 = h2 ? true : (pushoverSavedMembers.find(s => s.id === m.id)?.release2 || false);
  });

  if (step.results) {
    frameResults = step.results;
    renderer.frameResults = frameResults;
    maxForce = frameResults.maxForce || 0;
    maxMoment = frameResults.maxMoment || 0;
    renderer.maxForce = maxForce;
    renderer.maxMoment = maxMoment;
    hasResults = true;
    renderer.hasResults = true;
  }

  renderer.pushoverHinges = hingesAtStep;
  renderer.pushoverHighlightStep = stepIndex;
  pushoverCurrentStep = stepIndex;

  updatePushoverStatusDisplay(step);
}

function startPushoverAnalysis() {
  if (analysisMode !== 'frame') {
    alert('推覆分析仅在刚架模式下可用');
    return;
  }

  const pattern = document.getElementById('po-pattern').value;
  const direction = document.getElementById('po-direction').value;
  const forceInc = parseFloat(document.getElementById('po-force-inc').value) || 5000;
  const maxSteps = parseInt(document.getElementById('po-max-steps').value) || 100;
  const fy = (parseFloat(document.getElementById('po-fy').value) || 235) * 1e6;

  pushoverAnalyzer = new PushoverAnalyzer(nodes, members, {
    pattern, direction, forceIncrement: forceInc, maxSteps, fy
  });
  pushoverRunning = true;
  pushoverCurrentStep = -1;

  document.getElementById('po-results-section').style.display = 'none';
  updatePushoverControlsState();
  updateStatus('推覆分析进行中...');

  let frameCount = 0;
  const runBatch = () => {
    if (!pushoverRunning) return;

    const batchSize = 3;
    let anyNew = false;

    for (let i = 0; i < batchSize; i++) {
      if (pushoverAnalyzer.finished) break;
      const result = pushoverAnalyzer.runStep();
      anyNew = true;
      if (!result) break;

      const stepIdx = result.step;
      applyPushoverStepToScene(stepIdx);

      if (result.newHinges && result.newHinges.length > 0) {
        const names = result.newHinges.map(h => `杆件#${h.memberId}${h.end === 1 ? '左端' : '右端'}`).join(', ');
        updateStatus(`第${stepIdx + 1}步: 新塑性铰 → ${names}`);
      }

      if (result.isCollapse) {
        updateStatus(`⚠ 结构在第${stepIdx + 1}步形成机构，已倒塌!`);
        break;
      }
    }

    if (anyNew) {
      const total = pushoverAnalyzer.steps.length;
      const pct = Math.min(100, (total / maxSteps) * 100);
      document.getElementById('po-progress-fill').style.width = pct + '%';
      document.getElementById('po-progress-text').textContent = `步骤 ${total} / ${maxSteps}`;

      updatePushoverTimeline();
      drawPushoverCapacityCurve();
      render();
    }

    if (pushoverAnalyzer.finished) {
      pushoverRunning = false;
      finishPushoverAnalysis();
      return;
    }

    pushoverTimer = setTimeout(runBatch, 0);
  };

  runBatch();
}

function stopPushoverAnalysis() {
  pushoverRunning = false;
  if (pushoverTimer) {
    clearTimeout(pushoverTimer);
    pushoverTimer = null;
  }
  updatePushoverControlsState();
}

function finishPushoverAnalysis() {
  stopPushoverAnalysis();
  updatePushoverControlsState();
  updatePushoverTimeline();
  drawPushoverCapacityCurve();
  render();
  showPushoverResults();
}

function showPushoverResults() {
  if (!pushoverAnalyzer) return;
  const summary = pushoverAnalyzer.getSummary();
  const section = document.getElementById('po-results-section');
  section.style.display = 'block';

  const summaryHtml = `
    <div class="po-status-item">总步数: <span>${summary.totalSteps}</span></div>
    <div class="po-status-item">最大基底剪力: <span>${(summary.maxBaseShear / 1000).toFixed(2)} kN</span></div>
    <div class="po-status-item">顶点极限位移: <span>${(summary.ultimateDisplacement * 1000).toFixed(2)} mm</span></div>
    <div class="po-status-item">塑性铰总数: <span>${summary.totalHinges}</span></div>
    <div class="po-status-item">结构状态: <span style="color:${summary.collapsed ? '#c62828' : '#2e7d32'}">${summary.collapsed ? '已倒塌' : '未倒塌'}</span></div>
  `;
  document.getElementById('po-result-summary').innerHTML = `<div class="po-status-box">${summaryHtml}</div>`;

  const hingeList = document.getElementById('po-hinge-list');
  if (summary.hingeFormationSteps.length === 0) {
    hingeList.innerHTML = '<div style="font-size:11px;color:#999;padding:8px;">未形成塑性铰</div>';
  } else {
    hingeList.innerHTML = summary.hingeFormationSteps.map(step => {
      const hingeNames = step.hinges.map(h =>
        `<div class="po-hinge-item">
          <span class="po-hinge-step">第${step.step + 1}步</span>
          杆件#${h.memberId}${h.end === 1 ? '左端' : '右端'}
          <small style="color:#666;">M=${(Math.abs(h.moment) / 1000).toFixed(2)}kN·m / Mp=${(h.Mp / 1000).toFixed(2)}kN·m</small>
        </div>`
      ).join('');
      return hingeNames;
    }).join('');
  }

  const msg = summary.collapsed
    ? `推覆完成: ${summary.totalSteps}步, 最大剪力${(summary.maxBaseShear / 1000).toFixed(1)}kN, 形成${summary.totalHinges}个塑性铰后倒塌`
    : `推覆完成: ${summary.totalSteps}步, 最大剪力${(summary.maxBaseShear / 1000).toFixed(1)}kN, 共${summary.totalHinges}个塑性铰`;
  updateStatus(msg);
}

function resetPushoverAnalysis() {
  stopPushoverAnalysis();

  if (pushoverSavedNodes) {
    pushoverSavedNodes.forEach(sn => {
      const n = nodes.find(x => x.id === sn.id);
      if (n) {
        n.fx = sn.fx; n.fy = sn.fy; n.m = sn.m;
        n.dx = sn.dx; n.dy = sn.dy; n.dtheta = sn.dtheta;
      }
    });
  }
  if (pushoverSavedMembers) {
    pushoverSavedMembers.forEach(sm => {
      const m = members.find(x => x.id === sm.id);
      if (m) {
        m.release1 = sm.release1; m.release2 = sm.release2;
        m.q = sm.q; m.axialForce = sm.axialForce; m.stress = sm.stress;
      }
    });
  }
  frameResults = pushoverSavedFrameResults;
  renderer.frameResults = frameResults;
  hasResults = pushoverSavedHasResults;
  renderer.hasResults = hasResults;
  if (frameResults) {
    maxForce = frameResults.maxForce || 0;
    maxMoment = frameResults.maxMoment || 0;
    renderer.maxForce = maxForce;
    renderer.maxMoment = maxMoment;
  }

  pushoverAnalyzer = null;
  pushoverCurrentStep = -1;
  renderer.pushoverHinges = [];
  renderer.pushoverHighlightStep = -1;

  document.getElementById('po-progress-fill').style.width = '0%';
  document.getElementById('po-progress-text').textContent = '步骤 0 / 0';
  document.getElementById('po-results-section').style.display = 'none';
  updatePushoverStatusDisplay(null);

  updatePushoverControlsState();
  updatePushoverTimeline();
  drawPushoverCapacityCurve();
  render();
  updateStatus('推覆分析已重置');
}

function demoPushoverAnalysis() {
  document.getElementById('po-pattern').value = 'triangle';
  document.getElementById('po-direction').value = 'right';
  document.getElementById('po-force-inc').value = 3000;
  document.getElementById('po-max-steps').value = 80;
  document.getElementById('po-fy').value = 235;
  startPushoverAnalysis();
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (compareActive) return;
  if (pushoverActive) return;

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

  updateSelectedMembersSectionInfo();
  render();
});

canvas.addEventListener('mousemove', (e) => {
  if (compareActive) return;
  const pos = getMousePos(e);

  if (pushoverActive) {
    const hinge = renderer.findHingeAtScreenPos(pos.x, pos.y);
    const tooltip = document.getElementById('tooltip');
    if (hinge) {
      const html = `<strong>塑性铰</strong><br/>
        杆件 #${hinge.memberId} ${hinge.end === 1 ? '左端' : '右端'}<br/>
        形成步骤: 第${hinge.step + 1}步<br/>
        荷载水平: ${(hinge.loadLevel / 1000).toFixed(1)} kN<br/>
        弯矩: ${(Math.abs(hinge.moment) / 1000).toFixed(2)} / ${(hinge.Mp / 1000).toFixed(2)} kN·m`;
      tooltip.innerHTML = html;
      tooltip.style.left = (e.clientX + 12) + 'px';
      tooltip.style.top = (e.clientY + 12) + 'px';
      tooltip.classList.remove('hidden');
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.classList.add('hidden');
      canvas.style.cursor = 'default';
    }
    return;
  }

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
  if (compareActive) return;

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
    updateSelectedMembersSectionInfo();
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
  if (compareActive) { e.preventDefault(); return; }
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
  if (compareActive) return;
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

document.getElementById('btn-buckling').addEventListener('click', () => {
  if (bucklingActive) {
    exitBucklingMode();
  } else {
    startBucklingAnalysis();
  }
});

document.getElementById('btn-buckling-close').addEventListener('click', exitBucklingMode);

document.getElementById('buckling-scale-factor').addEventListener('change', (e) => {
  bucklingScaleFactor = parseFloat(e.target.value) || 50;
});

document.getElementById('buckling-num-modes').addEventListener('change', () => {
  if (bucklingActive) {
    startBucklingAnalysis();
  }
});

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
    if (bucklingActive) exitBucklingMode();
    if (influenceActive) exitInfluenceMode();
    if (constructionActive) exitConstructionMode();
    if (topoActive) exitTopoMode();
    if (compareActive) exitCompareMode();
    constructionStages = [];
    currentStageIndex = -1;
    compareSchemes = [];
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
  if (bucklingActive) exitBucklingMode();
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
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');
    
    if (tabName === 'section') {
      renderSectionList();
      updateSelectedMembersSectionInfo();
      updateAutoSelectButtonState();
    }
    if (tabName === 'timehistory') {
      updateThNodeSelects();
      updateThObserveList();
      setTimeout(() => {
        if (thLoadType === 'piecewise') {
          resizeThPiecewiseCanvas();
          drawThPiecewiseCanvas();
        }
      }, 10);
    }
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

document.getElementById('btn-compare').addEventListener('click', () => {
  if (compareActive) {
    exitCompareMode();
  } else {
    enterCompareMode();
  }
});

document.getElementById('btn-save-scheme').addEventListener('click', () => {
  const defaultName = `方案${compareSchemes.length + 1}`;
  const html = `
    <div class="form-group">
      <label>方案名称</label>
      <input type="text" id="input-scheme-name" value="${defaultName}" />
    </div>
  `;
  showModal('保存方案', html, () => {
    const name = document.getElementById('input-scheme-name').value.trim();
    if (name) saveScheme(name);
  });
});

document.getElementById('btn-exit-compare').addEventListener('click', exitCompareMode);

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

// ==================== 动力时程分析 ====================

let timeHistoryActive = false;
let thLoadType = 'sine';
let thSineAmplitude = 10000;
let thSineFrequency = 1;
let thSineDuration = 5;
let thPiecewisePoints = [];
let thPiecewiseTotalTime = 5;
let thPiecewiseMaxForce = 10000;
let thLoadNodeId = null;
let thLoadDirection = 'fy';
let thObserveNodes = [];
let thObserveDirection = 'dy';
let thNumSteps = 200;
let thResults = null;
let thRunning = false;
let thStopRequested = false;
let thHoverTimeIdx = -1;
let thShowDx = false;
let thShowDy = true;
let thPiecewiseDraggingIdx = -1;
let thColors = ['#e65100', '#1565c0', '#2e7d32', '#f9a825', '#7b1fa2', '#c62828', '#00838f', '#ef6c00'];

function getThLoadValue(t) {
  if (thLoadType === 'sine') {
    return thSineAmplitude * Math.sin(2 * Math.PI * thSineFrequency * t);
  } else {
    if (thPiecewisePoints.length < 2) return 0;
    const pts = [...thPiecewisePoints].sort((a, b) => a.t - b.t);
    if (t <= pts[0].t) return pts[0].f * thPiecewiseMaxForce;
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].f * thPiecewiseMaxForce;
    for (let i = 0; i < pts.length - 1; i++) {
      if (t >= pts[i].t && t <= pts[i + 1].t) {
        const ratio = (t - pts[i].t) / (pts[i + 1].t - pts[i].t);
        return (pts[i].f + (pts[i + 1].f - pts[i].f) * ratio) * thPiecewiseMaxForce;
      }
    }
    return 0;
  }
}

function updateThNodeSelects() {
  const loadSelect = document.getElementById('th-load-node');
  const observeSelect = document.getElementById('th-observe-node-select');
  
  loadSelect.innerHTML = '<option value="">-- 选择节点 --</option>';
  observeSelect.innerHTML = '<option value="">-- 选择节点 --</option>';
  
  nodes.forEach(node => {
    const opt1 = document.createElement('option');
    opt1.value = node.id;
    opt1.textContent = `节点 #${node.id}`;
    loadSelect.appendChild(opt1);
    
    const opt2 = document.createElement('option');
    opt2.value = node.id;
    opt2.textContent = `节点 #${node.id}`;
    observeSelect.appendChild(opt2);
  });
}

function updateThObserveList() {
  const container = document.getElementById('th-observe-list');
  container.innerHTML = '';
  
  if (thObserveNodes.length === 0) {
    container.innerHTML = '<div style="font-size:11px;color:#999;padding:8px;text-align:center;">暂无观测节点</div>';
    return;
  }
  
  thObserveNodes.forEach((obs, idx) => {
    const item = document.createElement('div');
    item.className = 'th-observe-item';
    
    const info = document.createElement('div');
    info.className = 'th-observe-item-info';
    
    const color = document.createElement('div');
    color.className = 'th-observe-item-color';
    color.style.background = thColors[idx % thColors.length];
    
    const label = document.createElement('span');
    label.textContent = `节点#${obs.nodeId} - ${obs.direction === 'dx' ? '水平位移' : obs.direction === 'dy' ? '竖向位移' : '双向位移'}`;
    
    info.appendChild(color);
    info.appendChild(label);
    
    const del = document.createElement('span');
    del.className = 'th-observe-item-delete';
    del.textContent = '×';
    del.onclick = (e) => {
      e.stopPropagation();
      thObserveNodes.splice(idx, 1);
      updateThObserveList();
      if (thResults) drawTimeHistoryCurve();
    };
    
    item.appendChild(info);
    item.appendChild(del);
    container.appendChild(item);
  });
}

function drawThSinePreview() {
  const canvas = document.getElementById('th-sine-preview');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  if (W <= 0 || H <= 0) return;
  
  ctx.clearRect(0, 0, W, H);
  
  const margin = { left: 40, right: 15, top: 10, bottom: 20 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = margin.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(W - margin.right, y);
    ctx.stroke();
  }
  
  ctx.strokeStyle = '#999';
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top + plotH / 2);
  ctx.lineTo(W - margin.right, margin.top + plotH / 2);
  ctx.stroke();
  
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(W - margin.right, margin.top + plotH);
  ctx.stroke();
  
  const duration = thSineDuration;
  const numCycles = thSineFrequency * duration;
  ctx.strokeStyle = '#e65100';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 100; i++) {
    const tRatio = i / 100;
    const t = tRatio * duration;
    const f = Math.sin(2 * Math.PI * thSineFrequency * t);
    const x = margin.left + tRatio * plotW;
    const y = margin.top + plotH / 2 - f * plotH / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#666';
  ctx.textAlign = 'center';
  ctx.fillText('时间(s)', margin.left + plotW / 2, H - 4);
  ctx.textAlign = 'right';
  ctx.fillText('F', margin.left - 4, margin.top + 8);
  ctx.fillText('0', margin.left - 4, margin.top + plotH / 2 + 3);
  ctx.fillText('-F', margin.left - 4, margin.top + plotH - 2);
}

function resizeThSinePreview() {
  const canvas = document.getElementById('th-sine-preview');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  drawThSinePreview();
}

function drawThPiecewiseCanvas() {
  const canvas = document.getElementById('th-piecewise-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  if (W <= 0 || H <= 0) return;
  
  ctx.clearRect(0, 0, W, H);
  
  const margin = { left: 40, right: 20, top: 10, bottom: 20 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = margin.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(W - margin.right, y);
    ctx.stroke();
  }
  
  ctx.strokeStyle = '#999';
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top + plotH / 2);
  ctx.lineTo(W - margin.right, margin.top + plotH / 2);
  ctx.stroke();
  
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(W - margin.right, margin.top + plotH);
  ctx.stroke();
  
  const pts = [...thPiecewisePoints].sort((a, b) => a.t - b.t);
  if (pts.length >= 2) {
    ctx.strokeStyle = '#e65100';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = margin.left + p.t * plotW;
      const y = margin.top + plotH / 2 - p.f * plotH / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#e65100';
    ctx.lineWidth = 2;
    pts.forEach((p, i) => {
      const x = margin.left + p.t * plotW;
      const y = margin.top + plotH / 2 - p.f * plotH / 2;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }
  
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#666';
  ctx.textAlign = 'center';
  ctx.fillText('时间(s)', margin.left + plotW / 2, H - 4);
  ctx.textAlign = 'right';
  ctx.fillText('F', margin.left - 4, margin.top + 8);
  ctx.fillText('0', margin.left - 4, margin.top + plotH / 2 + 3);
  ctx.fillText('-F', margin.left - 4, margin.top + plotH - 2);
}

function resizeThPiecewiseCanvas() {
  const canvas = document.getElementById('th-piecewise-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  drawThPiecewiseCanvas();
}

function getThPiecewisePointAt(x, y) {
  const canvas = document.getElementById('th-piecewise-canvas');
  const rect = canvas.getBoundingClientRect();
  const margin = { left: 40, right: 20, top: 10, bottom: 20 };
  const plotW = canvas.width - margin.left - margin.right;
  const plotH = canvas.height - margin.top - margin.bottom;
  
  const cx = x - rect.left;
  const cy = y - rect.top;
  
  for (let i = 0; i < thPiecewisePoints.length; i++) {
    const p = thPiecewisePoints[i];
    const px = margin.left + p.t * plotW;
    const py = margin.top + plotH / 2 - p.f * plotH / 2;
    const dist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
    if (dist < 8) return i;
  }
  return -1;
}

function runTimeHistoryAnalysis() {
  if (!thLoadNodeId) {
    alert('请选择荷载作用节点');
    return;
  }
  if (thObserveNodes.length === 0) {
    alert('请至少添加一个观测节点');
    return;
  }
  
  const loadNode = nodes.find(n => n.id === thLoadNodeId);
  if (!loadNode) {
    alert('荷载节点不存在');
    return;
  }
  
  thRunning = true;
  thStopRequested = false;
  
  document.getElementById('btn-th-calculate').style.display = 'none';
  document.getElementById('btn-th-stop').style.display = 'block';
  document.getElementById('th-progress-section').style.display = 'block';
  document.getElementById('th-results-section').style.display = 'none';
  
  const savedFx = {};
  const savedFy = {};
  const savedM = {};
  const savedQ = {};
  nodes.forEach(n => { savedFx[n.id] = n.fx; savedFy[n.id] = n.fy; savedM[n.id] = n.m; });
  members.forEach(m => { savedQ[m.id] = m.q; });
  
  thResults = {
    timePoints: [],
    nodeResults: {},
    totalTime: thLoadType === 'sine' ? thSineDuration : thPiecewiseTotalTime
  };
  
  thObserveNodes.forEach(obs => {
    if (obs.direction === 'dx') {
      thResults.nodeResults[obs.nodeId + '_dx'] = [];
    } else if (obs.direction === 'dy') {
      thResults.nodeResults[obs.nodeId + '_dy'] = [];
    } else if (obs.direction === 'both') {
      thResults.nodeResults[obs.nodeId + '_dx'] = [];
      thResults.nodeResults[obs.nodeId + '_dy'] = [];
    }
  });
  
  const totalTime = thResults.totalTime;
  const dt = totalTime / thNumSteps;
  let currentStep = 0;
  
  function processStep() {
    if (thStopRequested || currentStep > thNumSteps) {
      finishAnalysis();
      return;
    }
    
    const t = currentStep * dt;
    thResults.timePoints.push(t);
    
    const loadValue = getThLoadValue(t);
    
    nodes.forEach(n => { n.fx = 0; n.fy = 0; n.m = 0; });
    members.forEach(m => { m.q = 0; });
    
    if (thLoadDirection === 'fx') {
      loadNode.fx = loadValue;
    } else {
      loadNode.fy = loadValue;
    }
    
    let result;
    try {
      if (analysisMode === 'frame') {
        result = solveFrame(nodes, members);
      } else {
        result = solveTruss(nodes, members);
      }
      
      thObserveNodes.forEach(obs => {
        const rn = result.nodes.find(n => n.id === obs.nodeId);
        if (rn) {
          if (obs.direction === 'dx') {
            thResults.nodeResults[obs.nodeId + '_dx'].push(rn.dx);
          } else if (obs.direction === 'dy') {
            thResults.nodeResults[obs.nodeId + '_dy'].push(rn.dy);
          } else if (obs.direction === 'both') {
            thResults.nodeResults[obs.nodeId + '_dx'].push(rn.dx);
            thResults.nodeResults[obs.nodeId + '_dy'].push(rn.dy);
          }
        }
      });
    } catch (e) {
      thObserveNodes.forEach(obs => {
        if (obs.direction === 'dx' || obs.direction === 'both') {
          thResults.nodeResults[obs.nodeId + '_dx'].push(0);
        }
        if (obs.direction === 'dy' || obs.direction === 'both') {
          thResults.nodeResults[obs.nodeId + '_dy'].push(0);
        }
      });
    }
    
    currentStep++;
    const progress = Math.floor((currentStep / thNumSteps) * 100);
    document.getElementById('th-progress-fill').style.width = progress + '%';
    document.getElementById('th-progress-text').textContent = progress + '%';
    
    if (currentStep % 5 === 0 || currentStep === thNumSteps) {
      drawTimeHistoryCurve();
    }
    
    requestAnimationFrame(processStep);
  }
  
  function finishAnalysis() {
    thRunning = false;
    
    nodes.forEach(n => { n.fx = savedFx[n.id]; n.fy = savedFy[n.id]; n.m = savedM[n.id]; });
    members.forEach(m => { m.q = savedQ[m.id]; });
    
    const lc = getCurrentLoadCase();
    if (lc && lc.solved && lc.results) {
      restoreResults(lc.results);
    }
    
    document.getElementById('btn-th-calculate').style.display = 'block';
    document.getElementById('btn-th-stop').style.display = 'none';
    document.getElementById('th-results-section').style.display = 'block';
    
    updateThResultSummary();
    drawTimeHistoryCurve();
    render();
    updateStatus('时程分析完成');
  }
  
  requestAnimationFrame(processStep);
}

function stopTimeHistoryAnalysis() {
  thStopRequested = true;
}

function updateThResultSummary() {
  const container = document.getElementById('th-result-summary');
  if (!thResults) {
    container.innerHTML = '';
    return;
  }
  
  let html = '';
  thObserveNodes.forEach((obs, idx) => {
    const keys = [];
    if (obs.direction === 'dx' || obs.direction === 'both') {
      keys.push({ key: obs.nodeId + '_dx', label: '水平位移 Dx' });
    }
    if (obs.direction === 'dy' || obs.direction === 'both') {
      keys.push({ key: obs.nodeId + '_dy', label: '竖向位移 Dy' });
    }
    
    keys.forEach(k => {
      const values = thResults.nodeResults[k.key];
      if (!values || values.length === 0) return;
      
      let maxVal = -Infinity;
      let minVal = Infinity;
      let maxIdx = 0;
      let minIdx = 0;
      values.forEach((v, i) => {
        if (v > maxVal) { maxVal = v; maxIdx = i; }
        if (v < minVal) { minVal = v; minIdx = i; }
      });
      
      html += `<div class="result-item">`;
      html += `<strong style="color:${thColors[idx % thColors.length]}">节点#${obs.nodeId} ${k.label}</strong><br/>`;
      html += `最大: ${(maxVal * 1000).toFixed(3)} mm (t=${thResults.timePoints[maxIdx].toFixed(3)}s)<br/>`;
      html += `最小: ${(minVal * 1000).toFixed(3)} mm (t=${thResults.timePoints[minIdx].toFixed(3)}s)`;
      html += `</div>`;
    });
  });
  
  container.innerHTML = html;
}

function drawTimeHistoryCurve() {
  const canvas = document.getElementById('time-history-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  if (W <= 0 || H <= 0) return;
  if (!thResults || !thResults.timePoints || thResults.timePoints.length === 0) return;
  
  ctx.clearRect(0, 0, W, H);
  
  const margin = { left: 70, right: 20, top: 20, bottom: 40 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  if (plotW <= 0 || plotH <= 0) return;
  
  const times = thResults.timePoints;
  const maxT = times[times.length - 1];
  const minT = 0;
  const rangeT = maxT - minT || 1;
  
  let allMax = 0;
  let allMin = 0;
  thObserveNodes.forEach((obs, idx) => {
    const keys = [];
    if (obs.direction === 'dx' || obs.direction === 'both') {
      if (thShowDx) keys.push(obs.nodeId + '_dx');
    }
    if (obs.direction === 'dy' || obs.direction === 'both') {
      if (thShowDy) keys.push(obs.nodeId + '_dy');
    }
    keys.forEach(k => {
      const vals = thResults.nodeResults[k];
      if (vals && vals.length > 0) {
        vals.forEach(v => {
          if (v > allMax) allMax = v;
          if (v < allMin) allMin = v;
        });
      }
    });
  });
  
  const absMax = Math.max(Math.abs(allMax), Math.abs(allMin), 1e-10);
  const valRange = Math.max(allMax - allMin, absMax * 0.2);
  const valCenter = (allMax + allMin) / 2;
  const halfRange = Math.max(valRange / 2, absMax * 0.6);
  
  const mapX = (t) => margin.left + ((t - minT) / rangeT) * plotW;
  const mapY = (v) => margin.top + plotH / 2 - (v / (halfRange * 2)) * plotH;
  
  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = margin.top + (plotH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(W - margin.right, y);
    ctx.stroke();
  }
  
  const zeroY = mapY(0);
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, zeroY);
  ctx.lineTo(W - margin.right, zeroY);
  ctx.stroke();
  
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(W - margin.right, margin.top + plotH);
  ctx.stroke();
  
  let colorIdx = 0;
  thObserveNodes.forEach((obs, idx) => {
    const keys = [];
    if (obs.direction === 'dx' || obs.direction === 'both') {
      if (thShowDx) keys.push(obs.nodeId + '_dx');
    }
    if (obs.direction === 'dy' || obs.direction === 'both') {
      if (thShowDy) keys.push(obs.nodeId + '_dy');
    }
    
    keys.forEach((k, ki) => {
      const vals = thResults.nodeResults[k];
      if (!vals || vals.length === 0) return;
      
      const color = thColors[idx % thColors.length];
      const isDashed = k.endsWith('_dx');
      
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (isDashed) ctx.setLineDash([6, 4]);
      
      ctx.beginPath();
      for (let i = 0; i < vals.length && i < times.length; i++) {
        const x = mapX(times[i]);
        const y = mapY(vals[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      
      colorIdx++;
    });
  });
  
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#666';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = valCenter + halfRange * (1 - i / 2);
    const y = margin.top + (plotH / 4) * i;
    if (y > margin.top && y < margin.top + plotH) {
      ctx.fillText(`${(v * 1000).toFixed(2)} mm`, margin.left - 6, y);
    }
  }
  
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const numTicks = Math.min(8, times.length);
  for (let i = 0; i <= numTicks; i++) {
    const t = minT + (rangeT / numTicks) * i;
    const x = mapX(t);
    ctx.fillText(t.toFixed(1) + 's', x, margin.top + plotH + 6);
  }
  
  ctx.fillText('时间 (s)', margin.left + plotW / 2, H - 14);
  
  ctx.save();
  ctx.translate(14, margin.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('位移 (mm)', 0, 0);
  ctx.restore();
  
  if (thHoverTimeIdx >= 0 && thHoverTimeIdx < times.length) {
    const hx = mapX(times[thHoverTimeIdx]);
    
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, margin.top);
    ctx.lineTo(hx, margin.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    
    let tooltipHtml = `<strong>t = ${times[thHoverTimeIdx].toFixed(3)}s</strong><br/>`;
    thObserveNodes.forEach((obs, idx) => {
      const color = thColors[idx % thColors.length];
      if (obs.direction === 'dx' || obs.direction === 'both') {
        if (thShowDx) {
          const v = thResults.nodeResults[obs.nodeId + '_dx'];
          if (v && v[thHoverTimeIdx] !== undefined) {
            tooltipHtml += `<span style="color:${color}">节点#${obs.nodeId} Dx: ${(v[thHoverTimeIdx] * 1000).toFixed(3)} mm</span><br/>`;
          }
        }
      }
      if (obs.direction === 'dy' || obs.direction === 'both') {
        if (thShowDy) {
          const v = thResults.nodeResults[obs.nodeId + '_dy'];
          if (v && v[thHoverTimeIdx] !== undefined) {
            tooltipHtml += `<span style="color:${color}">节点#${obs.nodeId} Dy: ${(v[thHoverTimeIdx] * 1000).toFixed(3)} mm</span><br/>`;
          }
        }
      }
    });
    
    const tooltip = document.getElementById('th-tooltip');
    tooltip.innerHTML = tooltipHtml;
    tooltip.classList.remove('hidden');
    
    const panel = document.getElementById('time-history-panel');
    const panelRect = panel.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    
    let tipX = canvasRect.left - panelRect.left + hx + 10;
    let tipY = canvasRect.top - panelRect.top + 20;
    
    if (tipX + tooltipRect.width > panelRect.width) {
      tipX = canvasRect.left - panelRect.left + hx - tooltipRect.width - 10;
    }
    
    tooltip.style.left = tipX + 'px';
    tooltip.style.top = tipY + 'px';
  } else {
    document.getElementById('th-tooltip').classList.add('hidden');
  }
}

function resizeTimeHistoryCanvas() {
  const panel = document.getElementById('time-history-panel');
  const canvas = document.getElementById('time-history-canvas');
  const header = panel.querySelector('.time-history-panel-header');
  canvas.width = panel.clientWidth;
  canvas.height = panel.clientHeight - header.offsetHeight;
  if (thResults) drawTimeHistoryCurve();
}

function enterTimeHistoryMode() {
  if (modalActive) exitModalMode();
  if (bucklingActive) exitBucklingMode();
  if (influenceActive) exitInfluenceMode();
  if (constructionActive) exitConstructionMode();
  if (sectionStressActive) hideSectionStressView();
  if (topoActive) exitTopoMode();
  if (compareActive) exitCompareMode();
  
  timeHistoryActive = true;
  document.getElementById('btn-time-history').classList.add('active');
  document.getElementById('time-history-panel').classList.remove('hidden');
  
  updateThNodeSelects();
  updateThObserveList();
  
  setTimeout(() => {
    resizeTimeHistoryCanvas();
    resizeThPiecewiseCanvas();
    drawThPiecewiseCanvas();
  }, 10);
  
  render();
  updateStatus('动力时程分析模式');
}

function exitTimeHistoryMode() {
  timeHistoryActive = false;
  thRunning = false;
  thStopRequested = true;
  document.getElementById('btn-time-history').classList.remove('active');
  document.getElementById('time-history-panel').classList.add('hidden');
  document.getElementById('th-tooltip').classList.add('hidden');
  
  render();
}

document.getElementById('btn-time-history').addEventListener('click', () => {
  if (timeHistoryActive) {
    exitTimeHistoryMode();
  } else {
    enterTimeHistoryMode();
  }
});

document.querySelectorAll('input[name="th-load-type"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    thLoadType = e.target.value;
    document.getElementById('th-sine-config').style.display = thLoadType === 'sine' ? 'block' : 'none';
    document.getElementById('th-piecewise-config').style.display = thLoadType === 'piecewise' ? 'block' : 'none';
    if (thLoadType === 'piecewise') {
      setTimeout(() => {
        resizeThPiecewiseCanvas();
        drawThPiecewiseCanvas();
      }, 10);
    }
  });
});

['th-sine-amplitude', 'th-sine-frequency', 'th-sine-duration'].forEach(id => {
  document.getElementById(id).addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (isNaN(val)) return;
    if (id === 'th-sine-amplitude') thSineAmplitude = val;
    if (id === 'th-sine-frequency') thSineFrequency = val;
    if (id === 'th-sine-duration') thSineDuration = val;
  });
});

['th-piecewise-total-time', 'th-piecewise-max-force'].forEach(id => {
  document.getElementById(id).addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (isNaN(val)) return;
    if (id === 'th-piecewise-total-time') thPiecewiseTotalTime = val;
    if (id === 'th-piecewise-max-force') thPiecewiseMaxForce = val;
    drawThPiecewiseCanvas();
  });
});

document.getElementById('th-load-node').addEventListener('change', (e) => {
  thLoadNodeId = e.target.value ? parseInt(e.target.value) : null;
});

document.getElementById('th-load-direction').addEventListener('change', (e) => {
  thLoadDirection = e.target.value;
});

document.getElementById('th-observe-direction').addEventListener('change', (e) => {
  thObserveDirection = e.target.value;
});

document.getElementById('btn-th-add-observe').addEventListener('click', () => {
  const select = document.getElementById('th-observe-node-select');
  const nodeId = select.value ? parseInt(select.value) : null;
  if (!nodeId) {
    alert('请选择观测节点');
    return;
  }
  const exists = thObserveNodes.some(o => o.nodeId === nodeId && o.direction === thObserveDirection);
  if (exists) {
    alert('该观测已存在');
    return;
  }
  thObserveNodes.push({ nodeId, direction: thObserveDirection });
  updateThObserveList();
  if (thResults) drawTimeHistoryCurve();
});

document.getElementById('th-num-steps').addEventListener('change', (e) => {
  thNumSteps = parseInt(e.target.value) || 200;
});

document.getElementById('btn-th-calculate').addEventListener('click', () => {
  runTimeHistoryAnalysis();
});

document.getElementById('btn-th-stop').addEventListener('click', () => {
  stopTimeHistoryAnalysis();
});

document.getElementById('btn-th-panel-close').addEventListener('click', () => {
  exitTimeHistoryMode();
});

document.getElementById('th-show-dx').addEventListener('change', (e) => {
  thShowDx = e.target.checked;
  if (thResults) drawTimeHistoryCurve();
});

document.getElementById('th-show-dy').addEventListener('change', (e) => {
  thShowDy = e.target.checked;
  if (thResults) drawTimeHistoryCurve();
});

const thCanvas = document.getElementById('time-history-canvas');
thCanvas.addEventListener('mousemove', (e) => {
  if (!thResults || !thResults.timePoints || thResults.timePoints.length === 0) return;
  
  const rect = thCanvas.getBoundingClientRect();
  const margin = { left: 70, right: 20, top: 20, bottom: 40 };
  const plotW = thCanvas.width - margin.left - margin.right;
  
  const x = e.clientX - rect.left;
  if (x < margin.left || x > thCanvas.width - margin.right) {
    if (thHoverTimeIdx !== -1) {
      thHoverTimeIdx = -1;
      drawTimeHistoryCurve();
    }
    return;
  }
  
  const t = ((x - margin.left) / plotW) * thResults.totalTime;
  let closestIdx = 0;
  let closestDist = Infinity;
  thResults.timePoints.forEach((tp, i) => {
    const dist = Math.abs(tp - t);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  });
  
  if (closestIdx !== thHoverTimeIdx) {
    thHoverTimeIdx = closestIdx;
    drawTimeHistoryCurve();
  }
});

thCanvas.addEventListener('mouseleave', () => {
  if (thHoverTimeIdx !== -1) {
    thHoverTimeIdx = -1;
    drawTimeHistoryCurve();
  }
});

document.getElementById('btn-th-add-point').addEventListener('click', () => {
  if (thPiecewisePoints.length >= 10) {
    alert('最多添加10个控制点');
    return;
  }
  const t = thPiecewisePoints.length > 0 
    ? Math.min(1, thPiecewisePoints[thPiecewisePoints.length - 1].t + 0.2)
    : 0.5;
  thPiecewisePoints.push({ t, f: 0.5 });
  drawThPiecewiseCanvas();
});

document.getElementById('btn-th-clear-points').addEventListener('click', () => {
  thPiecewisePoints = [];
  initDefaultPiecewisePoints();
  drawThPiecewiseCanvas();
});

function initDefaultPiecewisePoints() {
  thPiecewisePoints = [
    { t: 0, f: 0 },
    { t: 0.2, f: 1 },
    { t: 0.5, f: 0.5 },
    { t: 0.8, f: -0.5 },
    { t: 1, f: 0 }
  ];
}

const pwCanvas = document.getElementById('th-piecewise-canvas');
pwCanvas.addEventListener('mousedown', (e) => {
  const idx = getThPiecewisePointAt(e.clientX, e.clientY);
  if (idx >= 0) {
    thPiecewiseDraggingIdx = idx;
    pwCanvas.style.cursor = 'grabbing';
  } else {
    const canvas = document.getElementById('th-piecewise-canvas');
    const rect = canvas.getBoundingClientRect();
    const margin = { left: 40, right: 20, top: 10, bottom: 20 };
    const plotW = canvas.width - margin.left - margin.right;
    const plotH = canvas.height - margin.top - margin.bottom;
    
    let t = (e.clientX - rect.left - margin.left) / plotW;
    let f = 1 - (e.clientY - rect.top - margin.top) / (plotH / 2);
    
    t = Math.max(0, Math.min(1, t));
    f = Math.max(-1, Math.min(1, f));
    
    thPiecewisePoints.push({ t, f });
    drawThPiecewiseCanvas();
  }
});

pwCanvas.addEventListener('mousemove', (e) => {
  if (thPiecewiseDraggingIdx >= 0) {
    const canvas = document.getElementById('th-piecewise-canvas');
    const rect = canvas.getBoundingClientRect();
    const margin = { left: 40, right: 20, top: 10, bottom: 20 };
    const plotW = canvas.width - margin.left - margin.right;
    const plotH = canvas.height - margin.top - margin.bottom;
    
    let t = (e.clientX - rect.left - margin.left) / plotW;
    let f = 1 - (e.clientY - rect.top - margin.top) / (plotH / 2);
    
    t = Math.max(0, Math.min(1, t));
    f = Math.max(-1, Math.min(1, f));
    
    thPiecewisePoints[thPiecewiseDraggingIdx].t = t;
    thPiecewisePoints[thPiecewiseDraggingIdx].f = f;
    drawThPiecewiseCanvas();
  } else {
    const idx = getThPiecewisePointAt(e.clientX, e.clientY);
    pwCanvas.style.cursor = idx >= 0 ? 'grab' : 'crosshair';
  }
});

pwCanvas.addEventListener('mouseup', () => {
  thPiecewiseDraggingIdx = -1;
  pwCanvas.style.cursor = 'crosshair';
});

pwCanvas.addEventListener('mouseleave', () => {
  thPiecewiseDraggingIdx = -1;
  pwCanvas.style.cursor = 'crosshair';
});

pwCanvas.addEventListener('dblclick', (e) => {
  const idx = getThPiecewisePointAt(e.clientX, e.clientY);
  if (idx >= 0 && thPiecewisePoints.length > 2) {
    thPiecewisePoints.splice(idx, 1);
    drawThPiecewiseCanvas();
  }
});

window.addEventListener('resize', () => {
  if (timeHistoryActive) {
    resizeTimeHistoryCanvas();
    if (thLoadType === 'piecewise') {
      resizeThPiecewiseCanvas();
    }
  }
  if (pushoverPanelVisible) {
    if (_pushoverResizeTimer) clearTimeout(_pushoverResizeTimer);
    _pushoverResizeTimer = setTimeout(drawPushoverCapacityCurve, 100);
  }
});

document.getElementById('btn-pushover').addEventListener('click', () => {
  if (pushoverActive) {
    exitPushoverMode();
  } else {
    enterPushoverMode();
  }
});

document.getElementById('btn-po-start').addEventListener('click', startPushoverAnalysis);
document.getElementById('btn-po-stop').addEventListener('click', stopPushoverAnalysis);
document.getElementById('btn-po-reset').addEventListener('click', resetPushoverAnalysis);
document.getElementById('btn-po-demo').addEventListener('click', demoPushoverAnalysis);

document.getElementById('btn-pushover-panel-close').addEventListener('click', () => {
  document.getElementById('pushover-panel').classList.add('hidden');
  pushoverPanelVisible = false;
});

document.getElementById('pushover-timeline-slider').addEventListener('input', (e) => {
  if (!pushoverAnalyzer) return;
  const stepIdx = parseInt(e.target.value);
  applyPushoverStepToScene(stepIdx);
  updatePushoverTimeline();
  drawPushoverCapacityCurve();
  render();
});

document.querySelectorAll('.panel-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    switchPanelTab(tab.dataset.tab);
  });
});

const pushoverCanvas = document.getElementById('pushover-canvas');
const pushoverTooltip = document.getElementById('pushover-tooltip');

pushoverCanvas.addEventListener('mousemove', (e) => {
  if (!pushoverAnalyzer || !pushoverPanelVisible) {
    pushoverTooltip.classList.add('hidden');
    return;
  }
  const rect = pushoverCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const idx = Renderer.findCapacityCurvePoint(pushoverCanvas, pushoverAnalyzer.capacityCurve, x, y);
  if (idx >= 0) {
    const p = pushoverAnalyzer.capacityCurve[idx];
    let html = `<strong>第 ${idx + 1} 步</strong><br/>`;
    html += `基底剪力: ${(p.baseShear / 1000).toFixed(2)} kN<br/>`;
    html += `顶点位移: ${(p.topDisplacement * 1000).toFixed(2)} mm`;
    if (p.isHingeFormation && p.newHinges.length > 0) {
      const names = p.newHinges.map(h => `#${h.memberId}${h.end === 1 ? '左' : '右'}`).join(', ');
      html += `<br/><span style="color:#ff9800;">塑性铰: ${names}</span>`;
    }
    if (p.isCollapse) {
      html += `<br/><span style="color:#f44336;">⚠ 倒塌点</span>`;
    }
    pushoverTooltip.innerHTML = html;
    pushoverTooltip.style.left = (e.clientX + 12) + 'px';
    pushoverTooltip.style.top = (e.clientY + 12) + 'px';
    pushoverTooltip.classList.remove('hidden');
    pushoverCanvas.style.cursor = 'pointer';
  } else {
    pushoverTooltip.classList.add('hidden');
    pushoverCanvas.style.cursor = 'default';
  }
});

pushoverCanvas.addEventListener('mouseleave', () => {
  pushoverTooltip.classList.add('hidden');
});

pushoverCanvas.addEventListener('click', (e) => {
  if (!pushoverAnalyzer || !pushoverPanelVisible) return;
  const rect = pushoverCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const idx = Renderer.findCapacityCurvePoint(pushoverCanvas, pushoverAnalyzer.capacityCurve, x, y);
  if (idx >= 0 && idx < pushoverAnalyzer.steps.length) {
    document.getElementById('pushover-timeline-slider').value = idx;
    applyPushoverStepToScene(idx);
    updatePushoverTimeline();
    drawPushoverCapacityCurve();
    render();
  }
});

initDefaultPiecewisePoints();

init();
