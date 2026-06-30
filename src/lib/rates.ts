import type { Recipe } from './types';

/** 超频功耗指数：功耗 = 基础功耗 × 超频倍率 ^ 1.321321。 */
export const OVERCLOCK_POWER_EXPONENT = 1.321321;

/** 允许的最小 / 最大超频倍率（1.0x ~ 2.5x）。 */
export const MIN_CLOCK = 1.0;
export const MAX_CLOCK = 2.5;

/** 传送带档位定义。 */
export interface Belt {
  mark: string;
  /** 满速，单位 件/min（流体管道同理，单位 m³/min）。 */
  speed: number;
}

/** 全部传送带档位（按速度升序）。 */
export const BELTS: Belt[] = [
  { mark: 'Mk1', speed: 60 },
  { mark: 'Mk2', speed: 120 },
  { mark: 'Mk3', speed: 270 },
  { mark: 'Mk4', speed: 480 },
  { mark: 'Mk5', speed: 780 },
  { mark: 'Mk6', speed: 1200 },
];

/**
 * 给定速率，返回够用的最低传送带档位。
 * 例：suggestBelt(130) → Mk3(270)，suggestBelt(60) → Mk1(60)。
 * 超出最高档时返回 Mk6。
 */
export function suggestBelt(ratePerMin: number): Belt {
  for (const belt of BELTS) {
    if (belt.speed >= ratePerMin) return belt;
  }
  return BELTS[BELTS.length - 1];
}

/** 取配方的主产物（产出表的第一项）。 */
export function primaryProduct(recipe: Recipe): { itemId: string; qty: number } {
  const entries = Object.entries(recipe.produce);
  if (entries.length === 0) {
    throw new Error(`Recipe ${recipe.id} has no produce output`);
  }
  const [itemId, qty] = entries[0];
  return { itemId, qty };
}

/** 某配方在给定超频倍率下，每分钟产出多少 `itemId`。 */
export function outputPerMin(recipe: Recipe, itemId: string, clock = 1): number {
  const qty = recipe.produce[itemId] ?? 0;
  return (qty * 60) / recipe.duration * clock;
}

/** 某配方在给定超频倍率下，每分钟消耗多少 `itemId`。 */
export function inputPerMin(recipe: Recipe, itemId: string, clock = 1): number {
  const qty = recipe.ingredients[itemId] ?? 0;
  return (qty * 60) / recipe.duration * clock;
}

/** 单机产能/min（按主产物计）：produce_qty × 60 / duration × clock。 */
export function machineCapacity(recipe: Recipe, clock = 1): number {
  const { itemId } = primaryProduct(recipe);
  return outputPerMin(recipe, itemId, clock);
}

/** 超频后功耗：基础功耗 × clock ^ 1.321321。 */
export function overclockPower(basePower: number, clock: number): number {
  return basePower * Math.pow(clock, OVERCLOCK_POWER_EXPONENT);
}
