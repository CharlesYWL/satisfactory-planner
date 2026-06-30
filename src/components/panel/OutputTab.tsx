import { useState } from 'react';
import { gameData } from '../../lib';
import { usePlanner, usePlannerDerived } from '../../store/plannerStore';
import { formatRate } from '../nodes';
import ItemPickerDialog from './ItemPickerDialog';
import RecipePicker from './RecipePicker';

/** 产出 Tab：选目标产品 + 模式切换 + 产量/min（反向）+ 替代配方选择。 */
export default function OutputTab() {
  const targetItemId = usePlanner((s) => s.targetItemId);
  const mode = usePlanner((s) => s.mode);
  const setMode = usePlanner((s) => s.setMode);
  const targetRate = usePlanner((s) => s.targetRate);
  const setTargetRate = usePlanner((s) => s.setTargetRate);
  const derived = usePlannerDerived();

  const [pickerOpen, setPickerOpen] = useState(false);

  const targetItem = gameData.items[targetItemId];
  const targetName = targetItem?.name ?? targetItemId;

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
        <button
          type="button"
          className="item-trigger"
          onClick={() => setPickerOpen(true)}
          title="点击选择目标产品"
        >
          <span className="item-trigger__icon">
            {targetItem?.image ? (
              <img src={targetItem.image} alt="" />
            ) : (
              <span className="item-trigger__icon-fallback" aria-hidden="true">
                {targetName.charAt(0)}
              </span>
            )}
          </span>
          <span className="item-trigger__name">{targetName}</span>
          <span className="item-trigger__chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        <p className="panel__hint">点击从图片网格中选择目标产品。</p>
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

      {pickerOpen ? <ItemPickerDialog onClose={() => setPickerOpen(false)} /> : null}
    </div>
  );
}
