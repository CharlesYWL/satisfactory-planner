import { MarkerType, type Edge } from '@xyflow/react';
import type { BlueprintGroup, BlueprintPlan, GameData } from '../lib';
import { gameData as defaultData, computeBlueprint, suggestBelt } from '../lib';
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

/**
 * 某下游机器组消费某产物时的「输入 manifold 入口」（node + handle）。
 * 与 buildBlueprint 输入循环里 `firstTarget` 的算法一致：
 *  - 组内 ≥2 台机器 → 该物料输入 manifold 首个分离器左端口 `s:<组>:<料>:0` 'l'；
 *  - 单台机器 → 该台机器顶部该物料专属入口 `m:<组>:0` 't{j}'（j = 料在该组 inputs 的序号）。
 * 用于把上游共享主干的抽料支路直接落到下游 manifold 头部。
 */
function consumerEntry(consumer: BlueprintGroup, itemId: string): { id: string; h: string } {
  const j = Math.max(0, consumer.inputs.findIndex((inp) => inp.itemId === itemId));
  if (consumer.machineCount >= 2) return { id: `s:${consumer.itemId}:${itemId}:0`, h: 'l' };
  return { id: `m:${consumer.itemId}:0`, h: `t${j}` };
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

  let y = 40;

  for (const g of plan.groups) {
    const N = g.machineCount;
    const building = data.buildings[g.machineId];
    // 入口数（顶部 handle 数）：优先用建筑物理入口数（building.input），没有再回退到配方原料种类数。
    // 仍按物料种类各占一个 handle（每种料落到自己的入口），物理口数仅作上限/参照，
    // 故取二者较大值：料多于物理口（罕见）时不丢 handle，物理口多于料时展示真实空口。
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
        id: `m:${g.itemId}:${i}`,
        type: 'bpMachine',
        position: { x: GX + i * MACHINE_DX, y: machineY },
        width: MACHINE_W,
        height: MACHINE_H,
        data: {
          itemName: itemLabel(g.itemId, lang, data),
          machineName,
          machineImage: building?.image ?? '',
          index: i + 1,
          perMachineRate: g.perMachineRate,
          inputCount: k,
          isProduct: g.isProduct,
        },
      };
      nodes.push(node);
    }

    // --- 每种原料一条输入 manifold ---
    g.inputs.forEach((inp, j) => {
      const beltY = bandTop + j * BELT_ROW_H;
      const color = beltColor(inp.belt.mark);
      const producedHere = inp.produced && groupIds.has(inp.itemId);
      // 该物料在机器顶部的专属入口 handle + 主干整体横向偏移（让线竖直落到自己的入口）。
      const inHandle = `t${j}`;
      const offX = portOffset(j, k);
      // 主干入口的目标端：N≥2 → 第一个分离器左侧；N=1 → 机器该物料的入口 handle。
      const firstTarget =
        N >= 2 ? { id: `s:${g.itemId}:${inp.itemId}:0`, h: 'l' } : { id: `m:${g.itemId}:0`, h: inHandle };

      // 入口边：来自上游机器组的输出端点（跨带）或本地原料/供给源卡片。
      if (producedHere) {
        // 自产上游：入口边由上游组的「输出分流主干」统一绘制（共享主干沿途 tap
        // → 本组 manifold 头部），此处不再从 out:<料> 单独引一条独立源，
        // 避免把「一条主干分流」画成「多个独立源」。firstTarget 已按同一算法
        // 由 consumerEntry() 在上游侧复现。
      } else {
        const srcNode: BpSourceNode = {
          id: `src:${g.itemId}:${inp.itemId}`,
          type: 'bpSource',
          position: { x: SRC_X, y: beltY + DEV / 2 - SOURCE_H / 2 },
          width: SOURCE_W,
          height: SOURCE_H,
          data: {
            itemName: itemLabel(inp.itemId, lang, data),
            itemImage: data.items[inp.itemId]?.image ?? '',
            flowText: `${formatRate(inp.totalFlow)}/min`,
            beltMark: inp.belt.mark,
            beltColor: color,
            overBelt: inp.overBelt,
            beltCount: inp.beltCount,
            kind: inp.kind === 'supplied' ? 'supplied' : 'raw',
          },
        };
        nodes.push(srcNode);
        edges.push(
          makeEdge(
            `bpin:${g.itemId}:${inp.itemId}`,
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
          id: `s:${g.itemId}:${inp.itemId}:${i}`,
          type: 'bpDevice',
          position: { x: centerX(i) + offX - DEV / 2, y: beltY },
          width: DEV,
          height: DEV,
          data: { device: 'splitter', beltColor: color, branchText: tapLabel },
        };
        nodes.push(devNode);
        // 抽一台：分离器 → 该台机器该物料的入口 handle（竖直落线）。
        edges.push(
          makeEdge(
            `stap:${g.itemId}:${inp.itemId}:${i}`,
            devNode.id,
            'b',
            `m:${g.itemId}:${i}`,
            inHandle,
            { color, label: tapLabel, arrow: true },
          ),
        );
        // 尾料续接：非最后一个分离器 → 下一个分离器；最后一个 → 最后一台机器。
        if (i < N - 2) {
          edges.push(
            makeEdge(
              `scont:${g.itemId}:${inp.itemId}:${i}`,
              devNode.id,
              'r',
              `s:${g.itemId}:${inp.itemId}:${i + 1}`,
              'l',
              { color },
            ),
          );
        } else {
          edges.push(
            makeEdge(
              `stail:${g.itemId}:${inp.itemId}`,
              devNode.id,
              'r',
              `m:${g.itemId}:${N - 1}`,
              inHandle,
              { color, label: tapLabel, arrow: true },
            ),
          );
        }
      }
    });

    // --- 输出 manifold：各台机器 → 合并器级联 → 输出端点 ---
    const outXpos = GX + (N - 1) * MACHINE_DX + MACHINE_W + 52;
    const outNode: BpOutNode = {
      id: `out:${g.itemId}`,
      type: 'bpOut',
      position: { x: outXpos, y: outY + DEV / 2 - OUT_H / 2 },
      width: OUT_W,
      height: OUT_H,
      data: {
        itemName: itemLabel(g.itemId, lang, data),
        itemImage: data.items[g.itemId]?.image ?? '',
        flowText: `${formatRate(g.totalRate)}/min`,
        beltMark: g.outputBelt.mark,
        beltColor: beltColor(g.outputBelt.mark),
        overBelt: g.outputOverBelt,
        beltCount: g.outputBeltCount,
        isProduct: g.isProduct,
      },
    };
    nodes.push(outNode);

    const outColor = beltColor(g.outputBelt.mark);
    const perOut = `${formatRate(g.perMachineRate)}/min`;
    if (N === 1) {
      edges.push(
        makeEdge(`oout:${g.itemId}`, `m:${g.itemId}:0`, 'b', outNode.id, 'l', {
          color: outColor,
          label: `${formatRate(g.totalRate)}/min`,
          beltMark: g.outputBelt.mark,
          overBelt: g.outputOverBelt,
          beltCount: g.outputBeltCount,
          arrow: true,
        }),
      );
    } else {
      for (let i = 1; i <= N - 1; i++) {
        const devNode: BpDeviceNode = {
          id: `g:${g.itemId}:${i}`,
          type: 'bpDevice',
          position: { x: centerX(i) - DEV / 2, y: outY },
          width: DEV,
          height: DEV,
          data: { device: 'merger', beltColor: outColor, branchText: perOut },
        };
        nodes.push(devNode);
        // 该台机器产物汇入其正下方合并器顶部。
        edges.push(
          makeEdge(`gin:${g.itemId}:${i}`, `m:${g.itemId}:${i}`, 'b', devNode.id, 't', {
            color: outColor,
            label: perOut,
            arrow: true,
          }),
        );
        if (i < N - 1) {
          edges.push(
            makeEdge(`gcont:${g.itemId}:${i}`, devNode.id, 'r', `g:${g.itemId}:${i + 1}`, 'l', {
              color: outColor,
            }),
          );
        } else {
          edges.push(
            makeEdge(`gout:${g.itemId}`, devNode.id, 'r', outNode.id, 'l', {
              color: outColor,
              label: `${formatRate(g.totalRate)}/min`,
              beltMark: g.outputBelt.mark,
              overBelt: g.outputOverBelt,
              beltCount: g.outputBeltCount,
              arrow: true,
            }),
          );
        }
      }
      // 第一台机器产物从左侧汇入首个合并器主干。
      edges.push(
        makeEdge(`gfirst:${g.itemId}`, `m:${g.itemId}:0`, 'b', `g:${g.itemId}:1`, 'l', {
          color: outColor,
          label: perOut,
        }),
      );
    }

    // --- 输出分流主干：产物被多个下游消费时，从共享主干沿途 tap 到各下游 ---
    // 单下游 → 直连（不引入分流节点）；≥2 下游 → 主干接 N-1 个分离器，
    // 每个分离器抽走一股给对应下游，尾料给最后一个下游。跨组落到下游 manifold 头部。
    const taps = g.outputTaps;
    if (taps.length === 1) {
      const t0 = taps[0];
      const target = byItemGroup.get(t0.targetItemId);
      if (target) {
        const entry = consumerEntry(target, g.itemId);
        edges.push(
          makeEdge(`bpin:${t0.targetItemId}:${g.itemId}`, outNode.id, 'b', entry.id, entry.h, {
            color: beltColor(t0.belt.mark),
            label: `${formatRate(t0.flow)}/min`,
            beltMark: t0.belt.mark,
            overBelt: t0.overBelt,
            beltCount: t0.beltCount,
            arrow: true,
          }),
        );
      }
    } else if (taps.length >= 2) {
      const tapBaseX = outXpos + OUT_W + 44;
      const lastSplit = taps.length - 2; // 最后一个分离器索引（尾料下游不占分离器）
      for (let i = 0; i <= lastSplit; i++) {
        const tp = taps[i];
        const branchColor = beltColor(tp.belt.mark);
        const devNode: BpDeviceNode = {
          id: `d:${g.itemId}:${i}`,
          type: 'bpDevice',
          position: { x: tapBaseX + i * TAP_DX, y: outY },
          width: DEV,
          height: DEV,
          data: {
            device: 'splitter',
            beltColor: branchColor,
            branchText: `${formatRate(tp.flow)}/min`,
          },
        };
        nodes.push(devNode);

        // 主干进料：out 端点 → 首个分离器（标主干总产）；否则上一个分离器续接（标剩余）。
        if (i === 0) {
          edges.push(
            makeEdge(`dtrunk:${g.itemId}`, outNode.id, 'b', devNode.id, 'l', {
              color: outColor,
              label: `${formatRate(g.totalRate)}/min`,
              beltMark: g.outputBelt.mark,
              overBelt: g.outputOverBelt,
              beltCount: g.outputBeltCount,
              arrow: true,
            }),
          );
        } else {
          const prevRemaining = taps[i - 1].remaining;
          const contBelt = suggestBelt(prevRemaining);
          edges.push(
            makeEdge(`dcont:${g.itemId}:${i}`, `d:${g.itemId}:${i - 1}`, 'r', devNode.id, 'l', {
              color: beltColor(contBelt.mark),
              label: `${formatRate(prevRemaining)}/min`,
              beltMark: contBelt.mark,
            }),
          );
        }

        // 抽料支路：分离器 → 该下游输入 manifold 头部。
        const target = byItemGroup.get(tp.targetItemId);
        if (target) {
          const entry = consumerEntry(target, g.itemId);
          edges.push(
            makeEdge(`dtap:${g.itemId}:${tp.targetItemId}`, devNode.id, 'b', entry.id, entry.h, {
              color: branchColor,
              label: `${formatRate(tp.flow)}/min`,
              beltMark: tp.belt.mark,
              overBelt: tp.overBelt,
              beltCount: tp.beltCount,
              arrow: true,
            }),
          );
        }

        // 尾料：最后一个分离器的续接口 → 最后一个下游（吃主干剩余）。
        if (i === lastSplit) {
          const tail = taps[taps.length - 1];
          const tailTarget = byItemGroup.get(tail.targetItemId);
          if (tailTarget) {
            const entry = consumerEntry(tailTarget, g.itemId);
            edges.push(
              makeEdge(`dtail:${g.itemId}:${tail.targetItemId}`, devNode.id, 'r', entry.id, entry.h, {
                color: beltColor(tail.belt.mark),
                label: `${formatRate(tail.flow)}/min`,
                beltMark: tail.belt.mark,
                overBelt: tail.overBelt,
                beltCount: tail.beltCount,
                arrow: true,
              }),
            );
          }
        }
      }
    }

    y = outY + DEV + BAND_GAP;
  }

  return { nodes, edges, plan };
}
