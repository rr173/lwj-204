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
  
  nodes[4].fy = -10000;
  
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
