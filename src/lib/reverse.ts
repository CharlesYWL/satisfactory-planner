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

  const machines: ReverseMachineSummary[] = [];
  const buildingTotals: Record<string, number> = {};
  let totalPower = 0;
  let totalPowerExact = 0;

  for (const [producedItemId, rate] of Object.entries(trace.produced)) {
    const recipe = data.recipes[trace.recipeOf[producedItemId]];
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
