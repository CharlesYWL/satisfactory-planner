import type { GameData } from './types';
import { gameData } from './data';
import { machineCapacity, overclockPower, MAX_CLOCK } from './rates';
import type { RecipeOverrides } from './recipes';
import { traceProduction } from './trace';

const EPS = 1e-9;

/** 正向配平的机器数模式。 */
export type ForwardMode = 'integer' | 'overclock';

/** 正向配平（产线取向）入参。 */
export interface ForwardOptions {
  /** 'integer'（严格整数 + 利用率，默认）或 'overclock'（允许超频凑整）。 */
  mode?: ForwardMode;
  /** 超频上限，默认 2.5。 */
  maxClock?: number;
  /** 目标产品使用的配方（覆盖 base）。 */
  recipeId?: string;
  /** 中间产物的配方覆盖。 */
  recipeOverrides?: RecipeOverrides;
  data?: GameData;
}

/** 某个供给原料的瓶颈分析。 */
export interface ForwardInput {
  itemId: string;
  /** 用户提供的供给速率/min。 */
  supplied: number;
  /** 每 1 成品/min 对该原料的需求量/min。 */
  demandPerOutput: number;
  /** 该原料可支撑的成品产量上限/min（supplied / demandPerOutput）。 */
  maxOutput: number;
  /** 实际消耗量/min（在最终成品产量下）。 */
  consumed: number;
  /** 剩余未用量/min。 */
  leftover: number;
  /** 是否为限制产量的瓶颈原料。 */
  isBottleneck: boolean;
}

/** 正向配平中某一级的机器配置。 */
export interface ForwardNode {
  itemId: string;
  recipeId: string;
  machineId: string;
  /** 整数机器数。 */
  machineCount: number;
  /** 每台机器的超频百分比（integer 模式恒为 100）。 */
  clockPct: number;
  /** 该级所需产量/min。 */
  demand: number;
  /** 实际产能/min（machineCount × 单机产能 × clock）。 */
  actualThroughput: number;
  /** 利用率 = demand / actualThroughput（integer 模式 ≤ 1）。 */
  utilization: number;
  /** 该级是否直接消耗瓶颈原料。 */
  isBottleneck: boolean;
  /** 该级功耗/MW。 */
  power: number;
}

/** 正向配平结果。 */
export interface ForwardResult {
  itemId: string;
  recipeId: string;
  /** 实际成品产量/min（受瓶颈原料限制）。 */
  targetOutput: number;
  /** 各供给原料的瓶颈分析。 */
  inputs: ForwardInput[];
  /** 限制产量的瓶颈原料 id 列表。 */
  bottlenecks: string[];
  /** 每一级机器配置（含目标本身，按 itemId 升序）。 */
  nodes: ForwardNode[];
  /** 生产途中遇到、但用户未提供供给的原料叶子（原矿）→ 需求/min。 */
  rawInputs: Record<string, number>;
  /** 总功耗/MW。 */
  totalPower: number;
}

/**
 * 正向配平：给定目标产品 + 各供给原料的速率，算出在该供给下能造多少成品，
 * 以及每一级需要多少机器（严格整数 + 利用率，或超频凑整）。
 *
 * 供给表里的物品即生产树的「输入边界」——展开到这些物品就停止，把它们当作外部原料。
 * 找瓶颈：每种供给可支撑的成品产量 = 供给 / 单位需求，取最小值即实际成品产出。
 */
export function balanceForward(
  itemId: string,
  supplies: Record<string, number>,
  options: ForwardOptions = {},
): ForwardResult {
  const data = options.data ?? gameData;
  const mode: ForwardMode = options.mode ?? 'integer';
  const maxClock = options.maxClock ?? MAX_CLOCK;
  const supplyKeys = new Set(Object.keys(supplies));

  // 第一遍：以「1 成品/min」为单位追踪需求。
  const unit = traceProduction(itemId, 1, {
    supplies: supplyKeys,
    recipeId: options.recipeId,
    recipeOverrides: options.recipeOverrides,
    data,
  });

  // 找瓶颈：每种被实际消耗的供给可支撑的成品上限，取最小值。
  let targetOutput = Infinity;
  let anyConstrained = false;
  for (const key of supplyKeys) {
    const demand = unit.suppliedTotals[key] ?? 0;
    if (demand > EPS) {
      anyConstrained = true;
      const maxOut = (supplies[key] ?? 0) / demand;
      if (maxOut < targetOutput) targetOutput = maxOut;
    }
  }
  if (!anyConstrained) targetOutput = 0; // 没有任何供给被用到 → 无法确定产量

  // 瓶颈原料 = 上限恰好等于实际产量的那些。
  const bottlenecks: string[] = [];
  const inputs: ForwardInput[] = [];
  for (const key of supplyKeys) {
    const demandPerOutput = unit.suppliedTotals[key] ?? 0;
    const supplied = supplies[key] ?? 0;
    const maxOutput = demandPerOutput > EPS ? supplied / demandPerOutput : Infinity;
    const consumed = demandPerOutput * targetOutput;
    const isBottleneck =
      demandPerOutput > EPS && Math.abs(maxOutput - targetOutput) <= 1e-6;
    if (isBottleneck) bottlenecks.push(key);
    inputs.push({
      itemId: key,
      supplied,
      demandPerOutput,
      maxOutput,
      consumed,
      leftover: supplied - consumed,
      isBottleneck,
    });
  }
  inputs.sort((a, b) => a.itemId.localeCompare(b.itemId));
  const bottleneckSet = new Set(bottlenecks);

  // 第二遍：把每个自产物品按实际产量算成机器配置。
  const nodes: ForwardNode[] = [];
  let totalPower = 0;
  for (const [producedItemId, unitRate] of Object.entries(unit.produced)) {
    const recipe = data.recipes[unit.recipeOf[producedItemId]];
    const machineId = recipe.machines[0];
    const building = data.buildings[machineId];
    const basePower = building?.power ?? 0;
    const singleCap = machineCapacity(recipe, 1);
    const demand = unitRate * targetOutput;

    let machineCount: number;
    let clock: number;
    let power: number;
    if (mode === 'overclock') {
      machineCount = singleCap > 0 ? Math.max(1, Math.ceil(demand / (singleCap * maxClock) - EPS)) : 0;
      clock = machineCount > 0 && singleCap > 0 ? demand / (machineCount * singleCap) : 0;
      power = machineCount * overclockPower(basePower, clock || 1);
    } else {
      machineCount = singleCap > 0 ? Math.ceil(demand / singleCap - EPS) : 0;
      clock = 1;
      power = machineCount * basePower;
    }
    const actualThroughput = machineCount * singleCap * clock;
    const utilization = actualThroughput > 0 ? demand / actualThroughput : 0;
    const isBottleneck = Object.keys(recipe.ingredients).some((ing) => bottleneckSet.has(ing));

    nodes.push({
      itemId: producedItemId,
      recipeId: recipe.id,
      machineId,
      machineCount,
      clockPct: clock * 100,
      demand,
      actualThroughput,
      utilization,
      isBottleneck,
      power,
    });
    totalPower += power;
  }
  nodes.sort((a, b) => a.itemId.localeCompare(b.itemId));

  const rawInputs: Record<string, number> = {};
  for (const [rawId, unitRate] of Object.entries(unit.rawTotals)) {
    rawInputs[rawId] = unitRate * targetOutput;
  }

  return {
    itemId,
    recipeId: unit.recipeOf[itemId] ?? options.recipeId ?? '',
    targetOutput,
    inputs,
    bottlenecks,
    nodes,
    rawInputs,
    totalPower,
  };
}
