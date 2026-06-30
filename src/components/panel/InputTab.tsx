import { useState } from 'react';
import { BELTS, gameData, suggestBelt, type ForwardInput } from '../../lib';
import {
  usePlanner,
  usePlannerDerived,
  useChainStructure,
} from '../../store/plannerStore';
import { formatRate } from '../nodes';

const itemName = (id: string) => gameData.items[id]?.name ?? id;

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
  const matchedBelt = BELTS.find((b) => Math.abs(b.speed - value) < 1e-6);
  const [custom, setCustom] = useState(!matchedBelt);

  return (
    <div className={`supply-row ${info?.isBottleneck ? 'supply-row--bottleneck' : ''}`}>
      <div className="supply-row__head">
        <span className="supply-row__name">{itemName(itemId)}</span>
        {onRemove ? (
          <button className="supply-row__x" title="移除" onClick={onRemove}>
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
          <option value="custom">自定义…</option>
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
          消耗 {formatRate(info.consumed)} · 剩余 {formatRate(info.leftover)}
          {info.isBottleneck ? ' · 瓶颈' : ''}
        </div>
      ) : null}
    </div>
  );
}

/** 原料 Tab：反向只读列出原矿需求；正向可调供给带速 + 把中间产物当作半成品边界。 */
export default function InputTab() {
  const mode = usePlanner((s) => s.mode);
  const supplies = usePlanner((s) => s.supplies);
  const setSupply = usePlanner((s) => s.setSupply);
  const removeSupply = usePlanner((s) => s.removeSupply);
  const targetItemId = usePlanner((s) => s.targetItemId);
  const derived = usePlannerDerived();
  const chain = useChainStructure();

  if (mode === 'reverse') {
    const rows = Object.entries(derived.reverse?.rawTotals ?? {}).sort((a, b) => b[1] - a[1]);
    return (
      <div className="panel__tab">
        <section className="panel__section">
          <h3 className="panel__section-title">原矿需求</h3>
          <p className="panel__hint">成品取向下由目标产量倒推；切到产线取向可改为按带速供给。</p>
          {rows.length === 0 ? (
            <p className="panel__hint">目标本身即原料，无需上游。</p>
          ) : (
            rows.map(([id, rate]) => (
              <div className="supply-row supply-row--readonly" key={id}>
                <div className="supply-row__head">
                  <span className="supply-row__name">{itemName(id)}</span>
                  <span className="supply-row__rate">{formatRate(rate)}/min</span>
                </div>
                <div className="supply-row__info">建议带速 {suggestBelt(rate).mark}</div>
              </div>
            ))
          )}
        </section>
      </div>
    );
  }

  // forward 模式
  const inputByItem = new Map((derived.forward?.inputs ?? []).map((i) => [i.itemId, i]));
  const rawIds = Object.keys(chain.rawTotals).sort((a, b) => itemName(a).localeCompare(itemName(b)));
  const intermediates = chain.machines
    .map((m) => m.itemId)
    .filter((id) => id !== targetItemId)
    .sort((a, b) => itemName(a).localeCompare(itemName(b)));

  return (
    <div className="panel__tab">
      <section className="panel__section">
        <h3 className="panel__section-title">原料供给</h3>
        <p className="panel__hint">选带速或自定义速率，正向算出实际产量与瓶颈（高亮）。</p>
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
        <h3 className="panel__section-title">已有半成品</h3>
        <p className="panel__hint">勾选后把该中间产物当作输入边界——算法展开到它就停。</p>
        {intermediates.length === 0 ? (
          <p className="panel__hint">当前产线没有可作边界的中间产物。</p>
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
                  当作已有：{itemName(id)}
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
          <h3 className="panel__section-title">瓶颈</h3>
          <p className="panel__hint">
            {derived.forward.bottlenecks.map(itemName).join('、')} 限制了产量。
          </p>
        </section>
      ) : null}
    </div>
  );
}
