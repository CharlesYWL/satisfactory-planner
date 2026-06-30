import { useEffect, useMemo, useRef, useState } from 'react';
import { gameData } from '../../lib';
import { usePlanner } from '../../store/plannerStore';

/** 弹窗里展示的一个候选物品（仅取网格需要的字段）。 */
interface PickItem {
  id: string;
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

/** 分类中文名（面板整体为中文，未登记的分类回退为原始 key）。 */
const CATEGORY_LABELS: Record<string, string> = {
  ore: '矿石',
  ingot: '锭',
  mineral: '矿物',
  animal: '动物制品',
  liquid: '液体',
  gas: '气体',
  standard: '标准件',
  industrial: '工业件',
  electronic: '电子件',
  communication: '通讯件',
  quantum: '量子科技',
  container: '容器/包装',
  fuel: '燃料',
  consumed: '消耗品',
  ammo: '弹药',
  nuclear: '核能',
  waste: '废料',
  special: '特殊物品',
  statue: '雕像',
  ficsmas: 'FICSMAS',
};

interface ItemGroup {
  category: string;
  label: string;
  items: PickItem[];
}

/** 把候选物品按分类分组并按 CATEGORY_ORDER 排序，组内按名称排序。 */
function groupByCategory(items: PickItem[]): ItemGroup[] {
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
    arr.sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ category: cat, label: CATEGORY_LABELS[cat] ?? cat, items: arr });
  }
  return groups;
}

/**
 * 目标产品图片网格选择弹窗（对标 satisfactory-calculator 的「可供生产的物品」弹窗）。
 *
 * 替代原下拉框：顶部搜索（按名称/ID 过滤，中英文皆可），物品按分类分组成带 header 的
 * 网格，每格大图标 + 名称（无数字）。点物品即写入 store.targetItemId 并关闭，主流程图实时重算。
 */
export default function ItemPickerDialog({ onClose }: { onClose: () => void }) {
  const targetItemId = usePlanner((s) => s.targetItemId);
  const setTargetItemId = usePlanner((s) => s.setTargetItemId);
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
    const filtered = q
      ? CANDIDATES.filter(
          (it) => it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q),
        )
      : CANDIDATES;
    return groupByCategory(filtered);
  }, [query]);

  const total = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups],
  );

  const choose = (id: string) => {
    setTargetItemId(id);
    onClose();
  };

  return (
    <div className="item-dialog__backdrop" onClick={onClose}>
      <div
        className="item-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="选择目标产品"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="item-dialog__head">
          <h2 className="item-dialog__title">选择目标产品</h2>
          <button className="item-dialog__close" onClick={onClose} aria-label="关闭" type="button">
            ×
          </button>
        </header>

        <div className="item-dialog__search">
          <input
            ref={inputRef}
            className="panel__input"
            type="text"
            placeholder="搜索物品…（支持中英文）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="item-dialog__body">
          {groups.length === 0 ? (
            <p className="item-dialog__empty">没有匹配的物品</p>
          ) : (
            groups.map((g) => (
              <section className="item-group" key={g.category}>
                <div className="item-group__head">{g.label}</div>
                <div className="item-grid">
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className={`item-card ${it.id === targetItemId ? 'item-card--active' : ''}`}
                      onClick={() => choose(it.id)}
                      title={it.name}
                    >
                      <span className="item-card__icon">
                        {it.image ? (
                          <img src={it.image} alt="" loading="lazy" />
                        ) : (
                          <span className="item-card__icon-fallback" aria-hidden="true">
                            {it.name.charAt(0)}
                          </span>
                        )}
                      </span>
                      <span className="item-card__name">{it.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <footer className="item-dialog__foot">{total} 个可选物品</footer>
      </div>
    </div>
  );
}
