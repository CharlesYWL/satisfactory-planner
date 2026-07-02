import { describe, it, expect } from 'vitest';
import { gameData, recipeIO } from '../index';

const WIRE = 'Desc_Wire_C';
const COPPER_INGOT = 'Desc_CopperIngot_C';
const STATOR = 'Desc_Stator_C';
const STEEL_PIPE = 'Desc_SteelPipe_C';

describe('recipeIO 配方投入产出速率详情', () => {
  it('线材基础配方：铜锭 15/min → 线材 30/min', () => {
    const io = recipeIO(gameData.recipes.Recipe_Wire_C);
    expect(io.output).toEqual({ itemId: WIRE, rate: 30 });
    expect(io.inputs).toEqual([{ itemId: COPPER_INGOT, rate: 15 }]);
    expect(io.byproducts).toEqual([]);
  });

  it('定子基础配方：钢管 15/min + 线材 40/min → 定子 5/min', () => {
    const io = recipeIO(gameData.recipes.Recipe_Stator_C);
    expect(io.output).toEqual({ itemId: STATOR, rate: 5 });
    const byItem = Object.fromEntries(io.inputs.map((e) => [e.itemId, e.rate]));
    expect(byItem[STEEL_PIPE]).toBeCloseTo(15, 6);
    expect(byItem[WIRE]).toBeCloseTo(40, 6);
    expect(io.inputs).toHaveLength(2);
  });

  it('超频倍率线性缩放投入与产出（clock=2 → 全部 ×2）', () => {
    const base = recipeIO(gameData.recipes.Recipe_Wire_C, 1);
    const oc = recipeIO(gameData.recipes.Recipe_Wire_C, 2);
    expect(oc.output.rate).toBeCloseTo(base.output.rate * 2, 6);
    expect(oc.inputs[0].rate).toBeCloseTo(base.inputs[0].rate * 2, 6);
  });
});
