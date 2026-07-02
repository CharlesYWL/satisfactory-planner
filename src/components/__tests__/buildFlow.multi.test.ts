import { describe, it, expect } from 'vitest';
import { balanceReverse, balanceReverseMulti } from '../../lib';
import { buildFlow, reverseMultiToGraph } from '../buildFlow';

const STATOR = 'Desc_Stator_C';
const CABLE = 'Desc_Cable_C';
const WIRE = 'Desc_Wire_C';
const ORE_COPPER = 'Desc_OreCopper_C';

describe('buildFlow 多目标（共享产线）图层', () => {
  const multi = balanceReverseMulti([
    { itemId: STATOR, rate: 5 },
    { itemId: CABLE, rate: 30 },
  ]);
  const graph = reverseMultiToGraph(multi);
  const { nodes, edges } = buildFlow(graph);

  it('共享中间产物只生成一个节点（按 itemId 去重合并）', () => {
    expect(nodes.filter((n) => n.id === WIRE)).toHaveLength(1);
    // 虚拟 super-root 不渲染。
    expect(nodes.some((n) => n.id === '__targets__')).toBe(false);
  });

  it('两个成品都高亮为 product 变体', () => {
    const stator = nodes.find((n) => n.id === STATOR);
    const cable = nodes.find((n) => n.id === CABLE);
    expect(stator?.type).toBe('machine');
    expect(cable?.type).toBe('machine');
    expect((stator?.data as { variant?: string }).variant).toBe('product');
    expect((cable?.data as { variant?: string }).variant).toBe('product');
  });

  it('共享节点产量 = 两目标需求之和', () => {
    const a = balanceReverse(STATOR, 5);
    const b = balanceReverse(CABLE, 30);
    const wire = nodes.find((n) => n.id === WIRE);
    const expected =
      a.machines.find((m) => m.itemId === WIRE)!.rate +
      b.machines.find((m) => m.itemId === WIRE)!.rate;
    expect((wire?.data as { rate: number }).rate).toBeCloseTo(expected, 6);
  });

  it('共享原矿的输入流量 = 两目标之和（对标铜矿石流量修法）', () => {
    const a = balanceReverse(STATOR, 5);
    const b = balanceReverse(CABLE, 30);
    const oreNode = nodes.find((n) => n.id === ORE_COPPER && n.type === 'resource');
    const expected = a.rawTotals[ORE_COPPER] + b.rawTotals[ORE_COPPER];
    expect((oreNode?.data as { rate: number }).rate).toBeCloseTo(expected, 6);

    // 边 CopperIngot→Wire 的流量标签也应为跨目标累加后的总量。
    const wireInEdge = edges.find((e) => e.id === 'Desc_CopperIngot_C->Desc_Wire_C');
    expect(wireInEdge).toBeDefined();
  });
});
