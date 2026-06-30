# Satisfactory 产线配平工具 (Better Satisfactory Planner)

正向 + 反向生产线配平计算器。对标 satisfactory-calculator，但支持**产线取向**（固定原矿输入→算整数机器）+ **成品取向**（目标成品→倒推原矿）。

## 项目状态
Multica 项目: 「Better Satisfactory Planner」(MYW-43~48)

- [x] M0 数据层（官方数据归一化 + 反向索引）
- [ ] M1 配平算法 + 单测
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
