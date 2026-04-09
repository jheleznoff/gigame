import { create } from 'zustand';
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';

interface ScenarioState {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  selectNode: (id: string | null) => void;
  addNode: (node: Node) => void;
  updateNodeData: (id: string, data: Record<string, string>) => void;
  deleteNode: (id: string) => void;
}

export const useScenarioStore = create<ScenarioState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) }),

  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (connection) =>
    set({ edges: addEdge(connection, get().edges) }),

  selectNode: (id) => set({ selectedNodeId: id }),

  addNode: (node) => set({ nodes: [...get().nodes, node] }),

  updateNodeData: (id, data) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
      ),
    }),

  deleteNode: (id) =>
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    }),
}));
