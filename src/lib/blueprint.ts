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
import { aggregateInputFlows } from './trace';
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

/**
 * 某条带（主干/支路）在整段流量下需要几条并行满档带（每条 ≤ 单条最高档带速）。
 * 例：MAX=1200 时 flow=2400 → 2；flow=1200 → 1；flow=0 → 1（至少一条）。
 */
export function lanesForFlow(flow: number, maxBelt = MAX_BELT_SPEED): number {
  if (!Number.isFinite(flow) || flow <= 0 || maxBelt <= 0) return 1;
  return Math.max(1, Math.ceil(flow / maxBelt - 1e-9));
}

/**
 * 把 N 台机器**均分**到 `laneCount` 条并行产线，返回第 `k` 条（0-based）分到的台数。
 * 余数摊给靠前的车道（前 `N % L` 条各 +1），保证各车道台数最多差 1、合计 = N。
 * 对应 Q3「方案B」：整条子产线复制成 L 条并行线，每条一条满档带，车道对车道 1:1。
 */
export function laneMachineCount(total: number, laneCount: number, k: number): number {
  const N = Math.max(0, Math.floor(total));
  const L = Math.max(1, Math.floor(laneCount));
  if (k < 0 || k >= L) return 0;
  return Math.floor(N / L) + (k < N % L ? 1 : 0);
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

/**
 * 输出主干上的一个「沿途抽料点」（tap）：把 `flow` 从共享主干抽给某个自产下游，
 * 抽走后主干剩 `remaining`。对照游戏里「一条主干沿途按需求分流」的真实物流。
 */
export interface BlueprintTap {
  /** 下游消费方物品 itemId（消费该产物的机器组）。 */
  targetItemId: string;
  /** 从主干抽给该下游的流量/min。 */
  flow: number;
  /** 抽走本股后主干剩余流量/min（最后一个下游后为 0）。 */
  remaining: number;
  /** 该抽料支路建议带级（按支路流量）。 */
  belt: Belt;
  /** 支路流量是否超单条最高档带速。 */
  overBelt: boolean;
  /** 支路满足流量所需并行带条数。 */
  beltCount: number;
  /** 是否为主干尾料（最后一个下游，直接吃主干剩余，无需独立分离器）。 */
  isTail: boolean;
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
  /**
   * 输出分流主干：该组产物被哪些自产下游、按什么流量沿共享主干「沿途抽料」。
   * 按下游需求降序排列（尾料给最后一个）。语义：
   *  - 空数组 = 无自产下游（最终成品，或产物只被原料/供给消费的罕见情形）。
   *  - 长度 1 = 单下游，直连（渲染不引入分流节点）。
   *  - 长度 ≥ 2 = 共享主干 + N-1 个分离器沿途 tap，最后一个吃尾料。
   * 主干起点流量 = totalRate；抽料后每段剩余记在对应 tap 的 remaining 上。
   */
  outputTaps: BlueprintTap[];
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
  /**
   * 并行产线条数：全图任一条带的流量都能被 `laneCount` 条满档带承载
   * （= 各组「输出主干 / 各输入主干」所需并行带数的最大值，≥1）。
   * 渲染层据此把每个机器组均分成 L 条并行产线（每条一条 ≤ 最高档的带）。
   */
  laneCount: number;
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
      laneCount: 1,
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

  // 2.5) 输入流量必须取「该机器组对某物料的全组总流量」，而不是首个树节点那条支路的量。
  // 同一中间产物被多个下游消费时树里会出现多个该物品节点，各只带一条支路的 rate；
  // 聚合全树同 (目标, 输入) 的 inputs 才是真实总流量（详见 aggregateInputFlows）。
  const inputFlowOf = aggregateInputFlows(tree);

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
      // 全组总流量（多消费者时聚合所有同名节点支路），回退单节点 rate。
      const totalFlow = inputFlowOf(itemId, input.itemId) ?? input.rate;
      const splitters = manifoldNodes(machineCount);
      const b = beltFor(totalFlow);
      addBelt(b.belt, b.beltCount);
      totalSplitters += splitters;
      return {
        itemId: input.itemId,
        totalFlow,
        perMachineFlow: machineCount > 0 ? totalFlow / machineCount : totalFlow,
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
      outputTaps: [],
      depth: depth.get(itemId) ?? 0,
    });
  }

  // 3) 输出分流主干：为每个自产物品收集其所有自产下游消费连接（target + flow），
  //    按需求降序沿共享主干「沿途抽料」（先给需求大的下游，尾料给最后一个）。
  //    这是「共享输出主干 + 沿途分流」建模，替代「每个消费方各自独立源」的旧画法。
  for (const g of groups) {
    // 消费 g.itemId 的所有下游机器组（other 组的输入里含本产物且为自产）。
    const consumers: { targetItemId: string; flow: number }[] = [];
    for (const other of groups) {
      for (const inp of other.inputs) {
        if (inp.produced && inp.itemId === g.itemId) {
          consumers.push({ targetItemId: other.itemId, flow: inp.totalFlow });
        }
      }
    }
    // 按需求降序（稳定：同量按 itemId 升序），生成沿途 tap。
    consumers.sort(
      (a, b) => b.flow - a.flow || a.targetItemId.localeCompare(b.targetItemId),
    );
    let backbone = g.totalRate;
    g.outputTaps = consumers.map((c, idx) => {
      const isTail = idx === consumers.length - 1;
      // 非尾料按下游真实需求抽料；尾料吃主干剩余（保证与主干总产对账、对 Bug1 更稳健）。
      const flow = isTail ? Math.max(0, backbone) : c.flow;
      const remaining = Math.max(0, backbone - flow);
      const b = beltFor(flow);
      backbone = remaining;
      return {
        targetItemId: c.targetItemId,
        flow,
        remaining,
        belt: b.belt,
        overBelt: b.overBelt,
        beltCount: b.beltCount,
        isTail,
      };
    });
  }

  // 上游（depth 大）在前 → 画在上方，物料整体向下流；同 depth 保持稳定顺序。
  groups.sort((a, b) => b.depth - a.depth || a.itemId.localeCompare(b.itemId));

  const beltUsage = [...usageMap.values()].sort((a, b) => a.speed - b.speed);

  // 并行产线条数 = 全图任一条带所需并行满档带数的最大值（输出主干 + 各输入主干）。
  let laneCount = 1;
  for (const g of groups) {
    laneCount = Math.max(laneCount, lanesForFlow(g.totalRate));
    for (const inp of g.inputs) laneCount = Math.max(laneCount, lanesForFlow(inp.totalFlow));
  }

  return {
    groups,
    productItemId: tree.itemId,
    productRate: rateOf(tree.itemId) ?? tree.rate,
    laneCount,
    totalMachines,
    totalSplitters,
    totalMergers,
    beltUsage,
  };
}
