/**
 * 施工图（Blueprint）视图的纯计算层（无 UI 依赖，可单测）。
 *
 * 与「拓扑视图」的抽象「组对组」不同，施工图把每个机器组**展开成 N 台独立机器**，
 * 并按游戏里最通用的 **manifold（歧管/主干供料）** 拓扑给出「照着能搭」的走线：
 *
 *  - 输入侧：每种原料一条主干带。主干沿机器阵列走，在每台机器前用一个 **1→2 分离器**
 *    抽出该台需要的量，尾料继续喂下一台，最后一台直接吃主干尾料。
 *    → N 台机器 = N-1 个分离器（每个净增 1 个出口）。
 *  - 输出侧：每台机器的产物用 **2→1 合并器** 级联汇成一条主干带。
 *    → N 台机器 = N-1 个合并器。
 *  - 传送带按整段主干总流量定档（suggestBelt），超单条最高档给出并行带条数。
 *
 * 口径与 logistics.ts 一致（数量级正确、不追求最省带的 balancer），区别仅在于
 * manifold 用「线性级联」而非「先全合再全分」的树，故分/合数量为 N-1（更贴近实际搭法）。
 */

import { BELTS, suggestBelt, type Belt } from './rates';
import type { InputKind, TraceNode } from './trace';
import type { BeltUsage } from './logistics';

/** 单条传送带最高吞吐（最高档带速）/min。 */
export const MAX_BELT_SPEED = BELTS[BELTS.length - 1].speed;

/**
 * manifold 线性级联：把一条主干供到 N 台机器（每台前一个分离器抽料，最后一台吃尾料）
 * 需要的分离器数 = max(N-1, 0)。合并侧同理（N 台汇成一条主干需 N-1 个合并器）。
 */
export function manifoldNodes(machines: number): number {
  if (!Number.isFinite(machines) || machines <= 1) return 0;
  return Math.floor(machines) - 1;
}

/** 施工图里一个机器组的「一种原料」输入 manifold 估算。 */
export interface BlueprintInput {
  /** 流动的物品 itemId。 */
  itemId: string;
  /** 该原料主干总流量/min（全组）。 */
  totalFlow: number;
  /** 每台机器分到的流量/min。 */
  perMachineFlow: number;
  /** 建议带级（按主干总流量）。 */
  belt: Belt;
  /** 是否超单条最高档带速。 */
  overBelt: boolean;
  /** 满足流量所需并行带条数（≥1）。 */
  beltCount: number;
  /** 该 manifold 需要的分离器数（= N-1）。 */
  splitters: number;
  /** 原料是否来自另一机器组（false = 原矿/外部供给，无上游组）。 */
  produced: boolean;
  /** 输入分类（produced / supplied / raw）。 */
  kind: InputKind;
}

/** 施工图里一个机器组（某物品的全部机器）。 */
export interface BlueprintGroup {
  /** 该组产出的物品 itemId。 */
  itemId: string;
  recipeId: string;
  machineId: string;
  /** 展开的整数机器台数。 */
  machineCount: number;
  /** 该组全树累计产量/min。 */
  totalRate: number;
  /** 每台机器产量/min。 */
  perMachineRate: number;
  /** 是否为最终成品（根节点）。 */
  isProduct: boolean;
  /** 各原料输入 manifold。 */
  inputs: BlueprintInput[];
  /** 输出侧合并器数（= N-1）。 */
  outputMergers: number;
  /** 输出主干建议带级。 */
  outputBelt: Belt;
  /** 输出流量是否超单条最高档带速。 */
  outputOverBelt: boolean;
  /** 输出主干所需并行带条数。 */
  outputBeltCount: number;
  /** 距根节点的最长距离（用于排布：越大越靠上游 → 画在越上方）。 */
  depth: number;
}

/** 整张施工图的计算结果。 */
export interface BlueprintPlan {
  /** 机器组（已按「上游在前」排序：depth 大的在前）。 */
  groups: BlueprintGroup[];
  /** 最终成品 itemId。 */
  productItemId: string;
  /** 最终成品产出速率/min（底部对账用）。 */
  productRate: number;
  /** 全图机器总台数。 */
  totalMachines: number;
  /** 全图分离器合计。 */
  totalSplitters: number;
  /** 全图合并器合计。 */
  totalMergers: number;
  /** 各带级用量（按带速升序）。 */
  beltUsage: BeltUsage[];
}

function beltFor(flow: number): { belt: Belt; overBelt: boolean; beltCount: number } {
  const f = Math.max(0, flow);
  const belt = suggestBelt(f);
  const overBelt = f > MAX_BELT_SPEED + 1e-6;
  const beltCount = overBelt ? Math.ceil(f / MAX_BELT_SPEED) : 1;
  return { belt, overBelt, beltCount };
}

/**
 * 遍历生产树，把每个「自产」物品展开成一个施工图机器组（含 manifold 分/合估算）。
 *
 * 与 buildFlow / computeLogistics 的连边口径一致：同一物品（消费方）在树里只走一次（去重）。
 *
 * @param tree           生产树根（反向/正向重跑后的树）。
 * @param machineCountOf 取某物品所属机器组的整数台数（原料/未知返回 0）。
 * @param rateOf         取某物品所属机器组的累计产量/min（缺省回退树节点 rate）。
 */
export function computeBlueprint(
  tree: TraceNode | null,
  machineCountOf: (itemId: string) => number,
  rateOf: (itemId: string) => number | undefined,
): BlueprintPlan {
  if (!tree) {
    return {
      groups: [],
      productItemId: '',
      productRate: 0,
      totalMachines: 0,
      totalSplitters: 0,
      totalMergers: 0,
      beltUsage: [],
    };
  }

  // 1) 计算每个物品距根的最长距离（上游更深 → depth 更大 → 画在更上方）。
  const depth = new Map<string, number>();
  const dfsDepth = (node: TraceNode, d: number) => {
    const prev = depth.get(node.itemId);
    if (prev !== undefined && prev >= d) return; // 已有更深路径，剪枝避免指数级重访
    depth.set(node.itemId, prev === undefined ? d : Math.max(prev, d));
    for (const child of node.children) dfsDepth(child, d + 1);
  };
  dfsDepth(tree, 0);

  // 2) 每个物品取首个出现的树节点（承载该组的输入 / 配方信息）。
  const nodeOf = new Map<string, TraceNode>();
  const collect = (node: TraceNode) => {
    if (!nodeOf.has(node.itemId)) nodeOf.set(node.itemId, node);
    for (const child of node.children) collect(child);
  };
  collect(tree);

  const groups: BlueprintGroup[] = [];
  let totalMachines = 0;
  let totalSplitters = 0;
  let totalMergers = 0;
  const usageMap = new Map<string, BeltUsage>();

  const addBelt = (belt: Belt, beltCount: number) => {
    const u = usageMap.get(belt.mark) ?? {
      mark: belt.mark,
      speed: belt.speed,
      segments: 0,
      beltCount: 0,
    };
    u.segments += 1;
    u.beltCount += beltCount;
    usageMap.set(belt.mark, u);
  };

  for (const [itemId, node] of nodeOf) {
    const machineCount = Math.max(0, Math.floor(machineCountOf(itemId)));
    // 无机器（不应发生在自产物品）则跳过。
    if (machineCount <= 0) continue;
    const totalRate = rateOf(itemId) ?? node.rate;
    const perMachineRate = machineCount > 0 ? totalRate / machineCount : totalRate;
    const isProduct = itemId === tree.itemId;

    const inputs: BlueprintInput[] = node.inputs.map((input) => {
      const splitters = manifoldNodes(machineCount);
      const b = beltFor(input.rate);
      addBelt(b.belt, b.beltCount);
      totalSplitters += splitters;
      return {
        itemId: input.itemId,
        totalFlow: input.rate,
        perMachineFlow: machineCount > 0 ? input.rate / machineCount : input.rate,
        belt: b.belt,
        overBelt: b.overBelt,
        beltCount: b.beltCount,
        splitters,
        produced: input.kind === 'produced',
        kind: input.kind,
      };
    });

    const outputMergers = manifoldNodes(machineCount);
    const ob = beltFor(totalRate);
    addBelt(ob.belt, ob.beltCount);
    totalMergers += outputMergers;
    totalMachines += machineCount;

    groups.push({
      itemId,
      recipeId: node.recipeId,
      machineId: node.machineId,
      machineCount,
      totalRate,
      perMachineRate,
      isProduct,
      inputs,
      outputMergers,
      outputBelt: ob.belt,
      outputOverBelt: ob.overBelt,
      outputBeltCount: ob.beltCount,
      depth: depth.get(itemId) ?? 0,
    });
  }

  // 上游（depth 大）在前 → 画在上方，物料整体向下流；同 depth 保持稳定顺序。
  groups.sort((a, b) => b.depth - a.depth || a.itemId.localeCompare(b.itemId));

  const beltUsage = [...usageMap.values()].sort((a, b) => a.speed - b.speed);

  return {
    groups,
    productItemId: tree.itemId,
    productRate: rateOf(tree.itemId) ?? tree.rate,
    totalMachines,
    totalSplitters,
    totalMergers,
    beltUsage,
  };
}
