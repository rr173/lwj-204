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
    dx: 0,
    dy: 0,
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
