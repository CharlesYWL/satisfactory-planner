import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
import { buildingName, itemName, useLang } from '../i18n';
import { buildFlow, layoutFlow, beltColor, BELT_COLORS, type GraphResult } from './buildFlow';
import { edgeTypes } from './edges';
import { formatRate, nodeTypes, type AppFlowNode, type DetailLevel } from './nodes';
import CollapsibleHud from './CollapsibleHud';

export interface FlowGraphProps {
  /** 归一化产线结果（正向/反向均可）。 */
  result: GraphResult;
  data?: GameData;
  /** 图表方向：左右(LR) / 上下(TB)。 */
  direction?: 'LR' | 'TB';
  /** 节点信息详略级别。 */
  detail?: DetailLevel;
  /** 详细物流：开 → 显示分离器/合并器节点 + 边按带级配色 + 带级图例。 */
  logistics?: boolean;
}

function miniMapColor(node: AppFlowNode): string {
  if (node.type === 'resource') return '#e5484d';
  if (node.type === 'logistics') return '#8a8f98';
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
  logistics = false,
}: FlowGraphProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const layouted = useMemo(() => {
    const { nodes, edges, logisticsSummary } = buildFlow(result, data, detail, lang, logistics);
    return { nodes: layoutFlow(nodes, edges, direction), edges, logisticsSummary };
  }, [result, data, direction, detail, lang, logistics]);

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
        const name = buildingName(m.machineId, lang, data);
        const cur = map.get(m.machineId) ?? { name, count: 0, power: 0 };
        cur.count += m.machineCountInteger;
        cur.power += m.power;
        map.set(m.machineId, cur);
      }
      return [...map.values()].sort((a, b) => b.power - a.power);
    },
    [result.machines, data, lang],
  );

  const rawRows = useMemo(
    () =>
      Object.entries(result.rawTotals)
        .map(([id, rate]) => ({ name: itemName(id, lang, data), rate }))
        .sort((a, b) => b.rate - a.rate),
    [result.rawTotals, data, lang],
  );

  const targetName = itemName(result.itemId, lang, data);
  const logisticsSummary = layouted.logisticsSummary;
  // 带级图例固定展示全 6 档梯度（让用户学会冷→暖配色），高亮当前用到的档位。
  const usedBeltMarks = new Set(logisticsSummary?.beltUsage.map((u) => u.mark) ?? []);
  const beltLegend = Object.keys(BELT_COLORS).map((mark) => ({
    mark,
    color: beltColor(mark),
    used: usedBeltMarks.has(mark),
  }));

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
        <CollapsibleHud title={t('graph.targetLine')} chip="ℹ">
          <div className="sf-hud__label">{t('graph.targetLine')}</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            {formatRate(result.targetRate)}/min · {targetName}
          </div>
          <div className="sf-legend" style={{ marginTop: 8 }}>
            <div className="sf-legend__item">
              <span className="sf-legend__dot" style={{ background: '#e5484d' }} />
              {t('graph.legendRaw')}
            </div>
            <div className="sf-legend__item">
              <span className="sf-legend__dot" style={{ background: '#4caf50' }} />
              {t('graph.legendMachine')}
            </div>
            <div className="sf-legend__item">
              <span className="sf-legend__dot" style={{ background: '#ff8c00' }} />
              {t('graph.legendProduct')}
            </div>
          </div>
          {logistics ? (
            <>
              <div className="sf-hud__label" style={{ marginTop: 10 }}>
                {t('graph.beltLegend')}
              </div>
              <div className="sf-legend sf-legend--belt">
                {beltLegend.map((b) => (
                  <div
                    className={`sf-legend__item${b.used ? ' sf-legend__item--used' : ''}`}
                    key={b.mark}
                  >
                    <span className="sf-legend__bar" style={{ background: b.color }} />
                    {b.mark}
                  </div>
                ))}
              </div>
              <div className="sf-legend sf-legend--belt" style={{ marginTop: 6 }}>
                <div className="sf-legend__item">
                  <span className="sf-legend__glyph">{t('logistics.splitterGlyph')}</span>
                  {t('logistics.splitter')}
                </div>
                <div className="sf-legend__item">
                  <span className="sf-legend__glyph">{t('logistics.mergerGlyph')}</span>
                  {t('logistics.merger')}
                </div>
              </div>
            </>
          ) : null}
        </CollapsibleHud>
      </Panel>

      <Panel position="bottom-right">
        <CollapsibleHud title={t('graph.totalPower')} chip="⚡" className="sf-hud--power">
          <div className="sf-hud__label">{t('graph.totalPower')}</div>
          <div className="sf-hud__power-value">
            {Math.round(result.totalPower)} <small>MW</small>
          </div>
          <details className="sf-hud__group" open>
            <summary className="sf-hud__label sf-hud__summary">{t('graph.machinePower')}</summary>
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
            <summary className="sf-hud__label sf-hud__summary">{t('graph.rawDemand')}</summary>
            {rawRows.map((r) => (
              <div className="sf-hud__row" key={r.name}>
                <span>{r.name}</span>
                <span>{formatRate(r.rate)}/min</span>
              </div>
            ))}
          </details>
          {logistics && logisticsSummary ? (
            <details className="sf-hud__group" open>
              <summary className="sf-hud__label sf-hud__summary">
                {t('graph.logisticsTitle')}
              </summary>
              <div className="sf-hud__row">
                <span>
                  {t('logistics.splitterGlyph')} {t('logistics.splitter')}
                </span>
                <span>×{logisticsSummary.totalSplitters}</span>
              </div>
              <div className="sf-hud__row">
                <span>
                  {t('logistics.mergerGlyph')} {t('logistics.merger')}
                </span>
                <span>×{logisticsSummary.totalMergers}</span>
              </div>
              <div className="sf-hud__divider" />
              <div className="sf-hud__label">{t('graph.beltUsage')}</div>
              {logisticsSummary.beltUsage.map((u) => (
                <div className="sf-hud__row" key={u.mark}>
                  <span>
                    <span
                      className="sf-legend__bar"
                      style={{ background: beltColor(u.mark), marginRight: 6 }}
                    />
                    {u.mark} <small>{u.speed}/min</small>
                  </span>
                  <span>
                    {u.segments} {t('graph.beltSegments')}
                    {u.beltCount > u.segments ? ` · ${u.beltCount}×` : ''}
                  </span>
                </div>
              ))}
            </details>
          ) : null}
        </CollapsibleHud>
      </Panel>
    </ReactFlow>
  );
}
