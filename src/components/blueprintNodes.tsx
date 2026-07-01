import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import { formatRate } from './nodes';

/**
 * 施工图（Blueprint）自定义节点。
 *
 * 统一给每个节点四个 handle（左=target 'l' / 上=target 't' / 右=source 'r' / 下=source 'b'），
 * 让 manifold 走线能用 step（90°）边在固定端口间连出「主干 → 分离器 → 机器」的直角布线。
 */

/** 四向 handle：左/上为入，右/下为出（配合 step 边做直角走线）。 */
function Ports() {
  return (
    <>
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="t" type="target" position={Position.Top} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
    </>
  );
}

/**
 * 机器专用 handle：顶部按入料种类数放 N 个 target handle（`t0..t{k-1}`），横向均匀错开
 * （2 入口 = 25% / 75%，N 入口 = 每格中点），让不同物料的传送带各自落到自己的入口，
 * 不再合流到同一个中心点（对照 references/ref6 双入口手绘图）。左/右/底保留单 handle。
 */
function MachinePorts({ inputCount }: { inputCount: number }) {
  const k = Math.max(1, inputCount);
  return (
    <>
      {Array.from({ length: k }, (_, j) => (
        <Handle
          key={j}
          id={`t${j}`}
          type="target"
          position={Position.Top}
          style={{ left: `${((j + 0.5) / k) * 100}%` }}
        />
      ))}
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
    </>
  );
}

/** 一台独立机器（阵列展开后的单体）。 */
export type BpMachineData = {
  itemName: string;
  machineName: string;
  machineImage: string;
  /** 1-based 序号（第几台）。 */
  index: number;
  /** 每台产量/min。 */
  perMachineRate: number;
  /** 入料种类数（= 顶部 target handle 数量，用于双/多入口 offset 走线）。 */
  inputCount: number;
  isProduct: boolean;
};

/** 分离器 / 合并器节点（manifold 主干上的分/合）。 */
export type BpDeviceData = {
  device: 'splitter' | 'merger';
  beltColor: string;
  /** 该分支流量文本（可空）。 */
  branchText?: string;
};

/** 输入源（原矿 / 外部供给）卡片，位于一条输入主干最左端。 */
export type BpSourceData = {
  itemName: string;
  itemImage: string;
  flowText: string;
  beltMark: string;
  beltColor: string;
  overBelt: boolean;
  beltCount: number;
  /** raw = 原矿，supplied = 外部供给（当作已有半成品）。 */
  kind: 'raw' | 'supplied';
};

/** 输出端点（一条输出主干最右端）：中间产物的下游接口 / 最终成品的对账口。 */
export type BpOutData = {
  itemName: string;
  itemImage: string;
  flowText: string;
  beltMark: string;
  beltColor: string;
  overBelt: boolean;
  beltCount: number;
  isProduct: boolean;
};

export type BpMachineNode = Node<BpMachineData, 'bpMachine'>;
export type BpDeviceNode = Node<BpDeviceData, 'bpDevice'>;
export type BpSourceNode = Node<BpSourceData, 'bpSource'>;
export type BpOutNode = Node<BpOutData, 'bpOut'>;
export type BpFlowNode = BpMachineNode | BpDeviceNode | BpSourceNode | BpOutNode;

function BpMachineImpl({ data }: NodeProps<BpMachineNode>) {
  const { t } = useTranslation();
  const cls = `sf-bp-machine${data.isProduct ? ' sf-bp-machine--product' : ''}`;
  const tip = `${data.itemName} · ${data.machineName} #${data.index} · ${formatRate(
    data.perMachineRate,
  )}/min`;
  return (
    <div className={cls} title={tip}>
      <MachinePorts inputCount={data.inputCount} />
      <span className="sf-bp-machine__idx">#{data.index}</span>
      <div className="sf-bp-machine__icon">
        {data.machineImage ? <img src={data.machineImage} alt={data.machineName} /> : null}
      </div>
      <div className="sf-bp-machine__body">
        <div className="sf-bp-machine__name">{data.machineName}</div>
        <div className="sf-bp-machine__rate">
          {formatRate(data.perMachineRate)}
          <small> {t('common.perMin')}</small>
        </div>
      </div>
    </div>
  );
}

function BpDeviceImpl({ data }: NodeProps<BpDeviceNode>) {
  const { t } = useTranslation();
  const isSplit = data.device === 'splitter';
  const glyph = isSplit ? t('logistics.splitterGlyph') : t('logistics.mergerGlyph');
  const label = isSplit ? t('logistics.splitter') : t('logistics.merger');
  return (
    <div
      className={`sf-bp-dev sf-bp-dev--${data.device}`}
      title={data.branchText ? `${label} · ${data.branchText}` : label}
      style={{ borderColor: data.beltColor, ['--sf-belt-color' as string]: data.beltColor }}
    >
      <Ports />
      <span className="sf-bp-dev__glyph">{glyph}</span>
    </div>
  );
}

function BpSourceImpl({ data }: NodeProps<BpSourceNode>) {
  return (
    <div
      className={`sf-bp-source sf-bp-source--${data.kind}`}
      title={`${data.itemName} · ${data.flowText} · ${data.beltMark}`}
    >
      <Ports />
      <div className="sf-bp-source__icon">
        {data.itemImage ? <img src={data.itemImage} alt={data.itemName} /> : null}
      </div>
      <div className="sf-bp-source__body">
        <div className="sf-bp-source__name">{data.itemName}</div>
        <div className="sf-bp-source__flow">
          {data.flowText}
          <span
            className="sf-bp-belt"
            style={{ background: data.beltColor, borderColor: data.beltColor }}
          >
            {data.overBelt ? `${data.beltMark}×${data.beltCount}` : data.beltMark}
          </span>
        </div>
      </div>
    </div>
  );
}

function BpOutImpl({ data }: NodeProps<BpOutNode>) {
  const cls = `sf-bp-out${data.isProduct ? ' sf-bp-out--product' : ''}`;
  return (
    <div className={cls} title={`${data.itemName} · ${data.flowText} · ${data.beltMark}`}>
      <Ports />
      <div className="sf-bp-out__icon">
        {data.itemImage ? <img src={data.itemImage} alt={data.itemName} /> : null}
      </div>
      <div className="sf-bp-out__body">
        <div className="sf-bp-out__name">{data.itemName}</div>
        <div className="sf-bp-out__flow">
          {data.flowText}
          <span
            className="sf-bp-belt"
            style={{ background: data.beltColor, borderColor: data.beltColor }}
          >
            {data.overBelt ? `${data.beltMark}×${data.beltCount}` : data.beltMark}
          </span>
        </div>
      </div>
    </div>
  );
}

export const BpMachine = memo(BpMachineImpl);
export const BpDevice = memo(BpDeviceImpl);
export const BpSource = memo(BpSourceImpl);
export const BpOut = memo(BpOutImpl);

/** 注册给 React Flow 的施工图节点类型表。 */
export const blueprintNodeTypes: NodeTypes = {
  bpMachine: BpMachine,
  bpDevice: BpDevice,
  bpSource: BpSource,
  bpOut: BpOut,
};
