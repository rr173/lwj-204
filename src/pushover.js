import { solveFrame } from './solver.js';
import { deepClone } from './core.js';

const PIXEL_TO_METER = 0.01;
const DEFAULT_FY = 235e6;

export function calculatePlasticMoment(member, fy = DEFAULT_FY) {
  if (member.sectionName && member.Wpl) {
    return fy * member.Wpl;
  }
  const b = member.b || (member.A / (member.h || 0.2));
  const h = member.h || 0.2;
  const Wpl = (b * h * h) / 4;
  return fy * Wpl;
}

export function generateLateralLoadPattern(nodes, pattern = 'triangle', direction = 'right') {
  const loads = {};
  const supportNodes = nodes.filter(n => n.support === 'fixed' || n.support === 'pinned');
  const baseY = supportNodes.length > 0
    ? Math.max(...supportNodes.map(n => n.y))
    : Math.max(...nodes.map(n => n.y));

  const heights = nodes.map(n => baseY - n.y);
  const maxH = Math.max(...heights, 1);
  const totalWeight = heights.reduce((s, h) => {
    if (pattern === 'triangle') return s + Math.max(h, 0);
    return s + 1;
  }, 0);

  nodes.forEach(node => {
    const h = baseY - node.y;
    let weight = 0;
    if (pattern === 'triangle') {
      weight = Math.max(h, 0) / (totalWeight || 1);
    } else {
      weight = 1 / (totalWeight || 1);
    }
    const sign = direction === 'right' ? 1 : -1;
    loads[node.id] = { fx: sign * weight, fy: 0, m: 0 };
  });

  return loads;
}

export function findTopNode(nodes) {
  const supportNodes = nodes.filter(n => n.support === 'fixed' || n.support === 'pinned');
  const baseY = supportNodes.length > 0
    ? Math.max(...supportNodes.map(n => n.y))
    : Math.max(...nodes.map(n => n.y));
  let top = null;
  let minY = Infinity;
  nodes.forEach(n => {
    const y = n.y;
    if (y < minY && (baseY - y) > 0.1) {
      minY = y;
      top = n;
    }
  });
  return top || nodes[0];
}

export function calculateBaseShear(nodes, members, results, analysisMode) {
  if (analysisMode !== 'frame') return 0;
  if (!results || !results.nodes) return 0;
  let sum = 0;
  nodes.forEach(n => {
    if (n.support === 'fixed' || n.support === 'pinned' || n.support === 'roller') {
      const rn = results.nodes.find(r => r.id === n.id);
      if (rn && rn.reaction) {
        sum += rn.reaction.fx || 0;
      }
    }
  });
  if (Math.abs(sum) > 1e-6) return sum;
  const loadSum = nodes.reduce((s, n) => s + (n.fx || 0), 0);
  return -loadSum;
}

export function runPushoverStep(nodesIn, membersIn, loadMultiplier, loadPattern, currentHinges, fy = DEFAULT_FY) {
  const nodes = nodesIn.map(n => ({ ...n, fx: 0, fy: 0, m: 0 }));
  const members = membersIn.map(m => ({ ...m }));

  currentHinges.forEach(h => {
    const mem = members.find(m => m.id === h.memberId);
    if (mem) {
      if (h.end === 1) mem.release1 = true;
      if (h.end === 2) mem.release2 = true;
    }
  });

  for (const node of nodes) {
    const lp = loadPattern[node.id];
    if (lp) {
      node.fx = lp.fx * loadMultiplier;
      node.fy = lp.fy * loadMultiplier;
      node.m = lp.m * loadMultiplier;
    }
  }

  let result;
  try {
    result = solveFrame(nodes, members);
  } catch (e) {
    return {
      success: false,
      mechanism: true,
      error: e.message,
      nodes,
      members,
      results: null,
      newHinges: [],
      baseShear: 0,
      topDisplacement: 0
    };
  }

  const MpMap = new Map();
  members.forEach(m => {
    MpMap.set(m.id, calculatePlasticMoment(m, fy));
  });

  const newHinges = [];
  const memberById = new Map(members.map(m => [m.id, m]));

  result.members.forEach(mr => {
    const mem = memberById.get(mr.id);
    if (!mem) return;
    const Mp = MpMap.get(mr.id);
    const M1 = Math.abs(mr.M1 || 0);
    const M2 = Math.abs(mr.M2 || 0);

    if (!mem.release1 && M1 >= Mp * 0.999) {
      const alreadyExists = currentHinges.some(h => h.memberId === mr.id && h.end === 1) ||
        newHinges.some(h => h.memberId === mr.id && h.end === 1);
      if (!alreadyExists) {
        newHinges.push({
          memberId: mr.id,
          end: 1,
          moment: mr.M1,
          Mp,
          nodeId: mem.node1Id
        });
      }
    }
    if (!mem.release2 && M2 >= Mp * 0.999) {
      const alreadyExists = currentHinges.some(h => h.memberId === mr.id && h.end === 2) ||
        newHinges.some(h => h.memberId === mr.id && h.end === 2);
      if (!alreadyExists) {
        newHinges.push({
          memberId: mr.id,
          end: 2,
          moment: mr.M2,
          Mp,
          nodeId: mem.node2Id
        });
      }
    }
  });

  const topNode = findTopNode(nodes);
  const topResult = result.nodes.find(r => r.id === topNode.id);
  const topDx = topResult ? topResult.dx : 0;

  const loadSum = nodes.reduce((s, n) => s + (n.fx || 0), 0);
  const baseShear = Math.abs(loadSum);

  nodes.forEach(n => {
    const rn = result.nodes.find(r => r.id === n.id);
    if (rn) {
      n.dx = rn.dx;
      n.dy = rn.dy;
      n.dtheta = rn.dtheta || 0;
    }
  });

  members.forEach(m => {
    const rm = result.members.find(r => r.id === m.id);
    if (rm) {
      m.axialForce = rm.axialForce;
      m.stress = rm.stress;
    }
  });

  let isMechanism = false;
  const numFixedSupports = nodes.filter(n => n.support === 'fixed').length;
  const totalHingeCount = currentHinges.length + newHinges.length;
  if (numFixedSupports > 0 && totalHingeCount >= members.length + numFixedSupports) {
    isMechanism = true;
  }
  if (Math.abs(topDx) > 5.0) {
    isMechanism = true;
  }

  return {
    success: true,
    mechanism: isMechanism,
    error: null,
    nodes,
    members,
    results: result,
    newHinges,
    baseShear,
    topDisplacement: Math.abs(topDx)
  };
}

export class PushoverAnalyzer {
  constructor(nodes, members, options = {}) {
    this.originalNodes = deepClone(nodes);
    this.originalMembers = deepClone(members);
    this.options = {
      pattern: 'triangle',
      direction: 'right',
      forceIncrement: 10000,
      maxSteps: 100,
      fy: DEFAULT_FY,
      ...options
    };

    this.steps = [];
    this.hinges = [];
    this.hingeHistory = [];
    this.capacityCurve = [];
    this.currentStep = 0;
    this.finished = false;
    this.collapsed = false;
    this.collapseStep = -1;

    this.loadPattern = generateLateralLoadPattern(
      this.originalNodes,
      this.options.pattern,
      this.options.direction
    );
  }

  runStep() {
    if (this.finished) return null;

    const stepNum = this.steps.length;
    const multiplier = (stepNum + 1) * this.options.forceIncrement;

    const stepResult = runPushoverStep(
      this.originalNodes,
      this.originalMembers,
      multiplier,
      this.loadPattern,
      this.hinges,
      this.options.fy
    );

    if (!stepResult.success) {
      this.finished = true;
      this.collapsed = true;
      this.collapseStep = stepNum;
      this.capacityCurve.push({
        step: stepNum,
        baseShear: this.capacityCurve.length > 0 ? this.capacityCurve[this.capacityCurve.length - 1].baseShear : 0,
        topDisplacement: this.capacityCurve.length > 0 ? this.capacityCurve[this.capacityCurve.length - 1].topDisplacement * 1.5 : 0.1,
        isCollapse: true,
        hinges: [...this.hinges],
        newHinges: []
      });
      return {
        step: stepNum,
        multiplier,
        ...stepResult,
        isCollapse: true
      };
    }

    const allNewHinges = stepResult.newHinges.map(h => ({
      ...h,
      step: stepNum,
      loadLevel: multiplier
    }));

    this.hinges.push(...allNewHinges);
    this.hingeHistory.push([...this.hinges]);

    const curvePoint = {
      step: stepNum,
      baseShear: stepResult.baseShear,
      topDisplacement: stepResult.topDisplacement,
      hinges: [...this.hinges],
      newHinges: allNewHinges,
      isHingeFormation: allNewHinges.length > 0,
      isCollapse: stepResult.mechanism
    };

    this.capacityCurve.push(curvePoint);

    this.steps.push({
      step: stepNum,
      multiplier,
      nodes: stepResult.nodes,
      members: stepResult.members,
      results: stepResult.results,
      hinges: [...this.hinges],
      newHinges: allNewHinges,
      baseShear: stepResult.baseShear,
      topDisplacement: stepResult.topDisplacement
    });

    if (stepResult.mechanism || stepNum >= this.options.maxSteps - 1) {
      this.finished = true;
      if (stepResult.mechanism) {
        this.collapsed = true;
        this.collapseStep = stepNum;
      }
    }

    return {
      step: stepNum,
      multiplier,
      ...stepResult,
      isCollapse: stepResult.mechanism,
      newHinges: allNewHinges
    };
  }

  async runAll(onProgress = null) {
    while (!this.finished) {
      const result = this.runStep();
      if (onProgress) {
        const shouldContinue = await onProgress(result, this.steps.length, this.options.maxSteps);
        if (shouldContinue === false) {
          this.finished = true;
          break;
        }
      }
    }
    return this.getSummary();
  }

  getStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= this.steps.length) return null;
    return this.steps[stepIndex];
  }

  getSummary() {
    const hingeFormationSteps = this.capacityCurve
      .filter(p => p.isHingeFormation)
      .map(p => ({
        step: p.step,
        baseShear: p.baseShear,
        topDisplacement: p.topDisplacement,
        hinges: p.newHinges
      }));

    let maxBaseShear = 0;
    let maxShearStep = 0;
    this.capacityCurve.forEach((p, i) => {
      if (p.baseShear > maxBaseShear) {
        maxBaseShear = p.baseShear;
        maxShearStep = i;
      }
    });

    const ultimatePoint = this.collapsed && this.collapseStep >= 0
      ? this.capacityCurve[this.collapseStep]
      : this.capacityCurve[this.capacityCurve.length - 1];

    return {
      totalSteps: this.steps.length,
      maxBaseShear,
      maxShearStep,
      ultimateDisplacement: ultimatePoint ? ultimatePoint.topDisplacement : 0,
      totalHinges: this.hinges.length,
      hingeFormationSteps,
      collapsed: this.collapsed,
      collapseStep: this.collapseStep,
      capacityCurve: this.capacityCurve,
      hinges: this.hinges
    };
  }

  getHingesAtStep(stepIndex) {
    if (stepIndex < 0) return [];
    if (stepIndex >= this.hingeHistory.length) return this.hinges;
    return this.hingeHistory[stepIndex];
  }
}
