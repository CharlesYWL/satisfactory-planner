/**
 * URL ⇄ store 实时同步的副作用装配层（读 window / 写 history / 订阅 store + i18n）。
 *
 * - {@link initStateFromUrl}：页面加载时把 URL 解析结果一次性注入 store（直接 setState
 *   整体注入，绕过 setTargetItemId 的副作用——先 target 再 overrides/supplies 的顺序问题
 *   由「整体合并」天然规避），并把 lang 应用到 i18n。
 * - {@link startUrlSync}：订阅 store 与 i18n 语言变化，debounce 后用 history.replaceState
 *   更新地址栏（不 pushState，不污染后退键）。
 *
 * 纯编解码逻辑在 {@link ./urlState}，此文件只负责「接线」。
 */

import { usePlanner } from './plannerStore';
import i18n, { normalizeLang, setLang } from '../i18n';
import {
  decodeLang,
  decodeParamsToState,
  encodeStateToParams,
  pickSerializable,
} from './urlState';

const WRITE_DEBOUNCE_MS = 150;

/** 页面加载时从 URL 初始化 store 与界面语言（只在有 window 时生效）。 */
export function initStateFromUrl(search?: string): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(search ?? window.location.search);

  const partial = decodeParamsToState(params);
  if (Object.keys(partial).length > 0) {
    // 整体注入而非逐个 setter：避免 setTargetItemId 清掉随后要设的 overrides/supplies。
    usePlanner.setState(partial);
  }

  const lang = decodeLang(params);
  if (lang) setLang(lang);
}

/** 用当前 store + 语言重写地址栏 query（保留 path 与 hash，只换 search）。 */
function writeUrl(): void {
  if (typeof window === 'undefined') return;
  const state = pickSerializable(usePlanner.getState());
  const lang = normalizeLang(i18n.language);
  const query = encodeStateToParams(state, lang).toString();
  const { pathname, hash } = window.location;
  const url = (query ? `${pathname}?${query}` : pathname) + hash;
  window.history.replaceState(null, '', url);
}

/**
 * 订阅 store 与语言变化，debounce 后把状态同步进 URL。
 * 返回停止函数（解绑订阅、清理定时器）——通常整个页面生命周期不需要调用。
 */
export function startUrlSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(writeUrl, WRITE_DEBOUNCE_MS);
  };

  const unsubStore = usePlanner.subscribe(schedule);
  i18n.on('languageChanged', schedule);

  return () => {
    if (timer) clearTimeout(timer);
    unsubStore();
    i18n.off('languageChanged', schedule);
  };
}
