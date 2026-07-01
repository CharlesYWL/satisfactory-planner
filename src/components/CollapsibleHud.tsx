import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface CollapsibleHudProps {
  /** 面板标题（也用作收起后的悬浮 tooltip）。 */
  title: string;
  /** 收起后 chip 上显示的图标 / 短标（语言无关的字形）。 */
  chip: string;
  /** 附加在 sf-hud 上的类名（如 'sf-hud--power'）。 */
  className?: string;
  /** 默认是否收起（默认展开）。 */
  defaultCollapsed?: boolean;
  children: ReactNode;
}

/**
 * 可折叠的浮层 HUD 面板：展开时右上角有折叠按钮；收起后只剩一个小 chip 按钮
 * （图标 + tooltip），点击复原。用于施工图 / 拓扑图画布上的角落信息面板，
 * 让用户随时腾出画布空间。折叠状态为组件本地 state，切视图时回到默认展开。
 */
export default function CollapsibleHud({
  title,
  chip,
  className,
  defaultCollapsed = false,
  children,
}: CollapsibleHudProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (collapsed) {
    return (
      <button
        type="button"
        className="sf-hud sf-hud--chip nodrag nopan"
        title={`${title} · ${t('hud.expand')}`}
        aria-label={`${title} · ${t('hud.expand')}`}
        onClick={() => setCollapsed(false)}
      >
        <span className="sf-hud__chip-glyph">{chip}</span>
      </button>
    );
  }

  return (
    <div className={`sf-hud${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="sf-hud__collapse nodrag nopan"
        title={t('hud.collapse')}
        aria-label={t('hud.collapse')}
        onClick={() => setCollapsed(true)}
      >
        –
      </button>
      {children}
    </div>
  );
}
