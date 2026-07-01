import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gameData } from '../../lib';
import { itemName, useLang } from '../../i18n';
import { usePlanner, usePlannerDerived } from '../../store/plannerStore';
import { formatRate } from '../nodes';
import ItemPickerDialog from './ItemPickerDialog';
import RecipePicker from './RecipePicker';

/** 产出 Tab：选目标产品 + 模式切换 + 产量/min（反向）+ 替代配方选择。 */
export default function OutputTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const targetItemId = usePlanner((s) => s.targetItemId);
  const mode = usePlanner((s) => s.mode);
  const setMode = usePlanner((s) => s.setMode);
  const targetRate = usePlanner((s) => s.targetRate);
  const setTargetRate = usePlanner((s) => s.setTargetRate);
  const derived = usePlannerDerived();

  const [pickerOpen, setPickerOpen] = useState(false);

  const targetItem = gameData.items[targetItemId];
  const targetName = itemName(targetItemId, lang);

  return (
    <div className="panel__tab">
      <section className="panel__section">
        <h3 className="panel__section-title">{t('output.modeTitle')}</h3>
        <div className="seg">
          <button
            className={`seg__btn ${mode === 'reverse' ? 'seg__btn--active' : ''}`}
            onClick={() => setMode('reverse')}
          >
            {t('output.modeReverse')}
          </button>
          <button
            className={`seg__btn ${mode === 'forward' ? 'seg__btn--active' : ''}`}
            onClick={() => setMode('forward')}
          >
            {t('output.modeForward')}
          </button>
        </div>
        <p className="panel__hint">
          {mode === 'reverse' ? t('output.modeHintReverse') : t('output.modeHintForward')}
        </p>
      </section>

      <section className="panel__section">
        <h3 className="panel__section-title">{t('output.targetTitle')}</h3>
        <button
          type="button"
          className="item-trigger"
          onClick={() => setPickerOpen(true)}
          title={t('output.targetTrigger')}
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
        <p className="panel__hint">{t('output.targetHint')}</p>
      </section>

      <section className="panel__section">
        {mode === 'reverse' ? (
          <>
            <h3 className="panel__section-title">{t('output.targetRateTitle')}</h3>
            <label className="panel__field">
              <input
                className="panel__input panel__input--num"
                type="number"
                min={1}
                step={1}
                value={targetRate}
                onChange={(e) => setTargetRate(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              />
              <span className="panel__unit">/min</span>
            </label>
          </>
        ) : (
          <>
            <h3 className="panel__section-title">{t('output.actualRateTitle')}</h3>
            <div className="panel__readout">
              {formatRate(derived.graph.targetRate)} <small>/min</small>
            </div>
            <p className="panel__hint">{t('output.actualRateHint')}</p>
          </>
        )}
      </section>

      <section className="panel__section">
        <h3 className="panel__section-title">{t('output.altTitle')}</h3>
        <p className="panel__hint">{t('output.altHint')}</p>
        <RecipePicker />
      </section>

      {pickerOpen ? <ItemPickerDialog onClose={() => setPickerOpen(false)} /> : null}
    </div>
  );
}
