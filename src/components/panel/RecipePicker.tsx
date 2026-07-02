import { useTranslation } from 'react-i18next';
import { chooseRecipe, gameData, recipeIO, type Recipe } from '../../lib';
import { itemName, recipeName, useLang, type Lang } from '../../i18n';
import { usePlanner, useRelevantRecipes } from '../../store/plannerStore';
import { formatRate } from '../nodes';

/** 一条「物料 速率/min」文本，如 `铁棒 10/min`。 */
function entryLabel(itemId: string, rate: number, lang: Lang): string {
  return `${itemName(itemId, lang)} ${formatRate(rate)}/min`;
}

/**
 * 组装配方投入产出详情文本：`原料A x/min + 原料B y/min → 主产物 z/min`。
 * 有副产物时追加 `+ 副产物 w/min`。名称本地化、速率格式化都在这里做。
 */
function formatRecipeDetail(
  recipe: Recipe,
  lang: Lang,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const io = recipeIO(recipe);
  const inputs =
    io.inputs.length === 0
      ? t('recipe.detailNoInput')
      : io.inputs.map((e) => entryLabel(e.itemId, e.rate, lang)).join(t('recipe.detailInputSep'));
  let text = `${inputs} ${t('recipe.detailArrow')} ${entryLabel(io.output.itemId, io.output.rate, lang)}`;
  if (io.byproducts.length > 0) {
    const items = io.byproducts
      .map((e) => entryLabel(e.itemId, e.rate, lang))
      .join(t('recipe.detailInputSep'));
    text += ` ${t('recipe.detailByproduct', { items })}`;
  }
  return text;
}

/**
 * 替代配方选择：对当前产线涉及的每个中间产物给一组候选配方卡片。
 *
 * 每张卡片都显示配方的投入产出详情（`原料/min → 产出/min`，默认配方同样显示），
 * 当前选中项高亮。选项来源 **只** 用 getRelevantRecipes().byItem[itemId]——即与当前
 * 产线相关的候选配方（含 alternate）。选某配方 → 写进 store.recipeOverrides，触发重算 →
 * 图与原料随之刷新（换配方可能改变原料结构）。
 */
export default function RecipePicker() {
  const { t } = useTranslation();
  const lang = useLang();
  const relevant = useRelevantRecipes();
  const recipeOverrides = usePlanner((s) => s.recipeOverrides);
  const setRecipeOverride = usePlanner((s) => s.setRecipeOverride);
  const clearRecipeOverride = usePlanner((s) => s.clearRecipeOverride);

  const items = relevant.items.filter((id) => (relevant.byItem[id]?.length ?? 0) > 0);

  if (items.length === 0) {
    return <p className="panel__hint">{t('recipe.none')}</p>;
  }

  return (
    <div className="recipe-picker">
      {items.map((itemId) => {
        const candidates = relevant.byItem[itemId] ?? [];
        const current = chooseRecipe(itemId, recipeOverrides, gameData);
        const baseId = chooseRecipe(itemId, {}, gameData)?.id;
        const single = candidates.length <= 1;

        return (
          <div className="recipe-picker__row" key={itemId}>
            <span className="recipe-picker__item">{itemName(itemId, lang)}</span>
            <div className="recipe-picker__options" role="radiogroup">
              {candidates.map((recipeId) => {
                const recipe = gameData.recipes[recipeId];
                const selected = current?.id === recipeId;
                return (
                  <label
                    key={recipeId}
                    className={`recipe-card ${selected ? 'recipe-card--selected' : ''}`}
                  >
                    <input
                      type="radio"
                      className="recipe-card__radio"
                      name={`recipe-${itemId}`}
                      value={recipeId}
                      checked={selected}
                      disabled={single}
                      onChange={() => {
                        if (recipeId === baseId) clearRecipeOverride(itemId);
                        else setRecipeOverride(itemId, recipeId);
                      }}
                    />
                    <span className="recipe-card__body">
                      <span className="recipe-card__name">
                        {recipe?.isAlternate ? '★ ' : ''}
                        {recipeName(recipeId, lang)}
                      </span>
                      {recipe ? (
                        <span className="recipe-card__io">
                          {formatRecipeDetail(recipe, lang, t)}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
