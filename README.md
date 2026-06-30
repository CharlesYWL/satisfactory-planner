# Satisfactory 产线配平工具 (Better Satisfactory Planner)

正向 + 反向生产线配平计算器。对标 satisfactory-calculator，但支持**产线取向**（固定原矿输入→算整数机器）+ **成品取向**（目标成品→倒推原矿）。

## 项目状态
Multica 项目: 「Better Satisfactory Planner」(MYW-43~48)

- [x] M0 数据层（官方数据归一化 + 反向索引）
- [x] M1 配平算法 + 单测
- [ ] M2 流程图渲染 (React Flow)
- [ ] M3 交互三 Tab + 替代配方智能筛选 + 超频
- [ ] M4 打磨
- [ ] M5 部署（可选）

## 数据层 (data/)
- `data/scim-en-stable.json` — 官方游戏数据 (SCIM en-Stable, 1.5MB)
- `data/normalize.py` — 归一化脚本
- `data/data.normalized.json` — 归一化输出（178 物品 / 551 建筑 / 306 可自动化配方 / 110 替代配方 + producers 反向索引）

### 数据 schema (data.normalized.json)
```
items{id, name, category, color, image, isRaw}
buildings{id, name, power, image, beltSpeed, extractionRate}
recipes{id, name, machines[], duration(秒), ingredients{item:qty/周期}, produce{item:qty/周期}, isAlternate}
producers{itemId: [recipeId...]}   # 反向索引：物品→能生产它的配方（替代配方筛选用）
```

### 关键公式
- 单机产能/min = produce_qty × 60 / duration × 超频(1.0~2.5)
- 超频功耗 = 基础功耗 × 超频^1.321321
- 带速: Mk1=60 Mk2=120 Mk3=270 Mk4=480 Mk5=780 Mk6=1200/min

## 技术栈 (计划)
Vite + React + TypeScript + @xyflow/react (流程图) + Zustand。纯前端，数据打包，离线可用。深色 #222 + Satisfactory 橙。

## 工程 / 开发

```bash
npm install      # 安装依赖
npm run dev      # 本地预览（占位骨架，真正 UI 在 M2）
npm test         # 跑算法单测 (vitest)
npm run build    # 类型检查 + 生产构建
```

工程为 Vite + React + TS 脚手架；M1 只交付 `src/lib/` 下的纯函数算法层 + 单测，不含 UI。

## M1 · 配平算法 (`src/lib/`)

纯函数、无副作用、无 UI 依赖。默认数据源为打包进来的 `data/data.normalized.json`，
所有函数都可传入第三/可选参数 `data`（或 `options.data`）注入自定义数据，便于测试。

| 模块 | 职责 |
| --- | --- |
| `types.ts` | `GameData` / `Item` / `Building` / `Recipe` 类型 |
| `data.ts` | 加载归一化数据 + `getItem/getRecipe/getBuilding/isRawItem` |
| `rates.ts` | `machineCapacity` / `outputPerMin` / `overclockPower` / `BELTS` / `suggestBelt` |
| `recipes.ts` | `chooseRecipe`（默认 base，可 override）/ `getRelevantRecipes` |
| `trace.ts` | `traceProduction` 自顶向下展开生产树（正反向共用，含循环保护） |
| `forward.ts` | `balanceForward` 正向配平（产线取向） |
| `reverse.ts` | `balanceReverse` 反向配平（成品取向） |

入口 `src/lib/index.ts` 统一导出。

### 关键公式
- 单机产能/min = `produce_qty × 60 / duration × clock`（clock 1.0~2.5）
- 超频功耗/MW = `基础功耗 × clock ^ 1.321321`
- `suggestBelt(rate)` 返回够用的最低带速档（Mk1=60 … Mk6=1200）

### 正向配平 — 产线取向（新手重点）

固定各原料供给速率 → 找瓶颈算出实际成品产量 + 每级整数机器（或超频凑整）。
供给表里的物品即「输入边界」，展开到它们即停止。

```ts
import { balanceForward } from './lib';

// 钢管 15/min + 线材 40/min → 恰好 5 定子/min，1 台 Assembler，利用率 100%
const r = balanceForward('Desc_Stator_C', {
  Desc_SteelPipe_C: 15,
  Desc_Wire_C: 40,
});
r.targetOutput;   // 5
r.bottlenecks;    // ['Desc_SteelPipe_C', 'Desc_Wire_C']（两者同时到顶）
r.nodes[0];       // { machineId:'Build_AssemblerMk1_C', machineCount:1, clockPct:100, utilization:1, ... }

// 超频模式：把多台机器凑成更少的超频机器
balanceForward('Desc_Wire_C', { Desc_CopperIngot_C: 35 }, { mode: 'overclock' });
// → 1 台 Constructor @233.3%
```

`mode: 'integer'`（默认）给出严格整数台数 + 利用率；`mode: 'overclock'` 在
`machineCount = ceil(需求 / (单机产能 × maxClock))` 下回算每台超频百分比（默认上限 2.5）。

### 反向配平 — 成品取向（对标原网站）

目标成品/min → 递归倒推完整生产树 + 原矿需求 + 总功耗。机器数允许小数。

```ts
import { balanceReverse } from './lib';

const r = balanceReverse('Desc_Stator_C', 5);
r.totalPower;                       // 47 (MW)，整数台机器满载，与游戏一致
r.rawTotals;                        // { Desc_OreIron_C:22.5, Desc_Coal_C:22.5, Desc_OreCopper_C:20 }
r.machines;                         // 每个自产物品的台数（小数）+ 整数台数 + 功耗
r.tree;                             // 完整生产树（可用于 M2 流程图）
```

### 替代配方

正反向函数都接受 `recipeId`（目标产品配方）与 `recipeOverrides`（中间产物 itemId → recipeId）：

```ts
balanceReverse('Desc_Stator_C', 5, {
  recipeOverrides: { Desc_Stator_C: 'Recipe_Alternate_Stator_C' },
});
```

`getRelevantRecipes(itemId)` 遍历默认生产树涉及的所有中间产物，用 `producers`
取出能生产它们的全部配方（含替代配方），供 UI 智能下拉用——只列相关配方，不糊脸：

```ts
const rel = getRelevantRecipes('Desc_Stator_C');
rel.items;    // ['Desc_CopperIngot_C','Desc_SteelIngot_C','Desc_SteelPipe_C','Desc_Stator_C','Desc_Wire_C']
rel.recipes;  // 上述物品的全部候选配方并集（含 Recipe_Alternate_Stator_C 等）
rel.byItem;   // { 物品: [候选配方...] }
```

### 测试

`src/lib/__tests__/balance.test.ts`（vitest）覆盖全部验收标准：定子正向 5/min·100% 利用率、
反向 47MW、深链到原矿、`suggestBelt`、`getRelevantRecipes` 相关性、替代配方等。`npm test` 全绿。

