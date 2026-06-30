/**
 * Satisfactory 产线配平算法库（纯函数，无副作用，无 UI 依赖）。
 *
 * - 正向配平 {@link balanceForward}：固定原料供给 → 算整数机器 + 实际产出 + 瓶颈。
 * - 反向配平 {@link balanceReverse}：目标成品/min → 倒推完整生产树 + 原矿需求 + 总功耗。
 * - 工具：{@link suggestBelt} 带速建议、{@link getRelevantRecipes} 相关配方筛选。
 */

export * from './types';
export {
  gameData,
  getItem,
  getRecipe,
  getBuilding,
  isRawItem,
} from './data';
export {
  BELTS,
  MIN_CLOCK,
  MAX_CLOCK,
  OVERCLOCK_POWER_EXPONENT,
  suggestBelt,
  primaryProduct,
  outputPerMin,
  inputPerMin,
  machineCapacity,
  overclockPower,
} from './rates';
export type { Belt } from './rates';
export {
  chooseRecipe,
  getRelevantRecipes,
} from './recipes';
export type {
  RecipeOverrides,
  RelevantRecipes,
  RelevantRecipesOptions,
} from './recipes';
export { traceProduction } from './trace';
export type {
  TraceNode,
  TraceInput,
  TraceResult,
  TraceOptions,
  InputKind,
} from './trace';
export { balanceForward } from './forward';
export type {
  ForwardMode,
  ForwardOptions,
  ForwardInput,
  ForwardNode,
  ForwardResult,
} from './forward';
export { balanceReverse } from './reverse';
export type {
  ReverseOptions,
  ReverseResult,
  ReverseMachineSummary,
} from './reverse';
