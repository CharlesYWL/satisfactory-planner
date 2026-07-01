/**
 * 物流计算层（纯函数，无 UI 依赖）。
 *
 * 给定配平后的生产树（每级机器数 + 各连接的物料流速），估算每条
 * 「源机器组 → 目标机器组」连接需要多少分离器(Splitter)/合并器(Merger)，
 * 以及该段传送带需要的等级。
 *
 * ⚠️ 估算口径（务必看清，游戏内最优布线是 NP 难，这里只求「数量级正确、新手能照搭」）：
 *  - 一台 Conveyor Splitter = 1 进 3 出；一台 Conveyor Merger = 3 进 1 出。
 *  - 合流：N 台源机器的出口先汇成一条主干。一个 3 进合并器净减 2 股，
 *    故合并 N 股需 ceil((N-1)/2) 个合并器（N≤1 时 0 个）。
 *  - 分流：主干再分配到「目标机器数 × 每台该物料入口数」个入口。
 *    一个 3 出分离器净增 2 个出口，故分到 P 个入口需 ceil((P-1)/2) 个分离器（P≤1 时 0 个）。
 *  - 这是「先全合再全分」的主干（manifold）心智模型，是新手最容易照搭的拓扑；
 *    不追求源/目标 1:1 直连等更省料的优化布线。
 *  - 一台机器对某一物料只占 1 个进料口（配方 ingredients 里一个键=一个口），
 *    故每台目标机器对该物料的入口数恒为 1，目标入口总数 = 目标机器数。
 *  - 同一物料若被多个不同配方消费，本层按「每条连接各自合一次流」计数，
 *    会略高估合并器数；对「数量级正确」的目标可接受。
 *  - 传送带等级按整段主干总流量定档（suggestBelt）；流量超单条最高档时给出并行带条数。
 */

import type { GameData } from './types';
import { gameData as defaultData } from './data';
import { BELTS, suggestBelt, type Belt } from './rates';
import type { TraceNode } from './trace';
import { aggregateInputFlows } from './trace';

/** Conveyor Splitter 出口数（1 进 3 出）。 */
export const SPLITTER_FANOUT = 3;
/** Conveyor Merger 入口数（3 进 1 出）。 */
export const MERGER_FANIN = 3;
/** 单条传送带最高吞吐（最高档带速）/min。 */
export const MAX_BELT_SPEED = BELTS[BELTS.length - 1].speed;

/**
 * 把一条主干分配到 `outputs` 个出口，需要多少个分离器（每个 `fan` 出）。
 * 一个 fan 出分离器净增 (fan-1) 个出口，故分离器树节点数 = ceil((outputs-1)/(fan-1))。
 * `outputs ≤ 1` 时直连即可，无需分离器。
 */
export function splittersForOutputs(outputs: number, fan = SPLITTER_FANOUT): number {
  if (!Number.isFinite(outputs) || outputs <= 1 || fan <= 1) return 0;
  return Math.ceil((outputs - 1) / (fan - 1));
}

/**
 * 把 `inputs` 条料汇成一条主干，需要多少个合并器（每个 `fan` 进）。
 * 一个 fan 进合并器净减 (fan-1) 股，故合并器树节点数 = ceil((inputs-1)/(fan-1))。
 * `inputs ≤ 1` 时本就是一股，无需合并器。
 */
export function mergersForInputs(inputs: number, fan = MERGER_FANIN): number {
  if (!Number.isFinite(inputs) || inputs <= 1 || fan <= 1) return 0;
  return Math.ceil((inputs - 1) / (fan - 1));
}

/** 一条「源机器组 → 目标机器组」连接的物流估算。 */
export interface LogisticsConnection {
  /** 流动的物品 itemId。 */
  itemId: string;
  /** 消费方物品 itemId（目标机器组的产物）。 */
  targetItemId: string;
  /** 该连接主干总流量/min。 */
  flow: number;
  /** 源机器组台数（产出该物料的机器数；原料/外部供给源为 0）。 */
  sourceMachines: number;
  /** 目标机器组台数（消费该物料的机器数）。 */
  targetMachines: number;
  /** 每台目标机器对该物料的入口数（一般为 1）。 */
  inputsPerTarget: number;
  /** 目标入口总数 = 目标机器数 × 每台入口数。 */
  targetPorts: number;
  /** 建议传送带档位（按主干总流量）。 */
  belt: Belt;
  /** 流量是否超单条最高档带速 → 需多条并行带。 */
  overBelt: boolean;
  /** 满足流量所需的（最高档）并行带条数（≥1）。 */
  beltCount: number;
  /** 主干分配到各目标入口所需分离器数。 */
  splitters: number;
  /** 合并 N 个源出口到主干所需合并器数。 */
  mergers: number;
  /** 源是否为原料 / 外部供给（无源机器组，主干视为已就绪）。 */
  rawSource: boolean;
}

/** 估算单条连接的传送带等级与分离器/合并器数量。 */
export function connectionLogistics(params: {
  itemId: string;
  targetItemId: string;
  flow: number;
  sourceMachines: number;
  targetMachines: number;
  inputsPerTarget?: number;
}): LogisticsConnection {
  const flow = Math.max(0, params.flow);
  const sourceMachines = Math.max(0, params.sourceMachines);
  const targetMachines = Math.max(0, params.targetMachines);
  const inputsPerTarget = params.inputsPerTarget ?? 1;
  const targetPorts = Math.max(0, Math.round(targetMachines * inputsPerTarget));

  const belt = suggestBelt(flow);
  const overBelt = flow > MAX_BELT_SPEED + 1e-6;
  const beltCount = overBelt ? Math.ceil(flow / MAX_BELT_SPEED) : 1;
  const rawSource = sourceMachines <= 0;

  return {
    itemId: params.itemId,
    targetItemId: params.targetItemId,
    flow,
    sourceMachines,
    targetMachines,
    inputsPerTarget,
    targetPorts,
    belt,
    overBelt,
    beltCount,
    // 原料/外部供给已是一条主干，无需再合流。
    mergers: rawSource ? 0 : mergersForInputs(sourceMachines),
    splitters: splittersForOutputs(targetPorts),
    rawSource,
  };
}

/** 某传送带等级在整条产线里的用量统计。 */
export interface BeltUsage {
  mark: string;
  /** 满速/min。 */
  speed: number;
  /** 用到该档的连接段数。 */
  segments: number;
  /** 该档累计并行带条数（含超带速时的多条）。 */
  beltCount: number;
}

/** 整条产线的物流汇总。 */
export interface LogisticsSummary {
  /** 每条连接的物流估算（与流程图的边一一对应）。 */
  connections: LogisticsConnection[];
  /** 全产线分离器合计。 */
  totalSplitters: number;
  /** 全产线合并器合计。 */
  totalMergers: number;
  /** 各传送带等级用量（按带速升序）。 */
  beltUsage: BeltUsage[];
}

/**
 * 遍历生产树，按「每个消费方节点的每条输入」生成连接物流估算并汇总。
 *
 * 与 buildFlow 的连边口径一致：同一物品（消费方）在树里只走一次（去重），
 * 故连接集合与流程图的边一一对应。
 *
 * @param tree           生产树根（反向/正向重跑后的树）。
 * @param machineCountOf 取某物品所属机器组的整数台数（原料/未知返回 0）。
 */
export function computeLogistics(
  tree: TraceNode | null,
  machineCountOf: (itemId: string) => number,
  data: GameData = defaultData,
): LogisticsSummary {
  const connections: LogisticsConnection[] = [];
  const visited = new Set<string>();
  // 每条连接的流量取「源→目标 的全组总流量」，而不是首个目标节点那条支路的量。
  // 同一物料被多个下游消费时树里会出现多个目标节点，各只带一条支路的 rate；聚合后才正确。
  const inputFlowOf = aggregateInputFlows(tree);

  const walk = (node: TraceNode) => {
    if (visited.has(node.itemId)) return;
    visited.add(node.itemId);

    const targetMachines = Math.max(0, machineCountOf(node.itemId));
    const recipe = data.recipes[node.recipeId];

    for (const input of node.inputs) {
      // 自产输入才有源机器组；原矿/已供给输入视为外部主干（无源机器）。
      const sourceMachines =
        input.kind === 'produced' ? Math.max(0, machineCountOf(input.itemId)) : 0;
      // 配方 ingredients 里一个键=一个进料口，故每台目标对该物料入口数为 1。
      const inputsPerTarget = recipe?.ingredients[input.itemId] != null ? 1 : 1;
      const flow = inputFlowOf(node.itemId, input.itemId) ?? input.rate;
      connections.push(
        connectionLogistics({
          itemId: input.itemId,
          targetItemId: node.itemId,
          flow,
          sourceMachines,
          targetMachines,
          inputsPerTarget,
        }),
      );
    }

    for (const child of node.children) walk(child);
  };

  if (tree) walk(tree);

  let totalSplitters = 0;
  let totalMergers = 0;
  const usageMap = new Map<string, BeltUsage>();
  for (const c of connections) {
    totalSplitters += c.splitters;
    totalMergers += c.mergers;
    const usage = usageMap.get(c.belt.mark) ?? {
      mark: c.belt.mark,
      speed: c.belt.speed,
      segments: 0,
      beltCount: 0,
    };
    usage.segments += 1;
    usage.beltCount += c.beltCount;
    usageMap.set(c.belt.mark, usage);
  }
  const beltUsage = [...usageMap.values()].sort((a, b) => a.speed - b.speed);

  return { connections, totalSplitters, totalMergers, beltUsage };
}
