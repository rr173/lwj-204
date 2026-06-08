import {
  createLocalStiffnessMatrix,
  createTransformationMatrix,
  multiplyMatrices,
  transposeMatrix,
  createBeamLocalStiffnessMatrix,
  createBeamTransformationMatrix,
  applyEndReleases,
  gaussElimination
} from './core.js';

const PIXEL_TO_METER = 0.01;

function createTrussLocalMassMatrix(rho, A, L) {
  const rAL = rho * A * L / 6;
  return [
    [2 * rAL, 0,       rAL,     0      ],
    [0,       2 * rAL, 0,       rAL    ],
    [rAL,     0,       2 * rAL, 0      ],
    [0,       rAL,     0,       2 * rAL]
  ];
}

function createBeamLocalConsistentMassMatrix(rho, A, I, L) {
  const rAL = rho * A * L;
  const rAL420 = rAL / 420;
  const rAL6 = rAL / 6;

  const L2 = L * L;

  return [
    [rAL6 * 2,    0,                    0,                   rAL6,      0,                    0                  ],
    [0,           rAL420 * 156,          rAL420 * 22 * L,     0,         rAL420 * 54,          rAL420 * (-13) * L ],
    [0,           rAL420 * 22 * L,       rAL420 * 4 * L2,     0,         rAL420 * 13 * L,      rAL420 * (-3) * L2 ],
    [rAL6,        0,                    0,                   rAL6 * 2,  0,                    0                  ],
    [0,           rAL420 * 54,           rAL420 * 13 * L,     0,         rAL420 * 156,          rAL420 * (-22) * L ],
    [0,           rAL420 * (-13) * L,    rAL420 * (-3) * L2,  0,         rAL420 * (-22) * L,    rAL420 * 4 * L2    ]
  ];
}

function assembleGlobalMatrices(nodes, members, analysisMode) {
  const nodeMap = new Map();
  nodes.forEach((node, index) => {
    nodeMap.set(node.id, { ...node, index });
  });

  const dofPerNode = analysisMode === 'frame' ? 3 : 2;
  const numDOF = nodes.length * dofPerNode;

  const K = Array(numDOF).fill(null).map(() => Array(numDOF).fill(0));
  const M = Array(numDOF).fill(null).map(() => Array(numDOF).fill(0));

  for (const member of members) {
    const node1 = nodeMap.get(member.node1Id);
    const node2 = nodeMap.get(member.node2Id);
    if (!node1 || !node2) continue;

    const lengthInMeters = member.length * PIXEL_TO_METER;
    const L = lengthInMeters;
    const rho = member.rho || 7850;

    if (analysisMode === 'frame') {
      let kLocal = createBeamLocalStiffnessMatrix(member.E, member.A, member.I, L);
      kLocal = applyEndReleases(kLocal, member.release1, member.release2);

      const mLocal = createBeamLocalConsistentMassMatrix(rho, member.A, member.I, L);
      const T = createBeamTransformationMatrix(member.angle);
      const Tt = transposeMatrix(T);

      const kGlobal = multiplyMatrices(multiplyMatrices(Tt, kLocal), T);
      const mGlobal = multiplyMatrices(multiplyMatrices(Tt, mLocal), T);

      const dof1 = node1.index * 3;
      const dof2 = node2.index * 3;
      const dofIndices = [dof1, dof1 + 1, dof1 + 2, dof2, dof2 + 1, dof2 + 2];

      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          K[dofIndices[i]][dofIndices[j]] += kGlobal[i][j];
          M[dofIndices[i]][dofIndices[j]] += mGlobal[i][j];
        }
      }
    } else {
      const kLocal = createLocalStiffnessMatrix(member.E, member.A, L);
      const mLocal = createTrussLocalMassMatrix(rho, member.A, L);
      const T = createTransformationMatrix(member.angle);
      const Tt = transposeMatrix(T);

      const kGlobal = multiplyMatrices(multiplyMatrices(Tt, kLocal), T);
      const mGlobal = multiplyMatrices(multiplyMatrices(Tt, mLocal), T);

      const dof1 = node1.index * 2;
      const dof2 = node2.index * 2;
      const dofIndices = [dof1, dof1 + 1, dof2, dof2 + 1];

      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          K[dofIndices[i]][dofIndices[j]] += kGlobal[i][j];
          M[dofIndices[i]][dofIndices[j]] += mGlobal[i][j];
        }
      }
    }
  }

  return { K, M, numDOF, nodeMap, dofPerNode };
}

function applyBoundaryConditions(nodes, nodeMap, K, M, analysisMode) {
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
    throw new Error('结构无自由度，无法进行模态分析');
  }

  const numConstrained = constrainedDOFs.length;
  if (analysisMode === 'frame' && numConstrained < 3) {
    throw new Error('结构欠约束，可能为机构（约束数不足3个）');
  }
  if (analysisMode === 'truss' && numConstrained < 3) {
    throw new Error('结构欠约束，可能为机构（约束数不足3个）');
  }

  const Kff = Array(numFree).fill(null).map(() => Array(numFree).fill(0));
  const Mff = Array(numFree).fill(null).map(() => Array(numFree).fill(0));

  for (let i = 0; i < numFree; i++) {
    for (let j = 0; j < numFree; j++) {
      Kff[i][j] = K[freeDOFs[i]][freeDOFs[j]];
      Mff[i][j] = M[freeDOFs[i]][freeDOFs[j]];
    }
  }

  return { Kff, Mff, freeDOFs, numFree };
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

function mOrthogonalize(x, M, prevModes) {
  for (const phi of prevModes) {
    const mPhi = matrixVectorMultiply(M, phi);
    const coeff = dotProduct(x, mPhi) / dotProduct(phi, mPhi);
    for (let i = 0; i < x.length; i++) {
      x[i] -= coeff * phi[i];
    }
  }
  return x;
}

function inverseIteration(Kff, Mff, numModes, maxIter = 200, tol = 1e-10) {
  const n = Kff.length;
  if (numModes > n) numModes = n;
  if (numModes <= 0) numModes = 1;

  const modes = [];

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

    mOrthogonalize(x, Mff, modes);

    let eigenvalue = 0;
    let converged = false;

    for (let iter = 0; iter < maxIter; iter++) {
      const Mx = matrixVectorMultiply(Mff, x);

      const xNew = solveLinearSystem(Kff, Mx);
      if (!xNew) break;

      mOrthogonalize(xNew, Mff, modes);

      norm = vectorNorm(xNew);
      if (norm < 1e-15) break;
      for (let i = 0; i < n; i++) {
        xNew[i] /= norm;
      }

      const Kx = matrixVectorMultiply(Kff, xNew);
      const MxNew = matrixVectorMultiply(Mff, xNew);
      const denom = dotProduct(xNew, MxNew);
      if (Math.abs(denom) < 1e-30) break;
      const newEigenvalue = dotProduct(xNew, Kx) / denom;

      if (iter > 0 && Math.abs(newEigenvalue - eigenvalue) < tol * Math.abs(newEigenvalue)) {
        eigenvalue = newEigenvalue;
        x = xNew;
        converged = true;
        break;
      }

      eigenvalue = newEigenvalue;
      x = xNew;
    }

    if (!converged && eigenvalue <= 0) {
      if (modes.length > 0) break;
    }

    if (eigenvalue <= 0) {
      if (modes.length > 0) break;
    }

    const maxComp = Math.max(...x.map(Math.abs));
    if (maxComp > 1e-15) {
      for (let i = 0; i < n; i++) {
        x[i] /= maxComp;
      }
    }

    modes.push([...x]);
  }

  return modes.map((modeShape, idx) => {
    const Kx = matrixVectorMultiply(Kff, modeShape);
    const Mx = matrixVectorMultiply(Mff, modeShape);
    const eigenvalue = dotProduct(modeShape, Kx) / dotProduct(modeShape, Mx);
    const omega = Math.sqrt(Math.max(eigenvalue, 0));
    const frequency = omega / (2 * Math.PI);

    return {
      modeNumber: idx + 1,
      frequency,
      omega,
      eigenvalue,
      modeShape
    };
  }).filter(m => m.eigenvalue > 0);
}

export function solveModal(nodes, members, analysisMode, numModes = 5) {
  numModes = Math.max(1, Math.min(20, numModes));

  const { K, M, numDOF, nodeMap, dofPerNode } = assembleGlobalMatrices(nodes, members, analysisMode);
  const { Kff, Mff, freeDOFs, numFree } = applyBoundaryConditions(nodes, nodeMap, K, M, analysisMode);

  if (numModes > numFree) {
    numModes = numFree;
  }

  const modalResults = inverseIteration(Kff, Mff, numModes);

  const fullModes = modalResults.map(result => {
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
      frequency: result.frequency,
      omega: result.omega,
      nodeModeShapes
    };
  });

  return {
    modes: fullModes,
    analysisMode,
    numFreeDOF: numFree
  };
}
