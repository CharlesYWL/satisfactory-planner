import { useTranslation } from 'react-i18next';
import { chooseRecipe, gameData } from '../../lib';
import { itemName, recipeName, useLang } from '../../i18n';
import { usePlanner, useRelevantRecipes } from '../../store/plannerStore';

/**
 * 替代配方下拉：对当前产线涉及的每个中间产物给一个配方选择框。
 *
 * 选项来源 **只** 用 getRelevantRecipes().byItem[itemId]——即与当前产线相关的候选
 * 配方（含 alternate），绝不把游戏里几百个配方糊脸。选某配方 → 写进 store.recipeOverrides，
 * 触发 getRelevantRecipes + 重算 → 图与原料随之刷新（换配方可能改变原料结构）。
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
          <label className="recipe-picker__row" key={itemId}>
            <span className="recipe-picker__item">{itemName(itemId, lang)}</span>
            <select
              className="panel__select"
              value={current?.id ?? ''}
              disabled={single}
              onChange={(e) => {
                const recipeId = e.target.value;
                if (recipeId === baseId) clearRecipeOverride(itemId);
                else setRecipeOverride(itemId, recipeId);
              }}
            >
              {candidates.map((recipeId) => {
                const recipe = gameData.recipes[recipeId];
                return (
                  <option key={recipeId} value={recipeId}>
                    {recipe?.isAlternate ? '★ ' : ''}
                    {recipeName(recipeId, lang)}
                  </option>
                );
              })}
            </select>
          </label>
        );
      })}
    </div>
  );
}
