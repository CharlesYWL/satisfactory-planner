import { useTranslation } from 'react-i18next';
import { gameData } from './lib';
import FlowGraph from './components/FlowGraph';
import SidePanel from './components/panel/SidePanel';
import { usePlanner, usePlannerDerived } from './store/plannerStore';

/**
 * M3 主页面：左侧 M2 生产链流程图，右侧交互配置面板（产出 / 原料 / 选项）。
 *
 * 全局状态由 Zustand（src/store/plannerStore）统一管理：任意输入变化 → 派生结果重算
 * → FlowGraph 实时重渲染。算法层（src/lib）与 M2 渲染层（FlowGraph）保持复用、不改写。
 */
export default function App() {
  const { t } = useTranslation();
  const mode = usePlanner((s) => s.mode);
  const targetItemId = usePlanner((s) => s.targetItemId);
  const direction = usePlanner((s) => s.direction);
  const detail = usePlanner((s) => s.detail);
  const logistics = usePlanner((s) => s.logistics);
  const derived = usePlannerDerived();

  // 结构性变化（目标 / 取向 / 方向 / 详细物流）时 remount 以重新 fitView；
  // 速率 / 配方 / 供给 / 详略变化则原地更新，平滑不抖动。
  const graphKey = `${targetItemId}-${mode}-${direction}-${logistics ? 'logi' : 'plain'}`;

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">
          Better <span>Satisfactory</span> Planner
        </h1>
        <span className="app__subtitle">{t('app.subtitle')}</span>
      </header>

      <div className="app__split">
        <main className="app__canvas">
          <FlowGraph
            key={graphKey}
            result={derived.graph}
            data={gameData}
            direction={direction}
            detail={detail}
            logistics={logistics}
          />
        </main>
        <SidePanel />
      </div>
    </div>
  );
}
