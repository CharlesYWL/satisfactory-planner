import { useMemo } from 'react';
import { create } from 'zustand';
import {
  MAX_CLOCK,
  balanceForward,
  balanceReverse,
  balanceReverseMulti,
  getRelevantRecipes,
  traceProduction,
  type ForwardResult,
  type RecipeOverrides,
  type RelevantRecipes,
  type ReverseResult,
  type ReverseMultiResult,
} from '../lib';
import {
  forwardToGraph,
  reverseMultiToGraph,
  type GraphResult,
} from '../components/buildFlow';
import type { DetailLevel } from '../components/nodes';

/** 配平取向：成品取向（反向倒推）/ 产线取向（正向供给）。 */
export type PlannerMode = 'reverse' | 'forward';
/** 图表布局方向。 */
export type FlowDirection = 'LR' | 'TB';
/** 画布视图：拓扑图（抽象组对组）/ 施工图（展开机器阵列 + manifold 走线）。 */
export type ViewMode = 'topology' | 'blueprint';

/** 一个反向目标：目标产品 + 目标产量/min（≥1 整数）。 */
export interface PlannerTarget {
  itemId: string;
  rate: number;
}

/** 全局规划状态（单一数据源，任意输入变化 → 实时重算重渲染）。 */
export interface PlannerState {
  /**
   * 反向目标集合（成品取向可多目标共享产线；至少 1 个）。
   * 正向取向本期仍只用 `targets[0]`（单目标），行为不变。
   */
  targets: PlannerTarget[];
  /** 配平取向。 */
  mode: PlannerMode;
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
  /** 画布视图：拓扑图 / 施工图。 */
  viewMode: ViewMode;

  /** 整体替换目标列表（供 URL 初始化 / 批量注入）。 */
  setTargets: (targets: PlannerTarget[]) => void;
  /** 追加一个目标（已存在则累加其 rate）。 */
  addTarget: (itemId: string, rate?: number) => void;
  /** 删除第 index 个目标（至少保留 1 个，删到 1 个时为空操作）。 */
  removeTarget: (index: number) => void;
  /** 换第 index 个目标的物品（清空全局配方覆盖；正向下用新首目标重播种供给）。 */
  setTargetItem: (index: number, itemId: string) => void;
  /** 设第 index 个目标的产量（钳制 ≥1 整数）。 */
  setTargetRate: (index: number, rate: number) => void;
  setMode: (mode: PlannerMode) => void;
  setSupply: (itemId: string, rate: number) => void;
  removeSupply: (itemId: string) => void;
  setRecipeOverride: (itemId: string, recipeId: string) => void;
  clearRecipeOverride: (itemId: string) => void;
  setOverclockEnabled: (on: boolean) => void;
  setMaxClock: (clock: number) => void;
  setDirection: (direction: FlowDirection) => void;
  setDetail: (detail: DetailLevel) => void;
  setLogistics: (on: boolean) => void;
  setViewMode: (view: ViewMode) => void;
}

const DEFAULT_TARGET = 'Desc_Stator_C';
const DEFAULT_TARGET_RATE = 5;

const defaultTargets = (): PlannerTarget[] => [
  { itemId: DEFAULT_TARGET, rate: DEFAULT_TARGET_RATE },
];

const clampRate = (rate: number): number => Math.max(1, Math.round(rate));

/**
 * 规范化目标列表：合并重复目标（同 itemId → rate 相加）、钳制 rate≥1 整数、
 * 保留首次出现顺序。传入空列表返回空列表（调用方负责兜底默认）。
 */
function normalizeTargets(list: PlannerTarget[]): PlannerTarget[] {
  const order: string[] = [];
  const rateById = new Map<string, number>();
  for (const t of list) {
    const rate = clampRate(t.rate);
    if (rateById.has(t.itemId)) rateById.set(t.itemId, rateById.get(t.itemId)! + rate);
    else {
      order.push(t.itemId);
      rateById.set(t.itemId, rate);
    }
  }
  return order.map((itemId) => ({ itemId, rate: rateById.get(itemId)! }));
}

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
  targets: defaultTargets(),
  mode: 'reverse',
  supplies: {},
  recipeOverrides: {},
  overclockEnabled: false,
  maxClock: MAX_CLOCK,
  direction: 'LR',
  detail: 'detailed',
  logistics: false,
  viewMode: 'topology',

  setTargets: (list) =>
    set(() => {
      const norm = normalizeTargets(list);
      return { targets: norm.length > 0 ? norm : defaultTargets() };
    }),

  addTarget: (itemId, rate = DEFAULT_TARGET_RATE) =>
    set((s) => ({ targets: normalizeTargets([...s.targets, { itemId, rate }]) })),

  removeTarget: (index) =>
    set((s) => {
      // 至少保留 1 个目标。
      if (s.targets.length <= 1) return {} as Partial<PlannerState>;
      const next = s.targets.filter((_, i) => i !== index);
      return { targets: next.length > 0 ? next : s.targets };
    }),

  setTargetItem: (index, itemId) =>
    set((s) => {
      const next = s.targets.map((t, i) => (i === index ? { ...t, itemId } : t));
      const norm = normalizeTargets(next);
      const primary = norm[0] ?? { itemId, rate: DEFAULT_TARGET_RATE };
      // 换目标 → 清空与旧产线绑定的配方覆盖；正向取向下用新首目标的原矿需求重新播种供给。
      return {
        targets: norm,
        recipeOverrides: {},
        supplies:
          s.mode === 'forward'
            ? seedSuppliesFromReverse(primary.itemId, primary.rate, {})
            : {},
      };
    }),

  setTargetRate: (index, rate) =>
    set((s) => ({
      targets: s.targets.map((t, i) => (i === index ? { ...t, rate: clampRate(rate) } : t)),
    })),

  setMode: (mode) => {
    if (mode === 'forward') {
      const { supplies, targets, recipeOverrides } = get();
      const primary = targets[0];
      const seeded =
        Object.keys(supplies).length === 0 && primary
          ? seedSuppliesFromReverse(primary.itemId, primary.rate, recipeOverrides)
          : supplies;
      set({ mode, supplies: seeded });
    } else {
      set({ mode });
    }
  },

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
  setViewMode: (view) => set({ viewMode: view }),
}));

/** 派生产线结果：归一化 graph（图渲染）+ 可选 forward（供原料 Tab 显示瓶颈）。 */
export interface PlannerDerived {
  graph: GraphResult;
  forward: ForwardResult | null;
  reverse: ReverseMultiResult | null;
}

function computePlanner(input: {
  mode: PlannerMode;
  targets: PlannerTarget[];
  supplies: Record<string, number>;
  recipeOverrides: RecipeOverrides;
  overclockEnabled: boolean;
  maxClock: number;
}): PlannerDerived {
  const { mode, targets, supplies, recipeOverrides, overclockEnabled, maxClock } = input;

  if (mode === 'reverse') {
    // 反向多目标：共享中间产物按 itemId 合并，机器数/原矿跨目标累加。
    const reverse = balanceReverseMulti(targets, { recipeOverrides });
    return { graph: reverseMultiToGraph(reverse), forward: null, reverse };
  }

  // 正向本期仍单目标（取首目标），行为完全不变。
  const targetItemId = targets[0]?.itemId ?? DEFAULT_TARGET;
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
  const targets = usePlanner((s) => s.targets);
  const supplies = usePlanner((s) => s.supplies);
  const recipeOverrides = usePlanner((s) => s.recipeOverrides);
  const overclockEnabled = usePlanner((s) => s.overclockEnabled);
  const maxClock = usePlanner((s) => s.maxClock);

  return useMemo(
    () =>
      computePlanner({
        mode,
        targets,
        supplies,
        recipeOverrides,
        overclockEnabled,
        maxClock,
      }),
    [mode, targets, supplies, recipeOverrides, overclockEnabled, maxClock],
  );
}

/** 当前产线相关配方（替代配方下拉的唯一数据源）；多目标时取各目标的并集。 */
export function useRelevantRecipes(): RelevantRecipes {
  const targets = usePlanner((s) => s.targets);
  const recipeOverrides = usePlanner((s) => s.recipeOverrides);
  return useMemo(() => {
    const items = new Set<string>();
    const recipes = new Set<string>();
    const byItem: Record<string, string[]> = {};
    for (const t of targets) {
      const rel = getRelevantRecipes(t.itemId, { recipeOverrides });
      for (const id of rel.items) items.add(id);
      for (const id of rel.recipes) recipes.add(id);
      for (const [id, arr] of Object.entries(rel.byItem)) byItem[id] = arr;
    }
    return {
      items: [...items].sort(),
      recipes: [...recipes].sort(),
      byItem,
    };
  }, [targets, recipeOverrides]);
}

/**
 * 与取向无关的产线结构枚举（rate=1 的反向树），
 * 供原料 Tab 列出可设供给的原矿与可当作半成品的中间产物。
 * 正向本期单目标，故取首目标。
 */
export function useChainStructure(): ReverseResult {
  const targets = usePlanner((s) => s.targets);
  const recipeOverrides = usePlanner((s) => s.recipeOverrides);
  const primaryItemId = targets[0]?.itemId ?? DEFAULT_TARGET;
  return useMemo(
    () => balanceReverse(primaryItemId, 1, { recipeOverrides }),
    [primaryItemId, recipeOverrides],
  );
}
