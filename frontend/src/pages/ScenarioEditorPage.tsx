import { useEffect, useCallback, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { getScenario, updateScenario } from '@/api/scenarios';
import { useScenarioStore } from '@/stores/scenarioStore';
import { nodeTypes } from '@/components/scenario/ScenarioNode';
import { edgeTypes } from '@/components/scenario/LabeledEdge';
import { NodePalette } from '@/components/scenario/NodePalette';
import { NodeConfigPanel } from '@/components/scenario/NodeConfigPanel';
import { ScenarioRunner } from '@/components/scenario/ScenarioRunner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';

export function ScenarioEditorPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [showRunner, setShowRunner] = useState(false);
  const nodeIdCounter = useRef(0);

  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    onConnect: storeOnConnect,
    selectNode,
    addNode,
    selectedNodeId,
    execStatuses,
  } = useScenarioStore();

  // When connecting from a condition node, prompt for edge label
  const handleConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const branchingTypes = ['condition', 'switch', 'if_node'];
      if (sourceNode && branchingTypes.includes(sourceNode.type || '')) {
        const hint = sourceNode.type === 'if_node' ? 'true / false:' : 'Название ветки (например: ТЗ, КП, Прочее):';
        const label = prompt(hint);
        if (label === null) return; // cancelled
        // Add edge with label data via store, then patch data
        storeOnConnect(connection);
        setEdges(
          useScenarioStore.getState().edges.map((e) =>
            e.source === connection.source && e.target === connection.target && !e.data?.label
              ? { ...e, type: 'labeled', data: { ...e.data, label: label.trim() } }
              : e,
          ),
        );
      } else {
        storeOnConnect(connection);
      }
    },
    [nodes, storeOnConnect, setEdges],
  );

  const { data: scenario } = useQuery({
    queryKey: ['scenario', scenarioId],
    queryFn: () => getScenario(scenarioId!),
    enabled: !!scenarioId,
  });

  useEffect(() => {
    if (scenario) {
      setName(scenario.name);
      const gd = scenario.graph_data || { nodes: [], edges: [] };
      setNodes(gd.nodes || []);
      setEdges(gd.edges || []);
      const maxId = (gd.nodes || []).reduce((max: number, n: Node) => {
        const num = parseInt(n.id.split('_').pop() || '0');
        return num > max ? num : max;
      }, 0);
      nodeIdCounter.current = maxId + 1;
    }
  }, [scenario, setNodes, setEdges]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateScenario(scenarioId!, {
        name,
        graph_data: { nodes, edges },
      }),
    onSuccess: () => toast('Сценарий сохранён', 'success'),
    onError: () => toast('Ошибка сохранения', 'error'),
  });

  const handleAddNode = useCallback(
    (type: string) => {
      const id = `node_${nodeIdCounter.current++}`;
      const node: Node = {
        id,
        type,
        position: { x: 250 + Math.random() * 100, y: 100 + nodes.length * 120 },
        data: { label: '', prompt: '' },
      };
      addNode(node);
    },
    [addNode, nodes.length],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="bg-card border-b border-border px-5 py-2.5 flex items-center gap-3 shadow-sm">
        <button
          onClick={() => navigate('/scenarios')}
          className="w-8 h-8 rounded-xl hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-64 rounded-xl font-medium"
          placeholder="Название сценария"
        />
        <div className="flex-1" />
        <Button
          size="sm"
          className="rounded-xl"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
          {saveMutation.isPending ? 'Сохранение...' : 'Сохранить'}
        </Button>
        <Button
          size="sm"
          variant={showRunner ? 'outline' : 'default'}
          className={`rounded-xl ${!showRunner ? 'bg-[#00897b] hover:bg-[#00796b]' : ''}`}
          onClick={() => setShowRunner(!showRunner)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="mr-1.5">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          {showRunner ? 'Редактор' : 'Запустить'}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Node palette */}
        <NodePalette onAdd={handleAddNode} />

        {/* Canvas */}
        <div className="flex-1 bg-[#f7fbf7]">
          <ReactFlow
            nodes={nodes.map((n) => ({
              ...n,
              data: { ...n.data, execStatus: execStatuses[n.id] },
            }))}
            edges={edges.map((e) => e.data?.label ? { ...e, type: 'labeled' } : e)}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            onPaneClick={() => selectNode(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            deleteKeyCode="Delete"
            defaultEdgeOptions={{
              style: { stroke: '#21a038', strokeWidth: 2 },
              type: 'smoothstep',
            }}
          >
            <Background color="#d4e5d6" gap={20} size={1} />
            <Controls
              className="!bg-white !border-border !rounded-xl !shadow-md"
            />
          </ReactFlow>
        </div>

        {/* Config panel or runner */}
        {showRunner ? (
          <ScenarioRunner
            scenarioId={scenarioId!}
            onClose={() => setShowRunner(false)}
          />
        ) : (
          <NodeConfigPanel />
        )}
      </div>
    </div>
  );
}
