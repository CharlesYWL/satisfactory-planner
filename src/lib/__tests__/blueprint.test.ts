import { describe, it, expect } from 'vitest';
import {
  manifoldNodes,
  computeBlueprint,
  balanceForward,
  balanceReverse,
  traceProduction,
  machineCapacity,
  gameData,
} from '../index';

const STATOR = 'Desc_Stator_C';
const RIP = 'Desc_IronPlateReinforced_C';
const STITCHED = 'Recipe_Alternate_ReinforcedIronPlate_2_C';

const WIRING = 'Desc_SpaceElevatorPart_3_C'; // 自动路线 Automated Wiring
const WIRE = 'Desc_Wire_C';
const COPPER_INGOT = 'Desc_CopperIngot_C';
const ORE_COPPER = 'Desc_OreCopper_C';

/** 用反向配平结果构造 machineCountOf / rateOf 查询器。 */
function reverseLookups(itemId: string, rate: number, overrides = {}) {
  const r = balanceReverse(itemId, rate, { recipeOverrides: overrides });
  const byItem = new Map(r.machines.map((m) => [m.itemId, m]));
  return {
    r,
    machineCountOf: (id: string) => byItem.get(id)?.machineCountInteger ?? 0,
    rateOf: (id: string) => byItem.get(id)?.rate,
  };
}

/** 正向配平（产线取向）→ 与 store 一致的 machineCountOf / rateOf + 实产量重跑的树。 */
function forwardLookups(itemId: string, supplies: Record<string, number>) {
  const forward = balanceForward(itemId, supplies, { mode: 'integer' });
  const byItem = new Map(forward.nodes.map((n) => [n.itemId, n]));
  const output = Number.isFinite(forward.targetOutput) ? forward.targetOutput : 0;
  const trace = traceProduction(itemId, output, { supplies: new Set(Object.keys(supplies)) });
  return {
    forward,
    tree: trace.root,
    machineCountOf: (id: string) => byItem.get(id)?.machineCount ?? 0,
    rateOf: (id: string) => byItem.get(id)?.demand,
  };
}

/** 断言：每个组的每条输入 totalFlow == 组总产 × 配方该料用量比（Plan-A 不变式）。 */
function expectFlowMatchesRecipeRatio(plan: ReturnType<typeof computeBlueprint>) {
  for (const g of plan.groups) {
    const recipe = gameData.recipes[g.recipeId];
    const producedQty = recipe.produce[g.itemId] ?? 1;
    for (const inp of g.inputs) {
      const ratio = (recipe.ingredients[inp.itemId] ?? 0) / producedQty;
      expect(inp.totalFlow).toBeCloseTo(g.totalRate * ratio, 6);
      const expectedPerMachine = g.machineCount > 0 ? inp.totalFlow / g.machineCount : inp.totalFlow;
      expect(inp.perMachineFlow).toBeCloseTo(expectedPerMachine, 6);
    }
  }
}

describe('manifoldNodes 线性级联分/合数量', () => {
  it('N 台机器 → N-1 个分离器/合并器（1 台以下为 0）', () => {
    expect(manifoldNodes(0)).toBe(0);
    expect(manifoldNodes(1)).toBe(0);
    expect(manifoldNodes(2)).toBe(1);
    expect(manifoldNodes(5)).toBe(4);
    expect(manifoldNodes(6)).toBe(5);
  });

  it('非法输入回退 0', () => {
    expect(manifoldNodes(NaN)).toBe(0);
    expect(manifoldNodes(-3)).toBe(0);
  });
});

describe('computeBlueprint 施工图计算', () => {
  it('空树 → 空施工图', () => {
    const plan = computeBlueprint(null, () => 0, () => 0);
    expect(plan.groups).toEqual([]);
    expect(plan.totalMachines).toBe(0);
    expect(plan.totalSplitters).toBe(0);
    expect(plan.totalMergers).toBe(0);
    expect(plan.beltUsage).toEqual([]);
  });

  it('定子链：每组分/合数 = 机器数-1，机器总数 = 各组整数台数之和', () => {
    const { r, machineCountOf, rateOf } = reverseLookups(STATOR, 60);
    const plan = computeBlueprint(r.tree, machineCountOf, rateOf);

    expect(plan.groups.length).toBeGreaterThan(0);
    expect(plan.productItemId).toBe(STATOR);
    // 底部对账 = 目标产量。
    expect(plan.productRate).toBeCloseTo(60, 6);

    let machineSum = 0;
    let splitterSum = 0;
    let mergerSum = 0;
    for (const g of plan.groups) {
      const expected = Math.max(0, g.machineCount - 1);
      expect(g.outputMergers).toBe(expected);
      for (const inp of g.inputs) expect(inp.splitters).toBe(expected);
      // 每台机器产量 × 台数 ≈ 组总产量。
      expect(g.perMachineRate * g.machineCount).toBeCloseTo(g.totalRate, 6);
      machineSum += g.machineCount;
      splitterSum += g.inputs.reduce((s, i) => s + i.splitters, 0);
      mergerSum += g.outputMergers;
    }
    expect(plan.totalMachines).toBe(machineSum);
    expect(plan.totalSplitters).toBe(splitterSum);
    expect(plan.totalMergers).toBe(mergerSum);

    // 成品组排在最后（depth 最小），最上游组 depth 最大排最前。
    expect(plan.groups[plan.groups.length - 1].itemId).toBe(STATOR);
    for (let i = 1; i < plan.groups.length; i++) {
      expect(plan.groups[i - 1].depth).toBeGreaterThanOrEqual(plan.groups[i].depth);
    }
  });

  it('强化铁板(缝合替代)：展开成独立机器阵列，成品带 produced 输入', () => {
    // 缝合铁板：10 铁板 + 20 线材 → 3 强化铁板 / 32s；用较大产量制造多台机器。
    const overrides = { [RIP]: STITCHED };
    const { r, machineCountOf, rateOf } = reverseLookups(RIP, 30, overrides);
    const plan = computeBlueprint(r.tree, machineCountOf, rateOf);

    const product = plan.groups.find((g) => g.itemId === RIP)!;
    expect(product.isProduct).toBe(true);
    // 成品的两条输入（铁板 + 线材）都来自机器组。
    const inItems = product.inputs.map((i) => i.itemId).sort();
    expect(inItems).toEqual(['Desc_IronPlate_C', 'Desc_Wire_C'].sort());
    for (const inp of product.inputs) expect(inp.produced).toBe(true);

    // 组装机台数 = ⌈需求 / 单机产能⌉，且 > 1（多台 → 有 manifold）。
    const recipe = gameData.recipes[STITCHED];
    const cap = machineCapacity(recipe, 1);
    expect(product.machineCount).toBe(Math.ceil((30 / cap) - 1e-9));
    expect(product.machineCount).toBeGreaterThan(1);
    expect(product.outputMergers).toBe(product.machineCount - 1);
  });

  it('原矿输入标记为非 produced（无上游机器组）', () => {
    const trace = traceProduction('Desc_Wire_C', 120); // 线材 ← 铜锭 ← 铜矿
    const plan = computeBlueprint(trace.root, () => 2, () => undefined);
    const rawInputs = plan.groups
      .flatMap((g) => g.inputs)
      .filter((i) => i.kind === 'raw');
    expect(rawInputs.length).toBeGreaterThan(0);
    for (const i of rawInputs) expect(i.produced).toBe(false);
  });

  it('带级用量段数 = 全部输入 manifold + 每组输出主干之和', () => {
    const { r, machineCountOf, rateOf } = reverseLookups(STATOR, 60);
    const plan = computeBlueprint(r.tree, machineCountOf, rateOf);
    const segTotal = plan.beltUsage.reduce((s, u) => s + u.segments, 0);
    const expected = plan.groups.reduce((s, g) => s + g.inputs.length + 1, 0);
    expect(segTotal).toBe(expected);
    // 带速升序。
    const speeds = plan.beltUsage.map((u) => u.speed);
    expect([...speeds].sort((a, b) => a - b)).toEqual(speeds);
  });
});

describe('computeBlueprint 多消费者输入流量（Bug 修复：铜矿石 20→120）', () => {
  it('正向 / 自动路线 / 铜矿石 120 / 有钢管：输入侧每段流量按全组总量而非单条支路', () => {
    // 复现场景：目标=自动路线，铜矿石自定义 120，钢管作为已供给（充足）。
    const { forward, tree, machineCountOf, rateOf } = forwardLookups(WIRING, {
      [ORE_COPPER]: 120,
      Desc_SteelPipe_C: 1000,
    });
    // forward 本身正确：产量 5，瓶颈是铜矿石。
    expect(forward.targetOutput).toBeCloseTo(5, 6);
    expect(forward.bottlenecks).toContain(ORE_COPPER);

    const plan = computeBlueprint(tree, machineCountOf, rateOf);

    const copperIngot = plan.groups.find((g) => g.itemId === COPPER_INGOT)!;
    // 铜锭组：4 台冶炼站、总产 120（保持正确）。
    expect(copperIngot.machineCount).toBe(4);
    expect(copperIngot.totalRate).toBeCloseTo(120, 6);
    const oreIn = copperIngot.inputs.find((i) => i.itemId === ORE_COPPER)!;
    // 修复前：totalFlow=20 / perMachineFlow=5；修复后应为 120 / 30。
    expect(oreIn.totalFlow).toBeCloseTo(120, 6);
    expect(oreIn.perMachineFlow).toBeCloseTo(30, 6);

    const wire = plan.groups.find((g) => g.itemId === WIRE)!;
    // 线材组：8 台、总产 240（被电缆 + 定子两处消费）。
    expect(wire.machineCount).toBe(8);
    expect(wire.totalRate).toBeCloseTo(240, 6);
    const ingotIn = wire.inputs.find((i) => i.itemId === COPPER_INGOT)!;
    // 修复前：totalFlow=20 / perMachineFlow=2.5（截图里的 2.5）；修复后应为 120 / 15。
    expect(ingotIn.totalFlow).toBeCloseTo(120, 6);
    expect(ingotIn.perMachineFlow).toBeCloseTo(15, 6);

    // 全组一致性：每条输入 = 组总产 × 配方用量比，每台 = 总流量 / 台数。
    expectFlowMatchesRecipeRatio(plan);
  });

  it('反向 / 自动路线：多消费者中间产物的输入流量同样按全组聚合', () => {
    const { r, machineCountOf, rateOf } = reverseLookups(WIRING, 10);
    const plan = computeBlueprint(r.tree, machineCountOf, rateOf);

    const wire = plan.groups.find((g) => g.itemId === WIRE)!;
    // 线材被电缆 + 定子消费，总产 480；喂它的铜锭应为 480 × (1/2) = 240（非单条支路）。
    expect(wire.totalRate).toBeCloseTo(480, 6);
    const ingotIn = wire.inputs.find((i) => i.itemId === COPPER_INGOT)!;
    expect(ingotIn.totalFlow).toBeCloseTo(240, 6);

    const copperIngot = plan.groups.find((g) => g.itemId === COPPER_INGOT)!;
    const oreIn = copperIngot.inputs.find((i) => i.itemId === ORE_COPPER)!;
    expect(oreIn.totalFlow).toBeCloseTo(240, 6);

    // 反向取向下同样满足全组一致性（验收：不破坏反向配平）。
    expectFlowMatchesRecipeRatio(plan);
  });
});
