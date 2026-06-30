import { describe, it, expect, afterAll } from 'vitest';
import i18n from '../index';

/**
 * 实例级集成校验：默认中文，changeLanguage 后 t() 立即返回另一语言文案，
 * 以及插值与缺失 key 的优雅回退——对应「默认中文 / 可切换 / 优雅回退」三条验收。
 */
describe('i18n 运行时切换', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh');
  });

  it('默认中文', () => {
    expect(i18n.language).toBe('zh');
    expect(i18n.t('panel.tab.output')).toBe('产出');
    expect(i18n.t('options.languageTitle')).toBe('语言');
  });

  it('切到英文后 t() 返回英文', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('panel.tab.output')).toBe('Output');
    expect(i18n.t('graph.totalPower')).toBe('Total power');
  });

  it('插值占位生效', async () => {
    await i18n.changeLanguage('zh');
    expect(i18n.t('input.suggestBelt', { mark: 'Mk3' })).toBe('建议带速 Mk3');
    expect(i18n.t('node.tipPower', { power: 47, count: 1 })).toBe('功耗 47MW（1 台）');
  });

  it('未知 key 不抛错', () => {
    expect(() => i18n.t('does.not.exist')).not.toThrow();
  });
});
