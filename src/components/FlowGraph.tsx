import { useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { GameData } from '../lib';
import { gameData as defaultData } from '../lib';
import { buildFlow, layoutFlow, type GraphResult } from './buildFlow';
import { edgeTypes } from './edges';
import { formatRate, nodeTypes, type AppFlowNode, type DetailLevel } from './nodes';

export interface FlowGraphProps {
  /** 归一化产线结果（正向/反向均可）。 */
  result: GraphResult;
  data?: GameData;
  /** 图表方向：左右(LR) / 上下(TB)。 */
  direction?: 'LR' | 'TB';
  /** 节点信息详略级别。 */
  detail?: DetailLevel;
}

function miniMapColor(node: AppFlowNode): string {
  if (node.type === 'resource') return '#e5484d';
  return node.data.variant === 'product' ? '#ff8c00' : '#4caf50';
}

/**
 * 把一个配平结果渲染成可拖拽 / 缩放 / 平移的生产链流程图。
 * 节点 = 加工/原料/成品，边 = 物品流向（名称 + 速率），角落显示总功耗等汇总。
 */
export default function FlowGraph({
  result,
  data = defaultData,
  direction = 'LR',
  detail = 'detailed',
}: FlowGraphProps) {
  const layouted = useMemo(() => {
    const { nodes, edges } = buildFlow(result, data, detail);
    return { nodes: layoutFlow(nodes, edges, direction), edges };
  }, [result, data, direction, detail]);

  const [nodes, setNodes, onNodesChange] = useNodesState<AppFlowNode>(layouted.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(layouted.edges);

  useEffect(() => {
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
  }, [layouted, setNodes, setEdges]);

  const buildingRows = useMemo(
    () => {
      const map = new Map<string, { name: string; count: number; power: number }>();
      for (const m of result.machines) {
        const name = data.buildings[m.machineId]?.name ?? m.machineId;
        const cur = map.get(m.machineId) ?? { name, count: 0, power: 0 };
        cur.count += m.machineCountInteger;
        cur.power += m.power;
        map.set(m.machineId, cur);
      }
      return [...map.values()].sort((a, b) => b.power - a.power);
    },
    [result.machines, data],
  );

  const rawRows = useMemo(
    () =>
      Object.entries(result.rawTotals)
        .map(([id, rate]) => ({ name: data.items[id]?.name ?? id, rate }))
        .sort((a, b) => b.rate - a.rate),
    [result.rawTotals, data],
  );

  const targetName = data.items[result.itemId]?.name ?? result.itemId;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.15}
      maxZoom={2.5}
      nodesConnectable={false}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#3a3e45" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={miniMapColor} maskColor="rgba(20,22,26,0.7)" />

      <Panel position="top-left">
        <div className="sf-hud">
          <div className="sf-hud__label">目标产线</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            {formatRate(result.targetRate)}/min · {targetName}
          </div>
          <div className="sf-legend" style={{ marginTop: 8 }}>
            <div className="sf-legend__item">
              <span className="sf-legend__dot" style={{ background: '#e5484d' }} />原料
            </div>
            <div className="sf-legend__item">
              <span className="sf-legend__dot" style={{ background: '#4caf50' }} />加工
            </div>
            <div className="sf-legend__item">
              <span className="sf-legend__dot" style={{ background: '#ff8c00' }} />成品
            </div>
          </div>
        </div>
      </Panel>

      <Panel position="bottom-right">
        <div className="sf-hud sf-hud--power">
          <div className="sf-hud__label">总功耗</div>
          <div className="sf-hud__power-value">
            {Math.round(result.totalPower)} <small>MW</small>
          </div>
          <details className="sf-hud__group" open>
            <summary className="sf-hud__label sf-hud__summary">机器功耗（按类型）</summary>
            {buildingRows.map((b) => (
              <div className="sf-hud__row" key={b.name}>
                <span>
                  {b.name} <small>×{b.count}</small>
                </span>
                <span>{Math.round(b.power)}MW</span>
              </div>
            ))}
          </details>
          <details className="sf-hud__group">
            <summary className="sf-hud__label sf-hud__summary">原矿需求</summary>
            {rawRows.map((r) => (
              <div className="sf-hud__row" key={r.name}>
                <span>{r.name}</span>
                <span>{formatRate(r.rate)}/min</span>
              </div>
            ))}
          </details>
        </div>
      </Panel>
    </ReactFlow>
  );
}
