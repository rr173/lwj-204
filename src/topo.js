const GAUSS_POINTS = [
  { xi: -1 / Math.sqrt(3), eta: -1 / Math.sqrt(3), w: 1 },
  { xi: 1 / Math.sqrt(3), eta: -1 / Math.sqrt(3), w: 1 },
  { xi: 1 / Math.sqrt(3), eta: 1 / Math.sqrt(3), w: 1 },
  { xi: -1 / Math.sqrt(3), eta: 1 / Math.sqrt(3), w: 1 }
];

function planeStressDMatrix(E, nu) {
  const factor = E / (1 - nu * nu);
  return [
    [factor, factor * nu, 0],
    [factor * nu, factor, 0],
    [0, 0, factor * (1 - nu) / 2]
  ];
}

function shapeFunctionDerivatives(xi, eta) {
  return [
    { dNdxi: -(1 - eta) / 4, dNdeta: -(1 - xi) / 4 },
    { dNdxi: (1 - eta) / 4, dNdeta: -(1 + xi) / 4 },
    { dNdxi: (1 + eta) / 4, dNdeta: (1 + xi) / 4 },
    { dNdxi: -(1 + eta) / 4, dNdeta: (1 - xi) / 4 }
  ];
}

function computeElementStiffnessMatrix(a, b, E, nu, t) {
  const D = planeStressDMatrix(E, nu);
  const Ke = Array(8).fill(null).map(() => Array(8).fill(0));

  for (const gp of GAUSS_POINTS) {
    const derivs = shapeFunctionDerivatives(gp.xi, gp.eta);
    const dxdxi = a / 2;
    const dydeta = b / 2;
    const detJ = dxdxi * dydeta;

    const B = Array(3).fill(null).map(() => Array(8).fill(0));

    for (let i = 0; i < 4; i++) {
      const dNdx = derivs[i].dNdxi / dxdxi;
      const dNdy = derivs[i].dNdeta / dydeta;

      B[0][2 * i] = dNdx;
      B[1][2 * i + 1] = dNdy;
      B[2][2 * i] = dNdy;
      B[2][2 * i + 1] = dNdx;
    }

    const Bt = Array(8).fill(null).map(() => Array(3).fill(0));
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 3; j++) {
        Bt[i][j] = B[j][i];
      }
    }

    const DB = Array(3).fill(null).map(() => Array(8).fill(0));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 8; j++) {
        for (let k = 0; k < 3; k++) {
          DB[i][j] += D[i][k] * B[k][j];
        }
      }
    }

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        for (let k = 0; k < 3; k++) {
          Ke[i][j] += Bt[i][k] * DB[k][j] * detJ * t * gp.w;
        }
      }
    }
  }

  return Ke;
}

export class TopoOptimizer {
  constructor(config) {
    this.nx = config.nx || 40;
    this.ny = config.ny || 20;
    this.pixelWidth = config.pixelWidth;
    this.pixelHeight = config.pixelHeight;
    this.originX = config.originX;
    this.originY = config.originY;
    this.E = config.E || 200e9;
    this.nu = config.nu || 0.3;
    this.p = config.p || 3;
    this.volFrac = config.volFrac || 0.4;
    this.moveLimit = config.moveLimit || 0.2;
    this.Emin = 1e-9;
    this.thickness = config.thickness || 1;

    this.fixedEdges = config.fixedEdges || {};
    this.forces = config.forces || [];

    this.elemW = this.pixelWidth / this.nx;
    this.elemH = this.pixelHeight / this.ny;

    this.numNodes = (this.nx + 1) * (this.ny + 1);
    this.numElems = this.nx * this.ny;
    this.numDOF = this.numNodes * 2;

    this.density = new Float64Array(this.numElems).fill(this.volFrac);

    const aPhys = 1.0 / this.nx;
    const bPhys = (this.pixelHeight / this.pixelWidth) / this.ny;
    this.Ke0 = computeElementStiffnessMatrix(
      aPhys, bPhys, this.E, this.nu, this.thickness
    );

    this.constrainedDOFs = new Set();
    this.freeDOFs = [];
    this.forceVector = null;

    this.iteration = 0;
    this.maxIter = 200;
    this.converged = false;
    this.compliance = 0;
    this.currentVolFrac = this.volFrac;
    this.maxChange = 0;

    this._setupBoundaryConditions();
    this._setupForces();
  }

  _nodeIndex(col, row) {
    return row * (this.nx + 1) + col;
  }

  _elemNodeIndices(ei, ej) {
    const n0 = this._nodeIndex(ei, ej);
    const n1 = this._nodeIndex(ei + 1, ej);
    const n2 = this._nodeIndex(ei + 1, ej + 1);
    const n3 = this._nodeIndex(ei, ej + 1);
    return [n0, n1, n2, n3];
  }

  _setupBoundaryConditions() {
    this.constrainedDOFs.clear();
    this.freeDOFs = [];

    for (const edge in this.fixedEdges) {
      if (!this.fixedEdges[edge]) continue;

      let nodeIndices = [];
      if (edge === 'left') {
        for (let j = 0; j <= this.ny; j++) {
          nodeIndices.push(this._nodeIndex(0, j));
        }
      } else if (edge === 'right') {
        for (let j = 0; j <= this.ny; j++) {
          nodeIndices.push(this._nodeIndex(this.nx, j));
        }
      } else if (edge === 'top') {
        for (let i = 0; i <= this.nx; i++) {
          nodeIndices.push(this._nodeIndex(i, 0));
        }
      } else if (edge === 'bottom') {
        for (let i = 0; i <= this.nx; i++) {
          nodeIndices.push(this._nodeIndex(i, this.ny));
        }
      }

      for (const ni of nodeIndices) {
        this.constrainedDOFs.add(ni * 2);
        this.constrainedDOFs.add(ni * 2 + 1);
      }
    }

    for (let d = 0; d < this.numDOF; d++) {
      if (!this.constrainedDOFs.has(d)) {
        this.freeDOFs.push(d);
      }
    }
  }

  _setupForces() {
    this.forceVector = new Float64Array(this.numDOF);

    for (const f of this.forces) {
      const ci = Math.floor((f.x - this.originX) / this.elemW);
      const cj = Math.floor((f.y - this.originY) / this.elemH);

      let ni = -1;
      if (ci >= 0 && ci < this.nx && cj >= 0 && cj < this.ny) {
        const nodes = this._elemNodeIndices(ci, cj);
        let minDist = Infinity;
        for (const n of nodes) {
          const col = n % (this.nx + 1);
          const row = Math.floor(n / (this.nx + 1));
          const nx = this.originX + col * this.elemW;
          const ny = this.originY + row * this.elemH;
          const d = Math.sqrt((nx - f.x) ** 2 + (ny - f.y) ** 2);
          if (d < minDist) {
            minDist = d;
            ni = n;
          }
        }
      } else {
        let minDist = Infinity;
        for (let j = 0; j <= this.ny; j++) {
          for (let i = 0; i <= this.nx; i++) {
            const nx = this.originX + i * this.elemW;
            const ny = this.originY + j * this.elemH;
            const d = Math.sqrt((nx - f.x) ** 2 + (ny - f.y) ** 2);
            if (d < minDist) {
              minDist = d;
              ni = this._nodeIndex(i, j);
            }
          }
        }
      }

      if (ni >= 0) {
        this.forceVector[ni * 2] += f.fx || 0;
        this.forceVector[ni * 2 + 1] += f.fy || 0;
      }
    }
  }

  _assembleGlobalStiffness() {
    const rows = [];
    const cols = [];
    const vals = [];

    for (let ej = 0; ej < this.ny; ej++) {
      for (let ei = 0; ei < this.nx; ei++) {
        const eIdx = ej * this.nx + ei;
        const rho = this.density[eIdx];
        const scale = this.Emin + Math.pow(rho, this.p) * (this.E - this.Emin) / this.E;

        const nodes = this._elemNodeIndices(ei, ej);
        const dofIndices = [];
        for (const n of nodes) {
          dofIndices.push(n * 2, n * 2 + 1);
        }

        for (let i = 0; i < 8; i++) {
          for (let j = 0; j < 8; j++) {
            const v = scale * this.Ke0[i][j];
            if (Math.abs(v) > 1e-30) {
              rows.push(dofIndices[i]);
              cols.push(dofIndices[j]);
              vals.push(v);
            }
          }
        }
      }
    }

    const n = this.numDOF;
    const rowPtr = new Int32Array(n + 1);
    for (let k = 0; k < rows.length; k++) rowPtr[rows[k] + 1]++;
    for (let i = 0; i < n; i++) rowPtr[i + 1] += rowPtr[i];
    const colIdx = new Int32Array(rows.length);
    const values = new Float64Array(rows.length);
    const pos = new Int32Array(n);
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k];
      const p = rowPtr[r] + pos[r];
      colIdx[p] = cols[k];
      values[p] = vals[k];
      pos[r]++;
    }

    return { rowPtr, colIdx, values, n };
  }

  _sparseMV(K, x) {
    const { rowPtr, colIdx, values, n } = K;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
        sum += values[k] * x[colIdx[k]];
      }
      y[i] = sum;
    }
    return y;
  }

  _dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  _solveDisplacement(K) {
    const numFree = this.freeDOFs.length;
    if (numFree === 0) return null;

    const freeMap = new Int32Array(this.numDOF).fill(-1);
    for (let i = 0; i < numFree; i++) freeMap[this.freeDOFs[i]] = i;

    const rows = [];
    const cols = [];
    const vals = [];

    for (let i = 0; i < numFree; i++) {
      const gi = this.freeDOFs[i];
      for (let k = K.rowPtr[gi]; k < K.rowPtr[gi + 1]; k++) {
        const gj = K.colIdx[k];
        const j = freeMap[gj];
        if (j >= 0) {
          rows.push(i);
          cols.push(j);
          vals.push(K.values[k]);
        }
      }
    }

    const nf = numFree;
    const rowPtr = new Int32Array(nf + 1);
    for (let k = 0; k < rows.length; k++) rowPtr[rows[k] + 1]++;
    for (let i = 0; i < nf; i++) rowPtr[i + 1] += rowPtr[i];
    const colIdx = new Int32Array(rows.length);
    const values = new Float64Array(rows.length);
    const pos = new Int32Array(nf);
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k];
      const p = rowPtr[r] + pos[r];
      colIdx[p] = cols[k];
      values[p] = vals[k];
      pos[r]++;
    }
    const Kff = { rowPtr, colIdx, values, n: nf };

    const Ff = new Float64Array(nf);
    for (let i = 0; i < nf; i++) Ff[i] = this.forceVector[this.freeDOFs[i]];

    const x = new Float64Array(nf);
    const r = new Float64Array(nf);
    const Kx = this._sparseMV(Kff, x);
    for (let i = 0; i < nf; i++) r[i] = Ff[i] - Kx[i];

    const d = new Float64Array(r);
    let rr = this._dot(r, r);
    const maxIter = Math.min(nf, 2000);
    const tol = 1e-8 * rr;

    for (let iter = 0; iter < maxIter; iter++) {
      const Kd = this._sparseMV(Kff, d);
      const dKd = this._dot(d, Kd);
      if (Math.abs(dKd) < 1e-30) break;
      const alpha = rr / dKd;
      for (let i = 0; i < nf; i++) {
        x[i] += alpha * d[i];
        r[i] -= alpha * Kd[i];
      }
      const rrNew = this._dot(r, r);
      if (rrNew < tol) break;
      const beta = rrNew / rr;
      for (let i = 0; i < nf; i++) d[i] = r[i] + beta * d[i];
      rr = rrNew;
    }

    const u = new Float64Array(this.numDOF);
    for (let i = 0; i < numFree; i++) u[this.freeDOFs[i]] = x[i];

    return u;
  }

  _computeComplianceAndSensitivity(u) {
    let compliance = 0;
    const sensitivity = new Float64Array(this.numElems);

    for (let ej = 0; ej < this.ny; ej++) {
      for (let ei = 0; ei < this.nx; ei++) {
        const eIdx = ej * this.nx + ei;
        const rho = this.density[eIdx];

        const nodes = this._elemNodeIndices(ei, ej);
        const dofIndices = [];
        for (const n of nodes) {
          dofIndices.push(n * 2, n * 2 + 1);
        }

        const ue = new Array(8);
        for (let i = 0; i < 8; i++) {
          ue[i] = u[dofIndices[i]];
        }

        const keUe = new Array(8).fill(0);
        for (let i = 0; i < 8; i++) {
          for (let j = 0; j < 8; j++) {
            keUe[i] += this.Ke0[i][j] * ue[j];
          }
        }

        let ce = 0;
        for (let i = 0; i < 8; i++) {
          ce += ue[i] * keUe[i];
        }

        compliance += (this.Emin + Math.pow(rho, this.p) * (this.E - this.Emin) / this.E) * ce;

        sensitivity[eIdx] = -this.p * Math.pow(Math.max(rho, 1e-10), this.p - 1) *
          (this.E - this.Emin) / this.E * ce;
      }
    }

    return { compliance, sensitivity };
  }

  _ocUpdate(sensitivity) {
    const l1 = 0;
    const l2 = 100000;
    const move = this.moveLimit;
    const dAlpha = 1 / (1 + this.p);
    const targetVol = this.volFrac * this.numElems;

    const newDensity = new Float64Array(this.numElems);
    let maxChange = 0;

    let lo = l1, hi = l2;
    for (let bisection = 0; bisection < 50; bisection++) {
      const lam = (lo + hi) / 2;

      let totalVol = 0;
      for (let e = 0; e < this.numElems; e++) {
        const be = -sensitivity[e] / lam;
        let newRho = this.density[e] * Math.pow(Math.max(be, 1e-10), dAlpha);

        newRho = Math.max(0.001, Math.max(this.density[e] - move,
          Math.min(1.0, Math.min(this.density[e] + move, newRho))));

        newDensity[e] = newRho;
        totalVol += newRho;
      }

      if (totalVol > targetVol) {
        lo = lam;
      } else {
        hi = lam;
      }
    }

    for (let e = 0; e < this.numElems; e++) {
      const change = Math.abs(newDensity[e] - this.density[e]);
      if (change > maxChange) maxChange = change;
    }

    this.density = newDensity;
    this.maxChange = maxChange;
  }

  step() {
    if (this.converged || this.iteration >= this.maxIter) {
      this.converged = true;
      return false;
    }

    const K = this._assembleGlobalStiffness();
    const u = this._solveDisplacement(K);

    if (!u) {
      this.converged = true;
      return false;
    }

    const { compliance, sensitivity } = this._computeComplianceAndSensitivity(u);

    this.compliance = compliance;
    this._ocUpdate(sensitivity);

    this.currentVolFrac = 0;
    for (let e = 0; e < this.numElems; e++) {
      this.currentVolFrac += this.density[e];
    }
    this.currentVolFrac /= this.numElems;

    this.iteration++;

    if (this.maxChange < 0.01 || this.iteration >= this.maxIter) {
      this.converged = true;
    }

    return true;
  }

  getDensityField() {
    return {
      nx: this.nx,
      ny: this.ny,
      originX: this.originX,
      originY: this.originY,
      elemW: this.elemW,
      elemH: this.elemH,
      density: this.density,
      iteration: this.iteration,
      compliance: this.compliance,
      volFrac: this.currentVolFrac,
      converged: this.converged,
      fixedEdges: this.fixedEdges,
      forces: this.forces
    };
  }

  getDensityAt(mx, my) {
    const ei = Math.floor((mx - this.originX) / this.elemW);
    const ej = Math.floor((my - this.originY) / this.elemH);
    if (ei < 0 || ei >= this.nx || ej < 0 || ej >= this.ny) return null;
    return { ei, ej, density: this.density[ej * this.nx + ei] };
  }

  updateConfig(config) {
    if (config.volFrac !== undefined) {
      this.volFrac = Math.max(0.1, Math.min(0.9, config.volFrac));
    }
    if (config.fixedEdges !== undefined) {
      this.fixedEdges = config.fixedEdges;
      this._setupBoundaryConditions();
    }
    if (config.forces !== undefined) {
      this.forces = config.forces;
      this._setupForces();
    }
  }
}
