import { MarkerType, type Edge } from '@xyflow/react';
import type { BlueprintGroup, BlueprintPlan, GameData } from '../lib';
import { gameData as defaultData, BELTS, computeBlueprint, laneMachineCount, suggestBelt } from '../lib';
import { itemName as itemLabel, buildingName as buildingLabel, type Lang } from '../i18n';
import { beltColor, type GraphResult } from './buildFlow';
import { formatRate } from './nodes';
import type {
  BpDeviceNode,
  BpFlowNode,
  BpMachineNode,
  BpOutNode,
  BpSourceNode,
} from './blueprintNodes';
import type { BpEdge, BpEdgeData } from './blueprintEdges';

/* ---- 施工图几何常量（手工网格布局，让机器阵列对齐、走线成直角） ---- */
const MACHINE_W = 150;
const MACHINE_H = 92;
const MACHINE_DX = 214; // 相邻机器水平间距
const DEV = 46; // 分离器/合并器方块边长
const SOURCE_W = 158;
const SOURCE_H = 60;
const OUT_W = 162;
const OUT_H = 64;
const BELT_ROW_H = 76; // 每条输入主干占的行高（机器上方逐层堆叠）
const HEAD_PAD = 10;
const FOOT_GAP = 68; // 机器底 → 输出主干
const BAND_GAP = 82; // 相邻机器组之间的留白
const GX = 260; // 机器阵列左起点 x（左侧留给原料源卡片）
const SRC_X = 44;

const centerX = (i: number) => GX + i * MACHINE_DX + MACHINE_W / 2;

/* ---- 输出分流主干（共享主干沿途 tap）几何 ---- */
const TAP_DX = 90; // 相邻 tap 分离器水平间距

/* ---- 「可旋转」设备（分离器/合并器）走线方向工具 ---- */
type Side = 'l' | 't' | 'r' | 'b';
/** 对面（用于「一端出、对端进」的直连推断）。 */
const OPP: Record<Side, Side> = { l: 'r', r: 'l', t: 'b', b: 't' };
/** 设备入口 handle id（target，四面各一，见 blueprintNodes.DevicePorts）。 */
const din = (s: Side) => `${s}i`;
/** 设备出口 handle id（source）。 */
const dout = (s: Side) => `${s}o`;
/**
 * 由「源中心 → 目标中心」的相对位置，选设备该用哪一面出/进（水平优先，避免斜穿）。
 * 让设备「面朝来料方向进、面朝去料方向出」，减少线条交叉（对照 Q2：右进→左/下出）。
 */
function sidesBetween(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { out: Side; in: Side } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const out: Side = dx >= 0 ? 'r' : 'l';
    return { out, in: OPP[out] };
  }
  const out: Side = dy >= 0 ? 'b' : 't';
  return { out, in: OPP[out] };
}

/**
 * 某下游机器组消费某产物时的「输入 manifold 入口」（node + handle），带并行车道后缀 `sfx`。
 * 与 buildBlueprint 输入循环里 `firstTarget` 的算法一致，但因上游产物组永远画在下游**上方**，
 * 抽料支路统一从**顶部**落入（自然的「从上往下」喂料，少与同排横带交叉）：
 *  - 该车道内 ≥2 台机器 → 该物料输入 manifold 首个分离器顶端口 `s:<组>:<料>:0<sfx>` 'ti'；
 *  - 单台机器 → 该台机器顶部该物料专属入口 `m:<组>:0<sfx>` 't{j}'（j = 料在该组 inputs 的序号）。
 */
function consumerEntry(
  consumer: BlueprintGroup,
  itemId: string,
  laneMachines: number,
  sfx: string,
): { id: string; h: string } {
  const j = Math.max(0, consumer.inputs.findIndex((inp) => inp.itemId === itemId));
  if (laneMachines >= 2) return { id: `s:${consumer.itemId}:${itemId}:0${sfx}`, h: din('t') };
  return { id: `m:${consumer.itemId}:0${sfx}`, h: `t${j}` };
}

/**
 * 第 j 种入料（共 count 种）在机器顶部入口相对机器中心的横向偏移（px）。
 * 与 blueprintNodes.MachinePorts 的 handle 位置一致：单入口居中(0)，多入口均匀错开
 * （2 入口 = ±1/4 机宽）。用来把该物料的分离器主干整体平移到入口正上方，走竖直落线。
 */
const portOffset = (j: number, count: number) =>
  count <= 1 ? 0 : ((j + 0.5) / count - 0.5) * MACHINE_W;

interface EdgeOpts {
  color: string;
  label?: string;
  beltMark?: string;
  overBelt?: boolean;
  beltCount?: number;
  arrow?: boolean;
}

function makeEdge(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  opts: EdgeOpts,
): BpEdge {
  const data: BpEdgeData = {
    color: opts.color,
    label: opts.label,
    beltMark: opts.beltMark,
    overBelt: opts.overBelt,
    beltCount: opts.beltCount,
  };
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
    type: 'bpEdge',
    animated: true,
    data,
    style: { stroke: opts.color, strokeWidth: 3 },
    markerEnd: opts.arrow
      ? { type: MarkerType.ArrowClosed, color: opts.color, width: 16, height: 16 }
      : undefined,
  };
}

/**
 * 把配平结果渲染成「施工图」：每个机器组展开成 N 台独立机器阵列，
 * 每种原料一条 manifold 主干（主干 → 分离器级联 → 各台机器），产物侧合并器汇流，
 * 全部用 90° 直角边。返回 React Flow 的 nodes / edges 与计算所得的 plan（供 HUD 用）。
 */
export function buildBlueprint(
  result: GraphResult,
  data: GameData = defaultData,
  lang: Lang = 'en',
): { nodes: BpFlowNode[]; edges: Edge[]; plan: BlueprintPlan } {
  const byItem = new Map(result.machines.map((m) => [m.itemId, m]));
  const plan = computeBlueprint(
    result.tree,
    (id) => byItem.get(id)?.machineCountInteger ?? 0,
    (id) => byItem.get(id)?.rate,
  );

  const nodes: BpFlowNode[] = [];
  const edges: Edge[] = [];
  const groupIds = new Set(plan.groups.map((g) => g.itemId));
  const byItemGroup = new Map(plan.groups.map((g) => [g.itemId, g]));

  // 并行产线（方案B）：全图复制成 L 条并行线，每条一条 ≤ 最高档的带，车道对车道 1:1。
  const MAX = BELTS[BELTS.length - 1].speed;
  const L = Math.max(1, plan.laneCount);
  const beltInfo = (flow: number) => {
    const belt = suggestBelt(flow);
    const overBelt = flow > MAX + 1e-6;
    const beltCount = overBelt ? Math.ceil(flow / MAX) : 1;
    return { belt, overBelt, beltCount };
  };
  /** 车道后缀：单车道时为空（与旧图 id 完全一致，零行为变化）。 */
  const sfx = (lane: number) => (L > 1 ? `@${lane}` : '');
  /** 某组在第 lane 条车道的机器台数（均分，余数摊给靠前车道）。 */
  const laneN = (group: BlueprintGroup, lane: number) =>
    laneMachineCount(group.machineCount, L, lane);
  /**
   * 跨组抽料时目标下游所在车道：正常 1:1 落到同一车道；若下游台数 < L（该车道无机器），
   * 回退到第 0 条车道（避免悬空边）。返回该车道内目标台数 + 后缀，供 consumerEntry 用。
   */
  const targetLaneInfo = (target: BlueprintGroup, lane: number) => {
    const here = laneN(target, lane);
    const tLane = here > 0 ? lane : 0;
    return { machines: here > 0 ? here : laneN(target, 0), sfx: sfx(tLane) };
  };

  let y = 40;

  for (let lane = 0; lane < L; lane++) {
    const S = sfx(lane);
    for (const g of plan.groups) {
      const Nfull = g.machineCount;
      const N = laneN(g, lane);
      // 该组机器数 < L 时，靠后的车道分不到机器 → 该车道不画此组。
      if (N <= 0) continue;
      const perMachineRate = g.perMachineRate;
      const totalRate = perMachineRate * N; // 本车道该组总产
      const building = data.buildings[g.machineId];
      // 入口数（顶部 handle 数）：优先用建筑物理入口数（building.input），没有再回退到配方原料种类数。
      const materialKinds = g.inputs.length;
      const physicalPorts = building?.input;
      const k =
        physicalPorts != null && physicalPorts > 0
          ? Math.max(physicalPorts, materialKinds)
          : materialKinds;
      const bandTop = y;
      const machineY = bandTop + k * BELT_ROW_H + HEAD_PAD;
      const outY = machineY + MACHINE_H + FOOT_GAP;
      const machineName = buildingLabel(g.machineId, lang, data);

      // --- 机器阵列 ---
      for (let i = 0; i < N; i++) {
        const node: BpMachineNode = {
          id: `m:${g.itemId}:${i}${S}`,
          type: 'bpMachine',
          position: { x: GX + i * MACHINE_DX, y: machineY },
          width: MACHINE_W,
          height: MACHINE_H,
          data: {
            itemName: itemLabel(g.itemId, lang, data),
            machineName,
            machineImage: building?.image ?? '',
            index: i + 1,
            perMachineRate,
            inputCount: k,
            isProduct: g.isProduct,
          },
        };
        nodes.push(node);
      }

      // --- 每种原料一条输入 manifold（流量取本车道份额，带级按车道流量定档 ≤ 单条上限）---
      g.inputs.forEach((inp, j) => {
        const totalFlow = inp.perMachineFlow * N;
        const ib = beltInfo(totalFlow);
        const beltY = bandTop + j * BELT_ROW_H;
        const color = beltColor(ib.belt.mark);
        const producedHere = inp.produced && groupIds.has(inp.itemId);
        const inHandle = `t${j}`;
        const offX = portOffset(j, k);
        const firstTarget =
          N >= 2
            ? { id: `s:${g.itemId}:${inp.itemId}:0${S}`, h: din('l') }
            : { id: `m:${g.itemId}:0${S}`, h: inHandle };

        // 入口边：来自上游机器组的输出端点（跨带）或本地原料/供给源卡片。
        if (producedHere) {
          // 自产上游：入口边由上游组的「输出分流主干」统一绘制（同车道 tap → 本组 manifold 头部）。
        } else {
          const srcNode: BpSourceNode = {
            id: `src:${g.itemId}:${inp.itemId}${S}`,
            type: 'bpSource',
            position: { x: SRC_X, y: beltY + DEV / 2 - SOURCE_H / 2 },
            width: SOURCE_W,
            height: SOURCE_H,
            data: {
              itemName: itemLabel(inp.itemId, lang, data),
              itemImage: data.items[inp.itemId]?.image ?? '',
              flowText: `${formatRate(totalFlow)}/min`,
              beltMark: ib.belt.mark,
              beltColor: color,
              overBelt: ib.overBelt,
              beltCount: ib.beltCount,
              kind: inp.kind === 'supplied' ? 'supplied' : 'raw',
            },
          };
          nodes.push(srcNode);
          edges.push(
            makeEdge(
              `bpin:${g.itemId}:${inp.itemId}${S}`,
              srcNode.id,
              'r',
              firstTarget.id,
              firstTarget.h,
              { color, arrow: N < 2 },
            ),
          );
        }

        const tapLabel = `${formatRate(inp.perMachineFlow)}/min`;
        // 分离器级联（i = 0..N-2）：抽一台 + 尾料续接下一台/最后一台。
        for (let i = 0; i <= N - 2; i++) {
          const devNode: BpDeviceNode = {
            id: `s:${g.itemId}:${inp.itemId}:${i}${S}`,
            type: 'bpDevice',
            position: { x: centerX(i) + offX - DEV / 2, y: beltY },
            width: DEV,
            height: DEV,
            data: { device: 'splitter', beltColor: color, branchText: tapLabel },
          };
          nodes.push(devNode);
          edges.push(
            makeEdge(
              `stap:${g.itemId}:${inp.itemId}:${i}${S}`,
              devNode.id,
              dout('b'),
              `m:${g.itemId}:${i}${S}`,
              inHandle,
              { color, label: tapLabel, arrow: true },
            ),
          );
          if (i < N - 2) {
            edges.push(
              makeEdge(
                `scont:${g.itemId}:${inp.itemId}:${i}${S}`,
                devNode.id,
                dout('r'),
                `s:${g.itemId}:${inp.itemId}:${i + 1}${S}`,
                din('l'),
                { color },
              ),
            );
          } else {
            edges.push(
              makeEdge(
                `stail:${g.itemId}:${inp.itemId}${S}`,
                devNode.id,
                dout('r'),
                `m:${g.itemId}:${N - 1}${S}`,
                inHandle,
                { color, label: tapLabel, arrow: true },
              ),
            );
          }
        }
      });

      // --- 输出 manifold：各台机器 → 合并器级联 → 输出端点 ---
      const ob = beltInfo(totalRate);
      const outColor = beltColor(ob.belt.mark);
      const perOut = `${formatRate(perMachineRate)}/min`;
      const outXpos = GX + (N - 1) * MACHINE_DX + MACHINE_W + 52;
      const outNode: BpOutNode = {
        id: `out:${g.itemId}${S}`,
        type: 'bpOut',
        position: { x: outXpos, y: outY + DEV / 2 - OUT_H / 2 },
        width: OUT_W,
        height: OUT_H,
        data: {
          itemName: itemLabel(g.itemId, lang, data),
          itemImage: data.items[g.itemId]?.image ?? '',
          flowText: `${formatRate(totalRate)}/min`,
          beltMark: ob.belt.mark,
          beltColor: outColor,
          overBelt: ob.overBelt,
          beltCount: ob.beltCount,
          isProduct: g.isProduct,
        },
      };
      nodes.push(outNode);

      if (N === 1) {
        edges.push(
          makeEdge(`oout:${g.itemId}${S}`, `m:${g.itemId}:0${S}`, 'b', outNode.id, 'l', {
            color: outColor,
            label: `${formatRate(totalRate)}/min`,
            beltMark: ob.belt.mark,
            overBelt: ob.overBelt,
            beltCount: ob.beltCount,
            arrow: true,
          }),
        );
      } else {
        for (let i = 1; i <= N - 1; i++) {
          const devNode: BpDeviceNode = {
            id: `g:${g.itemId}:${i}${S}`,
            type: 'bpDevice',
            position: { x: centerX(i) - DEV / 2, y: outY },
            width: DEV,
            height: DEV,
            data: { device: 'merger', beltColor: outColor, branchText: perOut },
          };
          nodes.push(devNode);
          edges.push(
            makeEdge(`gin:${g.itemId}:${i}${S}`, `m:${g.itemId}:${i}${S}`, 'b', devNode.id, din('t'), {
              color: outColor,
              label: perOut,
              arrow: true,
            }),
          );
          if (i < N - 1) {
            edges.push(
              makeEdge(
                `gcont:${g.itemId}:${i}${S}`,
                devNode.id,
                dout('r'),
                `g:${g.itemId}:${i + 1}${S}`,
                din('l'),
                { color: outColor },
              ),
            );
          } else {
            edges.push(
              makeEdge(`gout:${g.itemId}${S}`, devNode.id, dout('r'), outNode.id, 'l', {
                color: outColor,
                label: `${formatRate(totalRate)}/min`,
                beltMark: ob.belt.mark,
                overBelt: ob.overBelt,
                beltCount: ob.beltCount,
                arrow: true,
              }),
            );
          }
        }
        edges.push(
          makeEdge(`gfirst:${g.itemId}${S}`, `m:${g.itemId}:0${S}`, 'b', `g:${g.itemId}:1${S}`, din('l'), {
            color: outColor,
            label: perOut,
          }),
        );
      }

      // --- 输出分流主干：本车道产物按同车道 tap 到各下游（流量取本车道份额）---
      const frac = N / Nfull;
      const taps = g.outputTaps;
      if (taps.length === 1) {
        const t0 = taps[0];
        const target = byItemGroup.get(t0.targetItemId);
        if (target) {
          const flow = t0.flow * frac;
          const tb = beltInfo(flow);
          const ti = targetLaneInfo(target, lane);
          const entry = consumerEntry(target, g.itemId, ti.machines, ti.sfx);
          edges.push(
            makeEdge(`bpin:${t0.targetItemId}:${g.itemId}${S}`, outNode.id, 'b', entry.id, entry.h, {
              color: beltColor(tb.belt.mark),
              label: `${formatRate(flow)}/min`,
              beltMark: tb.belt.mark,
              overBelt: tb.overBelt,
              beltCount: tb.beltCount,
              arrow: true,
            }),
          );
        }
      } else if (taps.length >= 2) {
        const tapBaseX = outXpos + OUT_W + 44;
        const lastSplit = taps.length - 2;
        const cxOut = outXpos + OUT_W / 2;
        const cyOut = outY + DEV / 2;
        const cyDev = outY + DEV / 2;
        const cxDev = (i: number) => tapBaseX + i * TAP_DX + DEV / 2;
        for (let i = 0; i <= lastSplit; i++) {
          const tp = taps[i];
          const flow = tp.flow * frac;
          const tb = beltInfo(flow);
          const branchColor = beltColor(tb.belt.mark);
          const devNode: BpDeviceNode = {
            id: `d:${g.itemId}:${i}${S}`,
            type: 'bpDevice',
            position: { x: tapBaseX + i * TAP_DX, y: outY },
            width: DEV,
            height: DEV,
            data: {
              device: 'splitter',
              beltColor: branchColor,
              branchText: `${formatRate(flow)}/min`,
              manifold: true,
            },
          };
          nodes.push(devNode);

          if (i === 0) {
            const s = sidesBetween(cxOut, cyOut, cxDev(0), cyDev);
            edges.push(
              makeEdge(`dtrunk:${g.itemId}${S}`, outNode.id, s.out, devNode.id, din(s.in), {
                color: outColor,
                label: `${formatRate(totalRate)}/min`,
                beltMark: ob.belt.mark,
                overBelt: ob.overBelt,
                beltCount: ob.beltCount,
                arrow: true,
              }),
            );
          } else {
            const prevRemaining = taps[i - 1].remaining * frac;
            const cb = beltInfo(prevRemaining);
            const s = sidesBetween(cxDev(i - 1), cyDev, cxDev(i), cyDev);
            edges.push(
              makeEdge(
                `dcont:${g.itemId}:${i}${S}`,
                `d:${g.itemId}:${i - 1}${S}`,
                dout(s.out),
                devNode.id,
                din(s.in),
                { color: beltColor(cb.belt.mark), label: `${formatRate(prevRemaining)}/min`, beltMark: cb.belt.mark },
              ),
            );
          }

          const target = byItemGroup.get(tp.targetItemId);
          if (target) {
            const ti = targetLaneInfo(target, lane);
            const entry = consumerEntry(target, g.itemId, ti.machines, ti.sfx);
            edges.push(
              makeEdge(`dtap:${g.itemId}:${tp.targetItemId}${S}`, devNode.id, dout('b'), entry.id, entry.h, {
                color: branchColor,
                label: `${formatRate(flow)}/min`,
                beltMark: tb.belt.mark,
                overBelt: tb.overBelt,
                beltCount: tb.beltCount,
                arrow: true,
              }),
            );
          }

          if (i === lastSplit) {
            const tail = taps[taps.length - 1];
            const tailTarget = byItemGroup.get(tail.targetItemId);
            if (tailTarget) {
              const tailFlow = tail.flow * frac;
              const tlb = beltInfo(tailFlow);
              const ti = targetLaneInfo(tailTarget, lane);
              const entry = consumerEntry(tailTarget, g.itemId, ti.machines, ti.sfx);
              edges.push(
                makeEdge(`dtail:${g.itemId}:${tail.targetItemId}${S}`, devNode.id, dout('r'), entry.id, entry.h, {
                  color: beltColor(tlb.belt.mark),
                  label: `${formatRate(tailFlow)}/min`,
                  beltMark: tlb.belt.mark,
                  overBelt: tlb.overBelt,
                  beltCount: tlb.beltCount,
                  arrow: true,
                }),
              );
            }
          }
        }
      }

      y = outY + DEV + BAND_GAP;
    }

    // 车道之间留更大间隔，视觉上区分「并行产线 #k」。
    if (L > 1) y += BAND_GAP;
  }

  return { nodes, edges, plan };
}
