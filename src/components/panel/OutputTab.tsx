import { useMemo, useState } from 'react';
import { gameData } from '../../lib';
import { usePlanner, usePlannerDerived } from '../../store/plannerStore';
import { formatRate } from '../nodes';
import RecipePicker from './RecipePicker';

/** 全部「可生产」物品（有配方且非原矿），按名称排序——作为目标产品候选。 */
const PRODUCIBLE_ITEMS = Object.keys(gameData.producers)
  .filter((id) => (gameData.producers[id]?.length ?? 0) > 0 && !gameData.items[id]?.isRaw)
  .map((id) => ({ id, name: gameData.items[id]?.name ?? id }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** 产出 Tab：选目标产品 + 模式切换 + 产量/min（反向）+ 替代配方选择。 */
export default function OutputTab() {
  const targetItemId = usePlanner((s) => s.targetItemId);
  const setTargetItemId = usePlanner((s) => s.setTargetItemId);
  const mode = usePlanner((s) => s.mode);
  const setMode = usePlanner((s) => s.setMode);
  const targetRate = usePlanner((s) => s.targetRate);
  const setTargetRate = usePlanner((s) => s.setTargetRate);
  const derived = usePlannerDerived();

  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? PRODUCIBLE_ITEMS.filter((it) => it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q))
      : PRODUCIBLE_ITEMS;
    // 始终保证当前选中项在列表里（即便被搜索过滤掉）。
    if (!list.some((it) => it.id === targetItemId)) {
      const cur = PRODUCIBLE_ITEMS.find((it) => it.id === targetItemId);
      if (cur) return [cur, ...list];
    }
    return list;
  }, [query, targetItemId]);

  return (
    <div className="panel__tab">
      <section className="panel__section">
        <h3 className="panel__section-title">配平取向</h3>
        <div className="seg">
          <button
            className={`seg__btn ${mode === 'reverse' ? 'seg__btn--active' : ''}`}
            onClick={() => setMode('reverse')}
          >
            成品取向
          </button>
          <button
            className={`seg__btn ${mode === 'forward' ? 'seg__btn--active' : ''}`}
            onClick={() => setMode('forward')}
          >
            产线取向
          </button>
        </div>
        <p className="panel__hint">
          {mode === 'reverse'
            ? '给定目标产量，倒推完整生产树与原矿需求。'
            : '给定原料供给（原料 Tab），正向算出实际产量与瓶颈。'}
        </p>
      </section>

      <section className="panel__section">
        <h3 className="panel__section-title">目标产品</h3>
        <input
          className="panel__input"
          type="text"
          placeholder="搜索物品…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="panel__select panel__select--list"
          size={8}
          value={targetItemId}
          onChange={(e) => setTargetItemId(e.target.value)}
        >
          {options.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
            </option>
          ))}
        </select>
        <p className="panel__hint">{options.length} 个可生产物品</p>
      </section>

      <section className="panel__section">
        {mode === 'reverse' ? (
          <>
            <h3 className="panel__section-title">目标产量</h3>
            <label className="panel__field">
              <input
                className="panel__input panel__input--num"
                type="number"
                min={0.1}
                step={0.5}
                value={targetRate}
                onChange={(e) => setTargetRate(Number(e.target.value) || 0.1)}
              />
              <span className="panel__unit">/min</span>
            </label>
          </>
        ) : (
          <>
            <h3 className="panel__section-title">实际产量</h3>
            <div className="panel__readout">
              {formatRate(derived.graph.targetRate)} <small>/min</small>
            </div>
            <p className="panel__hint">由原料 Tab 的供给与瓶颈决定。</p>
          </>
        )}
      </section>

      <section className="panel__section">
        <h3 className="panel__section-title">替代配方</h3>
        <p className="panel__hint">仅列出当前产线相关的候选配方（★ = 替代）。换配方后图与原料随之更新。</p>
        <RecipePicker />
      </section>
    </div>
  );
}
