/**
 * URL ⇄ 规划状态编解码器（纯函数，无副作用、不碰 window / store / i18n 实例）。
 *
 * 设计（已与 Charles 拍板）：
 * - URL 格式 = query string（可读、可手改、易调试），不做压缩 hash。
 * - id 用完整形式（`Desc_Stator_C` / `Recipe_..._C`），不做简写映射。
 * - 只写入与默认值不同的字段：等于默认的字段省略，URL 尽量短。
 * - `supplies` / `recipeOverrides` 是 map，用带前缀的重复 key 表达：
 *   `s.<itemId>=<rate>`、`r.<itemId>=<recipeId>`，每项独立可读。
 * - 解析时类型转换 + 范围钳制（rate≥1、clock 1~2.5）+ 非法/未知值丢弃回退默认。
 * - lang 独立于 store（读写 i18n），这里只负责 query key 的读写。
 */

import { MAX_CLOCK, MIN_CLOCK, gameData, type RecipeOverrides } from '../lib';
import type { PlannerMode, FlowDirection, ViewMode, PlannerState } from './plannerStore';
import type { DetailLevel } from '../components/nodes';
import type { Lang } from '../i18n/names';

/** 参与 URL 序列化的 store 输入子集（不含 setter 与派生视图）。 */
export interface SerializablePlannerState {
  targetItemId: string;
  mode: PlannerMode;
  targetRate: number;
  supplies: Record<string, number>;
  recipeOverrides: RecipeOverrides;
  overclockEnabled: boolean;
  maxClock: number;
  direction: FlowDirection;
  detail: DetailLevel;
  logistics: boolean;
  viewMode: ViewMode;
}

/** 各字段默认值——必须与 plannerStore 的初始 state 保持一致。 */
export const URL_STATE_DEFAULTS: SerializablePlannerState = {
  targetItemId: 'Desc_Stator_C',
  mode: 'reverse',
  targetRate: 5,
  supplies: {},
  recipeOverrides: {},
  overclockEnabled: false,
  maxClock: MAX_CLOCK,
  direction: 'LR',
  detail: 'detailed',
  logistics: false,
  viewMode: 'topology',
};

/** lang 默认值（首次访问 / 无存储时的界面语言）。 */
export const DEFAULT_LANG: Lang = 'zh';

const SUPPLY_PREFIX = 's.';
const RECIPE_PREFIX = 'r.';

/** 从完整 store state 中摘出可序列化的输入子集。 */
export function pickSerializable(state: PlannerState): SerializablePlannerState {
  return {
    targetItemId: state.targetItemId,
    mode: state.mode,
    targetRate: state.targetRate,
    supplies: state.supplies,
    recipeOverrides: state.recipeOverrides,
    overclockEnabled: state.overclockEnabled,
    maxClock: state.maxClock,
    direction: state.direction,
    detail: state.detail,
    logistics: state.logistics,
    viewMode: state.viewMode,
  };
}

function isKnownItem(itemId: string): boolean {
  return Object.prototype.hasOwnProperty.call(gameData.items, itemId);
}

function isKnownRecipe(recipeId: string): boolean {
  return Object.prototype.hasOwnProperty.call(gameData.recipes, recipeId);
}

/** 数字转干净字符串（整数不带小数点，小数原样，避免浮点噪声）。 */
function numStr(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
}

/** '1'/'true' → true，'0'/'false' → false，其余 → undefined（丢弃回退默认）。 */
function parseBool(raw: string | null): boolean | undefined {
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return undefined;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 把状态编码为 URLSearchParams：只写入与默认值不同的字段；
 * map 字段展开成多个 `s.*` / `r.*` 参数；lang 非默认时写入 `lang`。
 */
export function encodeStateToParams(
  state: SerializablePlannerState,
  lang: Lang = DEFAULT_LANG,
): URLSearchParams {
  const params = new URLSearchParams();
  const d = URL_STATE_DEFAULTS;

  if (state.targetItemId !== d.targetItemId) params.set('target', state.targetItemId);
  if (state.mode !== d.mode) params.set('mode', state.mode);
  if (state.targetRate !== d.targetRate) params.set('rate', numStr(state.targetRate));
  if (state.overclockEnabled !== d.overclockEnabled) {
    params.set('over', state.overclockEnabled ? '1' : '0');
  }
  if (state.maxClock !== d.maxClock) params.set('clock', numStr(state.maxClock));

  for (const [itemId, rate] of Object.entries(state.supplies)) {
    params.append(`${SUPPLY_PREFIX}${itemId}`, numStr(rate));
  }
  for (const [itemId, recipeId] of Object.entries(state.recipeOverrides)) {
    params.append(`${RECIPE_PREFIX}${itemId}`, recipeId);
  }

  if (state.viewMode !== d.viewMode) params.set('view', state.viewMode);
  if (state.direction !== d.direction) params.set('dir', state.direction);
  if (state.detail !== d.detail) params.set('detail', state.detail);
  if (state.logistics !== d.logistics) params.set('logi', state.logistics ? '1' : '0');

  if (lang !== DEFAULT_LANG) params.set('lang', lang);

  return params;
}

/**
 * 把 URLSearchParams 解析为状态覆盖（Partial）：类型转换 + 范围钳制 +
 * 非法/未知值丢弃。返回的字段可直接合并进 store（缺省字段沿用 store 默认）。
 * lang 不在此处返回——用 {@link decodeLang} 单独读取（它进 i18n 而非 store）。
 */
export function decodeParamsToState(
  params: URLSearchParams,
): Partial<SerializablePlannerState> {
  const out: Partial<SerializablePlannerState> = {};

  const target = params.get('target');
  if (target && isKnownItem(target)) out.targetItemId = target;

  const mode = params.get('mode');
  if (mode === 'reverse' || mode === 'forward') out.mode = mode;

  const rate = params.get('rate');
  if (rate != null) {
    const n = Number.parseInt(rate, 10);
    if (Number.isFinite(n)) out.targetRate = Math.max(1, n);
  }

  const supplies: Record<string, number> = {};
  let hasSupply = false;
  const overrides: RecipeOverrides = {};
  let hasOverride = false;
  for (const [key, val] of params.entries()) {
    if (key.startsWith(SUPPLY_PREFIX)) {
      const itemId = key.slice(SUPPLY_PREFIX.length);
      const n = Number(val);
      if (itemId && isKnownItem(itemId) && Number.isFinite(n) && n >= 0) {
        supplies[itemId] = n;
        hasSupply = true;
      }
    } else if (key.startsWith(RECIPE_PREFIX)) {
      const itemId = key.slice(RECIPE_PREFIX.length);
      if (itemId && isKnownItem(itemId) && isKnownRecipe(val)) {
        overrides[itemId] = val;
        hasOverride = true;
      }
    }
  }
  if (hasSupply) out.supplies = supplies;
  if (hasOverride) out.recipeOverrides = overrides;

  const over = parseBool(params.get('over'));
  if (over !== undefined) out.overclockEnabled = over;

  const clock = params.get('clock');
  if (clock != null) {
    const n = Number.parseFloat(clock);
    if (Number.isFinite(n)) out.maxClock = clamp(n, MIN_CLOCK, MAX_CLOCK);
  }

  const view = params.get('view');
  if (view === 'topology' || view === 'blueprint') out.viewMode = view;

  const dir = params.get('dir');
  if (dir === 'LR' || dir === 'TB') out.direction = dir;

  const detail = params.get('detail');
  if (detail === 'simple' || detail === 'detailed') out.detail = detail;

  const logi = parseBool(params.get('logi'));
  if (logi !== undefined) out.logistics = logi;

  return out;
}

/** 读取 URL 中的界面语言（仅接受 'zh' / 'en'，其余回退 undefined = 用现有默认）。 */
export function decodeLang(params: URLSearchParams): Lang | undefined {
  const lang = params.get('lang');
  if (lang === 'zh' || lang === 'en') return lang;
  return undefined;
}
