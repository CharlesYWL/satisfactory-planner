import { useMemo, useState } from 'react';
import { balanceReverse, gameData } from './lib';
import FlowGraph from './components/FlowGraph';

/** Demo 预设目标产线（仅为演示 M2 流程图，真正的交互面板在 M3）。 */
const PRESETS = [
  { itemId: 'Desc_Stator_C', label: 'Stator 定子' },
  { itemId: 'Desc_Rotor_C', label: 'Rotor 转子' },
  { itemId: 'Desc_ModularFrame_C', label: 'Modular Frame 模块化框架' },
  { itemId: 'Desc_IronPlateReinforced_C', label: 'Reinforced Iron Plate 强化铁板' },
  { itemId: 'Desc_Motor_C', label: 'Motor 电动机' },
  { itemId: 'Desc_Computer_C', label: 'Computer 计算机' },
] as const;

/**
 * M2 Demo 页面：给定一个目标成品 + 产量/min，调用 M1 反向配平算法，
 * 把完整生产链渲染成可拖拽 / 缩放 / 平移的流程图。
 */
export default function App() {
  const [itemId, setItemId] = useState<string>(PRESETS[0].itemId);
  const [rate, setRate] = useState<number>(5);

  const result = useMemo(() => balanceReverse(itemId, rate), [itemId, rate]);

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">
          Better <span>Satisfactory</span> Planner
        </h1>
        <span className="app__subtitle">M2 · 生产链流程图</span>
        <div className="app__spacer" />
        <label className="app__control">
          目标
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.itemId} value={p.itemId}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="app__control">
          产量
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={rate}
            onChange={(e) => setRate(Math.max(0.1, Number(e.target.value) || 0.1))}
          />
          /min
        </label>
      </header>

      <main className="app__canvas">
        <FlowGraph key={itemId} result={result} data={gameData} />
      </main>
    </div>
  );
}
