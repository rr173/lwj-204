import { createNode, createMember } from './core.js';

export function createWarrenTruss() {
  const nodes = [];
  const members = [];
  
  const spacing = 100;
  const height = 86.6;
  
  nodes.push(createNode(60, 320));
  nodes.push(createNode(140, 320));
  nodes.push(createNode(220, 320));
  nodes.push(createNode(300, 320));
  nodes.push(createNode(100, 320 - height));
  nodes.push(createNode(180, 320 - height));
  nodes.push(createNode(260, 320 - height));
  
  nodes[0].support = 'pinned';
  nodes[3].support = 'roller';
  
  nodes[5].fy = -10000;
  
  members.push(createMember(nodes[0], nodes[1]));
  members.push(createMember(nodes[1], nodes[2]));
  members.push(createMember(nodes[2], nodes[3]));
  
  members.push(createMember(nodes[4], nodes[5]));
  members.push(createMember(nodes[5], nodes[6]));
  
  members.push(createMember(nodes[0], nodes[4]));
  members.push(createMember(nodes[4], nodes[1]));
  members.push(createMember(nodes[1], nodes[5]));
  members.push(createMember(nodes[5], nodes[2]));
  members.push(createMember(nodes[2], nodes[6]));
  members.push(createMember(nodes[6], nodes[3]));
  
  return { nodes, members };
}
