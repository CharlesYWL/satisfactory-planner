import { useMemo } from 'react';
import { create } from 'zustand';
import {
  MAX_CLOCK,
  balanceForward,
  balanceReverse,
  getRelevantRecipes,
  traceProduction,
  type ForwardResult,
  type RecipeOverrides,
  type RelevantRecipes,
  type ReverseResult,
} from '../lib';
import {
  forwardToGraph,
  reverseToGraph,
  type GraphResult,
} from '../components/buildFlow';
import type { DetailLevel } from '../components/nodes';

/** 配平取向：成品取向（反向倒推）/ 产线取向（正向供给）。 */
export type PlannerMode = 'reverse' | 'forward';
/** 图表布局方向。 */
export type FlowDirection = 'LR' | 'TB';

/** 全局规划状态（单一数据源，任意输入变化 → 实时重算重渲染）。 */
export interface PlannerState {
  /** 目标产品 itemId。 */
  targetItemId: string;
  /** 配平取向。 */
  mode: PlannerMode;
  /** 反向：目标产量/min。 */
  targetRate: number;
  /** 正向：各供给原料/半成品 itemId → 速率/min。 */
  supplies: Record<string, number>;
  /** 中间产物配方覆盖（含目标本身）：itemId → recipeId。 */
  recipeOverrides: RecipeOverrides;
  /** 超频开关：开 → 正向用 overclock 凑整；关 → 整数机器数。 */
  overclockEnabled: boolean;
  /** 正向 overclock 模式的超频上限（1.0~2.5）。 */
  maxClock: number;
  /** 图表方向。 */
  direction: FlowDirection;
  /** 节点信息详略。 */
  detail: DetailLevel;
  /** 详细物流：开 → 显示分离器/合并器节点 + 边按带级配色。 */
  logistics: boolean;

  setTargetItemId: (itemId: string) => void;
  setMode: (mode: PlannerMode) => void;
  setTargetRate: (rate: number) => void;
  setSupply: (itemId: string, rate: number) => void;
  removeSupply: (itemId: string) => void;
  setRecipeOverride: (itemId: string, recipeId: string) => void;
  clearRecipeOverride: (itemId: string) => void;
  setOverclockEnabled: (on: boolean) => void;
  setMaxClock: (clock: number) => void;
  setDirection: (direction: FlowDirection) => void;
  setDetail: (detail: DetailLevel) => void;
  setLogistics: (on: boolean) => void;
}

const DEFAULT_TARGET = 'Desc_Stator_C';

/** 用反向配平的原矿需求为正向供给播种（切到正向且尚无供给时用）。 */
function seedSuppliesFromReverse(
  targetItemId: string,
  targetRate: number,
  recipeOverrides: RecipeOverrides,
): Record<string, number> {
  const reverse = balanceReverse(targetItemId, Math.max(targetRate, 0.1), {
    recipeOverrides,
  });
  return { ...reverse.rawTotals };
}

export const usePlanner = create<PlannerState>((set, get) => ({
  targetItemId: DEFAULT_TARGET,
  mode: 'reverse',
  targetRate: 5,
  supplies: {},
  recipeOverrides: {},
  overclockEnabled: false,
  maxClock: MAX_CLOCK,
  direction: 'LR',
  detail: 'detailed',
  logistics: false,

  setTargetItemId: (itemId) =>
    // 换目标 → 清空与旧产线绑定的配方覆盖；正向取向下用新产线的原矿需求重新播种供给。
    set((s) => ({
      targetItemId: itemId,
      recipeOverrides: {},
      supplies:
        s.mode === 'forward'
          ? seedSuppliesFromReverse(itemId, s.targetRate, {})
          : {},
    })),

  setMode: (mode) => {
    if (mode === 'forward') {
      const { supplies, targetItemId, targetRate, recipeOverrides } = get();
      const seeded =
        Object.keys(supplies).length === 0
          ? seedSuppliesFromReverse(targetItemId, targetRate, recipeOverrides)
          : supplies;
      set({ mode, supplies: seeded });
    } else {
      set({ mode });
    }
  },

  setTargetRate: (rate) => set({ targetRate: Math.max(0.1, rate) }),

  setSupply: (itemId, rate) =>
    set((s) => ({ supplies: { ...s.supplies, [itemId]: Math.max(0, rate) } })),

  removeSupply: (itemId) =>
    set((s) => {
      const next = { ...s.supplies };
      delete next[itemId];
      return { supplies: next };
    }),

  setRecipeOverride: (itemId, recipeId) =>
    set((s) => ({ recipeOverrides: { ...s.recipeOverrides, [itemId]: recipeId } })),

  clearRecipeOverride: (itemId) =>
    set((s) => {
      const next = { ...s.recipeOverrides };
      delete next[itemId];
      return { recipeOverrides: next };
    }),

  setOverclockEnabled: (on) => set({ overclockEnabled: on }),
  setMaxClock: (clock) => set({ maxClock: Math.min(MAX_CLOCK, Math.max(1, clock)) }),
  setDirection: (direction) => set({ direction }),
  setDetail: (detail) => set({ detail }),
  setLogistics: (on) => set({ logistics: on }),
}));

/** 派生产线结果：归一化 graph（图渲染）+ 可选 forward（供原料 Tab 显示瓶颈）。 */
export interface PlannerDerived {
  graph: GraphResult;
  forward: ForwardResult | null;
  reverse: ReverseResult | null;
}

function computePlanner(input: {
  mode: PlannerMode;
  targetItemId: string;
  targetRate: number;
  supplies: Record<string, number>;
  recipeOverrides: RecipeOverrides;
  overclockEnabled: boolean;
  maxClock: number;
}): PlannerDerived {
  const { mode, targetItemId, targetRate, supplies, recipeOverrides, overclockEnabled, maxClock } =
    input;

  if (mode === 'reverse') {
    const reverse = balanceReverse(targetItemId, targetRate, { recipeOverrides });
    return { graph: reverseToGraph(reverse), forward: null, reverse };
  }

  const forward = balanceForward(targetItemId, supplies, {
    mode: overclockEnabled ? 'overclock' : 'integer',
    maxClock,
    recipeOverrides,
  });
  // 在实际产量下重跑生产树，供给即输入边界（展开到它们就停）。
  const output = Number.isFinite(forward.targetOutput) ? forward.targetOutput : 0;
  const trace = traceProduction(targetItemId, output, {
    supplies: new Set(Object.keys(supplies)),
    recipeOverrides,
  });
  return { graph: forwardToGraph(forward, trace.root), forward, reverse: null };
}

/** 订阅相关切片并 useMemo 派生产线结果（输入变化 → 自动重算重渲染）。 */
export function usePlannerDerived(): PlannerDerived {
  const mode = usePlanner((s) => s.mode);
  const targetItemId = usePlanner((s) => s.targetItemId);
  const targetRate = usePlanner((s) => s.targetRate);
  const supplies = usePlanner((s) => s.supplies);
  const recipeOverrides = usePlanner((s) => s.recipeOverrides);
  const overclockEnabled = usePlanner((s) => s.overclockEnabled);
  const maxClock = usePlanner((s) => s.maxClock);

  return useMemo(
    () =>
      computePlanner({
        mode,
        targetItemId,
        targetRate,
        supplies,
        recipeOverrides,
        overclockEnabled,
        maxClock,
      }),
    [mode, targetItemId, targetRate, supplies, recipeOverrides, overclockEnabled, maxClock],
  );
}

/** 当前产线相关配方（替代配方下拉的唯一数据源）。 */
export function useRelevantRecipes(): RelevantRecipes {
  const targetItemId = usePlanner((s) => s.targetItemId);
  const recipeOverrides = usePlanner((s) => s.recipeOverrides);
  return useMemo(
    () => getRelevantRecipes(targetItemId, { recipeOverrides }),
    [targetItemId, recipeOverrides],
  );
}

/**
 * 与取向无关的产线结构枚举（rate=1 的反向树），
 * 供原料 Tab 列出可设供给的原矿与可当作半成品的中间产物。
 */
export function useChainStructure(): ReverseResult {
  const targetItemId = usePlanner((s) => s.targetItemId);
  const recipeOverrides = usePlanner((s) => s.recipeOverrides);
  return useMemo(
    () => balanceReverse(targetItemId, 1, { recipeOverrides }),
    [targetItemId, recipeOverrides],
  );
}
