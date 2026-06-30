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

import type { GameData, ReverseResult } from '../lib';
import { gameData as defaultData } from '../lib';
import { buildFlow, layoutFlow } from './buildFlow';
import { formatRate, nodeTypes, type AppFlowNode } from './nodes';

export interface FlowGraphProps {
  /** 反向配平结果（balanceReverse 的输出）。 */
  result: ReverseResult;
  data?: GameData;
}

function miniMapColor(node: AppFlowNode): string {
  if (node.type === 'resource') return '#e5484d';
  return node.data.variant === 'product' ? '#ff8c00' : '#4caf50';
}

/**
 * 把一个配平结果渲染成可拖拽 / 缩放 / 平移的生产链流程图。
 * 节点 = 加工/原料/成品，边 = 物品流向（名称 + 速率），角落显示总功耗等汇总。
 */
export default function FlowGraph({ result, data = defaultData }: FlowGraphProps) {
  const layouted = useMemo(() => {
    const { nodes, edges } = buildFlow(result, data);
    return { nodes: layoutFlow(nodes, edges), edges };
  }, [result, data]);

  const [nodes, setNodes, onNodesChange] = useNodesState<AppFlowNode>(layouted.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(layouted.edges);

  useEffect(() => {
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
  }, [layouted, setNodes, setEdges]);

  const buildingRows = useMemo(
    () =>
      Object.entries(result.buildingTotals)
        .map(([id, count]) => ({ name: data.buildings[id]?.name ?? id, count }))
        .sort((a, b) => b.count - a.count),
    [result.buildingTotals, data],
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
            {result.totalPower} <small>MW</small>
          </div>
          <div className="sf-hud__divider" />
          <div className="sf-hud__label">建筑</div>
          {buildingRows.map((b) => (
            <div className="sf-hud__row" key={b.name}>
              <span>{b.name}</span>
              <span>×{b.count}</span>
            </div>
          ))}
          <div className="sf-hud__divider" />
          <div className="sf-hud__label">原矿需求</div>
          {rawRows.map((r) => (
            <div className="sf-hud__row" key={r.name}>
              <span>{r.name}</span>
              <span>{formatRate(r.rate)}/min</span>
            </div>
          ))}
        </div>
      </Panel>
    </ReactFlow>
  );
}
