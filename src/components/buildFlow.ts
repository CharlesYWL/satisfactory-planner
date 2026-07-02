import dagre from '@dagrejs/dagre';
import { MarkerType, type Edge } from '@xyflow/react';
import type {
  ForwardResult,
  GameData,
  LogisticsConnection,
  LogisticsSummary,
  ReverseResult,
  ReverseMultiResult,
  TraceNode,
} from '../lib';
import {
  gameData as defaultData,
  BELTS,
  MULTI_ROOT_ITEM_ID,
  aggregateInputFlows,
  computeLogistics,
  machineCapacity,
  suggestBelt,
} from '../lib';
import { itemName as itemLabel, buildingName as buildingLabel, recipeName as recipeLabel, type Lang } from '../i18n';
import type { FlowEdgeData } from './edges';
import {
  formatRate,
  type AppFlowNode,
  type DetailLevel,
  type LogisticsFlowNode,
  type MachineFlowNode,
  type ResourceFlowNode,
} from './nodes';

/** 单条传送带的最高吞吐（最高档带速）；超过即需多条带 / 更高档。 */
const MAX_BELT_SPEED = BELTS[BELTS.length - 1].speed;

/**
 * 传送带等级配色（冷→暖，对应流量从低到高）。
 * 参照 ref5（B站UP主）的「带级分色 + 图例」：低级冷色、高级暖色，
 * 一眼看出哪段是带宽压力大（红=最高档/瓶颈风险）。
 */
export const BELT_COLORS: Record<string, string> = {
  Mk1: '#9aa0a6',
  Mk2: '#4caf50',
  Mk3: '#42a5f5',
  Mk4: '#ffd54f',
  Mk5: '#ff9800',
  Mk6: '#e5484d',
};

/** 取某带级的配色（未知档位回退灰）。 */
export function beltColor(mark: string): string {
  return BELT_COLORS[mark] ?? '#9aa0a6';
}

/**
 * 图层归一化结果：把 M1 的两种结果（正向 ForwardResult / 反向 ReverseResult）
 * 统一成 FlowGraph 能直接渲染的形状。算法层（src/lib）保持纯净，不感知 UI。
 */
export interface GraphMachine {
  itemId: string;
  recipeId: string;
  machineId: string;
  /** 该物品产量/min。 */
  rate: number;
  /** 用于卡片显示的机器数（反向=小数对标原网站；正向=整数台数）。 */
  machineCount: number;
  /** 实际建造的整数台数。 */
  machineCountInteger: number;
  /** 超频百分比（整数/反向恒 100）。 */
  clockPct: number;
  /** 利用率 0~1。 */
  utilization: number;
  /** 功耗/MW。 */
  power: number;
  /** 该级是否直接消耗瓶颈原料（仅正向有意义；反向恒 false）。 */
  isBottleneck: boolean;
}

/** FlowGraph 渲染所需的归一化产线结果。 */
export interface GraphResult {
  itemId: string;
  /** 配平取向：瓶颈/欠料高亮仅在 forward 下生效。 */
  mode: 'forward' | 'reverse';
  /** HUD 标题用的产出速率/min（反向=目标产量之和；正向=实际产量）。 */
  targetRate: number;
  /**
   * 目标集合（反向可多目标，正向恒单目标）：图层据此判断哪些节点是「成品」高亮，
   * HUD 据此逐目标显示「产量/min · 名称」。单目标时长度为 1。
   */
  targets: { itemId: string; rate: number }[];
  /** 生产树（用于连边与节点展开）；多目标时为虚拟 super-root（见 MULTI_ROOT_ITEM_ID）。 */
  tree: TraceNode | null;
  /** 原矿/原料需求汇总。 */
  rawTotals: Record<string, number>;
  /** 各自产物品的机器汇总。 */
  machines: GraphMachine[];
  /** 建筑 → 整数台数合计。 */
  buildingTotals: Record<string, number>;
  /** 总功耗/MW。 */
  totalPower: number;
}

/** 反向配平结果 → 归一化 GraphResult（小数机器数，clock 恒 100%）。 */
export function reverseToGraph(result: ReverseResult): GraphResult {
  const machines: GraphMachine[] = result.machines.map((m) => ({
    itemId: m.itemId,
    recipeId: m.recipeId,
    machineId: m.machineId,
    rate: m.rate,
    machineCount: m.machineCount,
    machineCountInteger: m.machineCountInteger,
    clockPct: 100,
    utilization: m.machineCountInteger > 0 ? m.machineCount / m.machineCountInteger : 1,
    power: m.power,
    isBottleneck: false,
  }));
  return {
    itemId: result.itemId,
    mode: 'reverse',
    targetRate: result.targetRate,
    targets: [{ itemId: result.itemId, rate: result.targetRate }],
    tree: result.tree,
    rawTotals: result.rawTotals,
    machines,
    buildingTotals: result.buildingTotals,
    totalPower: result.totalPower,
  };
}

/** 反向多目标配平结果 → 归一化 GraphResult（共享中间产物已按 itemId 合并）。 */
export function reverseMultiToGraph(result: ReverseMultiResult): GraphResult {
  const machines: GraphMachine[] = result.machines.map((m) => ({
    itemId: m.itemId,
    recipeId: m.recipeId,
    machineId: m.machineId,
    rate: m.rate,
    machineCount: m.machineCount,
    machineCountInteger: m.machineCountInteger,
    clockPct: 100,
    utilization: m.machineCountInteger > 0 ? m.machineCount / m.machineCountInteger : 1,
    power: m.power,
    isBottleneck: false,
  }));
  const targetRate = result.targets.reduce((sum, t) => sum + t.rate, 0);
  return {
    // HUD 名称退化字段取首个目标；多目标标题实际逐目标渲染 `targets`。
    itemId: result.targets[0]?.itemId ?? '',
    mode: 'reverse',
    targetRate,
    targets: result.targets.map((t) => ({ itemId: t.itemId, rate: t.rate })),
    tree: result.tree,
    rawTotals: result.rawTotals,
    machines,
    buildingTotals: result.buildingTotals,
    totalPower: result.totalPower,
  };
}

/**
 * 正向配平结果 + 在实际产量下重跑的生产树 → 归一化 GraphResult。
 * 机器数取正向的整数台数 / 超频百分比 / 利用率（demand÷throughput）。
 */
export function forwardToGraph(
  result: ForwardResult,
  tree: TraceNode | null,
): GraphResult {
  const machines: GraphMachine[] = result.nodes.map((n) => ({
    itemId: n.itemId,
    recipeId: n.recipeId,
    machineId: n.machineId,
    rate: n.demand,
    machineCount: n.machineCount,
    machineCountInteger: n.machineCount,
    clockPct: n.clockPct,
    utilization: n.utilization,
    power: n.power,
    isBottleneck: n.isBottleneck,
  }));
  const buildingTotals: Record<string, number> = {};
  for (const n of result.nodes) {
    buildingTotals[n.machineId] = (buildingTotals[n.machineId] ?? 0) + n.machineCount;
  }
  return {
    itemId: result.itemId,
    mode: 'forward',
    targetRate: result.targetOutput,
    targets: [{ itemId: result.itemId, rate: result.targetOutput }],
    tree,
    rawTotals: result.rawInputs,
    machines,
    buildingTotals,
    totalPower: result.totalPower,
  };
}

/** React Flow 节点 id 用物品 id 直接当 key（每个物品在图里去重为一个节点）。 */
const nodeId = (itemId: string) => itemId;

const FALLBACK_COLOR = '#ff8c00';

/**
 * 保证连线颜色在深色画布上可见：亮度过低的物品色（如 Coal #030405）
 * 朝白色方向提亮，足够亮的颜色原样返回。
 */
function visibleColor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  let r = parseInt(match[1].slice(0, 2), 16);
  let g = parseInt(match[1].slice(2, 4), 16);
  let b = parseInt(match[1].slice(4, 6), 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const MIN_LUM = 96;
  if (lum < MIN_LUM) {
    const t = (MIN_LUM - lum) / (255 - lum);
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
  }
  const hex2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** 各类节点尺寸（dagre 布局 + 卡片渲染共用）。 */
const SIZES = {
  product: { width: 250, height: 124 },
  machine: { width: 224, height: 104 },
  resource: { width: 176, height: 72 },
  logistics: { width: 104, height: 60 },
} as const;

function sizeOf(node: AppFlowNode): { width: number; height: number } {
  if (node.type === 'resource') return SIZES.resource;
  if (node.type === 'logistics') return SIZES.logistics;
  return node.data.variant === 'product' ? SIZES.product : SIZES.machine;
}

/** makeEdge 选项：详细物流配色 / 拆边的节点重定向 / 箭头开关。 */
interface MakeEdgeOptions {
  /** 详细物流：边按带级配色，徽章配色。 */
  logistics?: boolean;
  /** 该连接的物流估算（带级 / 分合数量，详细物流下用）。 */
  conn?: LogisticsConnection;
  /** 目标节点 id（默认 = targetItemId；拆边时指向物流节点）。 */
  targetNodeId?: string;
  /** 是否渲染箭头 marker（拆成两段时，前段不带箭头）。 */
  withMarker?: boolean;
}

function makeEdge(
  sourceItemId: string,
  targetItemId: string,
  rate: number,
  data: GameData,
  lang: Lang,
  options: MakeEdgeOptions = {},
): Edge {
  const { logistics = false, conn, targetNodeId, withMarker = true } = options;
  const item = data.items[sourceItemId];
  const belt = conn?.belt ?? suggestBelt(rate);
  const overBelt = conn ? conn.overBelt : rate > MAX_BELT_SPEED + 1e-6;
  const beltCount = conn ? conn.beltCount : overBelt ? Math.ceil(rate / MAX_BELT_SPEED) : 1;
  // 详细物流：边描边按带级配色；否则按物品主题色（提亮保证可见）。
  const tierColor = beltColor(belt.mark);
  const color = logistics ? tierColor : visibleColor(item?.color || FALLBACK_COLOR);
  const target = targetNodeId ?? nodeId(targetItemId);

  const edgeData: FlowEdgeData = {
    itemName: itemLabel(sourceItemId, lang, data),
    itemImage: item?.image ?? '',
    color,
    rate,
    rateText: `${formatRate(rate)}/min`,
    beltMark: belt.mark,
    overBelt,
    beltCount,
    logistics,
    beltColor: tierColor,
  };
  return {
    id: `${nodeId(sourceItemId)}->${target}`,
    source: nodeId(sourceItemId),
    target,
    type: 'flow',
    animated: true,
    data: edgeData,
    style: { stroke: color, strokeWidth: logistics ? 3 : 2.5 },
    markerEnd: withMarker
      ? { type: MarkerType.ArrowClosed, color, width: 18, height: 18 }
      : undefined,
  };
}

/** 物流节点 → 目标机器的「主干」连接段：只按带级描边 + 箭头，无标签。 */
function beltConnectorEdge(
  sourceNodeId: string,
  targetItemId: string,
  conn: LogisticsConnection,
): Edge {
  const color = beltColor(conn.belt.mark);
  return {
    id: `${sourceNodeId}->${nodeId(targetItemId)}`,
    source: sourceNodeId,
    target: nodeId(targetItemId),
    type: 'default',
    animated: true,
    style: { stroke: color, strokeWidth: 3 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
  };
}

/**
 * 把归一化产线结果（生产树）转成 React Flow 的 nodes + edges。
 *
 * - 每个「自产」物品 → 一个 machine 节点（目标成品标记为 product）。
 * - 每个原料 / 已供给叶子 → 一个 resource 节点（红圈），需求量按消费方累加。
 * - 边方向：生产者 → 消费者，label = 物品名 + 速率/min，颜色取 item.color。
 *
 * 同一物品在树里若出现多次（被多处消费）只生成一个节点，多条消费边各自保留。
 */
export function buildFlow(
  result: GraphResult,
  data: GameData = defaultData,
  detail: DetailLevel = 'detailed',
  lang: Lang = 'en',
  logistics = false,
): { nodes: AppFlowNode[]; edges: Edge[]; logisticsSummary: LogisticsSummary | null } {
  const nodes: AppFlowNode[] = [];
  const edges: Edge[] = [];
  const summaryByItem = new Map(result.machines.map((m) => [m.itemId, m]));
  const resourceRate = new Map<string, number>();
  const visited = new Set<string>();

  // 详细物流：按整数台数算每条连接的带级 + 分离器/合并器估算，键 = source->target。
  const machineCountOf = (itemId: string) =>
    summaryByItem.get(itemId)?.machineCountInteger ?? 0;
  const logisticsSummary = logistics
    ? computeLogistics(result.tree, machineCountOf, data)
    : null;
  const connByEdge = new Map<string, LogisticsConnection>(
    logisticsSummary?.connections.map((c) => [`${c.itemId}->${c.targetItemId}`, c]) ?? [],
  );
  // 边/资源需求的流量口径：同一物料被多个下游消费时，首个目标节点只带一条支路的 rate，
  // 必须聚合全树同 (目标, 输入) 的流量才是真实总量（与施工图 / 物流估算保持一致）。
  const inputFlowOf = aggregateInputFlows(result.tree);
  const targetItemIds = new Set(result.targets.map((t) => t.itemId));

  const walk = (node: TraceNode) => {
    // 多目标虚拟 super-root：本身不渲染，只透传到各目标子树。
    if (node.itemId === MULTI_ROOT_ITEM_ID) {
      for (const child of node.children) walk(child);
      return;
    }
    if (visited.has(node.itemId)) return;
    visited.add(node.itemId);

    const item = data.items[node.itemId];
    const building = data.buildings[node.machineId];
    const summary = summaryByItem.get(node.itemId);
    const machineCount = summary?.machineCount ?? node.machineCount;
    const machineCountInteger = summary?.machineCountInteger ?? Math.ceil(machineCount - 1e-9);
    const isTarget = targetItemIds.has(node.itemId);

    const clockPct = summary?.clockPct ?? 100;
    const utilization =
      summary?.utilization ??
      (machineCountInteger > 0 ? machineCount / machineCountInteger : 1);
    const recipe = data.recipes[summary?.recipeId ?? node.recipeId];
    const singleCapacity = recipe ? machineCapacity(recipe, clockPct / 100) : 0;
    // 瓶颈/欠料高亮仅在正向取向生效；反向只是凑整后的小数利用率，不视为欠料。
    const isBottleneck = result.mode === 'forward' && (summary?.isBottleneck ?? false);
    const starved =
      result.mode === 'forward' && !isBottleneck && utilization < 0.999;

    const machineNode: MachineFlowNode = {
      id: nodeId(node.itemId),
      type: 'machine',
      position: { x: 0, y: 0 },
      data: {
        variant: isTarget ? 'product' : 'machine',
        itemId: node.itemId,
        itemName: itemLabel(node.itemId, lang, data),
        itemImage: item?.image ?? '',
        machineName: buildingLabel(node.machineId, lang, data),
        machineImage: building?.image ?? '',
        rate: summary?.rate ?? node.rate,
        machineCount,
        machineCountInteger,
        clockPct,
        power: summary?.power ?? 0,
        utilization,
        isBottleneck,
        starved,
        recipeId: recipe?.id ?? node.recipeId,
        recipeName: recipeLabel(recipe?.id ?? node.recipeId, lang, data),
        recipeDuration: recipe?.duration ?? 0,
        singleCapacity,
        detail,
      },
    };
    nodes.push(machineNode);

    for (const input of node.inputs) {
      const conn = connByEdge.get(`${input.itemId}->${node.itemId}`);
      // 该「输入物料 → 本组」的真实总流量（多消费者时聚合），回退单节点 rate。
      const inputFlow = inputFlowOf(node.itemId, input.itemId) ?? input.rate;
      // 详细物流且该段确有分离器/合并器 → 在源与目标之间插入物流节点。
      if (logistics && conn && conn.splitters + conn.mergers > 0) {
        const logiId = `logi:${input.itemId}->${node.itemId}`;
        const tierColor = beltColor(conn.belt.mark);
        const logiNode: LogisticsFlowNode = {
          id: logiId,
          type: 'logistics',
          position: { x: 0, y: 0 },
          data: {
            itemName: itemLabel(input.itemId, lang, data),
            flowText: `${formatRate(conn.flow)}/min`,
            beltMark: conn.belt.mark,
            beltColor: tierColor,
            splitters: conn.splitters,
            mergers: conn.mergers,
            overBelt: conn.overBelt,
            beltCount: conn.beltCount,
          },
        };
        nodes.push(logiNode);
        // 前段：源 → 物流节点（带物料标签 + 带级配色，不带箭头）。
        edges.push(
          makeEdge(input.itemId, node.itemId, inputFlow, data, lang, {
            logistics: true,
            conn,
            targetNodeId: logiId,
            withMarker: false,
          }),
        );
        // 后段：物流节点 → 目标（带级配色 + 箭头，无标签）。
        edges.push(beltConnectorEdge(logiId, node.itemId, conn));
      } else {
        edges.push(
          makeEdge(input.itemId, node.itemId, inputFlow, data, lang, { logistics, conn }),
        );
      }
      if (input.kind !== 'produced') {
        resourceRate.set(input.itemId, (resourceRate.get(input.itemId) ?? 0) + inputFlow);
      }
    }

    for (const child of node.children) walk(child);
  };

  if (result.tree) walk(result.tree);

  for (const [itemId, rate] of resourceRate) {
    const item = data.items[itemId];
    const resourceNode: ResourceFlowNode = {
      id: nodeId(itemId),
      type: 'resource',
      position: { x: 0, y: 0 },
      data: {
        itemId,
        itemName: itemLabel(itemId, lang, data),
        itemImage: item?.image ?? '',
        rate,
        detail,
      },
    };
    nodes.push(resourceNode);
  }

  return { nodes, edges, logisticsSummary };
}

/**
 * 用 dagre 做有向无环图自动布局（默认左→右），返回带绝对坐标的节点。
 * dagre 给的是节点中心坐标，React Flow 用左上角，这里做一次换算。
 */
export function layoutFlow(
  nodes: AppFlowNode[],
  edges: Edge[],
  direction: 'LR' | 'TB' = 'LR',
): AppFlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 42, ranksep: 130, marginx: 48, marginy: 48 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const { width, height } = sizeOf(node);
    g.setNode(node.id, { width, height });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const { width, height } = sizeOf(node);
    const pos = g.node(node.id);
    return {
      ...node,
      width,
      height,
      position: { x: pos.x - width / 2, y: pos.y - height / 2 },
    };
  });
}
