let nodeIdCounter = 0;
let memberIdCounter = 0;

export function createNode(x, y) {
  return {
    id: ++nodeIdCounter,
    x,
    y,
    support: 'free',
    fx: 0,
    fy: 0,
    m: 0,
    dx: 0,
    dy: 0,
    dtheta: 0,
    selected: false
  };
}

export function createMember(node1, node2) {
  const dx = node2.x - node1.x;
  const dy = node2.y - node1.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  
  return {
    id: ++memberIdCounter,
    node1Id: node1.id,
    node2Id: node2.id,
    length,
    angle,
    E: 200e9,
    A: 10e-4,
    I: 1e-5,
    release1: false,
    release2: false,
    q: 0,
    axialForce: 0,
    stress: 0,
    selected: false
  };
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function gaussElimination(A, b) {
  const n = A.length;
  const augmented = [];
  
  for (let i = 0; i < n; i++) {
    augmented.push([...A[i], b[i]]);
  }
  
  for (let pivot = 0; pivot < n - 1; pivot++) {
    let maxRow = pivot;
    let maxVal = Math.abs(augmented[pivot][pivot]);
    
    for (let row = pivot + 1; row < n; row++) {
      if (Math.abs(augmented[row][pivot]) > maxVal) {
        maxVal = Math.abs(augmented[row][pivot]);
        maxRow = row;
      }
    }
    
    if (maxRow !== pivot) {
      [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];
    }
    
    if (Math.abs(augmented[pivot][pivot]) < 1e-10) {
      throw new Error('矩阵奇异，结构可能为机构');
    }
    
    for (let row = pivot + 1; row < n; row++) {
      const factor = augmented[row][pivot] / augmented[pivot][pivot];
      for (let col = pivot; col <= n; col++) {
        augmented[row][col] -= factor * augmented[pivot][col];
      }
    }
  }
  
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = augmented[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= augmented[i][j] * x[j];
    }
    x[i] = sum / augmented[i][i];
  }
  
  return x;
}

export function createLocalStiffnessMatrix(E, A, L) {
  const k = E * A / L;
  return [
    [k, 0, -k, 0],
    [0, 0, 0, 0],
    [-k, 0, k, 0],
    [0, 0, 0, 0]
  ];
}

export function createTransformationMatrix(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [c, s, 0, 0],
    [-s, c, 0, 0],
    [0, 0, c, s],
    [0, 0, -s, c]
  ];
}

export function multiplyMatrices(a, b) {
  const m = a.length;
  const n = b[0].length;
  const p = b.length;
  const result = [];
  
  for (let i = 0; i < m; i++) {
    result[i] = [];
    for (let j = 0; j < n; j++) {
      result[i][j] = 0;
      for (let k = 0; k < p; k++) {
        result[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  
  return result;
}

export function transposeMatrix(m) {
  const rows = m.length;
  const cols = m[0].length;
  const result = [];
  
  for (let j = 0; j < cols; j++) {
    result[j] = [];
    for (let i = 0; i < rows; i++) {
      result[j][i] = m[i][j];
    }
  }
  
  return result;
}

export function getForceColor(force, maxForce) {
  if (Math.abs(force) < 1e-6) {
    return '#9e9e9e';
  }
  
  const normalized = Math.min(Math.abs(force) / Math.max(Math.abs(maxForce), 1e-6), 1);
  const intensity = Math.floor(100 + normalized * 155);
  
  if (force > 0) {
    const r = Math.floor(30 + (1 - normalized) * 100);
    const g = Math.floor(136 + (1 - normalized) * 50);
    const b = Math.floor(229);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const r = Math.floor(229);
    const g = Math.floor(57 + (1 - normalized) * 100);
    const b = Math.floor(53 + (1 - normalized) * 100);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

export function createBeamLocalStiffnessMatrix(E, A, I, L) {
  const eaL = E * A / L;
  const eiL3 = E * I / (L * L * L);
  const eiL2 = E * I / (L * L);
  const eiL = E * I / L;

  return [
    [ eaL,    0,         0,       -eaL,   0,         0       ],
    [ 0,      12*eiL3,   6*eiL2,  0,      -12*eiL3,  6*eiL2  ],
    [ 0,      6*eiL2,    4*eiL,   0,      -6*eiL2,   2*eiL   ],
    [-eaL,    0,         0,       eaL,    0,         0       ],
    [ 0,      -12*eiL3,  -6*eiL2, 0,      12*eiL3,   -6*eiL2 ],
    [ 0,      6*eiL2,    2*eiL,   0,      -6*eiL2,   4*eiL   ]
  ];
}

export function createBeamTransformationMatrix(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [ c,  s,  0,  0,  0,  0 ],
    [-s,  c,  0,  0,  0,  0 ],
    [ 0,  0,  1,  0,  0,  0 ],
    [ 0,  0,  0,  c,  s,  0 ],
    [ 0,  0,  0, -s,  c,  0 ],
    [ 0,  0,  0,  0,  0,  1 ]
  ];
}

export function createUniformLoadEquivalentForces(q, L) {
  const qL2 = q * L * L;
  return [
    0,
    q * L / 2,
    qL2 / 12,
    0,
    q * L / 2,
    -qL2 / 12
  ];
}

export function multiplyMatrixVector(M, v) {
  const n = M.length;
  const result = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < v.length; j++) {
      result[i] += M[i][j] * v[j];
    }
  }
  return result;
}

export function applyEndReleases(kLocal, release1, release2) {
  if (!release1 && !release2) return kLocal;

  const k = kLocal.map(row => [...row]);
  const n = 6;
  const releasedDOFs = [];
  if (release1) releasedDOFs.push(2);
  if (release2) releasedDOFs.push(5);

  const keptDOFs = [];
  for (let i = 0; i < n; i++) {
    if (!releasedDOFs.includes(i)) keptDOFs.push(i);
  }

  const m = keptDOFs.length;
  const kReduced = [];
  for (let i = 0; i < m; i++) {
    kReduced[i] = [];
    for (let j = 0; j < m; j++) {
      kReduced[i][j] = k[keptDOFs[i]][keptDOFs[j]];
    }
  }

  const kModified = Array(n).fill(null).map(() => Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      kModified[keptDOFs[i]][keptDOFs[j]] = kReduced[i][j];
    }
  }

  return kModified;
}
