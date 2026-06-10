export const STEEL_DENSITY = 7850;
export const YIELD_STRENGTH = 235e6;
export const SAFETY_FACTOR = 0.85;

export const SECTIONS = [
  {
    name: 'H100×100×6×8',
    category: 'H型钢',
    h: 0.100,
    b: 0.100,
    tw: 0.006,
    tf: 0.008,
    A: 0.002190,
    Ix: 0.00000404,
    Iy: 0.00000134,
    Wx: 0.0000808,
    Wy: 0.0000268,
    weight: 17.19
  },
  {
    name: 'H125×125×6.5×9',
    category: 'H型钢',
    h: 0.125,
    b: 0.125,
    tw: 0.0065,
    tf: 0.009,
    A: 0.003031,
    Ix: 0.00000875,
    Iy: 0.00000294,
    Wx: 0.000140,
    Wy: 0.0000471,
    weight: 23.80
  },
  {
    name: 'H150×150×7×10',
    category: 'H型钢',
    h: 0.150,
    b: 0.150,
    tw: 0.007,
    tf: 0.010,
    A: 0.004055,
    Ix: 0.0000167,
    Iy: 0.00000564,
    Wx: 0.000223,
    Wy: 0.0000752,
    weight: 31.85
  },
  {
    name: 'H175×175×7.5×11',
    category: 'H型钢',
    h: 0.175,
    b: 0.175,
    tw: 0.0075,
    tf: 0.011,
    A: 0.005143,
    Ix: 0.0000290,
    Iy: 0.00000988,
    Wx: 0.000332,
    Wy: 0.000113,
    weight: 40.37
  },
  {
    name: 'H200×100×5.5×8',
    category: 'H型钢',
    h: 0.200,
    b: 0.100,
    tw: 0.0055,
    tf: 0.008,
    A: 0.002757,
    Ix: 0.0000204,
    Iy: 0.00000134,
    Wx: 0.000204,
    Wy: 0.0000268,
    weight: 21.66
  },
  {
    name: 'H200×200×8×12',
    category: 'H型钢',
    h: 0.200,
    b: 0.200,
    tw: 0.008,
    tf: 0.012,
    A: 0.006428,
    Ix: 0.0000492,
    Iy: 0.0000160,
    Wx: 0.000492,
    Wy: 0.000160,
    weight: 50.46
  },
  {
    name: 'H250×125×6×9',
    category: 'H型钢',
    h: 0.250,
    b: 0.125,
    tw: 0.006,
    tf: 0.009,
    A: 0.003782,
    Ix: 0.0000412,
    Iy: 0.00000294,
    Wx: 0.000330,
    Wy: 0.0000471,
    weight: 29.70
  },
  {
    name: 'H250×250×9×14',
    category: 'H型钢',
    h: 0.250,
    b: 0.250,
    tw: 0.009,
    tf: 0.014,
    A: 0.009208,
    Ix: 0.000108,
    Iy: 0.0000365,
    Wx: 0.000863,
    Wy: 0.000292,
    weight: 72.30
  },
  {
    name: 'H300×150×6.5×9',
    category: 'H型钢',
    h: 0.300,
    b: 0.150,
    tw: 0.0065,
    tf: 0.009,
    A: 0.004803,
    Ix: 0.0000735,
    Iy: 0.00000507,
    Wx: 0.000490,
    Wy: 0.0000676,
    weight: 37.70
  },
  {
    name: 'H300×300×10×15',
    category: 'H型钢',
    h: 0.300,
    b: 0.300,
    tw: 0.010,
    tf: 0.015,
    A: 0.01204,
    Ix: 0.000205,
    Iy: 0.0000676,
    Wx: 0.00137,
    Wy: 0.000451,
    weight: 94.54
  },
  {
    name: 'H350×175×7×11',
    category: 'H型钢',
    h: 0.350,
    b: 0.175,
    tw: 0.007,
    tf: 0.011,
    A: 0.006366,
    Ix: 0.000137,
    Iy: 0.00000988,
    Wx: 0.000783,
    Wy: 0.000113,
    weight: 50.00
  },
  {
    name: 'H350×350×12×19',
    category: 'H型钢',
    h: 0.350,
    b: 0.350,
    tw: 0.012,
    tf: 0.019,
    A: 0.01739,
    Ix: 0.000403,
    Iy: 0.000136,
    Wx: 0.00230,
    Wy: 0.000776,
    weight: 136.56
  },
  {
    name: 'H400×200×8×13',
    category: 'H型钢',
    h: 0.400,
    b: 0.200,
    tw: 0.008,
    tf: 0.013,
    A: 0.008412,
    Ix: 0.000236,
    Iy: 0.0000174,
    Wx: 0.00118,
    Wy: 0.000174,
    weight: 66.02
  },
  {
    name: 'H450×200×9×14',
    category: 'H型钢',
    h: 0.450,
    b: 0.200,
    tw: 0.009,
    tf: 0.014,
    A: 0.009741,
    Ix: 0.000346,
    Iy: 0.0000187,
    Wx: 0.00154,
    Wy: 0.000187,
    weight: 76.44
  },
  {
    name: 'H500×200×10×16',
    category: 'H型钢',
    h: 0.500,
    b: 0.200,
    tw: 0.010,
    tf: 0.016,
    A: 0.01142,
    Ix: 0.000493,
    Iy: 0.0000214,
    Wx: 0.00197,
    Wy: 0.000214,
    weight: 89.63
  },
  {
    name: 'H600×200×11×17',
    category: 'H型钢',
    h: 0.600,
    b: 0.200,
    tw: 0.011,
    tf: 0.017,
    A: 0.01352,
    Ix: 0.000807,
    Iy: 0.0000227,
    Wx: 0.00269,
    Wy: 0.000227,
    weight: 106.10
  },
  {
    name: '□50×50×3',
    category: '方钢管',
    h: 0.050,
    b: 0.050,
    t: 0.003,
    A: 0.000564,
    Ix: 0.000000220,
    Iy: 0.000000220,
    Wx: 0.00000880,
    Wy: 0.00000880,
    weight: 4.43
  },
  {
    name: '□80×80×4',
    category: '方钢管',
    h: 0.080,
    b: 0.080,
    t: 0.004,
    A: 0.001216,
    Ix: 0.00000116,
    Iy: 0.00000116,
    Wx: 0.0000290,
    Wy: 0.0000290,
    weight: 9.54
  },
  {
    name: '□100×100×4',
    category: '方钢管',
    h: 0.100,
    b: 0.100,
    t: 0.004,
    A: 0.001536,
    Ix: 0.00000228,
    Iy: 0.00000228,
    Wx: 0.0000457,
    Wy: 0.0000457,
    weight: 12.06
  },
  {
    name: '□100×100×6',
    category: '方钢管',
    h: 0.100,
    b: 0.100,
    t: 0.006,
    A: 0.002256,
    Ix: 0.00000318,
    Iy: 0.00000318,
    Wx: 0.0000636,
    Wy: 0.0000636,
    weight: 17.71
  },
  {
    name: '□120×120×4',
    category: '方钢管',
    h: 0.120,
    b: 0.120,
    t: 0.004,
    A: 0.001856,
    Ix: 0.00000402,
    Iy: 0.00000402,
    Wx: 0.0000670,
    Wy: 0.0000670,
    weight: 14.58
  },
  {
    name: '□150×150×5',
    category: '方钢管',
    h: 0.150,
    b: 0.150,
    t: 0.005,
    A: 0.002900,
    Ix: 0.00000982,
    Iy: 0.00000982,
    Wx: 0.000131,
    Wy: 0.000131,
    weight: 22.77
  },
  {
    name: '□150×150×8',
    category: '方钢管',
    h: 0.150,
    b: 0.150,
    t: 0.008,
    A: 0.004544,
    Ix: 0.0000145,
    Iy: 0.0000145,
    Wx: 0.000194,
    Wy: 0.000194,
    weight: 35.66
  },
  {
    name: '□200×200×6',
    category: '方钢管',
    h: 0.200,
    b: 0.200,
    t: 0.006,
    A: 0.004656,
    Ix: 0.0000279,
    Iy: 0.0000279,
    Wx: 0.000279,
    Wy: 0.000279,
    weight: 36.54
  },
  {
    name: '□200×200×8',
    category: '方钢管',
    h: 0.200,
    b: 0.200,
    t: 0.008,
    A: 0.006144,
    Ix: 0.0000358,
    Iy: 0.0000358,
    Wx: 0.000358,
    Wy: 0.000358,
    weight: 48.23
  },
  {
    name: '□250×250×8',
    category: '方钢管',
    h: 0.250,
    b: 0.250,
    t: 0.008,
    A: 0.007744,
    Ix: 0.0000732,
    Iy: 0.0000732,
    Wx: 0.000586,
    Wy: 0.000586,
    weight: 60.78
  },
  {
    name: '□300×300×10',
    category: '方钢管',
    h: 0.300,
    b: 0.300,
    t: 0.010,
    A: 0.01160,
    Ix: 0.000156,
    Iy: 0.000156,
    Wx: 0.00104,
    Wy: 0.00104,
    weight: 91.09
  }
];

export function getSectionsByCategory(category) {
  if (!category) return [...SECTIONS];
  return SECTIONS.filter(s => s.category === category);
}

export function getSectionByName(name) {
  return SECTIONS.find(s => s.name === name);
}

export function searchSections(query) {
  if (!query) return [...SECTIONS];
  const lower = query.toLowerCase();
  return SECTIONS.filter(s => 
    s.name.toLowerCase().includes(lower) || 
    s.category.toLowerCase().includes(lower)
  );
}

export function sortSections(sections, sortBy, ascending = true) {
  const sorted = [...sections];
  sorted.sort((a, b) => {
    let valA, valB;
    switch (sortBy) {
      case 'name':
        return ascending ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      case 'A':
        valA = a.A;
        valB = b.A;
        break;
      case 'Ix':
        valA = a.Ix;
        valB = b.Ix;
        break;
      case 'h':
        valA = a.h;
        valB = b.h;
        break;
      case 'weight':
        valA = a.weight;
        valB = b.weight;
        break;
      default:
        return 0;
    }
    return ascending ? valA - valB : valB - valA;
  });
  return sorted;
}

export function selectOptimalSection(axialForce, bendingMoment, yieldStrength = YIELD_STRENGTH, safetyFactor = SAFETY_FACTOR) {
  const allowableStress = yieldStrength * safetyFactor;
  const absAxial = Math.abs(axialForce);
  const absMoment = Math.abs(bendingMoment);

  let bestSection = null;
  let bestWeight = Infinity;

  for (const section of SECTIONS) {
    const W = section.Wx;
    const A = section.A;

    let maxStress = 0;
    if (absMoment > 0 && W > 0) {
      maxStress += absMoment / W;
    }
    if (absAxial > 0 && A > 0) {
      maxStress += absAxial / A;
    }

    if (maxStress <= allowableStress && section.weight < bestWeight) {
      bestSection = section;
      bestWeight = section.weight;
    }
  }

  if (bestSection) {
    const maxStress = (absMoment > 0 && bestSection.Wx > 0 ? absMoment / bestSection.Wx : 0) +
                      (absAxial > 0 && bestSection.A > 0 ? absAxial / bestSection.A : 0);
    const safetyMargin = maxStress > 0 ? (allowableStress / maxStress - 1) * 100 : Infinity;
    return {
      section: bestSection,
      maxStress,
      allowableStress,
      safetyMargin,
      utilization: maxStress / allowableStress
    };
  }

  return null;
}

export function getCategories() {
  const cats = new Set();
  SECTIONS.forEach(s => cats.add(s.category));
  return [...cats];
}
