import { useMemo } from 'react';
import { balanceForward, balanceReverse, gameData } from './lib';

/**
 * 占位骨架页面（M1 只做算法层）。
 * 这里跑一个反向配平的小例子，证明算法库在浏览器里也能直接调用。
 * 真正的流程图 UI 在 M2 里实现。
 */
export default function App() {
  const reverse = useMemo(() => balanceReverse('Desc_Stator_C', 5), []);
  const forward = useMemo(
    () =>
      balanceForward('Desc_Stator_C', {
        Desc_SteelPipe_C: 15,
        Desc_Wire_C: 40,
      }),
    [],
  );

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 720 }}>
      <h1>Better Satisfactory Planner</h1>
      <p>
        数据分支：<strong>{gameData.branch}</strong> · 物品 {Object.keys(gameData.items).length} · 配方{' '}
        {Object.keys(gameData.recipes).length}
      </p>

      <h2>反向：5 定子/min</h2>
      <p>总功耗 {reverse.totalPower} MW</p>
      <ul>
        {reverse.machines.map((m) => (
          <li key={m.itemId}>
            {gameData.items[m.itemId]?.name ?? m.itemId}: {m.machineCount.toFixed(2)} 台（建造{' '}
            {m.machineCountInteger}）
          </li>
        ))}
      </ul>
      <p>
        原矿：
        {Object.entries(reverse.rawTotals)
          .map(([id, rate]) => `${gameData.items[id]?.name ?? id} ${rate}/min`)
          .join('，')}
      </p>

      <h2>正向：钢管 15 + 线材 40</h2>
      <p>
        实际产出 {forward.targetOutput} 定子/min，瓶颈：
        {forward.bottlenecks.map((id) => gameData.items[id]?.name ?? id).join('、') || '无'}
      </p>
    </main>
  );
}
