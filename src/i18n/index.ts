import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './ui';
import { normalizeLang, type Lang } from './names';

const STORAGE_KEY = 'sf-planner-lang';

/** 安全读取持久化语言：localStorage 不可用 / 抛错时静默返回 null。 */
function readSavedLang(): string | null {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      return localStorage.getItem(STORAGE_KEY);
    }
  } catch {
    /* localStorage 被禁用（隐私模式等）→ 忽略 */
  }
  return null;
}

/** 安全写入持久化语言。 */
function saveLang(lang: Lang): void {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(STORAGE_KEY, lang);
    }
  } catch {
    /* 忽略写入失败 */
  }
}

/** 读取持久化语言；默认中文（首次访问 / 无存储时）。 */
function initialLang(): Lang {
  const saved = readSavedLang();
  return saved ? normalizeLang(saved) : 'zh';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** 切换界面语言并持久化（'zh' / 'en'）。 */
export function setLang(lang: Lang): void {
  void i18n.changeLanguage(lang);
  saveLang(lang);
}

export default i18n;
export * from './names';
