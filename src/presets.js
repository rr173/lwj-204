import { createNode, createMember } from './core.js';

export function createWarrenTruss() {
  const nodes = [];
  const members = [];
  
  const height = 86.6;
  
  nodes.push(createNode(80, 300));
  nodes.push(createNode(180, 300));
  nodes.push(createNode(280, 300));
  
  nodes.push(createNode(80, 300 - height));
  nodes.push(createNode(180, 300 - height));
  nodes.push(createNode(280, 300 - height));
  
  nodes[0].support = 'pinned';
  nodes[2].support = 'roller';
  
  members.push(createMember(nodes[0], nodes[1]));
  members.push(createMember(nodes[1], nodes[2]));
  
  members.push(createMember(nodes[3], nodes[4]));
  members.push(createMember(nodes[4], nodes[5]));
  
  members.push(createMember(nodes[0], nodes[3]));
  members.push(createMember(nodes[3], nodes[1]));
  members.push(createMember(nodes[1], nodes[4]));
  members.push(createMember(nodes[4], nodes[2]));
  members.push(createMember(nodes[2], nodes[5]));
  
  return { nodes, members };
}

export function createDefaultLoadCases(nodes) {
  const loadCases = [];
  
  const verticalLoadCase = {
    id: 'lc_vertical_' + Date.now() + '_1',
    name: '竖向荷载',
    nodeLoads: {},
    solved: false,
    results: null
  };
  
  nodes.forEach(node => {
    verticalLoadCase.nodeLoads[node.id] = { fx: 0, fy: 0 };
  });
  
  const topMiddleNode = nodes[4];
  if (topMiddleNode) {
    verticalLoadCase.nodeLoads[topMiddleNode.id] = { fx: 0, fy: -10000 };
  }
  
  loadCases.push(verticalLoadCase);
  
  const lateralLoadCase = {
    id: 'lc_lateral_' + Date.now() + '_2',
    name: '侧向风载',
    nodeLoads: {},
    solved: false,
    results: null
  };
  
  nodes.forEach(node => {
    lateralLoadCase.nodeLoads[node.id] = { fx: 0, fy: 0 };
  });
  
  const topNodes = [nodes[3], nodes[4], nodes[5]];
  topNodes.forEach(node => {
    if (node) {
      lateralLoadCase.nodeLoads[node.id] = { fx: 5000, fy: 0 };
    }
  });
  
  loadCases.push(lateralLoadCase);
  
  return loadCases;
}
