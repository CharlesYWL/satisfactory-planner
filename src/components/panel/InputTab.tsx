import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BELTS, suggestBelt, type ForwardInput } from '../../lib';
import { itemName, useLang, type Lang } from '../../i18n';
import {
  usePlanner,
  usePlannerDerived,
  useChainStructure,
} from '../../store/plannerStore';
import { formatRate } from '../nodes';

/** 某条供给的可调行：带速档位 60/120/270…/自定义 → 写进 store.supplies。 */
function SupplyRow({
  itemId,
  value,
  info,
  onChange,
  onRemove,
}: {
  itemId: string;
  value: number;
  info?: ForwardInput;
  onChange: (rate: number) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const matchedBelt = BELTS.find((b) => Math.abs(b.speed - value) < 1e-6);
  const [custom, setCustom] = useState(!matchedBelt);

  return (
    <div className={`supply-row ${info?.isBottleneck ? 'supply-row--bottleneck' : ''}`}>
      <div className="supply-row__head">
        <span className="supply-row__name">{itemName(itemId, lang)}</span>
        {onRemove ? (
          <button className="supply-row__x" title={t('input.remove')} onClick={onRemove}>
            ×
          </button>
        ) : null}
      </div>
      <div className="supply-row__controls">
        <select
          className="panel__select"
          value={custom ? 'custom' : matchedBelt?.mark ?? 'custom'}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setCustom(true);
              return;
            }
            const belt = BELTS.find((b) => b.mark === e.target.value);
            if (belt) {
              setCustom(false);
              onChange(belt.speed);
            }
          }}
        >
          {BELTS.map((b) => (
            <option key={b.mark} value={b.mark}>
              {b.mark} · {b.speed}/min
            </option>
          ))}
          <option value="custom">{t('input.custom')}</option>
        </select>
        {custom ? (
          <input
            className="panel__input panel__input--num"
            type="number"
            min={0}
            step={1}
            value={value}
            onChange={(e) => onChange(Number(e.target.value) || 0)}
          />
        ) : null}
        <span className="panel__unit">/min</span>
      </div>
      {info ? (
        <div className="supply-row__info">
          {t('input.usage', {
            consumed: formatRate(info.consumed),
            leftover: formatRate(info.leftover),
          })}
          {info.isBottleneck ? t('input.bottleneckSuffix') : ''}
        </div>
      ) : null}
    </div>
  );
}

/** 原料 Tab：反向只读列出原矿需求；正向可调供给带速 + 把中间产物当作半成品边界。 */
export default function InputTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const mode = usePlanner((s) => s.mode);
  const supplies = usePlanner((s) => s.supplies);
  const setSupply = usePlanner((s) => s.setSupply);
  const removeSupply = usePlanner((s) => s.removeSupply);
  const targets = usePlanner((s) => s.targets);
  const targetItemId = targets[0]?.itemId;
  const derived = usePlannerDerived();
  const chain = useChainStructure();

  const byName = (l: Lang) => (a: string, b: string) =>
    itemName(a, l).localeCompare(itemName(b, l));

  if (mode === 'reverse') {
    const rows = Object.entries(derived.reverse?.rawTotals ?? {}).sort((a, b) => b[1] - a[1]);
    return (
      <div className="panel__tab">
        <section className="panel__section">
          <h3 className="panel__section-title">{t('input.rawTitle')}</h3>
          <p className="panel__hint">{t('input.rawHint')}</p>
          {rows.length === 0 ? (
            <p className="panel__hint">{t('input.rawNoUpstream')}</p>
          ) : (
            rows.map(([id, rate]) => (
              <div className="supply-row supply-row--readonly" key={id}>
                <div className="supply-row__head">
                  <span className="supply-row__name">{itemName(id, lang)}</span>
                  <span className="supply-row__rate">{formatRate(rate)}/min</span>
                </div>
                <div className="supply-row__info">
                  {t('input.suggestBelt', { mark: suggestBelt(rate).mark })}
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    );
  }

  // forward 模式
  const inputByItem = new Map((derived.forward?.inputs ?? []).map((i) => [i.itemId, i]));
  const rawIds = Object.keys(chain.rawTotals).sort(byName(lang));
  const intermediates = chain.machines
    .map((m) => m.itemId)
    .filter((id) => id !== targetItemId)
    .sort(byName(lang));

  return (
    <div className="panel__tab">
      <section className="panel__section">
        <h3 className="panel__section-title">{t('input.supplyTitle')}</h3>
        <p className="panel__hint">{t('input.supplyHint')}</p>
        {rawIds.map((id) => (
          <SupplyRow
            key={id}
            itemId={id}
            value={supplies[id] ?? 0}
            info={inputByItem.get(id)}
            onChange={(rate) => setSupply(id, rate)}
          />
        ))}
      </section>

      <section className="panel__section">
        <h3 className="panel__section-title">{t('input.boundaryTitle')}</h3>
        <p className="panel__hint">{t('input.boundaryHint')}</p>
        {intermediates.length === 0 ? (
          <p className="panel__hint">{t('input.boundaryNone')}</p>
        ) : (
          intermediates.map((id) => {
            const supplied = Object.prototype.hasOwnProperty.call(supplies, id);
            return (
              <div className="boundary" key={id}>
                <label className="boundary__toggle">
                  <input
                    type="checkbox"
                    checked={supplied}
                    onChange={(e) => {
                      if (e.target.checked) setSupply(id, BELTS[0].speed);
                      else removeSupply(id);
                    }}
                  />
                  {t('input.boundaryAsHave', { name: itemName(id, lang) })}
                </label>
                {supplied ? (
                  <SupplyRow
                    itemId={id}
                    value={supplies[id] ?? 0}
                    info={inputByItem.get(id)}
                    onChange={(rate) => setSupply(id, rate)}
                    onRemove={() => removeSupply(id)}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </section>

      {derived.forward && derived.forward.bottlenecks.length > 0 ? (
        <section className="panel__section">
          <h3 className="panel__section-title">{t('input.bottleneckTitle')}</h3>
          <p className="panel__hint">
            {t('input.bottleneckHint', {
              items: derived.forward.bottlenecks
                .map((id) => itemName(id, lang))
                .join(lang === 'zh' ? '、' : ', '),
            })}
          </p>
        </section>
      ) : null}
    </div>
  );
}
