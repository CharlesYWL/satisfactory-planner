import { describe, it, expect } from 'vitest';
import {
  URL_STATE_DEFAULTS,
  decodeLang,
  decodeParamsToState,
  encodeStateToParams,
  type SerializablePlannerState,
} from '../urlState';

// 真实存在于 data.normalized.json 的 id（供校验通过）
const STATOR = 'Desc_Stator_C';
const MOTOR = 'Desc_Motor_C';
const SCREW = 'Desc_IronScrew_C';
const ORE_IRON = 'Desc_OreIron_C';
const ORE_COPPER = 'Desc_OreCopper_C';
const ALT_SCREW = 'Recipe_Alternate_Screw_C';
const ALT_STATOR = 'Recipe_Alternate_Stator_C';

/** 造一个「全部与默认不同」的状态，用于往返测试。 */
function nonDefaultState(): SerializablePlannerState {
  return {
    targets: [{ itemId: SCREW, rate: 42 }],
    mode: 'forward',
    supplies: { [ORE_IRON]: 120, [ORE_COPPER]: 60 },
    recipeOverrides: { [SCREW]: ALT_SCREW, [STATOR]: ALT_STATOR },
    overclockEnabled: true,
    maxClock: 2.0,
    direction: 'TB',
    detail: 'simple',
    logistics: true,
    viewMode: 'blueprint',
  };
}

describe('urlState 编解码', () => {
  it('默认值不出现在 URL（空串）', () => {
    const params = encodeStateToParams(URL_STATE_DEFAULTS, 'zh');
    expect(params.toString()).toBe('');
  });

  it('encode→decode 往返幂等（全非默认字段）', () => {
    const state = nonDefaultState();
    const decoded = decodeParamsToState(encodeStateToParams(state, 'zh'));
    expect(decoded).toEqual(state);
  });

  it('等于默认的字段被省略，只保留差异', () => {
    const state: SerializablePlannerState = {
      ...URL_STATE_DEFAULTS,
      targets: [{ itemId: SCREW, rate: 10 }],
    };
    const params = encodeStateToParams(state, 'zh');
    expect(params.get('targets')).toBe(`${SCREW}:10`);
    // 不再写旧单目标 key
    expect(params.has('target')).toBe(false);
    expect(params.has('rate')).toBe(false);
    // 其余默认字段不写入
    expect(params.has('mode')).toBe(false);
    expect(params.has('over')).toBe(false);
    expect(params.has('clock')).toBe(false);
    expect(params.has('view')).toBe(false);
    expect(params.has('dir')).toBe(false);
    expect(params.has('detail')).toBe(false);
    expect(params.has('logi')).toBe(false);
    expect(params.has('lang')).toBe(false);
    // decode 只返回差异字段
    expect(decodeParamsToState(params)).toEqual({
      targets: [{ itemId: SCREW, rate: 10 }],
    });
  });

  it('默认单目标（=默认）不写进 URL', () => {
    const params = encodeStateToParams(
      { ...URL_STATE_DEFAULTS, targets: [{ itemId: STATOR, rate: 5 }] },
      'zh',
    );
    expect(params.has('targets')).toBe(false);
  });

  it('多目标 targets round-trip 幂等（逗号分隔 itemId:rate）', () => {
    const state: SerializablePlannerState = {
      ...URL_STATE_DEFAULTS,
      targets: [
        { itemId: MOTOR, rate: 10 },
        { itemId: STATOR, rate: 5 },
      ],
    };
    const params = encodeStateToParams(state, 'zh');
    expect(params.get('targets')).toBe(`${MOTOR}:10,${STATOR}:5`);
    expect(decodeParamsToState(params)).toEqual({
      targets: [
        { itemId: MOTOR, rate: 10 },
        { itemId: STATOR, rate: 5 },
      ],
    });
  });

  it('向后兼容旧单目标 URL（target + rate → 单元素 targets）', () => {
    const params = new URLSearchParams();
    params.set('target', MOTOR);
    params.set('rate', '12');
    expect(decodeParamsToState(params)).toEqual({
      targets: [{ itemId: MOTOR, rate: 12 }],
    });
  });

  it('向后兼容：只有旧 rate（默认目标）→ 默认目标 + 该产量', () => {
    const decoded = decodeParamsToState(new URLSearchParams('rate=10'));
    expect(decoded.targets).toEqual([{ itemId: STATOR, rate: 10 }]);
  });

  it('向后兼容：旧 rate 钳制 ≥1、非数字丢弃', () => {
    expect(decodeParamsToState(new URLSearchParams('rate=0')).targets).toEqual([
      { itemId: STATOR, rate: 1 },
    ]);
    expect(decodeParamsToState(new URLSearchParams('rate=-5')).targets).toEqual([
      { itemId: STATOR, rate: 1 },
    ]);
    // 非数字：rate 丢弃且无 target → 不返回 targets
    expect(decodeParamsToState(new URLSearchParams('rate=abc')).targets).toBeUndefined();
  });

  it('targets 里非法/未知 itemId 丢弃；rate 钳制 ≥1 整数', () => {
    const params = new URLSearchParams();
    params.set('targets', `Desc_NotAnItem_C:5,${MOTOR}:0,${STATOR}:7`);
    // 未知项丢弃；MOTOR rate 0 → 1；STATOR 7
    expect(decodeParamsToState(params).targets).toEqual([
      { itemId: MOTOR, rate: 1 },
      { itemId: STATOR, rate: 7 },
    ]);
  });

  it('targets 全非法 → 不返回 targets（回退默认单目标）', () => {
    const params = new URLSearchParams();
    params.set('targets', 'Desc_NotAnItem_C:5,also-bad');
    expect(decodeParamsToState(params).targets).toBeUndefined();
  });

  it('targets 重复 itemId 合并（rate 相加）', () => {
    const params = new URLSearchParams();
    params.set('targets', `${MOTOR}:3,${MOTOR}:4`);
    expect(decodeParamsToState(params).targets).toEqual([{ itemId: MOTOR, rate: 7 }]);
  });

  it('supplies / recipeOverrides map 正确往返（多项）', () => {
    const state: SerializablePlannerState = {
      ...URL_STATE_DEFAULTS,
      supplies: { [ORE_IRON]: 120, [ORE_COPPER]: 60 },
      recipeOverrides: { [SCREW]: ALT_SCREW },
    };
    const params = encodeStateToParams(state, 'zh');
    expect(params.getAll(`s.${ORE_IRON}`)).toEqual(['120']);
    expect(params.get(`s.${ORE_COPPER}`)).toBe('60');
    expect(params.get(`r.${SCREW}`)).toBe(ALT_SCREW);

    const decoded = decodeParamsToState(params);
    expect(decoded.supplies).toEqual({ [ORE_IRON]: 120, [ORE_COPPER]: 60 });
    expect(decoded.recipeOverrides).toEqual({ [SCREW]: ALT_SCREW });
  });

  it('clock 钳制到 [1, 2.5]', () => {
    expect(decodeParamsToState(new URLSearchParams('clock=5')).maxClock).toBe(2.5);
    expect(decodeParamsToState(new URLSearchParams('clock=0.2')).maxClock).toBe(1.0);
    expect(decodeParamsToState(new URLSearchParams('clock=1.8')).maxClock).toBe(1.8);
    expect(decodeParamsToState(new URLSearchParams('clock=nope')).maxClock).toBeUndefined();
  });

  it('未知 / 非法值丢弃回退默认', () => {
    const params = new URLSearchParams();
    params.set('target', 'Desc_DoesNotExist_C');
    params.set('mode', 'sideways');
    params.set('view', 'isometric');
    params.set('dir', 'diagonal');
    params.set('detail', 'medium');
    params.set('over', 'maybe');
    params.set('logi', 'yes-please');
    params.append('s.Desc_NotAnItem_C', '10');
    params.append(`s.${ORE_IRON}`, 'not-a-number');
    params.append(`r.${STATOR}`, 'Recipe_NotReal_C');
    params.append('r.Desc_NotAnItem_C', ALT_SCREW);
    // 所有字段非法 → 空覆盖（无效 target 无 rate → 不产生 targets）
    expect(decodeParamsToState(params)).toEqual({});
  });

  it('负 supply 丢弃、0 supply 保留', () => {
    const params = new URLSearchParams();
    params.append(`s.${ORE_IRON}`, '-3');
    params.append(`s.${ORE_COPPER}`, '0');
    const decoded = decodeParamsToState(params);
    expect(decoded.supplies).toEqual({ [ORE_COPPER]: 0 });
  });

  it('bool 字段接受 1/0/true/false', () => {
    expect(decodeParamsToState(new URLSearchParams('over=1')).overclockEnabled).toBe(true);
    expect(decodeParamsToState(new URLSearchParams('over=0')).overclockEnabled).toBe(false);
    expect(decodeParamsToState(new URLSearchParams('logi=true')).logistics).toBe(true);
    expect(decodeParamsToState(new URLSearchParams('logi=false')).logistics).toBe(false);
  });

  it('lang 独立编解码（默认 zh 省略；en 写入并解析）', () => {
    expect(encodeStateToParams(URL_STATE_DEFAULTS, 'zh').has('lang')).toBe(false);
    const params = encodeStateToParams(URL_STATE_DEFAULTS, 'en');
    expect(params.get('lang')).toBe('en');
    expect(decodeLang(params)).toBe('en');
    // 缺省 / 非法 → undefined（沿用现有默认）
    expect(decodeLang(new URLSearchParams(''))).toBeUndefined();
    expect(decodeLang(new URLSearchParams('lang=fr'))).toBeUndefined();
    // lang 不进 store 覆盖
    expect(decodeParamsToState(new URLSearchParams('lang=en'))).toEqual({});
  });

  it('空 URL → 空覆盖（现有默认行为不变）', () => {
    expect(decodeParamsToState(new URLSearchParams(''))).toEqual({});
  });
});
