/**
 * 归一化游戏数据的类型定义。
 * 与 data/normalize.py 产出的 data/data.normalized.json 结构一一对应。
 */

/** 物品（成品 / 半成品 / 原矿 / 流体）。 */
export interface Item {
  id: string;
  name: string;
  /** 分类，如 ore / standard / electronic / industrial / liquid 等。 */
  category: string;
  /** 物品主题色（用于 UI 连线着色）。 */
  color: string;
  /** 图标 CDN 地址。 */
  image: string;
  /** AWESOME Sink 点数（可能缺省）。 */
  sinkPoints?: number;
  /** 是否为原矿 / 原始资源（生产树的叶子）。 */
  isRaw: boolean;
}

/** 生产建筑（制造机 / 冶炼炉 / 采矿机 等）。 */
export interface Building {
  id: string;
  name: string;
  category: string;
  /** 满载（100% 超频）基础功耗，单位 MW。 */
  power: number;
  /** 发电类建筑的发电量（普通建筑为 0 或缺省）。 */
  powerGenerated?: number;
  image: string;
  /** 传送带速度（仅传送带类建筑有值），单位 件/min。 */
  beltSpeed?: number | null;
  /** 采矿机在 不纯 / 普通 / 纯净 矿脉上的采集速率。 */
  extractionRate?: Record<string, number> | null;
  /** 物理入口数（进料口总数），如 Assembler=2、Manufacturer=4；缺省时回退配方原料种类数。 */
  input?: number | null;
  /** 物理出口数（产物口总数），如 Assembler=1、Refinery=2。 */
  output?: number | null;
}

/** 一条可自动化配方（每周期产出/消耗）。 */
export interface Recipe {
  id: string;
  name: string;
  /** 可承载此配方的建筑 id 列表（取第一个为默认建筑）。 */
  machines: string[];
  /** 单个生产周期时长，单位秒。 */
  duration: number;
  /** 每周期输入：itemId → 数量。 */
  ingredients: Record<string, number>;
  /** 每周期产出：itemId → 数量（可能多产物，取第一个为主产物）。 */
  produce: Record<string, number>;
  /** 是否为替代配方。 */
  isAlternate: boolean;
}

/** 整个归一化数据包。 */
export interface GameData {
  /** 数据分支，如 "Stable"。 */
  branch: string;
  items: Record<string, Item>;
  buildings: Record<string, Building>;
  recipes: Record<string, Recipe>;
  /** 反向索引：itemId → 能生产它的配方 id 列表。 */
  producers: Record<string, string[]>;
  /** 原矿 / 原始资源 itemId 列表。 */
  raw: string[];
}
