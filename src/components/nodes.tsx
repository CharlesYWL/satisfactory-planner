import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';

/** 节点信息详略级别。 */
export type DetailLevel = 'simple' | 'detailed';

/** 一个「加工节点」/「成品节点」的数据。 */
export type MachineNodeData = {
  /** machine = 中间加工，product = 终点成品（高亮大图）。 */
  variant: 'machine' | 'product';
  itemId: string;
  itemName: string;
  itemImage: string;
  /** 加工建筑名（Assembler / Constructor …）。 */
  machineName: string;
  /** 建筑图标 CDN 地址。 */
  machineImage: string;
  /** 该物品产量 /min。 */
  rate: number;
  /** 卡片显示的机器数（反向=小数；正向=整数台数）。 */
  machineCount: number;
  /** 实际需建造的整数机器数。 */
  machineCountInteger: number;
  /** 超频百分比（整数/反向恒 100）。 */
  clockPct: number;
  /** 整数台机器满载功耗 /MW。 */
  power: number;
  /** 末台 / 实际利用率 0~1。 */
  utilization: number;
  /** 是否为瓶颈节点（直接消耗瓶颈原料；仅正向，红高亮 + 角标）。 */
  isBottleneck: boolean;
  /** 是否欠料（正向且利用率 < 100% 且非瓶颈，黄警示）。 */
  starved: boolean;
  /** 配方 id。 */
  recipeId: string;
  /** 配方名（tooltip 用）。 */
  recipeName: string;
  /** 配方单周期时长/秒（tooltip 用）。 */
  recipeDuration: number;
  /** 当前超频下的单机产能/min（tooltip 用）。 */
  singleCapacity: number;
  /** 详略级别：simple 隐藏建筑名与利用率/功耗小字。 */
  detail: DetailLevel;
};

/** 一个「原料输入节点」的数据（红圈叶子）。 */
export type ResourceNodeData = {
  itemId: string;
  itemName: string;
  itemImage: string;
  /** 全树累计需求 /min。 */
  rate: number;
  /** 详略级别（保留以便未来扩展，simple 下不再赘述）。 */
  detail: DetailLevel;
};

export type MachineFlowNode = Node<MachineNodeData, 'machine'>;
export type ResourceFlowNode = Node<ResourceNodeData, 'resource'>;
export type AppFlowNode = MachineFlowNode | ResourceFlowNode;

/** 速率显示：整数原样，否则最多两位小数并去掉尾随 0。 */
export function formatRate(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function MachineNodeImpl({ data }: NodeProps<MachineFlowNode>) {
  const isProduct = data.variant === 'product';
  const detailed = data.detail === 'detailed';
  const overclocked = Math.abs(data.clockPct - 100) > 0.5;
  const utilPct = Math.round(data.utilization * 100);
  const cls = [
    'sf-node',
    isProduct ? 'sf-node--product' : 'sf-node--machine',
    data.isBottleneck ? 'sf-node--bottleneck' : '',
    data.starved ? 'sf-node--starved' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // hover tooltip（原生 title，简单可靠，不引依赖）：配方 / 时长 / 单机产能 / 利用率 / 超频 / 功耗。
  const tip = [
    `${data.itemName} · ${data.recipeName}`,
    `配方时长 ${formatRate(data.recipeDuration)}s`,
    `单机产能 ${formatRate(data.singleCapacity)}/min`,
    `利用率 ${utilPct}%`,
    `超频 ${Math.round(data.clockPct)}%`,
    `功耗 ${Math.round(data.power)}MW（${data.machineCountInteger} 台）`,
  ].join('\n');

  return (
    <div className={cls} title={tip}>
      <Handle type="target" position={Position.Left} />
      {data.isBottleneck ? <span className="sf-node__flag sf-node__flag--bottleneck">瓶颈</span> : null}
      {data.starved ? (
        <span className="sf-node__flag sf-node__flag--starved">{utilPct}%</span>
      ) : null}
      <div className="sf-node__icon">
        {data.machineImage ? <img src={data.machineImage} alt={data.machineName} /> : null}
      </div>
      <div className="sf-node__body">
        <div className="sf-node__title">{data.itemName}</div>
        {detailed ? <div className="sf-node__machine">{data.machineName}</div> : null}
        {isProduct ? (
          <div className="sf-node__rate">{formatRate(data.rate)}/min</div>
        ) : null}
        <div className="sf-node__count">
          ×{data.machineCount.toFixed(2)} <small>台</small>
          {overclocked ? <small className="sf-node__clock"> @{Math.round(data.clockPct)}%</small> : null}
        </div>
        {detailed ? (
          <div className="sf-node__sub">
            建造 {data.machineCountInteger} 台 · 利用率 {utilPct}% ·{' '}
            {Math.round(data.power)}MW
          </div>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function ResourceNodeImpl({ data }: NodeProps<ResourceFlowNode>) {
  return (
    <div className="sf-node sf-node--resource">
      <div className="sf-node__icon sf-node__icon--raw">
        {data.itemImage ? <img src={data.itemImage} alt={data.itemName} /> : null}
      </div>
      <div className="sf-node__body">
        <div className="sf-node__title">{data.itemName}</div>
        <div className="sf-node__sub">原料 · {formatRate(data.rate)}/min</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const MachineNode = memo(MachineNodeImpl);
export const ResourceNode = memo(ResourceNodeImpl);

/** 注册给 React Flow 的自定义节点类型表。 */
export const nodeTypes: NodeTypes = {
  machine: MachineNode,
  resource: ResourceNode,
};
