import type { GameData } from './types';
import { gameData } from './data';
import { machineCapacity, overclockPower } from './rates';
import type { RecipeOverrides } from './recipes';
import { traceProduction, type TraceNode } from './trace';

/** 反向配平（成品取向）入参。 */
export interface ReverseOptions {
  /** 目标产品使用的配方（覆盖 base）。 */
  recipeId?: string;
  /** 中间产物的配方覆盖。 */
  recipeOverrides?: RecipeOverrides;
  data?: GameData;
}

/** 反向配平中某个自产物品的汇总（按物品聚合，跨整棵树）。 */
export interface ReverseMachineSummary {
  itemId: string;
  recipeId: string;
  machineId: string;
  /** 该物品全树累计产量/min。 */
  rate: number;
  /** 100% 超频下所需机器数（小数，对标原网站）。 */
  machineCount: number;
  /** 实际需建造的整数机器数（向上取整）。 */
  machineCountInteger: number;
  /** 单机满载产能/min。 */
  capacity: number;
  /** 整数台机器、满载运行的功耗合计/MW。 */
  power: number;
}

/** 反向配平结果。 */
export interface ReverseResult {
  itemId: string;
  targetRate: number;
  /** 完整生产树（机器数为小数）。 */
  tree: TraceNode | null;
  /** 原矿需求汇总：itemId → 所需原矿/min。 */
  rawTotals: Record<string, number>;
  /** 各自产物品的机器汇总（按物品聚合）。 */
  machines: ReverseMachineSummary[];
  /** 建筑 → 整数台数合计。 */
  buildingTotals: Record<string, number>;
  /** 总功耗/MW（整数台机器满载，与游戏一致；定子链 = 47MW）。 */
  totalPower: number;
  /** 总功耗/MW（机器数取小数的线性值，仅供参考）。 */
  totalPowerExact: number;
}

/** {@link summarizeMachines} 的机器汇总产出（跨目标复用，避免复制粘贴）。 */
export interface MachineSummary {
  machines: ReverseMachineSummary[];
  buildingTotals: Record<string, number>;
  totalPower: number;
  totalPowerExact: number;
}

/**
 * 由「自产物品 → 全（森林）累计产量」聚合表算出各机器组汇总。
 *
 * 单目标 {@link balanceReverse} 与多目标 {@link balanceReverseMulti} 共用此逻辑：
 * 后者先把多棵目标树的 `produced` 按 itemId 相加，再喂进来，即得跨目标累加后的
 * 机器数 / 功耗（共享中间产物只按合并总产量算一次机器组）。
 */
export function summarizeMachines(
  produced: Record<string, number>,
  recipeOf: Record<string, string>,
  data: GameData = gameData,
): MachineSummary {
  const machines: ReverseMachineSummary[] = [];
  const buildingTotals: Record<string, number> = {};
  let totalPower = 0;
  let totalPowerExact = 0;

  for (const [producedItemId, rate] of Object.entries(produced)) {
    const recipe = data.recipes[recipeOf[producedItemId]];
    const machineId = recipe.machines[0];
    const building = data.buildings[machineId];
    const capacity = machineCapacity(recipe, 1);
    const machineCount = capacity > 0 ? rate / capacity : 0;
    const machineCountInteger = Math.ceil(machineCount - 1e-9);
    const basePower = building?.power ?? 0;
    const power = machineCountInteger * basePower;

    machines.push({
      itemId: producedItemId,
      recipeId: recipe.id,
      machineId,
      rate,
      machineCount,
      machineCountInteger,
      capacity,
      power,
    });

    buildingTotals[machineId] = (buildingTotals[machineId] ?? 0) + machineCountInteger;
    totalPower += power;
    totalPowerExact += overclockPower(basePower, 1) * machineCount;
  }

  machines.sort((a, b) => a.itemId.localeCompare(b.itemId));

  return { machines, buildingTotals, totalPower, totalPowerExact };
}

/**
 * 反向配平：给定目标产品与目标产量/min，递归倒推完整生产树、原矿需求与总功耗。
 *
 * 机器数允许小数（对标 satisfactory-calculator）；同时给出整数台数与对应功耗，
 * 后者与游戏内实际建造一致（每台满载 100%）。
 */
export function balanceReverse(
  itemId: string,
  targetRate: number,
  options: ReverseOptions = {},
): ReverseResult {
  const data = options.data ?? gameData;
  const trace = traceProduction(itemId, targetRate, {
    recipeId: options.recipeId,
    recipeOverrides: options.recipeOverrides,
    data,
  });

  const { machines, buildingTotals, totalPower, totalPowerExact } = summarizeMachines(
    trace.produced,
    trace.recipeOf,
    data,
  );

  return {
    itemId,
    targetRate,
    tree: trace.root,
    rawTotals: trace.rawTotals,
    machines,
    buildingTotals,
    totalPower,
    totalPowerExact,
  };
}

/** 一个反向目标：目标产品 itemId + 目标产量/min。 */
export interface ReverseTarget {
  itemId: string;
  rate: number;
}

/**
 * 多目标反向配平的合并森林根：这是一个**虚拟节点**，`children` 为各目标的生产树根。
 *
 * 图层 / 物流 / 施工图的遍历都从树根递归 `children`，本节点自身无输入、无机器，故：
 * - `aggregateInputFlows` / `computeLogistics` / `computeBlueprint` 遍历到它时不产生任何
 *   连接或机器组（inputs 为空、machineCount 为 0），只是「透明地」下钻到各目标子树；
 * - 拓扑图 `buildFlow.walk` 显式跳过该 itemId，不渲染它本身。
 */
export const MULTI_ROOT_ITEM_ID = '__targets__';

function makeSuperRoot(children: TraceNode[]): TraceNode {
  return {
    itemId: MULTI_ROOT_ITEM_ID,
    recipeId: '',
    machineId: '',
    rate: 0,
    machineCount: 0,
    inputs: [],
    children,
  };
}

/** 反向多目标配平结果（跨目标聚合）。 */
export interface ReverseMultiResult {
  /** 参与配平的目标列表（同 itemId 已合并、rate 相加）。 */
  targets: ReverseTarget[];
  /**
   * 合并森林：
   * - 0 个目标 → null；
   * - 1 个目标 → 该目标的生产树根（与 {@link balanceReverse} 完全一致）；
   * - ≥2 个目标 → 虚拟 super-root（{@link MULTI_ROOT_ITEM_ID}），children 为各目标根。
   */
  tree: TraceNode | null;
  /** 原矿需求汇总（跨目标累加）。 */
  rawTotals: Record<string, number>;
  /** 各自产物品的机器汇总（按合并后总产量重算，跨目标累加）。 */
  machines: ReverseMachineSummary[];
  /** 建筑 → 整数台数合计（跨目标累加）。 */
  buildingTotals: Record<string, number>;
  /** 总功耗/MW（整数台满载）。 */
  totalPower: number;
  /** 总功耗/MW（小数机器数线性值，仅供参考）。 */
  totalPowerExact: number;
}

/** 合并重复目标（同 itemId → rate 相加），保留首次出现顺序。 */
function dedupeTargets(targets: readonly ReverseTarget[]): ReverseTarget[] {
  const order: string[] = [];
  const rateById = new Map<string, number>();
  for (const t of targets) {
    if (rateById.has(t.itemId)) {
      rateById.set(t.itemId, rateById.get(t.itemId)! + t.rate);
    } else {
      order.push(t.itemId);
      rateById.set(t.itemId, t.rate);
    }
  }
  return order.map((itemId) => ({ itemId, rate: rateById.get(itemId)! }));
}

/**
 * 多目标反向配平：给定多个目标产品共享一条工厂产线，倒推合并后的生产森林、
 * 跨目标累加的原矿需求、机器数与总功耗。
 *
 * 共享的中间产物（转子 / 线材 / 铁棒…）在 `produced` / `rawTotals` 里天然按 itemId
 * 相加合并，机器组按合并总产量重算一次（不是各目标各建一组）；图层再按 itemId 去重
 * 显示为同一节点。单目标输入时结果与 {@link balanceReverse} 等价。
 */
export function balanceReverseMulti(
  targets: readonly ReverseTarget[],
  options: ReverseOptions = {},
): ReverseMultiResult {
  const data = options.data ?? gameData;
  const norm = dedupeTargets(targets);

  const produced: Record<string, number> = {};
  const recipeOf: Record<string, string> = {};
  const rawTotals: Record<string, number> = {};
  const roots: TraceNode[] = [];

  for (const target of norm) {
    const trace = traceProduction(target.itemId, target.rate, {
      recipeOverrides: options.recipeOverrides,
      data,
    });
    for (const [id, rate] of Object.entries(trace.produced)) {
      produced[id] = (produced[id] ?? 0) + rate;
    }
    for (const [id, recipeId] of Object.entries(trace.recipeOf)) {
      recipeOf[id] = recipeId;
    }
    for (const [id, rate] of Object.entries(trace.rawTotals)) {
      rawTotals[id] = (rawTotals[id] ?? 0) + rate;
    }
    if (trace.root) roots.push(trace.root);
  }

  const { machines, buildingTotals, totalPower, totalPowerExact } = summarizeMachines(
    produced,
    recipeOf,
    data,
  );

  const tree = roots.length === 0 ? null : roots.length === 1 ? roots[0] : makeSuperRoot(roots);

  return {
    targets: norm,
    tree,
    rawTotals,
    machines,
    buildingTotals,
    totalPower,
    totalPowerExact,
  };
}
