import { memo, type CSSProperties } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';

/** 施工图自定义边数据：可选流量标签 + 带级徽章。 */
export type BpEdgeData = {
  color: string;
  /** 流量文本（如 "160/min"），仅主干入口边显示。 */
  label?: string;
  /** 带级 mark（显示徽章）。 */
  beltMark?: string;
  /** 是否超单条最高档带速。 */
  overBelt?: boolean;
  /** 并行带条数。 */
  beltCount?: number;
};

export type BpEdge = Edge<BpEdgeData, 'bpEdge'>;

/**
 * 施工图走线：用 smoothstep 路径但把圆角设为 0 → 纯 90° 直角折线，
 * 模拟游戏内沿地基对齐的传送带布线。可选在中点渲染流量 + 带级徽章。
 */
function BpEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<BpEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 0,
  });

  const labelStyle = {
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
  } as CSSProperties;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div className="sf-bp-edge-label nodrag nopan" style={labelStyle}>
            <span className="sf-bp-edge-label__rate">{data.label}</span>
            {data.beltMark ? (
              <span
                className="sf-bp-belt"
                style={{ background: data.color, borderColor: data.color }}
              >
                {data.overBelt ? `${data.beltMark}×${data.beltCount ?? 1}` : data.beltMark}
              </span>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const BpEdgeView = memo(BpEdgeImpl);

/** 注册给 React Flow 的施工图边类型表。 */
export const blueprintEdgeTypes: EdgeTypes = {
  bpEdge: BpEdgeView,
};
