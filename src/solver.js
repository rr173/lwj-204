import {
  createLocalStiffnessMatrix,
  createTransformationMatrix,
  multiplyMatrices,
  transposeMatrix,
  gaussElimination
} from './core.js';

const PIXEL_TO_METER = 0.01;

export function solveTruss(nodes, members) {
  const nodeMap = new Map();
  nodes.forEach((node, index) => {
    nodeMap.set(node.id, { ...node, index });
  });
  
  const numDOF = nodes.length * 2;
  
  const K = Array(numDOF).fill(null).map(() => Array(numDOF).fill(0));
  
  for (const member of members) {
    const node1 = nodeMap.get(member.node1Id);
    const node2 = nodeMap.get(member.node2Id);
    
    if (!node1 || !node2) continue;
    
    const lengthInMeters = member.length * PIXEL_TO_METER;
    const kLocal = createLocalStiffnessMatrix(member.E, member.A, lengthInMeters);
    const T = createTransformationMatrix(member.angle);
    const Tt = transposeMatrix(T);
    
    const kGlobal = multiplyMatrices(multiplyMatrices(Tt, kLocal), T);
    
    const dof1 = node1.index * 2;
    const dof2 = node2.index * 2;
    const dofIndices = [dof1, dof1 + 1, dof2, dof2 + 1];
    
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        K[dofIndices[i]][dofIndices[j]] += kGlobal[i][j];
      }
    }
  }
  
  const F = Array(numDOF).fill(0);
  const constrainedDOFs = [];
  const freeDOFs = [];
  
  for (const node of nodes) {
    const idx = nodeMap.get(node.id).index;
    const dofX = idx * 2;
    const dofY = idx * 2 + 1;
    
    F[dofX] = node.fx || 0;
    F[dofY] = node.fy || 0;
    
    if (node.support === 'pinned') {
      constrainedDOFs.push(dofX);
      constrainedDOFs.push(dofY);
    } else if (node.support === 'roller') {
      constrainedDOFs.push(dofY);
      freeDOFs.push(dofX);
    } else {
      freeDOFs.push(dofX);
      freeDOFs.push(dofY);
    }
  }
  
  const numFree = freeDOFs.length;
  const numConstrained = constrainedDOFs.length;
  
  if (numFree === 0) {
    throw new Error('结构无自由度，无法求解');
  }
  
  if (numConstrained < 3) {
    throw new Error('结构欠约束，可能为机构（约束数不足3个）');
  }
  
  const Kff = Array(numFree).fill(null).map(() => Array(numFree).fill(0));
  const Ff = Array(numFree).fill(0);
  
  for (let i = 0; i < numFree; i++) {
    Ff[i] = F[freeDOFs[i]];
    for (let j = 0; j < numFree; j++) {
      Kff[i][j] = K[freeDOFs[i]][freeDOFs[j]];
    }
  }
  
  let displacementFree;
  try {
    displacementFree = gaussElimination(Kff, Ff);
  } catch (e) {
    throw new Error('求解失败：' + e.message);
  }
  
  const displacement = Array(numDOF).fill(0);
  for (let i = 0; i < numFree; i++) {
    displacement[freeDOFs[i]] = displacementFree[i];
  }
  
  for (const node of nodes) {
    const idx = nodeMap.get(node.id).index;
    node.dx = displacement[idx * 2];
    node.dy = displacement[idx * 2 + 1];
  }
  
  const nodeById = new Map();
  nodes.forEach(n => nodeById.set(n.id, n));
  
  let maxForce = 0;
  for (const member of members) {
    const node1 = nodeById.get(member.node1Id);
    const node2 = nodeById.get(member.node2Id);
    
    if (!node1 || !node2) {
      member.axialForce = 0;
      member.stress = 0;
      continue;
    }
    
    const c = Math.cos(member.angle);
    const s = Math.sin(member.angle);
    
    const u1 = node1.dx;
    const v1 = node1.dy;
    const u2 = node2.dx;
    const v2 = node2.dy;
    
    const delta = (u2 - u1) * c + (v2 - v1) * s;
    const lengthInMeters = member.length * PIXEL_TO_METER;
    const axialForce = member.E * member.A * delta / lengthInMeters;
    
    member.axialForce = axialForce;
    member.stress = axialForce / member.A;
    
    maxForce = Math.max(maxForce, Math.abs(axialForce));
  }
  
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      dx: n.dx,
      dy: n.dy,
      reaction: null
    })),
    members: members.map(m => ({
      id: m.id,
      axialForce: m.axialForce,
      stress: m.stress
    })),
    maxForce
  };
}
