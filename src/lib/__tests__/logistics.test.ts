import { describe, it, expect } from 'vitest';
import {
  splittersForOutputs,
  mergersForInputs,
  connectionLogistics,
  computeLogistics,
  balanceReverse,
  traceProduction,
  MAX_BELT_SPEED,
} from '../index';

const STATOR = 'Desc_Stator_C';
const WIRE = 'Desc_Wire_C';
const STEEL_PIPE = 'Desc_SteelPipe_C';

describe('splittersForOutputs / mergersForInputs 拓扑节点数', () => {
  it('分离器：1→3，net +2 出口/个 → ceil((P-1)/2)', () => {
    expect(splittersForOutputs(0)).toBe(0);
    expect(splittersForOutputs(1)).toBe(0);
    expect(splittersForOutputs(2)).toBe(1);
    expect(splittersForOutputs(3)).toBe(1);
    expect(splittersForOutputs(4)).toBe(2);
    expect(splittersForOutputs(5)).toBe(2);
    expect(splittersForOutputs(7)).toBe(3);
  });

  it('合并器：3→1，net -2 股/个 → ceil((N-1)/2)', () => {
    expect(mergersForInputs(0)).toBe(0);
    expect(mergersForInputs(1)).toBe(0);
    expect(mergersForInputs(2)).toBe(1);
    expect(mergersForInputs(4)).toBe(2);
    expect(mergersForInputs(6)).toBe(3);
  });

  it('支持自定义 fan（1→2 / 2→1 拓扑）', () => {
    // 1→2 分离器：net +1/个 → P-1 个
    expect(splittersForOutputs(5, 2)).toBe(4);
    // 2→1 合并器：net -1/个 → N-1 个
    expect(mergersForInputs(6, 2)).toBe(5);
  });
});

describe('connectionLogistics 单条连接估算', () => {
  it('验收 2：强化铁板例子的铜线段（高流量 → 高级带）', () => {
    // 6 台构造器铜线 → 5 台组装机；铜线 160/min
    const copper = connectionLogistics({
      itemId: WIRE,
      targetItemId: 'Desc_IronPlateReinforced_C',
      flow: 160,
      sourceMachines: 6,
      targetMachines: 5,
    });
    expect(copper.belt.mark).toBe('Mk3'); // 160 → Mk3(270)
    expect(copper.belt.speed).toBe(270);
    expect(copper.mergers).toBe(3); // 合 6 股 = ceil(5/2)
    expect(copper.targetPorts).toBe(5);
    expect(copper.splitters).toBe(2); // 分到 5 口 = ceil(4/2)
    expect(copper.overBelt).toBe(false);
    expect(copper.beltCount).toBe(1);
    expect(copper.rawSource).toBe(false);
  });

  it('验收 2：强化铁板例子的铁板段（低流量 → 低级带）', () => {
    // 4 台构造器铁板 → 5 台组装机；铁板 80/min
    const iron = connectionLogistics({
      itemId: 'Desc_IronPlate_C',
      targetItemId: 'Desc_IronPlateReinforced_C',
      flow: 80,
      sourceMachines: 4,
      targetMachines: 5,
    });
    expect(iron.belt.mark).toBe('Mk2'); // 80 → Mk2(120)
    expect(iron.mergers).toBe(2); // 合 4 股 = ceil(3/2)
    expect(iron.splitters).toBe(2);
  });

  it('铜线段流量大于铁板段 → 铜线带级更高', () => {
    const copper = connectionLogistics({
      itemId: WIRE,
      targetItemId: 'X',
      flow: 160,
      sourceMachines: 6,
      targetMachines: 5,
    });
    const iron = connectionLogistics({
      itemId: 'Desc_IronPlate_C',
      targetItemId: 'X',
      flow: 80,
      sourceMachines: 4,
      targetMachines: 5,
    });
    expect(copper.belt.speed).toBeGreaterThan(iron.belt.speed);
  });

  it('原料/外部供给源 → 无合并器（单一主干）', () => {
    const raw = connectionLogistics({
      itemId: 'Desc_OreCopper_C',
      targetItemId: 'Desc_CopperIngot_C',
      flow: 120,
      sourceMachines: 0,
      targetMachines: 3,
    });
    expect(raw.rawSource).toBe(true);
    expect(raw.mergers).toBe(0);
    expect(raw.splitters).toBe(1); // 分到 3 口
  });

  it('单源单目标 → 无需分离器/合并器', () => {
    const c = connectionLogistics({
      itemId: WIRE,
      targetItemId: 'X',
      flow: 30,
      sourceMachines: 1,
      targetMachines: 1,
    });
    expect(c.mergers).toBe(0);
    expect(c.splitters).toBe(0);
    expect(c.belt.mark).toBe('Mk1');
  });

  it('超单条最高档带速 → 需多条并行带', () => {
    const flow = MAX_BELT_SPEED * 2 + 50;
    const c = connectionLogistics({
      itemId: WIRE,
      targetItemId: 'X',
      flow,
      sourceMachines: 10,
      targetMachines: 8,
    });
    expect(c.overBelt).toBe(true);
    expect(c.beltCount).toBe(Math.ceil(flow / MAX_BELT_SPEED)); // 3
    expect(c.belt.mark).toBe('Mk6');
  });
});

describe('computeLogistics 整树汇总', () => {
  it('在反向配平的定子树上算出合理汇总', () => {
    const r = balanceReverse(STATOR, 30); // 放大产量制造多机器组
    const machineCountOf = (itemId: string) => {
      const m = r.machines.find((x) => x.itemId === itemId);
      return m ? m.machineCountInteger : 0;
    };
    const summary = computeLogistics(r.tree, machineCountOf);

    // 每条「消费方输入」都应有一条连接（与图的边一一对应）。
    expect(summary.connections.length).toBeGreaterThan(0);
    // 定子根节点的两条输入（钢管 + 线材）应在连接里。
    const intoStator = summary.connections.filter((c) => c.targetItemId === STATOR);
    expect(intoStator.map((c) => c.itemId).sort()).toEqual([STEEL_PIPE, WIRE].sort());

    // 汇总为非负整数。
    expect(summary.totalSplitters).toBeGreaterThanOrEqual(0);
    expect(summary.totalMergers).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(summary.totalSplitters)).toBe(true);
    expect(Number.isInteger(summary.totalMergers)).toBe(true);

    // beltUsage 段数合计 = 连接数；按带速升序。
    const segTotal = summary.beltUsage.reduce((s, u) => s + u.segments, 0);
    expect(segTotal).toBe(summary.connections.length);
    const speeds = summary.beltUsage.map((u) => u.speed);
    expect([...speeds].sort((a, b) => a - b)).toEqual(speeds);
  });

  it('空树 → 空汇总', () => {
    const summary = computeLogistics(null, () => 0);
    expect(summary.connections).toEqual([]);
    expect(summary.totalSplitters).toBe(0);
    expect(summary.totalMergers).toBe(0);
    expect(summary.beltUsage).toEqual([]);
  });

  it('原料叶子输入计为 rawSource（无合并器）', () => {
    const trace = traceProduction(WIRE, 60); // 线材 ← 铜锭 ← 铜矿
    const machineCountOf = () => 2;
    const summary = computeLogistics(trace.root, machineCountOf);
    const rawConns = summary.connections.filter((c) => c.rawSource);
    expect(rawConns.length).toBeGreaterThan(0);
    for (const c of rawConns) expect(c.mergers).toBe(0);
  });
});
