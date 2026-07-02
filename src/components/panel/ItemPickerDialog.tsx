import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gameData } from '../../lib';
import { itemName, useLang } from '../../i18n';

/** 弹窗里展示的一个候选物品（仅取网格需要的字段）。 */
interface PickItem {
  id: string;
  /** 英文名（用于搜索回退）。 */
  name: string;
  image: string;
  category: string;
}

/**
 * 候选目标物品：可作为产线目标的「可制造」物品（producers 里有配方且非原矿），
 * 外加原矿/原始资源（也允许直接当目标）。
 */
const CANDIDATES: PickItem[] = Object.values(gameData.items)
  .filter((it) => it.isRaw || (gameData.producers[it.id]?.length ?? 0) > 0)
  .map((it) => ({ id: it.id, name: it.name, image: it.image, category: it.category }));

/** 分类展示顺序：取归一化数据里分类首次出现的次序（矿石→锭→…的游戏推进序）。 */
const CATEGORY_ORDER: string[] = (() => {
  const seen: string[] = [];
  for (const it of Object.values(gameData.items)) {
    if (!seen.includes(it.category)) seen.push(it.category);
  }
  return seen;
})();

interface ItemGroup {
  category: string;
  items: PickItem[];
}

/** 把候选物品按分类分组并按 CATEGORY_ORDER 排序，组内按当前语言的显示名排序。 */
function groupByCategory(items: PickItem[], sortName: (it: PickItem) => string): ItemGroup[] {
  const byCat = new Map<string, PickItem[]>();
  for (const it of items) {
    const arr = byCat.get(it.category);
    if (arr) arr.push(it);
    else byCat.set(it.category, [it]);
  }
  const order = [...CATEGORY_ORDER];
  // 兜底：数据里出现但不在预设顺序里的分类，追加到末尾。
  for (const cat of byCat.keys()) {
    if (!order.includes(cat)) order.push(cat);
  }
  const groups: ItemGroup[] = [];
  for (const cat of order) {
    const arr = byCat.get(cat);
    if (!arr || arr.length === 0) continue;
    arr.sort((a, b) => sortName(a).localeCompare(sortName(b)));
    groups.push({ category: cat, items: arr });
  }
  return groups;
}

/**
 * 目标产品图片网格选择弹窗（对标 satisfactory-calculator 的「可供生产的物品」弹窗）。
 *
 * 纯受控组件：顶部搜索（按显示名/英文名/ID 过滤，中英文皆可），物品按分类分组成带 header 的
 * 网格，每格大图标 + 名称（无数字）。点物品即回调 `onPick(id)` 并关闭——由调用方决定写哪个
 * 目标（单目标换物品 / 多目标某行换物品 / 新增目标），故复用于产出 Tab 的所有取物品场景。
 */
export default function ItemPickerDialog({
  onClose,
  onPick,
  selectedId,
}: {
  onClose: () => void;
  onPick: (itemId: string) => void;
  selectedId?: string;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    // 搜索同时匹配英文名、中文名与 ID，无论当前界面语言。
    const filtered = q
      ? CANDIDATES.filter(
          (it) =>
            it.name.toLowerCase().includes(q) ||
            it.id.toLowerCase().includes(q) ||
            itemName(it.id, 'zh').toLowerCase().includes(q),
        )
      : CANDIDATES;
    return groupByCategory(filtered, (it) => itemName(it.id, lang));
  }, [query, lang]);

  const total = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups],
  );

  const choose = (id: string) => {
    onPick(id);
    onClose();
  };

  return (
    <div className="item-dialog__backdrop" onClick={onClose}>
      <div
        className="item-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('picker.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="item-dialog__head">
          <h2 className="item-dialog__title">{t('picker.title')}</h2>
          <button
            className="item-dialog__close"
            onClick={onClose}
            aria-label={t('picker.close')}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="item-dialog__search">
          <input
            ref={inputRef}
            className="panel__input"
            type="text"
            placeholder={t('picker.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="item-dialog__body">
          {groups.length === 0 ? (
            <p className="item-dialog__empty">{t('picker.empty')}</p>
          ) : (
            groups.map((g) => (
              <section className="item-group" key={g.category}>
                <div className="item-group__head">
                  {t(`picker.category.${g.category}`, { defaultValue: g.category })}
                </div>
                <div className="item-grid">
                  {g.items.map((it) => {
                    const name = itemName(it.id, lang);
                    return (
                      <button
                        key={it.id}
                        type="button"
                        className={`item-card ${it.id === selectedId ? 'item-card--active' : ''}`}
                        onClick={() => choose(it.id)}
                        title={name}
                      >
                        <span className="item-card__icon">
                          {it.image ? (
                            <img src={it.image} alt="" loading="lazy" />
                          ) : (
                            <span className="item-card__icon-fallback" aria-hidden="true">
                              {name.charAt(0)}
                            </span>
                          )}
                        </span>
                        <span className="item-card__name">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <footer className="item-dialog__foot">{t('picker.count', { count: total })}</footer>
      </div>
    </div>
  );
}
