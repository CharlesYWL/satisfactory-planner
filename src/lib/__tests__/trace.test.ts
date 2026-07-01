import { describe, it, expect } from 'vitest';
import { traceProduction, aggregateInputFlows } from '../index';

const WIRING = 'Desc_SpaceElevatorPart_3_C'; // 自动路线 Automated Wiring
const WIRE = 'Desc_Wire_C';
const COPPER_INGOT = 'Desc_CopperIngot_C';
const ORE_COPPER = 'Desc_OreCopper_C';
const CABLE = 'Desc_Cable_C';
const STATOR = 'Desc_Stator_C';

describe('aggregateInputFlows 多消费者输入流量聚合', () => {
  it('空树 → 查任何 pair 都是 undefined', () => {
    const flowOf = aggregateInputFlows(null);
    expect(flowOf('X', 'Y')).toBeUndefined();
  });

  it('同一中间产物被多个下游消费时，按 (目标,输入) 聚合出全组总流量', () => {
    // 自动路线：线材同时喂电缆(Cable)与定子(Stator)，故线材在树里出现多次，
    // 铜锭喂线材、铜矿喂铜锭同样出现多次。聚合后应得到真实总量，而非单条支路。
    const trace = traceProduction(WIRING, 10);
    const flowOf = aggregateInputFlows(trace.root);

    // 铜矿 → 铜锭：全组 240（此前只取到单条支路，会明显偏小）。
    expect(flowOf(COPPER_INGOT, ORE_COPPER)).toBeCloseTo(240, 6);
    // 铜锭 → 线材：全组 240（线材 480 × 1 铜锭 / 2 线材）。
    expect(flowOf(WIRE, COPPER_INGOT)).toBeCloseTo(240, 6);

    // 线材被两个不同配方消费 → 两条独立连接，各自是该连接的真实总流量。
    const wireToCable = flowOf(CABLE, WIRE)!;
    const wireToStator = flowOf(STATOR, WIRE)!;
    expect(wireToCable).toBeCloseTo(400, 6);
    expect(wireToStator).toBeCloseTo(80, 6);
    // 两条消费之和 = 线材总产量 480。
    expect(wireToCable + wireToStator).toBeCloseTo(480, 6);

    // 不存在的 pair → undefined（调用方回退单节点 rate）。
    expect(flowOf(ORE_COPPER, WIRE)).toBeUndefined();
  });
});
