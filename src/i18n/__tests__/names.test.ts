import { describe, it, expect } from 'vitest';
import { gameData } from '../../lib';
import { itemName, buildingName, recipeName, normalizeLang } from '../names';
import zhNames from '../names.zh.json';
import { resources } from '../ui';

describe('i18n 名称查表（data 驱动）', () => {
  it('中文模式返回中文名', () => {
    expect(itemName('Desc_Stator_C', 'zh')).toBe('定子');
    expect(buildingName('Build_AssemblerMk1_C', 'zh')).toBe('装配站');
    expect(buildingName('Build_ConstructorMk1_C', 'zh')).toBe('构筑站');
    expect(recipeName('Recipe_Stator_C', 'zh')).toBe('定子');
  });

  it('英文模式返回英文名（来自归一化数据）', () => {
    expect(itemName('Desc_Stator_C', 'en')).toBe('Stator');
    expect(buildingName('Build_AssemblerMk1_C', 'en')).toBe('Assembler');
    expect(recipeName('Recipe_Stator_C', 'en')).toBe('Stator');
  });

  it('缺翻译/未知 id 优雅回退（不抛错、不显示 i18n key）', () => {
    // 未知物品 → 回退 id 本身
    expect(itemName('Desc_NotARealItem_C', 'zh')).toBe('Desc_NotARealItem_C');
    expect(itemName('Desc_NotARealItem_C', 'en')).toBe('Desc_NotARealItem_C');
    // 已知 id 但 zh 表缺失时回退英文名
    const fakeData = {
      ...gameData,
      items: {
        ...gameData.items,
        Desc_Fake_C: { ...gameData.items.Desc_Stator_C, id: 'Desc_Fake_C', name: 'Fake Part' },
      },
    };
    expect(itemName('Desc_Fake_C', 'zh', fakeData)).toBe('Fake Part');
  });

  it('normalizeLang 把语言码归一化为 zh/en', () => {
    expect(normalizeLang('zh')).toBe('zh');
    expect(normalizeLang('zh-CN')).toBe('zh');
    expect(normalizeLang('en')).toBe('en');
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang(undefined)).toBe('en');
  });
});

describe('i18n 资源完整性', () => {
  it('中文名映射覆盖全部物品 / 建筑 / 配方', () => {
    const missing = (ids: string[], map: Record<string, string>) =>
      ids.filter((id) => !map[id]);
    expect(missing(Object.keys(gameData.items), zhNames.items)).toEqual([]);
    expect(missing(Object.keys(gameData.buildings), zhNames.buildings)).toEqual([]);
    expect(missing(Object.keys(gameData.recipes), zhNames.recipes)).toEqual([]);
  });

  it('zh 与 en 的 UI 文案 key 集合一致（无漏译）', () => {
    const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === 'object'
          ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      );
    const zhKeys = flatten(resources.zh.translation).sort();
    const enKeys = flatten(resources.en.translation).sort();
    expect(zhKeys).toEqual(enKeys);
  });
});
