import type { GameData } from './types';
import { gameData } from './data';
import { chooseRecipe, type RecipeOverrides } from './recipes';
import { machineCapacity } from './rates';

/** 生产树某条输入边的分类。 */
export type InputKind = 'produced' | 'supplied' | 'raw';

/** 生产树某节点的一条输入。 */
export interface TraceInput {
  itemId: string;
  /** 该输入每分钟需求量。 */
  rate: number;
  kind: InputKind;
}

/** 生产树节点（每个「自产」物品一个）。 */
export interface TraceNode {
  itemId: string;
  recipeId: string;
  machineId: string;
  /** 该物品每分钟需要的产量。 */
  rate: number;
  /** 100% 超频下需要的机器数（小数）。 */
  machineCount: number;
  inputs: TraceInput[];
  children: TraceNode[];
}

/** 一次生产追踪的入参。 */
export interface TraceOptions {
  /** 边界供给物品集合（出现即视为外部已供给，不再向下展开）。 */
  supplies?: Set<string>;
  recipeId?: string;
  recipeOverrides?: RecipeOverrides;
  data?: GameData;
}

/** 一次生产追踪的结果。 */
export interface TraceResult {
  /** 生产树根节点（目标本身即叶子时为 null）。 */
  root: TraceNode | null;
  /** 聚合：每个自产物品 → 全树累计产量/min。 */
  produced: Record<string, number>;
  /** 每个自产物品所用配方。 */
  recipeOf: Record<string, string>;
  /** 聚合：原料叶子（原矿 / 无配方 / 被截断的循环）→ 累计需求/min。 */
  rawTotals: Record<string, number>;
  /** 聚合：用户供给物品 → 累计被消耗量/min。 */
  suppliedTotals: Record<string, number>;
}

const add = (bag: Record<string, number>, key: string, value: number) => {
  bag[key] = (bag[key] ?? 0) + value;
};

/** `aggregateInputFlows` 内部 (目标物品, 输入物料) → 总流量 的 Map key。 */
const flowKey = (targetItemId: string, inputItemId: string) => `${targetItemId}\u0000${inputItemId}`;

/**
 * 聚合生产树里每个「输入物料 → 目标物品组」的真实总流量/min。
 *
 * 背景（Bug 修复）：同一个中间产物被多个下游配方消费时，`traceProduction` 生成的树里
 * 会出现该物品的多个节点，每个节点只携带它那一条支路的 rate/inputs。若下游只读「首个
 * 出现节点」的 `inputs[x].rate`（施工图 / 拓扑图 / 物流估算此前都是这么做的），就只拿到其中
 * 一条小支路的量，导致输入侧每段流量标签整体偏小（如铜矿石显示 20 应为 120）。
 *
 * 本函数遍历全树（不去重），把所有出现节点的 `inputs` 按 (目标物品, 输入物料) 累加，
 * 得到该机器组对该输入物料的组内总流量。等价于「组总产 × 配方该料用量比」，且与树的
 * 多节点结构完全解耦，可作为三处视图（施工图 / 拓扑图 / 物流）统一的流量口径来源。
 *
 * @param tree 生产树根（正向/反向重跑后的树）。
 * @returns `(targetItemId, inputItemId) => 总流量/min | undefined`（该 pair 不存在时 undefined，
 *          调用方可回退到单节点 rate）。
 */
export function aggregateInputFlows(
  tree: TraceNode | null,
): (targetItemId: string, inputItemId: string) => number | undefined {
  const flows = new Map<string, number>();
  const walk = (node: TraceNode) => {
    for (const input of node.inputs) {
      const key = flowKey(node.itemId, input.itemId);
      flows.set(key, (flows.get(key) ?? 0) + input.rate);
    }
    for (const child of node.children) walk(child);
  };
  if (tree) walk(tree);
  return (targetItemId, inputItemId) => flows.get(flowKey(targetItemId, inputItemId));
}

/**
 * 自顶向下递归展开生产树。
 *
 * 在以下三种情况停止向下展开，并把需求计入对应聚合表：
 *  - 物品出现在 `supplies` 中（外部已供给）→ suppliedTotals
 *  - 物品是原矿 / 无配方 → rawTotals
 *  - 物品已在当前路径上（配方循环）→ 截断为 rawTotals，避免无限递归
 */
export function traceProduction(
  targetItemId: string,
  targetRate: number,
  options: TraceOptions = {},
): TraceResult {
  const data = options.data ?? gameData;
  const supplies = options.supplies ?? new Set<string>();
  const overrides: RecipeOverrides = { ...(options.recipeOverrides ?? {}) };
  if (options.recipeId) overrides[targetItemId] = options.recipeId;

  const produced: Record<string, number> = {};
  const recipeOf: Record<string, string> = {};
  const rawTotals: Record<string, number> = {};
  const suppliedTotals: Record<string, number> = {};

  const classify = (itemId: string, path: ReadonlySet<string>): InputKind => {
    if (supplies.has(itemId)) return 'supplied';
    const item = data.items[itemId];
    if (item?.isRaw) return 'raw';
    if (path.has(itemId)) return 'raw'; // 循环截断
    const recipe = chooseRecipe(itemId, overrides, data);
    if (!recipe) return 'raw';
    return 'produced';
  };

  const build = (itemId: string, rate: number, path: ReadonlySet<string>): TraceNode => {
    const recipe = chooseRecipe(itemId, overrides, data)!;
    add(produced, itemId, rate);
    recipeOf[itemId] = recipe.id;

    const producedQty = recipe.produce[itemId] ?? 1;
    const capacity = machineCapacity(recipe, 1);
    const nextPath = new Set(path);
    nextPath.add(itemId);

    const inputs: TraceInput[] = [];
    const children: TraceNode[] = [];

    for (const [ingredientId, qtyPerCycle] of Object.entries(recipe.ingredients)) {
      const ingredientRate = (rate * qtyPerCycle) / producedQty;
      const kind = classify(ingredientId, nextPath);
      inputs.push({ itemId: ingredientId, rate: ingredientRate, kind });

      if (kind === 'supplied') {
        add(suppliedTotals, ingredientId, ingredientRate);
      } else if (kind === 'raw') {
        add(rawTotals, ingredientId, ingredientRate);
      } else {
        children.push(build(ingredientId, ingredientRate, nextPath));
      }
    }

    return {
      itemId,
      recipeId: recipe.id,
      machineId: recipe.machines[0],
      rate,
      machineCount: capacity > 0 ? rate / capacity : 0,
      inputs,
      children,
    };
  };

  const rootKind = classify(targetItemId, new Set());
  if (rootKind !== 'produced') {
    // 目标本身就是原料 / 已供给，没有生产树。
    if (rootKind === 'supplied') add(suppliedTotals, targetItemId, targetRate);
    else add(rawTotals, targetItemId, targetRate);
    return { root: null, produced, recipeOf, rawTotals, suppliedTotals };
  }

  const root = build(targetItemId, targetRate, new Set());
  return { root, produced, recipeOf, rawTotals, suppliedTotals };
}
