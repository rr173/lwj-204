import {
  createLocalStiffnessMatrix,
  createTransformationMatrix,
  multiplyMatrices,
  transposeMatrix,
  createBeamLocalStiffnessMatrix,
  createBeamTransformationMatrix,
  applyEndReleases,
  gaussElimination,
  multiplyMatrixVector,
  createBeamGeometricStiffnessMatrix,
  createTrussGeometricStiffnessMatrix
} from './core.js';

const PIXEL_TO_METER = 0.01;

function assembleStiffnessMatrices(nodes, members, memberAxialForces, analysisMode) {
  const nodeMap = new Map();
  nodes.forEach((node, index) => {
    nodeMap.set(node.id, { ...node, index });
  });

  const dofPerNode = analysisMode === 'frame' ? 3 : 2;
  const numDOF = nodes.length * dofPerNode;

  const K = Array(numDOF).fill(null).map(() => Array(numDOF).fill(0));
  const Kg = Array(numDOF).fill(null).map(() => Array(numDOF).fill(0));

  const axialForceMap = new Map();
  if (memberAxialForces) {
    if (memberAxialForces instanceof Map) {
      memberAxialForces.forEach((force, id) => {
        axialForceMap.set(id, force);
      });
    } else {
      memberAxialForces.forEach(mf => {
        axialForceMap.set(mf.id, mf.axialForce || 0);
      });
    }
  }

  for (const member of members) {
    const node1 = nodeMap.get(member.node1Id);
    const node2 = nodeMap.get(member.node2Id);
    if (!node1 || !node2) continue;

    const lengthInMeters = member.length * PIXEL_TO_METER;
    const L = lengthInMeters;

    const N = axialForceMap.get(member.id) !== undefined ? axialForceMap.get(member.id) : (member.axialForce || 0);

    if (analysisMode === 'frame') {
      let kLocal = createBeamLocalStiffnessMatrix(member.E, member.A, member.I, L);
      kLocal = applyEndReleases(kLocal, member.release1, member.release2);

      let kgLocal = createBeamGeometricStiffnessMatrix(N, L);
      kgLocal = applyEndReleases(kgLocal, member.release1, member.release2);

      const T = createBeamTransformationMatrix(member.angle);
      const Tt = transposeMatrix(T);

      const kGlobal = multiplyMatrices(multiplyMatrices(Tt, kLocal), T);
      const kgGlobal = multiplyMatrices(multiplyMatrices(Tt, kgLocal), T);

      const dof1 = node1.index * 3;
      const dof2 = node2.index * 3;
      const dofIndices = [dof1, dof1 + 1, dof1 + 2, dof2, dof2 + 1, dof2 + 2];

      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          K[dofIndices[i]][dofIndices[j]] += kGlobal[i][j];
          Kg[dofIndices[i]][dofIndices[j]] += kgGlobal[i][j];
        }
      }
    } else {
      const kLocal = createLocalStiffnessMatrix(member.E, member.A, L);
      const kgLocal = createTrussGeometricStiffnessMatrix(N, L);
      const T = createTransformationMatrix(member.angle);
      const Tt = transposeMatrix(T);

      const kGlobal = multiplyMatrices(multiplyMatrices(Tt, kLocal), T);
      const kgGlobal = multiplyMatrices(multiplyMatrices(Tt, kgLocal), T);

      const dof1 = node1.index * 2;
      const dof2 = node2.index * 2;
      const dofIndices = [dof1, dof1 + 1, dof2, dof2 + 1];

      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          K[dofIndices[i]][dofIndices[j]] += kGlobal[i][j];
          Kg[dofIndices[i]][dofIndices[j]] += kgGlobal[i][j];
        }
      }
    }
  }

  return { K, Kg, numDOF, nodeMap, dofPerNode };
}

function applyBoundaryConditions(nodes, nodeMap, K, Kg, analysisMode) {
  const constrainedDOFs = [];
  const freeDOFs = [];

  for (const node of nodes) {
    const idx = nodeMap.get(node.id).index;
    if (analysisMode === 'frame') {
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
    } else {
      const dofX = idx * 2;
      const dofY = idx * 2 + 1;

      if (node.support === 'pinned') {
        constrainedDOFs.push(dofX, dofY);
      } else if (node.support === 'roller') {
        constrainedDOFs.push(dofY);
        freeDOFs.push(dofX);
      } else {
        freeDOFs.push(dofX, dofY);
      }
    }
  }

  const numFree = freeDOFs.length;
  if (numFree === 0) {
    throw new Error('结构无自由度，无法进行屈曲分析');
  }

  if (analysisMode === 'frame' && constrainedDOFs.length < 3) {
    throw new Error('结构欠约束，可能为机构（约束数不足3个）');
  }
  if (analysisMode === 'truss' && constrainedDOFs.length < 3) {
    throw new Error('结构欠约束，可能为机构（约束数不足3个）');
  }

  const Kff = Array(numFree).fill(null).map(() => Array(numFree).fill(0));
  const Kgff = Array(numFree).fill(null).map(() => Array(numFree).fill(0));

  for (let i = 0; i < numFree; i++) {
    for (let j = 0; j < numFree; j++) {
      Kff[i][j] = K[freeDOFs[i]][freeDOFs[j]];
      Kgff[i][j] = Kg[freeDOFs[i]][freeDOFs[j]];
    }
  }

  return { Kff, Kgff, freeDOFs, numFree };
}

function solveLinearSystem(K, b) {
  try {
    return gaussElimination(K.map(row => [...row]), [...b]);
  } catch (e) {
    return null;
  }
}

function matrixVectorMultiply(M, v) {
  const n = M.length;
  const result = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < v.length; j++) {
      result[i] += M[i][j] * v[j];
    }
  }
  return result;
}

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function vectorNorm(v) {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

function kgOrthogonalize(x, Kg, prevModes) {
  for (const phi of prevModes) {
    const kgPhi = matrixVectorMultiply(Kg, phi);
    const denom = dotProduct(phi, kgPhi);
    if (Math.abs(denom) < 1e-20) continue;
    const coeff = dotProduct(x, kgPhi) / denom;
    for (let i = 0; i < x.length; i++) {
      x[i] -= coeff * phi[i];
    }
  }
  return x;
}

function inverseIterationBuckling(Kff, Kgff, numModes, maxIter = 300, tol = 1e-10) {
  const n = Kff.length;
  if (numModes > n) numModes = n;
  if (numModes <= 0) numModes = 1;

  const modes = [];
  const eigenvalues = [];

  for (let mode = 0; mode < numModes; mode++) {
    let x = new Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = Math.random() - 0.5;
    }

    let norm = vectorNorm(x);
    if (norm < 1e-15) {
      x = new Array(n).fill(1);
      norm = vectorNorm(x);
    }
    for (let i = 0; i < n; i++) {
      x[i] /= norm;
    }

    kgOrthogonalize(x, Kgff, modes);

    let eigenvalue = 0;
    let converged = false;

    for (let iter = 0; iter < maxIter; iter++) {
      const Kgx = matrixVectorMultiply(Kgff, x);

      const xNew = solveLinearSystem(Kff, Kgx);
      if (!xNew) break;

      kgOrthogonalize(xNew, Kgff, modes);

      norm = vectorNorm(xNew);
      if (norm < 1e-15) break;
      for (let i = 0; i < n; i++) {
        xNew[i] /= norm;
      }

      const Kx = matrixVectorMultiply(Kff, xNew);
      const KgxNew = matrixVectorMultiply(Kgff, xNew);
      const denom = dotProduct(xNew, KgxNew);
      if (Math.abs(denom) < 1e-30) break;
      const ratio = dotProduct(xNew, Kx) / denom;
      const newEigenvalue = Math.abs(ratio);

      if (iter > 0 && Math.abs(newEigenvalue - eigenvalue) < tol * Math.max(Math.abs(newEigenvalue), 1)) {
        eigenvalue = newEigenvalue;
        x = xNew;
        converged = true;
        break;
      }

      eigenvalue = newEigenvalue;
      x = xNew;
    }

    if (!converged && mode > 0) {
      break;
    }

    const maxComp = Math.max(...x.map(Math.abs));
    if (maxComp > 1e-15) {
      for (let i = 0; i < n; i++) {
        x[i] /= maxComp;
      }
    }

    modes.push([...x]);
    eigenvalues.push(eigenvalue);
  }

  return modes.map((modeShape, idx) => {
    const Kx = matrixVectorMultiply(Kff, modeShape);
    const Kgx = matrixVectorMultiply(Kgff, modeShape);
    const denom = dotProduct(modeShape, Kgx);
    const ratio = Math.abs(denom) > 1e-20 ? dotProduct(modeShape, Kx) / denom : eigenvalues[idx] || 0;
    const eigenvalue = Math.abs(ratio);

    return {
      modeNumber: idx + 1,
      lambda: eigenvalue,
      modeShape
    };
  }).filter(m => isFinite(m.lambda));
}

function calculateEffectiveLength(member, node1, node2, analysisMode, lambdaCrit, axialForceMap) {
  const L = member.length * PIXEL_TO_METER;
  let N = member.axialForce || 0;
  if (axialForceMap && axialForceMap.has && axialForceMap.has(member.id)) {
    N = axialForceMap.get(member.id);
  }
  const E = member.E;
  const I = member.I || 0;
  const A = member.A;

  if (analysisMode !== 'frame' || I <= 0) {
    const EulerNcr = N < 0 ? Math.PI * Math.PI * E * A / (L * L) : 0;
    return { mu: 1.0, Pcr: EulerNcr };
  }

  if (N >= 0 || lambdaCrit <= 0) {
    const EulerNcr = Math.PI * Math.PI * E * I / (L * L);
    return { mu: 1.0, Pcr: EulerNcr };
  }

  const Pcr = Math.abs(N) * lambdaCrit;
  const EulerNcr = Math.PI * Math.PI * E * I / (L * L);

  let mu = 1.0;
  if (Pcr > 0 && EulerNcr > 0) {
    mu = Math.sqrt(EulerNcr / Pcr);
  }
  mu = Math.max(0.1, Math.min(5.0, mu));

  return { mu, Pcr };
}

export function solveBuckling(nodes, members, memberAxialForces, analysisMode, numModes = 3) {
  numModes = Math.max(1, Math.min(10, numModes));

  const { K, Kg, numDOF, nodeMap, dofPerNode } = assembleStiffnessMatrices(
    nodes, members, memberAxialForces, analysisMode
  );
  const { Kff, Kgff, freeDOFs, numFree } = applyBoundaryConditions(
    nodes, nodeMap, K, Kg, analysisMode
  );

  if (numModes > numFree) {
    numModes = numFree;
  }

  const bucklingResults = inverseIterationBuckling(Kff, Kgff, numModes);

  const fullModes = bucklingResults.map(result => {
    const fullShape = new Array(numDOF).fill(0);
    for (let i = 0; i < freeDOFs.length; i++) {
      fullShape[freeDOFs[i]] = result.modeShape[i];
    }

    const nodeModeShapes = [];
    for (const node of nodes) {
      const idx = nodeMap.get(node.id).index;
      if (dofPerNode === 3) {
        nodeModeShapes.push({
          nodeId: node.id,
          dx: fullShape[idx * 3],
          dy: fullShape[idx * 3 + 1],
          dtheta: fullShape[idx * 3 + 2]
        });
      } else {
        nodeModeShapes.push({
          nodeId: node.id,
          dx: fullShape[idx * 2],
          dy: fullShape[idx * 2 + 1],
          dtheta: 0
        });
      }
    }

    return {
      modeNumber: result.modeNumber,
      lambda: result.lambda,
      nodeModeShapes
    };
  });

  const memberEffectiveLengths = new Map();
  if (fullModes.length > 0) {
    const lambda1 = fullModes[0].lambda;
    const axialForceMap = new Map();
    if (memberAxialForces instanceof Map) {
      memberAxialForces.forEach((force, id) => axialForceMap.set(id, force));
    }
    for (const member of members) {
      const n1 = nodes.find(n => n.id === member.node1Id);
      const n2 = nodes.find(n => n.id === member.node2Id);
      if (n1 && n2) {
        const eff = calculateEffectiveLength(member, n1, n2, analysisMode, lambda1, axialForceMap);
        memberEffectiveLengths.set(member.id, {
          mu: eff.mu,
          Pcr: eff.Pcr
        });
      }
    }
  }

  return {
    modes: fullModes,
    memberEffectiveLengths,
    analysisMode,
    numFreeDOF: numFree
  };
}
