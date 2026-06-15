import {
  createLocalStiffnessMatrix,
  createTransformationMatrix,
  multiplyMatrices,
  transposeMatrix,
  gaussElimination,
  createBeamLocalStiffnessMatrix,
  createBeamTransformationMatrix,
  createUniformLoadEquivalentForces,
  multiplyMatrixVector,
  applyEndReleases
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
  
  const R_full = multiplyMatrixVector(K, displacement);
  const reactions = new Map();
  for (const node of nodes) {
    const idx = nodeMap.get(node.id).index;
    const dofX = idx * 2;
    const dofY = idx * 2 + 1;
    let rx = 0, ry = 0;
    if (node.support === 'pinned') {
      rx = R_full[dofX] - F[dofX];
      ry = R_full[dofY] - F[dofY];
    } else if (node.support === 'roller') {
      ry = R_full[dofY] - F[dofY];
    }
    if (rx !== 0 || ry !== 0 || node.support !== 'free') {
      reactions.set(node.id, { rx, ry, m: 0 });
    }
  }

  const totalExternalFx = nodes.reduce((s, n) => s + (n.fx || 0), 0);
  const totalExternalFy = nodes.reduce((s, n) => s + (n.fy || 0), 0);

  return {
    nodes: nodes.map(n => ({
      id: n.id,
      dx: n.dx,
      dy: n.dy,
      reaction: reactions.get(n.id) || null
    })),
    members: members.map(m => ({
      id: m.id,
      axialForce: m.axialForce,
      stress: m.stress
    })),
    maxForce,
    externalForces: {
      fx: totalExternalFx,
      fy: totalExternalFy,
      m: 0
    }
  };
}

export function solveFrame(nodes, members) {
  const nodeMap = new Map();
  nodes.forEach((node, index) => {
    nodeMap.set(node.id, { ...node, index });
  });

  const numDOF = nodes.length * 3;

  const K = Array(numDOF).fill(null).map(() => Array(numDOF).fill(0));

  const F = Array(numDOF).fill(0);

  for (const member of members) {
    const node1 = nodeMap.get(member.node1Id);
    const node2 = nodeMap.get(member.node2Id);
    if (!node1 || !node2) continue;

    const lengthInMeters = member.length * PIXEL_TO_METER;
    const L = lengthInMeters;

    let kLocal = createBeamLocalStiffnessMatrix(member.E, member.A, member.I, L);
    kLocal = applyEndReleases(kLocal, member.release1, member.release2);

    const T = createBeamTransformationMatrix(member.angle);
    const Tt = transposeMatrix(T);
    const kGlobal = multiplyMatrices(multiplyMatrices(Tt, kLocal), T);

    const dof1 = node1.index * 3;
    const dof2 = node2.index * 3;
    const dofIndices = [dof1, dof1 + 1, dof1 + 2, dof2, dof2 + 1, dof2 + 2];

    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        K[dofIndices[i]][dofIndices[j]] += kGlobal[i][j];
      }
    }

    if (member.q !== 0) {
      const qLocal = createUniformLoadEquivalentForces(member.q, L);
      const qGlobal = multiplyMatrixVector(Tt, qLocal);
      for (let i = 0; i < 6; i++) {
        F[dofIndices[i]] += qGlobal[i];
      }
    }
  }

  for (const node of nodes) {
    const idx = nodeMap.get(node.id).index;
    const dofX = idx * 3;
    const dofY = idx * 3 + 1;
    const dofT = idx * 3 + 2;
    F[dofX] += node.fx || 0;
    F[dofY] += node.fy || 0;
    F[dofT] += node.m || 0;
  }

  const constrainedDOFs = [];
  const freeDOFs = [];

  for (const node of nodes) {
    const idx = nodeMap.get(node.id).index;
    const dofX = idx * 3;
    const dofY = idx * 3 + 1;
    const dofT = idx * 3 + 2;

    if (node.support === 'fixed') {
      constrainedDOFs.push(dofX, dofY, dofT);
    } else if (node.support === 'pinned') {
      constrainedDOFs.push(dofX, dofY);
      freeDOFs.push(dofT);
    } else if (node.support === 'roller') {
      constrainedDOFs.push(dofY);
      freeDOFs.push(dofX, dofT);
    } else {
      freeDOFs.push(dofX, dofY, dofT);
    }
  }

  if (freeDOFs.length === 0) {
    throw new Error('结构无自由度，无法求解');
  }

  const numFree = freeDOFs.length;
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
    node.dx = displacement[idx * 3];
    node.dy = displacement[idx * 3 + 1];
    node.dtheta = displacement[idx * 3 + 2];
  }

  let maxForce = 0;
  let maxMoment = 0;

  const memberResults = [];

  for (const member of members) {
    const node1 = nodeMap.get(member.node1Id);
    const node2 = nodeMap.get(member.node2Id);
    if (!node1 || !node2) {
      memberResults.push({
        id: member.id,
        axialForce: 0,
        stress: 0,
        N1: 0, V1: 0, M1: 0,
        N2: 0, V2: 0, M2: 0,
        q: member.q
      });
      continue;
    }

    const idx1 = node1.index;
    const idx2 = node2.index;
    const d = [
      displacement[idx1 * 3],
      displacement[idx1 * 3 + 1],
      displacement[idx1 * 3 + 2],
      displacement[idx2 * 3],
      displacement[idx2 * 3 + 1],
      displacement[idx2 * 3 + 2]
    ];

    const lengthInMeters = member.length * PIXEL_TO_METER;
    const L = lengthInMeters;

    const T = createBeamTransformationMatrix(member.angle);
    const dLocal = multiplyMatrixVector(transposeMatrix(T), d);

    let kLocal = createBeamLocalStiffnessMatrix(member.E, member.A, member.I, L);
    const fLocal = multiplyMatrixVector(kLocal, dLocal);

    let N1 = fLocal[0];
    let V1 = fLocal[1];
    let M1 = fLocal[2];
    let N2 = fLocal[3];
    let V2 = fLocal[4];
    let M2 = fLocal[5];

    if (member.q !== 0) {
      const qF = createUniformLoadEquivalentForces(member.q, L);
      N1 -= qF[0];
      V1 -= qF[1];
      M1 -= qF[2];
      N2 -= qF[3];
      V2 -= qF[4];
      M2 -= qF[5];
    }

    if (member.release1) {
      M1 = 0;
    }
    if (member.release2) {
      M2 = 0;
    }

    const axialForce = N2;

    member.axialForce = axialForce;
    member.stress = axialForce / member.A;

    maxForce = Math.max(maxForce, Math.abs(N1), Math.abs(N2), Math.abs(V1), Math.abs(V2));
    maxMoment = Math.max(maxMoment, Math.abs(M1), Math.abs(M2));

    memberResults.push({
      id: member.id,
      axialForce: member.axialForce,
      stress: member.stress,
      N1, V1, M1,
      N2, V2, M2,
      q: member.q
    });
  }

  const R_full = multiplyMatrixVector(K, displacement);
  const reactions = new Map();
  for (const node of nodes) {
    const idx = nodeMap.get(node.id).index;
    const dofX = idx * 3;
    const dofY = idx * 3 + 1;
    const dofT = idx * 3 + 2;
    let rx = 0, ry = 0, rm = 0;
    if (node.support === 'fixed') {
      rx = R_full[dofX] - F[dofX];
      ry = R_full[dofY] - F[dofY];
      rm = R_full[dofT] - F[dofT];
    } else if (node.support === 'pinned') {
      rx = R_full[dofX] - F[dofX];
      ry = R_full[dofY] - F[dofY];
    } else if (node.support === 'roller') {
      ry = R_full[dofY] - F[dofY];
    }
    if (rx !== 0 || ry !== 0 || rm !== 0 || node.support !== 'free') {
      reactions.set(node.id, { rx, ry, m: rm });
    }
  }

  let totalExternalFx = 0;
  let totalExternalFy = 0;
  let totalExternalM = 0;
  for (const node of nodes) {
    const fx = node.fx || 0;
    const fy = node.fy || 0;
    const m = node.m || 0;
    const xMeters = node.x * PIXEL_TO_METER;
    const yMeters = node.y * PIXEL_TO_METER;
    totalExternalFx += fx;
    totalExternalFy += fy;
    totalExternalM += m + fx * yMeters - fy * xMeters;
  }
  for (const member of members) {
    if (member.q && Math.abs(member.q) > 1e-10) {
      const node1 = nodeMap.get(member.node1Id);
      const node2 = nodeMap.get(member.node2Id);
      if (node1 && node2) {
        const lengthInMeters = member.length * PIXEL_TO_METER;
        const totalQ = member.q * lengthInMeters;
        const dx = node2.x - node1.x;
        const dy = node2.y - node1.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const qfx1 = totalQ * nx / 2;
        const qfx2 = totalQ * nx / 2;
        const qfy1 = totalQ * ny / 2;
        const qfy2 = totalQ * ny / 2;
        totalExternalFx += qfx1 + qfx2;
        totalExternalFy += qfy1 + qfy2;
        const x1 = node1.x * PIXEL_TO_METER;
        const y1 = node1.y * PIXEL_TO_METER;
        const x2 = node2.x * PIXEL_TO_METER;
        const y2 = node2.y * PIXEL_TO_METER;
        totalExternalM += (qfx1 * y1 - qfy1 * x1) + (qfx2 * y2 - qfy2 * x2);
      }
    }
  }

  return {
    nodes: nodes.map(n => ({
      id: n.id,
      dx: n.dx,
      dy: n.dy,
      dtheta: n.dtheta,
      reaction: reactions.get(n.id) || null
    })),
    members: memberResults,
    maxForce,
    maxMoment,
    externalForces: {
      fx: totalExternalFx,
      fy: totalExternalFy,
      m: totalExternalM
    }
  };
}
