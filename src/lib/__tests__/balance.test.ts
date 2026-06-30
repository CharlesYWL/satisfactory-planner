import { describe, it, expect } from 'vitest';
import {
  balanceForward,
  balanceReverse,
  suggestBelt,
  getRelevantRecipes,
  chooseRecipe,
  machineCapacity,
  overclockPower,
  outputPerMin,
  inputPerMin,
  gameData,
} from '../index';

// 关键物品 / 配方 / 建筑 id（来自 data.normalized.json）
const STATOR = 'Desc_Stator_C';
const STEEL_PIPE = 'Desc_SteelPipe_C';
const WIRE = 'Desc_Wire_C';
const STEEL_INGOT = 'Desc_SteelIngot_C';
const COPPER_INGOT = 'Desc_CopperIngot_C';
const ORE_IRON = 'Desc_OreIron_C';
const ORE_COPPER = 'Desc_OreCopper_C';
const COAL = 'Desc_Coal_C';
const ASSEMBLER = 'Build_AssemblerMk1_C';
const CONSTRUCTOR = 'Build_ConstructorMk1_C';

describe('rates 基础公式', () => {
  it('单机产能/min = produce × 60 / duration', () => {
    const stator = gameData.recipes.Recipe_Stator_C;
    // 1 × 60 / 12 = 5 定子/min
    expect(machineCapacity(stator)).toBeCloseTo(5);
    const wire = gameData.recipes.Recipe_Wire_C;
    // 2 × 60 / 4 = 30 线材/min
    expect(machineCapacity(wire)).toBeCloseTo(30);
  });

  it('outputPerMin / inputPerMin 随超频线性缩放', () => {
    const stator = gameData.recipes.Recipe_Stator_C;
    expect(outputPerMin(stator, STATOR, 2)).toBeCloseTo(10);
    // 每周期 8 线材 → 40/min @100%，超频 1.5x → 60/min
    expect(inputPerMin(stator, WIRE, 1)).toBeCloseTo(40);
    expect(inputPerMin(stator, WIRE, 1.5)).toBeCloseTo(60);
  });

  it('超频功耗 = 基础功耗 × clock ^ 1.321321', () => {
    expect(overclockPower(15, 1)).toBeCloseTo(15);
    expect(overclockPower(4, 2.5)).toBeCloseTo(4 * Math.pow(2.5, 1.321321));
  });
});

describe('suggestBelt 带速建议', () => {
  it('返回够用的最低档', () => {
    expect(suggestBelt(130).mark).toBe('Mk3');
    expect(suggestBelt(130).speed).toBe(270);
    expect(suggestBelt(60).mark).toBe('Mk1');
    expect(suggestBelt(60).speed).toBe(60);
  });

  it('边界与溢出', () => {
    expect(suggestBelt(0).mark).toBe('Mk1');
    expect(suggestBelt(120).mark).toBe('Mk2');
    expect(suggestBelt(121).mark).toBe('Mk3');
    expect(suggestBelt(99999).mark).toBe('Mk6');
  });
});

describe('chooseRecipe 配方选择', () => {
  it('默认选非替代(base)配方', () => {
    expect(chooseRecipe(STATOR)?.id).toBe('Recipe_Stator_C');
    expect(chooseRecipe(WIRE)?.id).toBe('Recipe_Wire_C');
  });

  it('override 生效', () => {
    expect(chooseRecipe(STATOR, { [STATOR]: 'Recipe_Alternate_Stator_C' })?.id).toBe(
      'Recipe_Alternate_Stator_C',
    );
  });

  it('未登记物品（无 producers）返回 undefined', () => {
    expect(chooseRecipe('Desc_NotARealItem_C')).toBeUndefined();
  });

  it('原矿有自产采矿配方，但被 isRaw 当作叶子（不展开）', () => {
    // 采矿机配方 ore→ore 存在于 producers 中，故 chooseRecipe 非空；
    // trace/getRelevantRecipes 靠 item.isRaw 把原矿当叶子，避免自循环。
    expect(chooseRecipe(ORE_IRON)?.produce).toHaveProperty(ORE_IRON);
    expect(gameData.items[ORE_IRON].isRaw).toBe(true);
  });
});

describe('正向配平 (产线取向)', () => {
  it('验收 2：钢管15 + 线材40 → 恰好 5 定子/min，1 台 Assembler，利用率 100%', () => {
    const r = balanceForward(STATOR, { [STEEL_PIPE]: 15, [WIRE]: 40 });

    expect(r.targetOutput).toBeCloseTo(5);
    expect(r.nodes).toHaveLength(1);

    const stator = r.nodes[0];
    expect(stator.itemId).toBe(STATOR);
    expect(stator.machineId).toBe(ASSEMBLER);
    expect(stator.machineCount).toBe(1);
    expect(stator.clockPct).toBe(100);
    expect(stator.utilization).toBeCloseTo(1.0);
    expect(stator.power).toBeCloseTo(15);

    // 两种原料同时到顶 → 都是瓶颈
    expect(new Set(r.bottlenecks)).toEqual(new Set([STEEL_PIPE, WIRE]));

    const pipe = r.inputs.find((i) => i.itemId === STEEL_PIPE)!;
    expect(pipe.demandPerOutput).toBeCloseTo(3);
    expect(pipe.consumed).toBeCloseTo(15);
    expect(pipe.leftover).toBeCloseTo(0);

    const wire = r.inputs.find((i) => i.itemId === WIRE)!;
    expect(wire.demandPerOutput).toBeCloseTo(8);
    expect(wire.consumed).toBeCloseTo(40);
    expect(wire.leftover).toBeCloseTo(0);
  });

  it('线材不足时只有线材是瓶颈，钢管有剩余', () => {
    const r = balanceForward(STATOR, { [STEEL_PIPE]: 15, [WIRE]: 20 });
    // 线材上限 = 20/8 = 2.5；钢管上限 = 15/3 = 5 → 取 2.5
    expect(r.targetOutput).toBeCloseTo(2.5);
    expect(r.bottlenecks).toEqual([WIRE]);
    const pipe = r.inputs.find((i) => i.itemId === STEEL_PIPE)!;
    expect(pipe.consumed).toBeCloseTo(7.5);
    expect(pipe.leftover).toBeCloseTo(7.5);
  });

  it('只给钢管时，线材会一路展开到铜矿并计入 rawInputs', () => {
    const r = balanceForward(STATOR, { [STEEL_PIPE]: 15 });
    expect(r.targetOutput).toBeCloseTo(5); // 仅受钢管限制
    expect(r.bottlenecks).toEqual([STEEL_PIPE]);
    // 线材 / 铜锭被自产展开
    const ids = r.nodes.map((n) => n.itemId);
    expect(ids).toContain(WIRE);
    expect(ids).toContain(COPPER_INGOT);
    // 铜矿未供给 → 作为原料叶子汇总：每 1 定子需 4 铜矿 → 5 定子需 20
    expect(r.rawInputs[ORE_COPPER]).toBeCloseTo(20);
  });

  it('超频模式把多台机器凑成更少的超频机器', () => {
    // 目标线材，供给 35 铜锭 → 70 线材/min
    const integer = balanceForward(WIRE, { [COPPER_INGOT]: 35 }, { mode: 'integer' });
    expect(integer.targetOutput).toBeCloseTo(70);
    expect(integer.nodes[0].machineCount).toBe(3); // ceil(70/30)
    expect(integer.nodes[0].clockPct).toBe(100);

    const oc = balanceForward(WIRE, { [COPPER_INGOT]: 35 }, { mode: 'overclock' });
    expect(oc.nodes[0].machineCount).toBe(1); // ceil(70/(30×2.5)) = 1
    expect(oc.nodes[0].clockPct).toBeCloseTo((70 / 30) * 100); // ≈233.33%
    expect(oc.nodes[0].utilization).toBeCloseTo(1.0);
  });
});

describe('反向配平 (成品取向)', () => {
  it('验收 3：5 定子/min → 15 钢管 + 40 线材，1 台 Assembler，47MW', () => {
    const r = balanceReverse(STATOR, 5);

    expect(r.totalPower).toBe(47);

    const stator = r.machines.find((m) => m.itemId === STATOR)!;
    expect(stator.machineId).toBe(ASSEMBLER);
    expect(stator.machineCount).toBeCloseTo(1);
    expect(stator.machineCountInteger).toBe(1);

    // 定子节点的直接输入 = 15 钢管 + 40 线材
    const root = r.tree!;
    expect(root.inputs.find((i) => i.itemId === STEEL_PIPE)!.rate).toBeCloseTo(15);
    expect(root.inputs.find((i) => i.itemId === WIRE)!.rate).toBeCloseTo(40);
  });

  it('验收 4：5 定子深链倒推到原矿，机器数与官方计算器吻合', () => {
    const r = balanceReverse(STATOR, 5);

    // 原矿汇总
    expect(r.rawTotals[ORE_IRON]).toBeCloseTo(22.5);
    expect(r.rawTotals[ORE_COPPER]).toBeCloseTo(20);
    expect(r.rawTotals[COAL]).toBeCloseTo(22.5);

    // 每级（小数）机器数
    const byItem = Object.fromEntries(r.machines.map((m) => [m.itemId, m]));
    expect(byItem[STATOR].machineCount).toBeCloseTo(1);
    expect(byItem[STEEL_PIPE].machineCount).toBeCloseTo(0.75);
    expect(byItem[WIRE].machineCount).toBeCloseTo(40 / 30);
    expect(byItem[STEEL_INGOT].machineCount).toBeCloseTo(0.5);
    expect(byItem[COPPER_INGOT].machineCount).toBeCloseTo(20 / 30);

    // 整数建筑汇总：1 Assembler + (ceil .75=1 钢管 + ceil 1.333=2 线材)=3 Constructor
    expect(r.buildingTotals[ASSEMBLER]).toBe(1);
    expect(r.buildingTotals[CONSTRUCTOR]).toBe(3);
  });

  it('产量线性缩放：10 定子 = 2× 5 定子的原矿', () => {
    const r5 = balanceReverse(STATOR, 5);
    const r10 = balanceReverse(STATOR, 10);
    expect(r10.rawTotals[ORE_IRON]).toBeCloseTo(r5.rawTotals[ORE_IRON] * 2);
    expect(r10.machines.find((m) => m.itemId === STATOR)!.machineCount).toBeCloseTo(2);
  });

  it('替代配方 override 改变生产树', () => {
    const r = balanceReverse(STATOR, 5, {
      recipeOverrides: { [STATOR]: 'Recipe_Alternate_Stator_C' },
    });
    // 替代定子配方用高速线材(Quickwire→镭射石英→金矿)，不再消耗普通线材/铜
    expect(r.tree!.recipeId).toBe('Recipe_Alternate_Stator_C');
    expect(r.machines.some((m) => m.itemId === WIRE)).toBe(false);
    expect(r.rawTotals[ORE_COPPER]).toBeUndefined();
    expect(r.rawTotals['Desc_OreGold_C']).toBeGreaterThan(0); // 卡特利金矿
  });
});

describe('getRelevantRecipes 相关配方筛选', () => {
  it('验收 6：定子相关配方齐全，且不含无关配方', () => {
    const rel = getRelevantRecipes(STATOR);

    // 涉及的自产物品（不含原矿）
    expect(rel.items).toContain(STATOR);
    expect(rel.items).toContain(STEEL_PIPE);
    expect(rel.items).toContain(WIRE);
    expect(rel.items).toContain(STEEL_INGOT);
    expect(rel.items).toContain(COPPER_INGOT);
    expect(rel.items).not.toContain(ORE_IRON); // 原矿不算自产物品

    // 候选配方并集（含替代配方，供下拉用）
    expect(rel.recipes).toContain('Recipe_Stator_C');
    expect(rel.recipes).toContain('Recipe_SteelPipe_C');
    expect(rel.recipes).toContain('Recipe_Wire_C');
    expect(rel.recipes).toContain('Recipe_IngotSteel_C');
    expect(rel.recipes).toContain('Recipe_IngotCopper_C');
    expect(rel.recipes).toContain('Recipe_Alternate_Stator_C');

    // 无关配方不应出现：铁锭不在定子默认树里，混凝土更无关
    expect(rel.recipes).not.toContain('Recipe_IngotIron_C');
    expect(rel.recipes).not.toContain('Recipe_Concrete_C');

    // byItem 提供每个物品的候选配方
    expect(rel.byItem[STATOR]).toContain('Recipe_Alternate_Stator_C');
  });
});
