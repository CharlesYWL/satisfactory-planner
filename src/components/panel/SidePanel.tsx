import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import InputTab from './InputTab';
import OptionsTab from './OptionsTab';
import OutputTab from './OutputTab';

type TabKey = 'output' | 'input' | 'options';

const TABS: TabKey[] = ['output', 'input', 'options'];

/** 右侧交互配置面板：产出 / 原料 / 选项 三 Tab（切换用本地 state），整体可收起成窄边栏。 */
export default function SidePanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('output');
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="panel panel--collapsed">
        <button
          type="button"
          className="panel__handle"
          title={t('panel.expand')}
          aria-label={t('panel.expand')}
          onClick={() => setCollapsed(false)}
        >
          <span className="panel__handle-arrow">‹</span>
          <span className="panel__handle-text">{t('panel.expand')}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="panel">
      <div className="panel__tabs">
        {TABS.map((key) => (
          <button
            key={key}
            className={`panel__tab-btn ${tab === key ? 'panel__tab-btn--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {t(`panel.tab.${key}`)}
          </button>
        ))}
        <button
          type="button"
          className="panel__collapse-btn"
          title={t('panel.collapse')}
          aria-label={t('panel.collapse')}
          onClick={() => setCollapsed(true)}
        >
          ›
        </button>
      </div>
      <div className="panel__body">
        {tab === 'output' ? <OutputTab /> : null}
        {tab === 'input' ? <InputTab /> : null}
        {tab === 'options' ? <OptionsTab /> : null}
      </div>
    </aside>
  );
}
