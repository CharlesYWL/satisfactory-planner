import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';

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
  /** 100% 超频下所需机器数（小数，对标原网站）。 */
  machineCount: number;
  /** 实际需建造的整数机器数。 */
  machineCountInteger: number;
  /** 整数台机器满载功耗 /MW。 */
  power: number;
  /** 末台利用率 0~1（machineCount / machineCountInteger）。 */
  utilization: number;
};

/** 一个「原料输入节点」的数据（红圈叶子）。 */
export type ResourceNodeData = {
  itemId: string;
  itemName: string;
  itemImage: string;
  /** 全树累计需求 /min。 */
  rate: number;
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
  return (
    <div className={`sf-node ${isProduct ? 'sf-node--product' : 'sf-node--machine'}`}>
      <Handle type="target" position={Position.Left} />
      <div className="sf-node__icon">
        {data.machineImage ? <img src={data.machineImage} alt={data.machineName} /> : null}
      </div>
      <div className="sf-node__body">
        <div className="sf-node__title">{data.itemName}</div>
        <div className="sf-node__machine">{data.machineName}</div>
        {isProduct ? (
          <div className="sf-node__rate">{formatRate(data.rate)}/min</div>
        ) : null}
        <div className="sf-node__count">
          ×{data.machineCount.toFixed(2)} <small>台</small>
        </div>
        <div className="sf-node__sub">
          建造 {data.machineCountInteger} 台 · 利用率 {Math.round(data.utilization * 100)}% · {data.power}MW
        </div>
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
