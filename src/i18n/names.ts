import { useTranslation } from 'react-i18next';
import { gameData, type GameData } from '../lib';
import zhNames from './names.zh.json';

/** 支持的界面语言。 */
export type Lang = 'zh' | 'en';

/**
 * 物品 / 建筑 / 配方的中文名查表（data 驱动）。
 * 由 data/build_zh_names.py 从 SCIM zh-Stable 游戏数据生成，覆盖归一化数据包里的全部 id。
 * 英文名仍取自 data.normalized.json，缺中文项运行时优雅回退英文。
 */
const ZH = zhNames as {
  items: Record<string, string>;
  buildings: Record<string, string>;
  recipes: Record<string, string>;
};

/** 把 i18next 的语言码归一化为 'zh' / 'en'（非中文一律按英文处理）。 */
export function normalizeLang(raw: string | undefined): Lang {
  return raw != null && raw.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 物品显示名：中文模式查中文表，缺失回退英文名，再回退 id。 */
export function itemName(itemId: string, lang: Lang, data: GameData = gameData): string {
  const en = data.items[itemId]?.name ?? itemId;
  return lang === 'zh' ? ZH.items[itemId] ?? en : en;
}

/** 建筑（机器）显示名：中文模式查中文表，缺失回退英文名，再回退 id。 */
export function buildingName(buildingId: string, lang: Lang, data: GameData = gameData): string {
  const en = data.buildings[buildingId]?.name ?? buildingId;
  return lang === 'zh' ? ZH.buildings[buildingId] ?? en : en;
}

/** 配方显示名：中文模式查中文表，缺失回退英文名，再回退 id。 */
export function recipeName(recipeId: string, lang: Lang, data: GameData = gameData): string {
  const en = data.recipes[recipeId]?.name ?? recipeId;
  return lang === 'zh' ? ZH.recipes[recipeId] ?? en : en;
}

/** 当前界面语言（订阅 i18next，语言切换时触发组件重渲染）。 */
export function useLang(): Lang {
  const { i18n } = useTranslation();
  return normalizeLang(i18n.language);
}
