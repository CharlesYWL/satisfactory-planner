import { useCallback, useEffect, useMemo } from 'react';
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
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { GameData } from '../lib';
import { gameData as defaultData } from '../lib';
import { itemName, useLang } from '../i18n';
import { beltColor, BELT_COLORS, type GraphResult } from './buildFlow';
import { buildBlueprint } from './blueprintFlow';
import { blueprintNodeTypes, type BpFlowNode } from './blueprintNodes';
import { blueprintEdgeTypes } from './blueprintEdges';
import { formatRate } from './nodes';
import CollapsibleHud from './CollapsibleHud';
import ReflowButton from './ReflowButton';

export interface BlueprintGraphProps {
  result: GraphResult;
  data?: GameData;
}

function miniMapColor(node: Node): string {
  if (node.type === 'bpSource') return '#e5484d';
  if (node.type === 'bpDevice') return '#8a8f98';
  if (node.type === 'bpOut') return (node.data as { isProduct?: boolean }).isProduct ? '#ff8c00' : '#4caf50';
  return '#4caf50';
}

/**
 * 施工图视图：展开机器阵列 + manifold 详细走线（对标 B站施工图）。
 * 与拓扑视图并存，由 store.viewMode 切换；本组件只负责渲染，不改动拓扑视图。
 */
export default function BlueprintGraph({ result, data = defaultData }: BlueprintGraphProps) {
  const { t } = useTranslation();
  const lang = useLang();

  const built = useMemo(() => buildBlueprint(result, data, lang), [result, data, lang]);

  const [nodes, setNodes, onNodesChange] = useNodesState<BpFlowNode>(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(built.edges);

  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  // 自动排版：把（被拖乱的）机器阵列恢复成 manifold 网格原始坐标，只改位置、不动边/数据。
  const handleReflow = useCallback(() => {
    setNodes(built.nodes.map((n) => ({ ...n })));
  }, [built.nodes, setNodes]);

  const plan = built.plan;
  const targetName = itemName(result.itemId, lang, data);
  const usedBeltMarks = new Set(plan.beltUsage.map((u) => u.mark));
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
      nodeTypes={blueprintNodeTypes}
      edgeTypes={blueprintEdgeTypes}
      fitView
      fitViewOptions={{ padding: 0.14 }}
      minZoom={0.08}
      maxZoom={2.5}
      nodesConnectable={false}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Lines} gap={38} size={1} color="#2f333a" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={miniMapColor} maskColor="rgba(20,22,26,0.7)" />

      <ReflowButton onReflow={handleReflow} padding={0.14} />

      <Panel position="top-left">
        <CollapsibleHud title={t('graph.blueprintTitle')} chip="ℹ">
          <div className="sf-hud__label">{t('graph.blueprintTitle')}</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            {formatRate(result.targetRate)}/min · {targetName}
          </div>
          <p className="sf-hud__note">{t('graph.blueprintNote')}</p>

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
        </CollapsibleHud>
      </Panel>

      <Panel position="bottom-right">
        <CollapsibleHud
          title={t('graph.blueprintReconcile')}
          chip="∑"
          className="sf-hud--power"
        >
          <div className="sf-hud__label">{t('graph.blueprintReconcile')}</div>
          <div className="sf-hud__power-value">
            {formatRate(plan.productRate)} <small>/min</small>
          </div>
          <div className="sf-hud__row" style={{ marginTop: 6 }}>
            <span>{t('graph.blueprintMachines')}</span>
            <span>×{plan.totalMachines}</span>
          </div>
          <div className="sf-hud__row">
            <span>
              {t('logistics.splitterGlyph')} {t('logistics.splitter')}
            </span>
            <span>×{plan.totalSplitters}</span>
          </div>
          <div className="sf-hud__row">
            <span>
              {t('logistics.mergerGlyph')} {t('logistics.merger')}
            </span>
            <span>×{plan.totalMergers}</span>
          </div>
          {plan.beltUsage.length ? (
            <>
              <div className="sf-hud__divider" />
              <div className="sf-hud__label">{t('graph.beltUsage')}</div>
              {plan.beltUsage.map((u) => (
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
            </>
          ) : null}
        </CollapsibleHud>
      </Panel>
    </ReactFlow>
  );
}
