import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gameData } from '../../lib';
import { itemName, useLang } from '../../i18n';
import { usePlanner, usePlannerDerived } from '../../store/plannerStore';
import { formatRate } from '../nodes';
import ItemPickerDialog from './ItemPickerDialog';
import RecipePicker from './RecipePicker';

/** 打开物品选择弹窗的场景：换某行目标 / 新增目标 / 正向换单目标。 */
type PickerState =
  | { kind: 'row'; index: number }
  | { kind: 'add' }
  | { kind: 'forward' }
  | null;

/** 单个目标的图标触发按钮（点击开物品选择弹窗）。 */
function TargetTrigger({
  itemId,
  title,
  onOpen,
}: {
  itemId: string;
  title: string;
  onOpen: () => void;
}) {
  const lang = useLang();
  const item = gameData.items[itemId];
  const name = itemName(itemId, lang);
  return (
    <button type="button" className="item-trigger" onClick={onOpen} title={title}>
      <span className="item-trigger__icon">
        {item?.image ? (
          <img src={item.image} alt="" />
        ) : (
          <span className="item-trigger__icon-fallback" aria-hidden="true">
            {name.charAt(0)}
          </span>
        )}
      </span>
      <span className="item-trigger__name">{name}</span>
      <span className="item-trigger__chevron" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}

/** 产出 Tab：模式切换 + 目标（反向可多目标）+ 产量/min + 替代配方选择。 */
export default function OutputTab() {
  const { t } = useTranslation();
  const mode = usePlanner((s) => s.mode);
  const setMode = usePlanner((s) => s.setMode);
  const targets = usePlanner((s) => s.targets);
  const addTarget = usePlanner((s) => s.addTarget);
  const removeTarget = usePlanner((s) => s.removeTarget);
  const setTargetItem = usePlanner((s) => s.setTargetItem);
  const setTargetRate = usePlanner((s) => s.setTargetRate);
  const derived = usePlannerDerived();

  const [picker, setPicker] = useState<PickerState>(null);

  const primary = targets[0];

  const onPick = (itemId: string) => {
    if (!picker) return;
    if (picker.kind === 'add') addTarget(itemId);
    else if (picker.kind === 'row') setTargetItem(picker.index, itemId);
    else setTargetItem(0, itemId); // forward：换唯一目标
  };

  const pickerSelectedId =
    picker?.kind === 'row'
      ? targets[picker.index]?.itemId
      : picker?.kind === 'forward'
        ? primary?.itemId
        : undefined;

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

      {mode === 'reverse' ? (
        <section className="panel__section">
          <h3 className="panel__section-title">{t('output.targetsTitle')}</h3>
          <p className="panel__hint">{t('output.targetsHint')}</p>
          <div className="target-list">
            {targets.map((target, index) => (
              <div className="target-row" key={`${target.itemId}-${index}`}>
                <TargetTrigger
                  itemId={target.itemId}
                  title={t('output.targetTrigger')}
                  onOpen={() => setPicker({ kind: 'row', index })}
                />
                <label className="target-row__rate">
                  <input
                    className="panel__input panel__input--num"
                    type="number"
                    min={1}
                    step={1}
                    value={target.rate}
                    onChange={(e) =>
                      setTargetRate(index, Math.max(1, Math.round(Number(e.target.value) || 1)))
                    }
                  />
                  <span className="panel__unit">/min</span>
                </label>
                <button
                  type="button"
                  className="target-row__remove"
                  title={t('output.removeTarget')}
                  aria-label={t('output.removeTarget')}
                  disabled={targets.length <= 1}
                  onClick={() => removeTarget(index)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="target-add"
            onClick={() => setPicker({ kind: 'add' })}
          >
            + {t('output.addTarget')}
          </button>
        </section>
      ) : (
        <>
          <section className="panel__section">
            <h3 className="panel__section-title">{t('output.targetTitle')}</h3>
            {primary ? (
              <TargetTrigger
                itemId={primary.itemId}
                title={t('output.targetTrigger')}
                onOpen={() => setPicker({ kind: 'forward' })}
              />
            ) : null}
            <p className="panel__hint">{t('output.targetHint')}</p>
          </section>

          <section className="panel__section">
            <h3 className="panel__section-title">{t('output.actualRateTitle')}</h3>
            <div className="panel__readout">
              {formatRate(derived.graph.targetRate)} <small>/min</small>
            </div>
            <p className="panel__hint">{t('output.actualRateHint')}</p>
          </section>
        </>
      )}

      <section className="panel__section">
        <h3 className="panel__section-title">{t('output.altTitle')}</h3>
        <p className="panel__hint">{t('output.altHint')}</p>
        <RecipePicker />
      </section>

      {picker ? (
        <ItemPickerDialog
          onClose={() => setPicker(null)}
          onPick={onPick}
          selectedId={pickerSelectedId}
        />
      ) : null}
    </div>
  );
}
