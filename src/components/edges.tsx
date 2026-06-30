import { memo, type CSSProperties } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';

/** 自定义物料边的数据：图标 + 名称 + 速率 + 建议带速。 */
export type FlowEdgeData = {
  /** 物品名。 */
  itemName: string;
  /** 物品图标 CDN 地址（可空 → 优雅降级为纯文字）。 */
  itemImage: string;
  /** 物品主题色（已提亮，保证深色画布可见）。 */
  color: string;
  /** 物料流速率/min（数值，留作排序/比较用）。 */
  rate: number;
  /** 预格式化的速率文本，如 "12.5/min"。 */
  rateText: string;
  /** 建议传送带档位 mark（suggestBelt）。 */
  beltMark: string;
  /** 速率是否超过单条最高档带速 → 需多条带 / 更高档（醒目提示）。 */
  overBelt: boolean;
  /** 超带速时需要的最高档带条数（≥2）。 */
  beltCount: number;
};

export type FlowEdge = Edge<FlowEdgeData, 'flow'>;

/**
 * 物料流自定义边：沿用 smoothstep 走线，但把 label 换成
 * 「物品小图标 + 名称 + 速率/min + 建议带速 badge」。
 * 图标加载失败时 onError 隐藏 img，只保留文字（优雅降级）。
 */
function FlowEdgeImpl({
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
}: EdgeProps<FlowEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const d = data;
  const labelStyle = {
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
    '--sf-edge-color': d?.color ?? '#ff8c00',
  } as CSSProperties;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {d ? (
        <EdgeLabelRenderer>
          <div className="sf-edge-label nodrag nopan" style={labelStyle}>
            {d.itemImage ? (
              <img
                className="sf-edge-label__icon"
                src={d.itemImage}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : null}
            <span className="sf-edge-label__name">{d.itemName}</span>
            <span className="sf-edge-label__rate">{d.rateText}</span>
            <span
              className={`sf-edge-label__belt${d.overBelt ? ' sf-edge-label__belt--over' : ''}`}
              title={
                d.overBelt
                  ? `超过单条 ${d.beltMark} 上限，需 ${d.beltCount} 条 ${d.beltMark} 或更高带速`
                  : `建议带速 ${d.beltMark}`
              }
            >
              {d.overBelt ? `${d.beltMark}×${d.beltCount} ⚠` : d.beltMark}
            </span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const FlowEdgeView = memo(FlowEdgeImpl);

/** 注册给 React Flow 的自定义边类型表。 */
export const edgeTypes: EdgeTypes = {
  flow: FlowEdgeView,
};
