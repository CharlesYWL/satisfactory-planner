import { describe, it, expect } from 'vitest';
import {
  balanceReverse,
  balanceReverseMulti,
  MULTI_ROOT_ITEM_ID,
} from '../index';

const STATOR = 'Desc_Stator_C';
const CABLE = 'Desc_Cable_C';
const WIRE = 'Desc_Wire_C';
const COPPER_INGOT = 'Desc_CopperIngot_C';
const ORE_COPPER = 'Desc_OreCopper_C';
const IRON_PLATE = 'Desc_IronPlate_C';
const COPPER_SHEET = 'Desc_CopperSheet_C';
const ORE_IRON = 'Desc_OreIron_C';

const machineCountOf = (
  machines: { itemId: string; machineCount: number }[],
  itemId: string,
): number => machines.find((m) => m.itemId === itemId)?.machineCount ?? 0;

describe('balanceReverseMulti 多目标反向配平', () => {
  it('单目标结果与旧 balanceReverse 等价（回归）', () => {
    const single = balanceReverse(STATOR, 5);
    const multi = balanceReverseMulti([{ itemId: STATOR, rate: 5 }]);

    expect(multi.rawTotals).toEqual(single.rawTotals);
    expect(multi.machines).toEqual(single.machines);
    expect(multi.buildingTotals).toEqual(single.buildingTotals);
    expect(multi.totalPower).toBe(single.totalPower);
    expect(multi.totalPowerExact).toBeCloseTo(single.totalPowerExact, 6);
    // 单目标时森林根即该目标的生产树根（非 super-root）。
    expect(multi.tree).toEqual(single.tree);
    expect(multi.tree?.itemId).toBe(STATOR);
    expect(multi.targets).toEqual([{ itemId: STATOR, rate: 5 }]);
  });

  it('两目标共享中间产物：produced / rawTotals / 机器数 = 各自之和', () => {
    const a = balanceReverse(STATOR, 5);
    const b = balanceReverse(CABLE, 30);
    const multi = balanceReverseMulti([
      { itemId: STATOR, rate: 5 },
      { itemId: CABLE, rate: 30 },
    ]);

    // 原矿需求跨目标累加（对每个出现过的原矿逐一校验）。
    const rawKeys = new Set([
      ...Object.keys(a.rawTotals),
      ...Object.keys(b.rawTotals),
    ]);
    for (const k of rawKeys) {
      expect(multi.rawTotals[k]).toBeCloseTo(
        (a.rawTotals[k] ?? 0) + (b.rawTotals[k] ?? 0),
        6,
      );
    }

    // 每个自产物品的（小数）机器数 = 两目标各自机器数之和。
    const itemKeys = new Set([
      ...a.machines.map((m) => m.itemId),
      ...b.machines.map((m) => m.itemId),
    ]);
    for (const id of itemKeys) {
      expect(machineCountOf(multi.machines, id)).toBeCloseTo(
        machineCountOf(a.machines, id) + machineCountOf(b.machines, id),
        6,
      );
    }

    // 共享中间产物（线材 / 铜锭）在合并结果里各只有一个机器组，产量为两目标之和。
    expect(multi.machines.filter((m) => m.itemId === WIRE)).toHaveLength(1);
    expect(multi.machines.filter((m) => m.itemId === COPPER_INGOT)).toHaveLength(1);
    const aWire = a.machines.find((m) => m.itemId === WIRE)!;
    const bWire = b.machines.find((m) => m.itemId === WIRE)!;
    const mWire = multi.machines.find((m) => m.itemId === WIRE)!;
    expect(mWire.rate).toBeCloseTo(aWire.rate + bWire.rate, 6);
    expect(multi.rawTotals[ORE_COPPER]).toBeCloseTo(
      a.rawTotals[ORE_COPPER] + b.rawTotals[ORE_COPPER],
      6,
    );

    // totalPowerExact（小数机器数线性）= 两目标之和；totalPower（整数）≤ 各自向上取整之和。
    expect(multi.totalPowerExact).toBeCloseTo(a.totalPowerExact + b.totalPowerExact, 6);
    expect(multi.totalPower).toBeLessThanOrEqual(a.totalPower + b.totalPower);
  });

  it('两目标不共享中间产物：结果为简单并集', () => {
    const a = balanceReverse(IRON_PLATE, 20);
    const b = balanceReverse(COPPER_SHEET, 10);
    const multi = balanceReverseMulti([
      { itemId: IRON_PLATE, rate: 20 },
      { itemId: COPPER_SHEET, rate: 10 },
    ]);

    // 两条链无交集 → 机器组数量 = 两者之和。
    const aItems = new Set(a.machines.map((m) => m.itemId));
    const bItems = new Set(b.machines.map((m) => m.itemId));
    for (const id of aItems) expect(bItems.has(id)).toBe(false);
    expect(multi.machines).toHaveLength(a.machines.length + b.machines.length);

    // 铁矿只来自铁链、铜矿只来自铜链，互不影响。
    expect(multi.rawTotals[ORE_IRON]).toBeCloseTo(a.rawTotals[ORE_IRON], 6);
    expect(multi.rawTotals[ORE_COPPER]).toBeCloseTo(b.rawTotals[ORE_COPPER], 6);
    expect(multi.totalPower).toBe(a.totalPower + b.totalPower);
  });

  it('≥2 目标 → tree 为虚拟 super-root，children 为各目标根', () => {
    const multi = balanceReverseMulti([
      { itemId: STATOR, rate: 5 },
      { itemId: CABLE, rate: 30 },
    ]);
    expect(multi.tree?.itemId).toBe(MULTI_ROOT_ITEM_ID);
    expect(multi.tree?.children.map((c) => c.itemId)).toEqual([STATOR, CABLE]);
    // super-root 自身无输入、无机器（图层/物流/施工图遍历它时透明穿过）。
    expect(multi.tree?.inputs).toEqual([]);
    expect(multi.tree?.machineCount).toBe(0);
  });

  it('空 targets → 空结果', () => {
    const multi = balanceReverseMulti([]);
    expect(multi.tree).toBeNull();
    expect(multi.rawTotals).toEqual({});
    expect(multi.machines).toEqual([]);
    expect(multi.buildingTotals).toEqual({});
    expect(multi.totalPower).toBe(0);
    expect(multi.totalPowerExact).toBe(0);
    expect(multi.targets).toEqual([]);
  });

  it('重复目标（同 itemId）合并、rate 相加', () => {
    const multi = balanceReverseMulti([
      { itemId: STATOR, rate: 5 },
      { itemId: STATOR, rate: 3 },
    ]);
    expect(multi.targets).toEqual([{ itemId: STATOR, rate: 8 }]);
    const eight = balanceReverse(STATOR, 8);
    expect(multi.rawTotals).toEqual(eight.rawTotals);
    expect(multi.machines).toEqual(eight.machines);
  });
});
