import { useState } from 'react';
import InputTab from './InputTab';
import OptionsTab from './OptionsTab';
import OutputTab from './OutputTab';

type TabKey = 'output' | 'input' | 'options';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'output', label: '产出' },
  { key: 'input', label: '原料' },
  { key: 'options', label: '选项' },
];

/** 右侧交互配置面板：产出 / 原料 / 选项 三 Tab（切换用本地 state）。 */
export default function SidePanel() {
  const [tab, setTab] = useState<TabKey>('output');

  return (
    <aside className="panel">
      <div className="panel__tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`panel__tab-btn ${tab === t.key ? 'panel__tab-btn--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel__body">
        {tab === 'output' ? <OutputTab /> : null}
        {tab === 'input' ? <InputTab /> : null}
        {tab === 'options' ? <OptionsTab /> : null}
      </div>
    </aside>
  );
}
