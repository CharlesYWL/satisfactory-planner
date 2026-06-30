import type { GameData } from './types';
import normalized from '../../data/data.normalized.json';

/**
 * 打包进前端的归一化游戏数据（默认数据源）。
 *
 * 通过 `as unknown as GameData` 跳过对超大 JSON 字面量的结构性类型检查，
 * 仅以 {@link GameData} 作为对外的类型契约。
 */
export const gameData: GameData = normalized as unknown as GameData;

/** 取物品定义。 */
export function getItem(itemId: string, data: GameData = gameData) {
  return data.items[itemId];
}

/** 取配方定义。 */
export function getRecipe(recipeId: string, data: GameData = gameData) {
  return data.recipes[recipeId];
}

/** 取建筑定义。 */
export function getBuilding(buildingId: string, data: GameData = gameData) {
  return data.buildings[buildingId];
}

/** 判断某物品是否为原矿 / 原始资源。 */
export function isRawItem(itemId: string, data: GameData = gameData): boolean {
  const item = data.items[itemId];
  if (item) return !!item.isRaw;
  // 未登记的物品按原始资源处理，避免无配方时递归越界。
  return !data.producers[itemId]?.length;
}
