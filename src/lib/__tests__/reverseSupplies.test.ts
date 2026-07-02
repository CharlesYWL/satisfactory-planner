import { describe, it, expect } from 'vitest';
import { balanceReverse, balanceReverseMulti } from '../index';

const STATOR = 'Desc_Stator_C';
const CABLE = 'Desc_Cable_C';
const WIRE = 'Desc_Wire_C';
const COPPER_INGOT = 'Desc_CopperIngot_C';
const ORE_COPPER = 'Desc_OreCopper_C';

const has = (machines: { itemId: string }[], itemId: string): boolean =>
  machines.some((m) => m.itemId === itemId);
const rateOf = (machines: { itemId: string; rate: number }[], itemId: string): number =>
  machines.find((m) => m.itemId === itemId)?.rate ?? 0;

describe('balanceReverse supplies 边界（勾选中间产物为已有）', () => {
  it('不传 supplies → 与现状完全一致（回归）', () => {
    const base = balanceReverse(STATOR, 10);
    const empty = balanceReverse(STATOR, 10, { supplies: new Set() });
    expect(empty.machines).toEqual(base.machines);
    expect(empty.rawTotals).toEqual(base.rawTotals);
    expect(empty.buildingTotals).toEqual(base.buildingTotals);
    expect(empty.suppliedTotals).toEqual({});
  });

  it('勾选线材为已有 → 线材/铜锭移出自产、铜矿从原矿消失、线材计入 suppliedTotals', () => {
    const base = balanceReverse(STATOR, 10);
    const cut = balanceReverse(STATOR, 10, { supplies: new Set([WIRE]) });

    // 前提：默认结构里线材、铜锭都是自产，铜矿是原矿。
    expect(has(base.machines, WIRE)).toBe(true);
    expect(has(base.machines, COPPER_INGOT)).toBe(true);
    expect(base.rawTotals[ORE_COPPER]).toBeGreaterThan(0);

    // 截断后：线材及其唯一上游（铜锭→铜矿）都不再自产 / 需求。
    expect(has(cut.machines, WIRE)).toBe(false);
    expect(has(cut.machines, COPPER_INGOT)).toBe(false);
    expect(cut.rawTotals[ORE_COPPER] ?? 0).toBe(0);

    // 被当作已有的线材计入 suppliedTotals，量 = 原本的线材总产量。
    expect(cut.suppliedTotals[WIRE]).toBeCloseTo(rateOf(base.machines, WIRE), 6);

    // 与线材无关的链（钢管一侧）机器不受影响。
    for (const m of cut.machines) {
      expect(m.itemId).not.toBe(WIRE);
      expect(m.itemId).not.toBe(COPPER_INGOT);
    }
  });
});

describe('balanceReverseMulti supplies 边界（共享中间产物对所有目标截断）', () => {
  it('勾选共享线材 → 定子链与电缆链都在线材截断，铜矿归零', () => {
    const base = balanceReverseMulti([
      { itemId: STATOR, rate: 5 },
      { itemId: CABLE, rate: 30 },
    ]);
    const cut = balanceReverseMulti(
      [
        { itemId: STATOR, rate: 5 },
        { itemId: CABLE, rate: 30 },
      ],
      { supplies: new Set([WIRE]) },
    );

    // 前提：线材是两条链共享的自产中间产物。
    expect(has(base.machines, WIRE)).toBe(true);
    expect(base.rawTotals[ORE_COPPER]).toBeGreaterThan(0);

    // 截断后线材/铜锭不再自产，铜矿需求归零（两链的铜都只经线材）。
    expect(has(cut.machines, WIRE)).toBe(false);
    expect(has(cut.machines, COPPER_INGOT)).toBe(false);
    expect(cut.rawTotals[ORE_COPPER] ?? 0).toBe(0);

    // suppliedTotals 跨目标累加 = 两条链原本的线材总产量。
    expect(cut.suppliedTotals[WIRE]).toBeCloseTo(rateOf(base.machines, WIRE), 6);
  });

  it('不传 supplies → 与现状一致（回归）', () => {
    const targets = [
      { itemId: STATOR, rate: 5 },
      { itemId: CABLE, rate: 30 },
    ];
    const base = balanceReverseMulti(targets);
    const empty = balanceReverseMulti(targets, { supplies: new Set() });
    expect(empty.machines).toEqual(base.machines);
    expect(empty.rawTotals).toEqual(base.rawTotals);
    expect(empty.suppliedTotals).toEqual({});
  });
});
