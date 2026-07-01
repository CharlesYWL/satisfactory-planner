import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel, useReactFlow } from '@xyflow/react';

export interface ReflowButtonProps {
  /** 重新应用自动布局：把（被拖乱的）节点位置恢复成算法布局。 */
  onReflow: () => void;
  /** fitView 内边距（各视图不同：拓扑 0.18 / 施工 0.14）。 */
  padding?: number;
}

/**
 * 左下角「自动排版」按钮：一键把拖乱的节点恢复成自动布局并重新 fitView。
 * 渲染在 <ReactFlow> 内（可用 useReactFlow），放在 Controls 正上方
 * （见 styles.css .sf-reflow-panel），不与左上信息面板 / 右下对账面板重叠。
 * 只影响节点位置，不改配平 / 边 / 数据。
 */
export default function ReflowButton({ onReflow, padding = 0.18 }: ReflowButtonProps) {
  const { t } = useTranslation();
  const { fitView } = useReactFlow();

  const handleClick = useCallback(() => {
    onReflow();
    // 位置更新提交到 store 后再 fitView（节点已存在且已测量，一帧即可）。
    requestAnimationFrame(() => {
      fitView({ padding, duration: 320 });
    });
  }, [onReflow, fitView, padding]);

  return (
    <Panel position="bottom-left" className="sf-reflow-panel">
      <button
        type="button"
        className="sf-reflow-btn"
        onClick={handleClick}
        title={t('graph.autoLayoutHint')}
        aria-label={t('graph.autoLayout')}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
          <rect x="1" y="1" width="6" height="6" rx="1.2" fill="currentColor" />
          <rect x="9" y="1" width="6" height="6" rx="1.2" fill="currentColor" opacity="0.6" />
          <rect x="1" y="9" width="6" height="6" rx="1.2" fill="currentColor" opacity="0.6" />
          <rect x="9" y="9" width="6" height="6" rx="1.2" fill="currentColor" />
        </svg>
        <span>{t('graph.autoLayout')}</span>
      </button>
    </Panel>
  );
}
