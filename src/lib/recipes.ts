import type { GameData, Recipe } from './types';
import { gameData } from './data';

/** 配方覆盖表：itemId → 指定使用的 recipeId。 */
export type RecipeOverrides = Record<string, string>;

/**
 * 为某物品选配方。
 * 优先级：override > 非替代(base)配方 > producers 列表首项。
 * 找不到返回 undefined（说明该物品没有可自动化配方，是叶子原料）。
 */
export function chooseRecipe(
  itemId: string,
  overrides: RecipeOverrides = {},
  data: GameData = gameData,
): Recipe | undefined {
  const override = overrides[itemId];
  if (override && data.recipes[override]) return data.recipes[override];

  const candidates = data.producers[itemId] ?? [];
  const base = candidates.find((id) => data.recipes[id] && !data.recipes[id].isAlternate);
  const chosenId = base ?? candidates[0];
  return chosenId ? data.recipes[chosenId] : undefined;
}

/** getRelevantRecipes 的入参选项。 */
export interface RelevantRecipesOptions {
  /** 目标产品使用的配方（覆盖 base）。 */
  recipeId?: string;
  /** 中间产物的配方覆盖。 */
  recipeOverrides?: RecipeOverrides;
  data?: GameData;
}

/** getRelevantRecipes 的结果。 */
export interface RelevantRecipes {
  /** 生产树涉及的全部「可生产」中间产物（含目标，按 id 升序）。 */
  items: string[];
  /** 这些物品对应的全部候选配方 id 并集（含替代配方，按 id 升序）。 */
  recipes: string[];
  /** 每个涉及物品 → 它的全部候选配方 id（供 UI 智能下拉用）。 */
  byItem: Record<string, string[]>;
}

/**
 * 遍历目标产品的默认生产树，收集涉及到的所有中间产物，
 * 再用 `producers` 反向索引取出能生产它们的全部配方（含替代配方）。
 *
 * 供 UI 的「智能下拉」用：只把与当前产线相关的配方塞进选择框，
 * 而不是把游戏里几百个配方一股脑列出来。
 */
export function getRelevantRecipes(
  targetItemId: string,
  options: RelevantRecipesOptions = {},
): RelevantRecipes {
  const data = options.data ?? gameData;
  const overrides: RecipeOverrides = { ...(options.recipeOverrides ?? {}) };
  if (options.recipeId) overrides[targetItemId] = options.recipeId;

  const involved = new Set<string>();
  const visitedRecipes = new Set<string>();

  const walk = (itemId: string) => {
    if (involved.has(itemId)) return;
    const item = data.items[itemId];
    if (item?.isRaw) return; // 原矿是叶子，没有配方

    const recipe = chooseRecipe(itemId, overrides, data);
    if (!recipe) return; // 无配方 → 叶子

    involved.add(itemId);
    if (visitedRecipes.has(recipe.id)) return; // 配方循环保护
    visitedRecipes.add(recipe.id);

    for (const ingredient of Object.keys(recipe.ingredients)) {
      walk(ingredient);
    }
  };

  walk(targetItemId);

  const byItem: Record<string, string[]> = {};
  for (const itemId of involved) {
    byItem[itemId] = [...(data.producers[itemId] ?? [])];
  }
  const recipes = Array.from(new Set(Object.values(byItem).flat())).sort();

  return { items: Array.from(involved).sort(), recipes, byItem };
}
