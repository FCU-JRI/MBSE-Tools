import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, BaseEdge, ConnectionMode, EdgeLabelRenderer, Handle, MarkerType, NodeResizer, Position, ReactFlow, ReactFlowProvider, SelectionMode, ViewportPortal, useEdgesState, useNodesState, useReactFlow, useStoreApi } from "@xyflow/react";
import type { Connection, Edge, EdgeProps, Node, NodeProps } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import { api } from "./api.ts";
import type { Annotation, Diagrams, Element, Layout, Meta, View } from "./api.ts";
import { ALL_LINKS, ANALYSIS_LINKS, analysisPalette, BEND, bendsOf, moveBends, buildGraph, CATEGORY_SHAPE, CUSTOM_DEFAULT, frameLabel, insertAt, LINK_TOOLS, modelItems, NODE_LIMIT, paletteOf, PKG_TAB, rocketLayout, seedLayout, STRUCTURAL_KINDS, suggestPartName, withBends } from "./model.ts";
import { expandFirst, PACKAGE_ZH, zhKeyword } from "./method/zh.ts";
import type { DiagramDef, GEdge, GNode, Graph, LinkTool } from "./model.ts";
import { annotationSvg, edgeMarkers, frameLayout, frameSvg, iconSvg, MARKERS, markerSvg, nodeSvg, SCREEN } from "./shapes.ts";
import { downloadPng, downloadSvg, toSvg } from "./exportSvg.ts";

/** g：模型元素的節點；a：草稿標註（便箋、外框、文字，不進模型）。 */
type NData = { g?: GNode; a?: Annotation; editable?: boolean; onResize?: (id: string, box: { x: number; y: number; w: number; h: number }) => void };
type FlowNode = Node<NData>;
const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

/** 節點：以 SysML 記法的 SVG 繪製；四邊各一個連接點，起訖都可用。 */
function ElementNode({ data, selected }: NodeProps<FlowNode>) {
  const g = data.g!;
  const svg = useMemo(() => nodeSvg(g, 0, 0, SCREEN, selected ? 2 : 1), [g, selected]);
  return (
    <div className={`sysml-node ${selected ? "is-selected" : ""}`} style={{ width: g.width, height: g.height }}>
      <svg width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={`${g.keyword} ${g.name}`.trim() || g.shape} dangerouslySetInnerHTML={{ __html: svg }} />
      {SIDES.map((p) => <Handle key={p} id={p} type="source" position={p} isConnectable={!!g.el} style={g.el ? undefined : { visibility: "hidden" }} />)}
      {/* 連接埠與參數的小方塊：連線接在方塊上（規範 8.2.3.12、8.2.3.17）；不能從這裡拉新的線 */}
      {(g.ports ?? []).map((p) => <Handle key={`p:${p.key}`} id={`p:${p.key}`} type="source" position={p.side === "left" ? Position.Left : Position.Right} isConnectable={false} className="port-handle" style={{ top: p.y }} />)}
    </div>
  );
}

const NOTE_ZH: Record<Annotation["type"], string> = { note: "草稿便箋", frame: "草稿外框", text: "草稿文字" };
const NOTE_NEW: Record<Annotation["type"], { w: number; h: number; text: string }> = { note: { w: 192, h: 72, text: "註解" }, frame: { w: 360, h: 240, text: "外框" }, text: { w: 168, h: 24, text: "文字" } };

/** 標註節點：選取後可拖曳邊框調整大小。 */
function NoteNode({ id, data, selected, width, height }: NodeProps<FlowNode>) {
  const a = data.a!;
  const w = Math.round(width ?? a.w), h = Math.round(height ?? a.h);
  const svg = useMemo(() => annotationSvg({ ...a, w, h }, 0, 0, SCREEN, selected ? 2 : 1), [a, w, h, selected]);
  return (
    <div className={`sysml-node note-${a.type} ${selected ? "is-selected" : ""}`} style={{ width: w, height: h }}>
      {data.editable && <NodeResizer isVisible={selected} minWidth={48} minHeight={24} lineClassName="note-resize-line" handleClassName="note-resize-handle"
        onResizeEnd={(_e, p) => data.onResize?.(id, { x: snap(p.x), y: snap(p.y), w: snap(p.width), h: snap(p.height) })} />}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${NOTE_ZH[a.type]}：${a.text}`} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
/** 套件節點：資料夾形狀，選取後可拖曳邊框調整大小。成員畫在它上面。 */
function PackageNode({ id, data, selected, width, height }: NodeProps<FlowNode>) {
  const g = data.g!;
  const w = Math.round(width ?? g.width), h = Math.round(height ?? g.height);
  const svg = useMemo(() => nodeSvg({ ...g, width: w, height: h }, 0, 0, SCREEN, selected ? 2 : 1), [g, w, h, selected]);
  return (
    <div className={`sysml-node pkg ${selected ? "is-selected" : ""}`} style={{ width: w, height: h }}>
      {data.editable && <NodeResizer isVisible={selected} minWidth={120} minHeight={72} lineClassName="note-resize-line" handleClassName="note-resize-handle"
        onResizeEnd={(_e, p) => data.onResize?.(id, { x: snap(p.x), y: snap(p.y), w: snap(p.width), h: snap(p.height) })} />}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={g.container ? `${g.keyword} ${g.name}` : `package ${g.name}`} dangerouslySetInnerHTML={{ __html: svg }} />
      {/* 系統簡圖的外框（P2）是模型元素，連線可以接在它上面 */}
      {g.container && SIDES.map((p) => <Handle key={p} id={p} type="source" position={p} />)}
    </div>
  );
}
const MARKER_DEFS = Object.values(MARKERS).map((m) => markerSvg(m, "jri-", SCREEN, "auto-start-reverse")).join("");
const nodeTypes = { el: ElementNode, note: NoteNode, pkg: PackageNode };

type Pt0 = { x: number; y: number };
/** onBends：拖曳中（commit 為 false）只更新畫面，放開時才存進版面紀錄 */
type EData = { g: GEdge; bends?: Pt0[]; editable?: boolean; onBends?: (edgeId: string, list: Pt0[], commit: boolean) => void };
/**
 * 手動連線（P2，METHOD.md 1.1 節）：路線完全由使用者決定，不自動繞線。
 * 選取連線後，方塊是轉折點（拖曳移動、按兩下刪除），圓點在每一段的中間（拖曳就多一個轉折點）。在線上按兩下也會加一個轉折點。
 */
function BendEdge({ id, sourceX, sourceY, targetX, targetY, markerStart, markerEnd, style, label, data, selected, interactionWidth }: EdgeProps<Edge<EData>>) {
  const flow = useReactFlow();
  const pts = data?.bends ?? [];
  const all = [{ x: sourceX, y: sourceY }, ...pts, { x: targetX, y: targetY }];
  const path = all.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  // 標籤放在中間那一段的中點
  const mid = Math.floor((all.length - 1) / 2);
  const lx = (all[mid].x + all[mid + 1].x) / 2, ly = (all[mid].y + all[mid + 1].y) / 2;
  const drag = (index: number, insert: boolean) => (ev: React.PointerEvent) => {
    if (!data?.editable || !data.onBends || ev.button !== 0) return;
    ev.stopPropagation(); ev.preventDefault();
    let list = [...pts];
    if (insert) list.splice(index, 0, { x: Math.round((all[index].x + all[index + 1].x) / 2), y: Math.round((all[index].y + all[index + 1].y) / 2) });
    const at = (e: PointerEvent) => { const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }); return { x: snap(p.x), y: snap(p.y) }; };
    const move = (e: PointerEvent) => { const p = at(e); list = list.map((q, k) => (k === index ? p : q)); data.onBends!(id, list, false); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); data.onBends!(id, list, true); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const remove = (index: number) => (ev: React.MouseEvent) => { ev.stopPropagation(); data?.onBends?.(id, pts.filter((_, k) => k !== index), true); };
  return (
    <>
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth ?? 16} />
      <EdgeLabelRenderer>
        {label && <div className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>{label}</div>}
        {selected && data?.editable && <>
          {pts.map((p, i) => <div key={`b${i}`} className="bend-handle nodrag nopan" role="button" aria-label={`轉折點 ${i + 1}`} title="拖曳移動；按兩下刪除這個轉折點"
            style={{ transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)` }} onPointerDown={drag(i, false)} onDoubleClick={remove(i)} />)}
          {all.slice(0, -1).map((p, i) => <div key={`m${i}`} className="bend-handle add nodrag nopan" role="button" aria-label={`在第 ${i + 1} 段加轉折點`} title="拖曳，在這一段加一個轉折點"
            style={{ transform: `translate(-50%, -50%) translate(${(p.x + all[i + 1].x) / 2}px, ${(p.y + all[i + 1].y) / 2}px)` }} onPointerDown={drag(i, true)} />)}
        </>}
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { bend: BendEdge };

type Spot = { x: number; y: number; w?: number; h?: number };
const PKG_PAD = 24;
/** 套件的框：包住成員，上方留標籤頁。 */
function boxAround(members: Box[]): Spot {
  const x = Math.min(...members.map((b) => b.x)) - PKG_PAD, y = Math.min(...members.map((b) => b.y)) - PKG_PAD - PKG_TAB;
  return { x: snap(x), y: snap(y), w: snap(Math.max(...members.map((b) => b.x + b.w)) + PKG_PAD - x) + SNAP, h: snap(Math.max(...members.map((b) => b.y + b.h)) + PKG_PAD - y) + SNAP };
}

function autoLayout(graph: Graph): Record<string, Spot> {
  const dg = new dagre.graphlib.Graph({ compound: true });
  dg.setGraph({ rankdir: graph.direction, nodesep: 40, ranksep: 72, marginx: 24, marginy: 24 });
  dg.setDefaultEdgeLabel(() => ({}));
  const full = new Set(graph.nodes.filter((n) => n.parent).map((n) => n.parent!));
  // 有成員的套件當作群集，讓不同套件的成員不會交錯；空套件當一般節點
  for (const n of graph.nodes) dg.setNode(n.id, n.shape === "package" && full.has(n.id) ? { label: n.id } : { width: n.width, height: n.height });
  for (const n of graph.nodes) if (n.parent) dg.setParent(n.id, n.parent);
  const rev = new Set(graph.reverse ?? []);
  for (const e of graph.edges) if (e.source !== e.target) { if (rev.has(e.kind)) dg.setEdge(e.target, e.source); else dg.setEdge(e.source, e.target); }
  dagre.layout(dg);
  const out: Record<string, Spot> = {};
  for (const n of graph.nodes) {
    if (n.shape === "package") continue;
    const p = dg.node(n.id); out[n.id] = { x: snap(p.x - n.width / 2), y: snap(p.y - n.height / 2) };
  }
  for (const n of graph.nodes) {
    if (n.shape !== "package") continue;
    const members = graph.nodes.filter((m) => m.parent === n.id).map((m) => ({ ...out[m.id], w: m.width, h: m.height }));
    if (members.length) out[n.id] = boxAround(members);
    else { const p = dg.node(n.id); out[n.id] = { x: snap(p.x - n.width / 2), y: snap(p.y - n.height / 2), w: n.width, h: n.height }; }
  }
  return out;
}

/** 格點：畫面上每 24 px 一點，節點貼齊半格。 */
const GRID = 24, SNAP = 12;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

type Box = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };
const hit = (a: Box, b: Box, m = GRID) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/** 只替新加入的節點找位置，既有節點一律不動：放在相連節點的下一層（或上一層），沒有相連的放在整張圖下方；有重疊就沿另一軸往後挪。 */
function placeNew(graph: Graph, known: Record<string, Pt>): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  const size = new Map(graph.nodes.map((n) => [n.id, n]));
  const placed: Box[] = [];
  for (const n of graph.nodes) { const p = known[n.id]; if (p) placed.push({ ...p, w: n.width, h: n.height }); }
  const vertical = graph.direction === "TB" || graph.direction === "BT";
  const sign = graph.direction === "TB" || graph.direction === "LR" ? 1 : -1;
  for (const n of graph.nodes) {
    if (known[n.id] || out[n.id]) continue;
    const at = (id: string) => known[id] ?? out[id];
    const e = graph.edges.find((x) => (x.source === n.id && at(x.target)) || (x.target === n.id && at(x.source)));
    let p: Pt;
    if (e) {
      const otherId = e.source === n.id ? e.target : e.source, o = at(otherId)!, os = size.get(otherId)!;
      const after = (e.target === n.id ? 1 : -1) * sign * ((graph.reverse ?? []).includes(e.kind) ? -1 : 1) > 0; // 在相連節點之後（下方或右方）
      p = vertical
        ? { x: o.x + (os.width - n.width) / 2, y: after ? o.y + os.height + 72 : o.y - n.height - 72 }
        : { x: after ? o.x + os.width + 72 : o.x - n.width - 72, y: o.y + (os.height - n.height) / 2 };
    } else {
      p = placed.length ? { x: Math.min(...placed.map((b) => b.x)), y: Math.max(...placed.map((b) => b.y + b.h)) + 48 } : { x: 24, y: 24 };
    }
    const box: Box = { x: snap(p.x), y: snap(p.y), w: n.width, h: n.height };
    for (let i = 0; i < 400 && placed.some((b) => hit(box, b)); i++) { if (vertical || !e) box.x += GRID; else box.y += GRID; }
    placed.push(box);
    out[n.id] = { x: box.x, y: box.y };
  }
  return out;
}

/** 連接點依圖的方向固定：階層圖一律由上往下（上方節點的底邊接到下方節點的頂邊），流程圖一律由左往右。只有兩個節點在該方向上重疊時才改用另一軸。 */
function sides(a: Box, b: Box, vertical: boolean): [Position, Position] {
  const v: [Position, Position] | null = b.y >= a.y + a.h ? [Position.Bottom, Position.Top] : a.y >= b.y + b.h ? [Position.Top, Position.Bottom] : null;
  const h: [Position, Position] | null = b.x >= a.x + a.w ? [Position.Right, Position.Left] : a.x >= b.x + b.w ? [Position.Left, Position.Right] : null;
  return (vertical ? v ?? h : h ?? v) ?? (vertical ? [Position.Bottom, Position.Top] : [Position.Right, Position.Left]);
}

/**
 * bends：使用者拉的轉折點（P2）。有轉折點的連線、以及分析圖上的連線，畫成照轉折點走的折線（沒有轉折點就是直線），不自動繞線；
 * 兩端接在朝向第一個（最後一個）轉折點的那一邊。其餘照舊。
 */
function toEdge(e: GEdge, pos: Map<string, Box>, vertical: boolean, straight: boolean, bends: Pt0[] = [], manual = false, onBends?: EData["onBends"]): Edge {
  const a = pos.get(e.source), b = pos.get(e.target);
  const dot = (p: Pt0): Box => ({ x: p.x, y: p.y, w: 0, h: 0 });
  const [sh, th] = a && b ? (bends.length ? [sides(a, dot(bends[0]), vertical)[0], sides(dot(bends[bends.length - 1]), b, vertical)[1]] : sides(a, b, vertical)) : vertical ? [Position.Bottom, Position.Top] : [Position.Right, Position.Left];
  const marks = edgeMarkers(e);
  const free = manual || bends.length > 0;
  return {
    id: e.id, source: e.source, target: e.target, sourceHandle: e.sourcePort ? `p:${e.sourcePort}` : sh, targetHandle: e.targetPort ? `p:${e.targetPort}` : th, label: e.label || undefined,
    data: { g: e, bends, editable: !!onBends, onBends },
    type: free ? "bend" : straight ? "straight" : "smoothstep", pathOptions: { borderRadius: 0 },
    style: { strokeWidth: 1, strokeDasharray: e.dashed ? "6 4" : undefined }, labelBgPadding: [4, 2],
    markerStart: marks.start ? `jri-${marks.start.id}` : undefined,
    markerEnd: e.head === "open" ? { type: MarkerType.Arrow, color: "currentColor", width: 18, height: 18, strokeWidth: 1.2 } : marks.end ? `jri-${marks.end.id}` : undefined,
    // 每條線都選得到，才拉得了轉折點；不能刪的線（例如「由誰定義」）仍不能刪
    selectable: true, focusable: e.remove !== null,
  } as Edge;
}
const boxes = (list: { id: string; position: { x: number; y: number }; data: NData }[]) =>
  new Map<string, Box>(list.filter((n) => n.data.g).map((n) => [n.id, { x: n.position.x, y: n.position.y, w: n.data.g!.width, h: n.data.g!.height }]));

/** 圖框的留白（畫面）。 */
const FRAME_PAD = 36;
/** 貼在圖框邊上的節點（參數、這個定義自己的連接埠）跟著圖框放；其餘節點不動。 */
function placeBoundary(list: FlowNode[], notes: Annotation[]): FlowNode[] {
  const edge = list.filter((n) => n.data.g?.boundary);
  if (!edge.length) return list;
  const inner = list.filter((n) => !n.data.g?.boundary).map((n) => ({ x: n.position.x, y: n.position.y, w: n.data.g?.width ?? n.width ?? n.data.a?.w ?? 0, h: n.data.g?.height ?? n.height ?? n.data.a?.h ?? 0 }));
  const fl = frameLayout(inner.length ? inner : notes.map((a) => ({ x: a.x, y: a.y, w: a.w, h: a.h })), edge.map((n) => ({ id: n.id, boundary: n.data.g!.boundary!, width: n.data.g!.width, height: n.data.g!.height })), FRAME_PAD);
  return list.map((n) => (fl.places.has(n.id) ? { ...n, position: fl.places.get(n.id)! } : n));
}

export interface DiagramProps {
  readOnly?: boolean;
  view: View; meta: Meta; def: DiagramDef;
  /** 自訂圖與標註；由上層負責儲存 */
  extra: Diagrams; onExtra: (next: Diagrams) => void;
  selectedId: string | null;
  onSelectElement: (id: string | null) => void;
  onSelectEdge: (e: GEdge | null) => void;
  onNew: (category: string, parentId: string | null) => void;
  onChanged: (v: View) => void;
  onError: (m: string) => void;
}

export function Diagram(props: DiagramProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}

type IconName = Parameters<typeof iconSvg>[0];
/** 工具按鈕。沒有圖形圖示的用一個字元代替，工具列收合時仍看得出是什麼。 */
function Tool({ on, onClick, icon, glyph, text, sub, disabled, title, danger }: { on?: boolean; onClick: () => void; icon?: IconName; glyph?: string; text: string; sub?: string; disabled?: boolean; title?: string; danger?: boolean }) {
  return (
    <button className={`tool ${danger ? "danger" : ""}`} aria-pressed={on} disabled={disabled} onClick={onClick} title={title ?? text} aria-label={text}>
      {icon ? <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(icon, SCREEN) }} />
        : <i className="glyph" aria-hidden="true">{glyph ?? text.slice(0, 1)}</i>}
      <span>{text}{sub && <small>{sub}</small>}</span>
    </button>
  );
}

// 每個人自己的偏好，存在瀏覽器；讀不到就用預設值
const load = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; } };
const store = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 無法儲存時只在本次有效 */ } };
/** 觸控裝置：單指拖曳維持移動畫面，不做框選 */
const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const newId = (prefix: string) => `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const linkIconOf = (k: string): IconName => (k === "compose" ? "diamond" : ["refine", "trace"].includes(k) ? "dashed" : "line"); // 衍生是連結，畫實線
type Moved = View & { moved: Record<string, string>; packageId: string | null; layout: Layout; diagrams: Diagrams };

function Canvas({ readOnly, view, meta, def, extra, onExtra, selectedId, onSelectElement, onSelectEdge, onNew, onChanged, onError }: DiagramProps) {
  const pid = view.project.id;
  const flow = useReactFlow();
  const rf = useStoreApi();
  const custom = def.kind === "custom";
  /** 分析圖（P2）：一個階段一張，成員由使用者放進來，和自訂圖一樣可以放任何元素 */
  const analysis = def.kind === "analysis";
  const av = def.view;
  const [layout, setLayout] = useState<Layout | null>(null);
  const catPkgs = useMemo(() => new Set(meta.categories.map((c) => c.pkg)), [meta]);
  // 剛在這張圖上建立、還沒有成員的套件與還沒有對象的註解：只要在這張圖有位置就畫出來
  const shownKey = Object.keys(layout?.[def.id] ?? {}).join("|");
  const graph = useMemo(() => buildGraph(def, view.analysis, { packages: catPkgs, shown: new Set(shownKey ? shownKey.split("|") : []) }), [def, view.analysis, catPkgs, shownKey]);
  const notes = useMemo(() => extra.notes[def.id] ?? [], [extra, def.id]);
  const [tool, setTool] = useState<string>("select"); // "select" 或連線種類
  const [selEdge, setSelEdge] = useState<GEdge | null>(null);
  const [selNote, setSelNote] = useState<string | null>(null);
  /** 同時選取兩個以上時的節點（元素、套件、草稿標註都算） */
  const [multi, setMulti] = useState<string[]>([]);
  const multiRef = useRef<string[]>([]);
  /** 右鍵選單：位置相對於畫布；ask 為 true 時顯示刪除的確認 */
  const [menu, setMenu] = useState<null | { x: number; y: number; on: "pane" | "item"; ask?: boolean }>(null);
  /** 「放進新套件」：套件建立後要搬進去的項目 */
  const pkgFor = useRef<string[] | null>(null);
  // 按住 Shift 捲動（滑鼠滾輪或觸控板兩指滑動）＝平移畫面；不按是縮放。
  // 用原生事件並搶在圖形元件之前處理，才擋得住它預設的縮放。
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey) return;
      if (!(e.target as HTMLElement | null)?.closest?.(".react-flow")) return;
      e.preventDefault(); e.stopPropagation();
      const k = e.deltaMode === 1 ? 20 : 1; // 以「行」為單位的滾輪換算成像素
      const v = flow.getViewport();
      flow.setViewport({ x: v.x - e.deltaX * k, y: v.y - e.deltaY * k, zoom: v.zoom });
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [flow]);
  const [confirm, setConfirm] = useState<null | "selection" | "diagram">(null);
  const [panel, setPanel] = useState<null | "all" | "add" | "rename" | "pkg" | "part">(null);
  /** 「加入零件」選好的型別與零件名稱（階段 3b） */
  const [partPick, setPartPick] = useState<{ type: Element; name: string } | null>(null);
  const [withDraft, setWithDraft] = useState(() => load("jri.export", { draft: false }).draft);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(() => load("jri.toolbox", { collapsed: false }).collapsed);
  const [pins, setPins] = useState(() => load("jri.tools.custom", CUSTOM_DEFAULT));
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const layoutRef = useRef<Layout>({});
  const extraRef = useRef(extra); extraRef.current = extra;
  const canvasRef = useRef<HTMLDivElement>(null);
  /** 在自訂圖按了元素工具之後，下一個新建立的項目自動放進這張圖 */
  const pending = useRef<Set<string> | null>(null);
  /** 最近一次版面存檔；搬進套件前要等它寫完，伺服器才換得到正確的識別碼 */
  const lastSave = useRef<Promise<unknown>>(Promise.resolve());
  /** 拖曳開始時的位置：套件帶著成員一起移動、搬移失敗時放回原位用 */
  const drag = useRef<{ starts: Map<string, { x: number; y: number }>; pkgs: Map<string, { x: number; y: number }>; members: Map<string, { pkg: string; x: number; y: number }> } | null>(null);

  // 第一層工具：一般的圖用該圖固定的項目，自訂圖用釘選的項目
  const elTools = custom ? pins.els.filter((c) => meta.categories.some((x) => x.id === c))
    : analysis ? (av?.pinned ?? []).filter((c) => meta.categories.some((x) => x.id === c)) : paletteOf(def, view.analysis, meta.categories);
  // 套件內容圖與分解圖的內容由擁有關係決定，不在這裡畫套件的框
  const structural = STRUCTURAL_KINDS.has(def.kind);
  const allowedLinks = LINK_TOOLS[def.kind];
  const linkTools: LinkTool[] = custom ? ALL_LINKS.filter((t) => pins.links.includes(t.kind)) : analysis ? ALL_LINKS.filter((t) => (av?.links ?? ANALYSIS_LINKS).includes(t.kind)) : allowedLinks;

  useEffect(() => { api<Layout>(`/projects/${pid}/layout`).then((l) => { layoutRef.current = l; setLayout(l); }).catch(() => setLayout({})); }, [pid]);
  useEffect(() => { setTool("select"); setSelEdge(null); setSelNote(null); setConfirm(null); setPanel(null); setMenu(null); multiRef.current = []; setMulti([]); pending.current = null; }, [def.id]);

  const vertical = graph.direction === "TB" || graph.direction === "BT";
  const straight = false; // 一律走直角折線
  const saveLayout = useCallback((next: Layout) => {
    layoutRef.current = next;
    if (readOnly) return; // 唯讀時位置只留在這次瀏覽
    // 只送這張圖：別人同時在排別張圖時不會互相蓋掉
    lastSave.current = api(`/projects/${pid}/layout`, "PATCH", { diagram: def.id, nodes: next[def.id] ?? null }).catch((e) => onError((e as Error).message));
  }, [pid, onError, readOnly, def.id]);
  /** 位置存檔並重畫（新增套件或註解、伺服器換過識別碼之後） */
  const applyLayout = useCallback((next: Layout, save = true) => { if (save) saveLayout(next); else layoutRef.current = next; setLayout(next); }, [saveLayout]);
  const onPkgResize = useCallback((id: string, b: { x: number; y: number; w: number; h: number }) => {
    saveLayout({ ...layoutRef.current, [def.id]: { ...(layoutRef.current[def.id] ?? {}), [id]: b } });
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, position: { x: b.x, y: b.y }, width: b.w, height: b.h, data: { ...n.data, g: { ...n.data.g!, width: b.w, height: b.h } } } : n)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id, saveLayout]);

  const setNotes = useCallback((fn: (list: Annotation[]) => Annotation[]) => {
    const cur = extraRef.current;
    const list = fn(cur.notes[def.id] ?? []);
    const all = { ...cur.notes };
    if (list.length) all[def.id] = list; else delete all[def.id];
    const next = { ...cur, notes: all };
    extraRef.current = next; onExtra(next);
  }, [def.id, onExtra]);
  const setMembers = useCallback((fn: (ids: string[]) => string[]) => {
    const cur = extraRef.current;
    const next = def.kind === "analysis"
      ? { ...cur, views: { ...(cur.views ?? {}), [def.id]: fn(cur.views?.[def.id] ?? []) } }
      : { ...cur, custom: cur.custom.map((c) => (c.id === def.id ? { ...c, members: fn(c.members) } : c)) };
    extraRef.current = next; onExtra(next);
  }, [def.id, def.kind, onExtra]);
  const onResize = useCallback((id: string, b: { x: number; y: number; w: number; h: number }) => setNotes((l) => l.map((n) => (n.id === id ? { ...n, ...b } : n))), [setNotes]);

  // 自訂圖：剛建立的項目放進這張圖
  useEffect(() => {
    if (!(custom || analysis) || !pending.current) return;
    const before = pending.current;
    const fresh = modelItems(view.analysis.elements).filter((e) => !before.has(e.id)).map((e) => e.id);
    if (fresh.length === 0) return;
    pending.current = null;
    setMembers((ids) => [...ids, ...fresh.filter((x) => !ids.includes(x))]);
  }, [view.analysis, custom, analysis, setMembers]);

  // ───────── 手動連線（P2）：轉折點存在版面紀錄裡，不自動繞線 ─────────
  const bendsRef = useRef<(edgeId: string, list: Pt0[], commit: boolean) => void>(() => {});
  const onBends = useCallback((edgeId: string, list: Pt0[], commit: boolean) => bendsRef.current(edgeId, list, commit), []);
  const edgesOf = (b: Map<string, Box>) => graph.edges.map((e) => toEdge(e, b, vertical, straight, bendsOf(layoutRef.current[def.id], e.key ?? e.id), analysis, readOnly ? undefined : onBends));
  bendsRef.current = (edgeId, list, commit) => {
    const g = graph.edges.find((e) => e.id === edgeId);
    if (!g) return;
    const b = boxes(flow.getNodes() as FlowNode[]);
    setEdges((es) => es.map((x) => (x.id === edgeId ? { ...toEdge(g, b, vertical, straight, list, analysis, onBends), selected: x.selected } : x)));
    if (commit) saveLayout({ ...layoutRef.current, [def.id]: withBends(layoutRef.current[def.id], g.key ?? g.id, list) });
  };
  /** 在線上按兩下：在最近的那一段加一個轉折點 */
  const addBend = (ev: React.MouseEvent, ed: Edge) => {
    if (readOnly) return;
    const d = ed.data as EData;
    const p = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    const mid = (id: string) => { const n = flow.getNode(id) as FlowNode | undefined; return n ? { x: n.position.x + (n.data.g?.width ?? 0) / 2, y: n.position.y + (n.data.g?.height ?? 0) / 2 } : p; };
    const list = [...(d.bends ?? [])];
    const at = insertAt([mid(ed.source), ...list, mid(ed.target)], p);
    list.splice(at, 0, { x: snap(p.x), y: snap(p.y) });
    onBends(ed.id, list, true);
  };
  const hasBends = Object.keys(layout?.[def.id] ?? {}).some((k) => k.startsWith(BEND));
  /** 「自動排列」前的位置：排好之後用來把轉折點跟著節點移過去 */
  const rearrangeFrom = useRef<Record<string, Spot> | null>(null);

  useEffect(() => {
    if (!layout) return;
    // 位置一旦決定就存起來，之後編輯模型不會重排；只有「自動排列」會整張重排。
    // 新的套件內容圖與分解圖還沒有紀錄時，沿用舊結構分解圖裡同一個節點的位置
    // 貼在圖框邊上的節點不排版、不存位置，由圖框決定
    const inner = { ...graph, nodes: graph.nodes.filter((g) => !g.boundary) };
    const saved = seedLayout(layoutRef.current, def, inner.nodes.map((g) => g.id));
    const missing = inner.nodes.filter((g) => !saved[g.id]);
    let pos: Record<string, Spot> = saved;
    if (missing.length > 0) {
      if (inner.arrange === "rocket") {
        // 系統簡圖（P2）：外框裡的零件由上而下疊成一枚火箭，其餘的再找空位
        pos = { ...saved, ...rocketLayout(inner, saved) };
        pos = { ...pos, ...placeNew(inner, pos) };
      } else if (!inner.nodes.some((g) => saved[g.id])) pos = { ...saved, ...autoLayout(inner) };
      else {
        // 還沒有位置的套件：先讓成員各自就位，再用框包住它們
        const plain = { ...inner, nodes: inner.nodes.filter((g) => g.shape !== "package" || saved[g.id]) };
        pos = { ...saved, ...placeNew(plain, saved) };
        for (const g of inner.nodes) {
          if (g.shape !== "package" || pos[g.id]) continue;
          const members = inner.nodes.filter((m) => m.parent === g.id && pos[m.id]).map((m) => ({ ...pos[m.id], w: m.width, h: m.height }));
          pos = { ...pos, ...(members.length ? { [g.id]: boxAround(members) } : placeNew({ ...inner, nodes: [g] }, {})) };
        }
      }
      // 自動排列：保留手動轉折點，跟著兩端節點的新位置移動
      if (rearrangeFrom.current) { pos = moveBends(rearrangeFrom.current, pos, graph.edges); rearrangeFrom.current = null; }
      saveLayout({ ...layoutRef.current, [def.id]: pos });
    } else if (saved !== layoutRef.current[def.id] && inner.nodes.length > 0) saveLayout({ ...layoutRef.current, [def.id]: pos }); // 全部沿用舊位置時也記到這張圖底下
    const isSel = (id: string, single: boolean) => (multiRef.current.length ? multiRef.current.includes(id) : single);
    const els: FlowNode[] = placeBoundary(graph.nodes.map((g0) => {
      const p = pos[g0.id] ?? { x: 0, y: 0 };
      if (g0.boundary) return { id: g0.id, type: "el", position: { x: p.x, y: p.y }, data: { g: g0 }, selected: isSel(g0.id, g0.id === selectedId), selectable: !!g0.el, draggable: false, width: g0.width, height: g0.height };
      if (g0.shape !== "package" && !g0.container) return { id: g0.id, type: "el", position: { x: p.x, y: p.y }, data: { g: g0 }, selected: isSel(g0.id, g0.id === selectedId), selectable: !!g0.el, width: g0.width, height: g0.height };
      const g = { ...g0, width: p.w ?? g0.width, height: p.h ?? g0.height };
      return { id: g.id, type: "pkg", position: { x: p.x, y: p.y }, data: { g, editable: !readOnly, onResize: onPkgResize }, selected: isSel(g.id, g.id === selectedId), connectable: !!g.container, width: g.width, height: g.height, zIndex: -1 };
    }), notes);
    const marks: FlowNode[] = notes.map((a) => ({ id: a.id, type: "note", position: { x: a.x, y: a.y }, data: { a, editable: !readOnly, onResize }, selected: isSel(a.id, a.id === selNote), draggable: !readOnly, connectable: false, width: a.w, height: a.h, zIndex: a.type === "frame" ? -1 : 2 }));
    setNodes([...marks.filter((n) => n.data.a!.type === "frame"), ...els, ...marks.filter((n) => n.data.a!.type !== "frame")]);
    setEdges(edgesOf(boxes(els)));
    // selectedId 的變化由下一個 effect 處理，避免重排版面
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, layout, def.id, notes]);

  useEffect(() => {
    const want = (n: FlowNode) => (multiRef.current.length ? multiRef.current.includes(n.id) : n.data.a ? n.id === selNote : n.id === selectedId);
    setNodes((ns) => ns.map((n) => (n.selected === want(n) ? n : { ...n, selected: want(n) })));
  }, [selectedId, selNote, setNodes]);

  // 框選或 Ctrl／Shift 加選：兩個以上就進入多選，右側不顯示單一項目
  const onSelectionChange = useCallback(({ nodes: ns }: { nodes: Node[] }) => {
    const ids = ns.map((n) => n.id);
    const next = ids.length > 1 ? ids : [];
    const was = multiRef.current;
    if (next.join("|") === was.join("|")) return;
    multiRef.current = next; setMulti(next);
    if (next.length) { setSelEdge(null); setSelNote(null); setConfirm(null); onSelectEdge(null); onSelectElement(null); return; }
    // 從多選減到剩一個：當成單選
    const one = ns[0] as FlowNode | undefined;
    if (one?.data.a) setSelNote(one.id); else if (one?.data.g?.el) onSelectElement(one.id);
  }, [onSelectEdge, onSelectElement]);

  const act = useCallback(async (fn: () => Promise<View>) => {
    setBusy(true);
    try { onChanged(await fn()); return true; } catch (e) { onError((e as Error).message); return false; } finally { setBusy(false); }
  }, [onChanged, onError]);

  /** 把項目搬進套件（pkg）或搬出（null）。伺服器會把版面與自訂圖裡的識別碼一起換掉。 */
  const moveTo = useCallback(async (ids: string[], pkg: string | null): Promise<Moved | null> => {
    setBusy(true);
    try {
      await lastSave.current;
      const r = await api<Moved>(`/projects/${pid}/elements/move`, "POST", { ids, packageId: pkg });
      applyLayout(r.layout, false);
      extraRef.current = r.diagrams; onExtra(r.diagrams);
      onChanged(r);
      if (selectedId && r.moved[selectedId]) onSelectElement(r.moved[selectedId]);
      return r;
    } catch (e) { onError((e as Error).message); return null; } finally { setBusy(false); }
  }, [pid, applyLayout, onExtra, onChanged, onError, onSelectElement, selectedId]);

  const byId = useMemo(() => new Map(view.analysis.elements.map((e) => [e.id, e])), [view.analysis]);
  const onNodeDragStart = useCallback((_e: unknown, _n: FlowNode, moving: FlowNode[]) => {
    const ids = new Set(moving.map((n) => n.id));
    const all = flow.getNodes() as FlowNode[];
    drag.current = {
      starts: new Map(moving.map((n) => [n.id, { ...n.position }])),
      pkgs: new Map(moving.filter((n) => n.type === "pkg").map((n) => [n.id, { ...n.position }])),
      // 套件的成員跟著套件走（自己也在拖曳中的除外）
      // 系統簡圖（P2）外框裡的零件也跟著外框走
      members: new Map(all.flatMap((n) => { const o = n.data.g?.parent ?? n.data.g?.inside; return o && ids.has(o) && !ids.has(n.id) ? [[n.id, { pkg: o, ...n.position }] as const] : []; })),
    };
  }, [flow]);
  const onNodeDrag = useCallback((_e: unknown, _n: FlowNode, moving: FlowNode[]) => {
    const d = drag.current;
    if (!d || d.members.size === 0) return;
    const delta = new Map(moving.filter((n) => d.pkgs.has(n.id)).map((n) => [n.id, { x: n.position.x - d.pkgs.get(n.id)!.x, y: n.position.y - d.pkgs.get(n.id)!.y }]));
    setNodes((ns) => ns.map((n) => { const m = d.members.get(n.id), dd = m && delta.get(m.pkg); return m && dd ? { ...n, position: { x: m.x + dd.x, y: m.y + dd.y } } : n; }));
  }, [setNodes]);

  const onNodeDragStop = useCallback((_e: unknown, _n: FlowNode, moved: FlowNode[]) => {
    const all = flow.getNodes() as FlowNode[];
    const cur = { ...(layoutRef.current[def.id] ?? {}) };
    const marks = new Map<string, { x: number; y: number }>();
    const carried = drag.current?.members ?? new Map();
    for (const n of [...moved, ...all.filter((x) => carried.has(x.id))]) {
      const p = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      if (n.data.a) marks.set(n.id, p); else cur[n.id] = { ...cur[n.id], ...p };
    }
    if (moved.some((n) => !n.data.a)) saveLayout({ ...layoutRef.current, [def.id]: cur });
    if (marks.size > 0) setNotes((l) => l.map((a) => (marks.has(a.id) ? { ...a, ...marks.get(a.id)! } : a)));
    // 節點移動後，貼在圖框邊上的節點跟著圖框走，再重新挑選連接點
    const placed = placeBoundary(all, notes);
    if (placed !== all) setNodes((ns) => { const at = new Map(placed.map((n) => [n.id, n.position])); return ns.map((n) => (n.data.g?.boundary && at.has(n.id) ? { ...n, position: at.get(n.id)! } : n)); });
    setEdges(edgesOf(boxes(placed)));

    // 放進套件的框裡就歸屬那個套件，拖出框外就移出
    if (readOnly) return;
    const pkgBoxes = all.filter((n) => n.type === "pkg" && n.data.g?.shape === "package").map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.data.g!.width, h: n.data.g!.height }));
    const groups = new Map<string | null, string[]>();
    for (const n of moved) {
      const g = n.data.g;
      if (!g?.el || n.type === "pkg" || g.shape === "comment" || byId.get(g.el.owner ?? "")?.kind !== "Package") continue;
      const cx = n.position.x + g.width / 2, cy = n.position.y + g.height / 2;
      const inside = pkgBoxes.filter((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
      const target = inside?.id ?? null;
      if (target !== (g.parent ?? null)) groups.set(target, [...(groups.get(target) ?? []), n.id]);
    }
    if (groups.size === 0) return;
    const starts = drag.current?.starts ?? new Map<string, { x: number; y: number }>();
    (async () => {
      for (const [target, ids] of groups) {
        if (await moveTo(ids, target)) continue;
        // 搬不進去：放回原位，免得看起來像已經在套件裡
        const back = { ...(layoutRef.current[def.id] ?? {}) };
        for (const id of ids) { const s = starts.get(id); if (s) back[id] = { ...back[id], ...s }; }
        applyLayout({ ...layoutRef.current, [def.id]: back });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id, saveLayout, setNotes, graph, flow, setEdges, vertical, straight, readOnly, byId, moveTo, applyLayout]);

  // 自動排列：節點重新排，手動拉的轉折點留著、排好後跟著節點移動（Mars：不可以清掉轉折點）
  const resetLayout = () => {
    const cur = layoutRef.current[def.id] ?? {};
    const keep = Object.fromEntries(Object.entries(cur).filter(([k]) => k.startsWith(BEND)));
    const next = { ...layoutRef.current };
    if (Object.keys(keep).length) { rearrangeFrom.current = cur; next[def.id] = keep; } else { rearrangeFrom.current = null; delete next[def.id]; }
    saveLayout(next); setLayout(next); setTimeout(() => flow.fitView({ padding: 0.15, maxZoom: 1 }), 60);
  };

  const onConnect = useCallback((c: Connection) => {
    if (readOnly || !c.source || !c.target || c.source === c.target) return;
    const kind = tool !== "select" ? tool : linkTools[0]?.kind;
    if (!kind) return;
    // P4：介面走介面的路由（自動找兩邊的連接埠與介面定義）
    act(() => api<View>(kind === "interface" ? `/projects/${pid}/interfaces/connect` : `/projects/${pid}/relations`, "POST", { kind, from: c.source, to: c.target }));
  }, [readOnly, tool, linkTools, pid, act]);

  const clearSel = () => { setSelEdge(null); setSelNote(null); setConfirm(null); onSelectEdge(null); };
  /** 結束多選，只留下指定的節點（或都不選） */
  const only = (id: string | null) => {
    multiRef.current = []; setMulti([]);
    rf.setState({ nodesSelectionActive: false });
    setNodes((ns) => ns.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })));
  };
  const pick = (n: FlowNode) => {
    if (n.data.a) { setSelEdge(null); setConfirm(null); onSelectEdge(null); onSelectElement(null); setSelNote(n.id); return; }
    if (!n.data.g?.el) return;
    clearSel(); onSelectElement(n.id);
  };
  const openMenu = (e: { clientX: number; clientY: number; preventDefault: () => void }, on: "pane" | "item") => {
    e.preventDefault();
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    setPanel(null);
    setMenu({ x: Math.max(4, Math.min(e.clientX - r.left, r.width - 200)), y: Math.max(4, Math.min(e.clientY - r.top, r.height - 220)), on });
  };
  const selectAll = () => {
    // 只改節點的選取狀態；多選的狀態由 onSelectionChange 統一接手
    setNodes((ns) => ns.map((n) => (n.selectable === false || n.selected ? n : { ...n, selected: true })));
  };
  const newElement = (c: string) => {
    setTool("select"); setPanel(null); setSelNote(null);
    if (custom) pending.current = new Set(modelItems(view.analysis.elements).map((e) => e.id));
    onNew(c, def.kind === "act" || def.kind === "stm" ? def.context : null);
  };
  const addNote = (type: Annotation["type"]) => {
    const r = canvasRef.current?.getBoundingClientRect();
    const c = r && graph.nodes.length + notes.length > 0 ? flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 240, y: 160 };
    const d = NOTE_NEW[type];
    const a: Annotation = { id: newId("note"), type, x: snap(c.x - d.w / 2), y: snap(c.y - d.h / 2), w: d.w, h: d.h, text: d.text };
    setNotes((l) => [...l, a]);
    setTool("select"); setPanel(null); setSelEdge(null); onSelectEdge(null); onSelectElement(null); setSelNote(a.id);
  };

  const center = (w: number, h: number) => {
    const r = canvasRef.current?.getBoundingClientRect();
    const c = r && graph.nodes.length + notes.length > 0 ? flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 240, y: 160 };
    return { x: snap(c.x - w / 2), y: snap(c.y - h / 2) };
  };
  const place = (id: string, spot: Spot) => applyLayout({ ...layoutRef.current, [def.id]: { ...(layoutRef.current[def.id] ?? {}), [id]: spot } });
  /** 建立套件，放在這張圖的指定位置。 */
  const createPackage = async (name: string, spot: Spot): Promise<string | null> => {
    setBusy(true);
    try {
      const r = await api<View & { created: string | null }>(`/projects/${pid}/packages`, "POST", { name });
      if (r.created) place(r.created, spot);
      onChanged(r);
      return r.created;
    } catch (e) { onError((e as Error).message); return null; } finally { setBusy(false); }
  };
  const addPackage = async (name: string) => {
    setPanel(null);
    const ids = pkgFor.current; pkgFor.current = null;
    if (!name.trim()) return;
    // 「放進新套件」：框包住選取的項目，建立後把它們搬進去
    const inside = ids ? (flow.getNodes() as FlowNode[]).filter((n) => ids.includes(n.id)) : [];
    const spot = inside.length ? boxAround(inside.map((n) => ({ x: n.position.x, y: n.position.y, w: n.data.g!.width, h: n.data.g!.height }))) : { ...center(360, 240), w: 360, h: 240 };
    const id = await createPackage(name, spot);
    if (!id) return;
    if (inside.length) {
      multiRef.current = []; setMulti([]);
      const r = await moveTo(inside.map((n) => n.id), id);
      if (r?.packageId && r.packageId !== id) { place(r.packageId, spot); clearSel(); onSelectElement(r.packageId); return; }
    }
    clearSel(); onSelectElement(id);
  };
  /** 草稿外框轉成套件：框裡的項目一起搬進去。 */
  const frameToPackage = async (a: Annotation) => {
    const inside = (flow.getNodes() as FlowNode[]).filter((n) => {
      const g = n.data.g;
      if (!g?.el || n.type === "pkg" || g.shape === "comment" || byId.get(g.el.owner ?? "")?.kind !== "Package") return false;
      const cx = n.position.x + g.width / 2, cy = n.position.y + g.height / 2;
      return cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h;
    });
    // 套件的框至少要包得住裡面的項目（節點可能比原本的草稿外框寬）
    const around = inside.length ? boxAround(inside.map((n) => ({ x: n.position.x, y: n.position.y, w: n.data.g!.width, h: n.data.g!.height }))) : null;
    const x0 = Math.min(a.x, around?.x ?? a.x), y0 = Math.min(a.y, around?.y ?? a.y);
    const spot = { x: x0, y: y0, w: Math.max(a.x + a.w, around ? around.x + around.w! : 0, x0 + 120) - x0, h: Math.max(a.y + a.h, around ? around.y + around.h! : 0, y0 + 72) - y0 };
    const id = await createPackage(a.text.trim() || "套件", spot);
    if (!id) return;
    if (inside.length) {
      const r = await moveTo(inside.map((n) => n.id), id);
      if (!r) return; // 搬不進去時保留草稿外框，套件留空
      if (r.packageId && r.packageId !== id) place(r.packageId, spot);
    }
    setNotes((l) => l.filter((n) => n.id !== a.id)); setSelNote(null);
  };
  /** 建立註解（SysML comment）；有選取的項目就以它為對象。 */
  const addComment = async (text: string, spot?: { x: number; y: number }, aboutId?: string): Promise<boolean> => {
    setTool("select"); setPanel(null);
    setBusy(true);
    try {
      const r = await api<View & { created: string | null }>(`/projects/${pid}/comments`, "POST", { text, aboutId });
      const target = aboutId ? (flow.getNodes() as FlowNode[]).find((n) => n.id === aboutId) : undefined;
      if (r.created) place(r.created, spot ?? (target ? { x: snap(target.position.x + (target.data.g?.width ?? 200) + 48), y: snap(target.position.y) } : center(190, 66)));
      onChanged(r);
      if (r.created) { clearSel(); onSelectElement(r.created); }
      return true;
    } catch (e) { onError((e as Error).message); return false; } finally { setBusy(false); }
  };
  const saveComment = (id: string, text: string) => act(() => api<View>(`/projects/${pid}/comments`, "PATCH", { id, text }));

  const selectedEl = selectedId ? view.analysis.elements.find((e) => e.id === selectedId) : undefined;
  const selectedNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) : undefined;
  // 多選時：可以搬動的模型項目（套件裡外的元素）、要刪的草稿標註
  const multiNodes = multi.map((id) => graph.nodes.find((n) => n.id === id)).filter((n): n is GNode => !!n?.el);
  const multiNotes = multi.filter((id) => notes.some((n) => n.id === id));
  const multiItems = multiNodes.filter((n) => n.shape !== "package" && n.shape !== "comment" && byId.get(n.el!.owner ?? "")?.kind === "Package");
  const outIds = multi.length ? multiNodes.filter((n) => n.parent).map((n) => n.id) : selectedNode?.parent ? [selectedNode.id] : [];
  /** 把選取的項目移回上一層套件，排在原本套件的右邊。 */
  const moveOut = async () => {
    if (outIds.length === 0) return;
    const all = flow.getNodes() as FlowNode[];
    const from = new Map(outIds.map((id) => [id, all.find((n) => n.id === graph.nodes.find((g) => g.id === id)?.parent)]));
    multiRef.current = []; setMulti([]);
    const r = await moveTo(outIds, null);
    if (!r) return;
    const next = { ...(layoutRef.current[def.id] ?? {}) };
    const used = new Map<string, number>();
    for (const id of outIds) {
      const nid = r.moved[id], box = from.get(id);
      if (!nid || !box) continue;
      const k = used.get(box.id) ?? 0; used.set(box.id, k + 1);
      next[nid] = { ...next[nid], x: snap(box.position.x + (box.data.g?.width ?? 0) + 24), y: snap(box.position.y + PKG_TAB + k * 96) };
    }
    applyLayout({ ...layoutRef.current, [def.id]: next });
  };
  const note = selNote ? notes.find((n) => n.id === selNote) : undefined;
  const onThisDiagram = !!selectedEl && graph.nodes.some((n) => n.id === selectedEl.id);
  const multiDel = multiNodes.filter((n) => !n.el!.shared && !(n.shape === "package" && catPkgs.has(n.el!.name)));
  const delCount = multiDel.length + multiNotes.length;
  const canDelete = !readOnly && (multi.length ? delCount > 0 : !!(note || (selEdge && selEdge.remove && selEdge.kind !== "verify") || (selectedEl && !selectedEl.shared)));
  const doDelete = async () => {
    setConfirm(null);
    if (multi.length) {
      const ids = [...multiDel].sort((a, b) => Number(a.shape === "package") - Number(b.shape === "package")).map((n) => n.id); // 套件最後刪，裡面要先清空
      if (multiNotes.length) setNotes((l) => l.filter((n) => !multiNotes.includes(n.id)));
      multiRef.current = []; setMulti([]);
      setBusy(true);
      try {
        let last: View | null = null;
        for (const id of ids) {
          if (last && !last.analysis.elements.some((e) => e.id === id)) continue; // 已經跟著上層一起刪掉
          last = await api<View>(`/projects/${pid}/elements/delete`, "POST", { id });
          onChanged(last);
        }
      } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
      return;
    }
    if (note) { setNotes((l) => l.filter((n) => n.id !== note.id)); setSelNote(null); return; }
    if (selEdge?.remove) {
      const r = selEdge.remove;
      if (await act(() => (r.type === "relation" ? api<View>(`/projects/${pid}/relations/delete`, "POST", { kind: r.kind, from: r.from, to: r.to }) : api<View>(`/projects/${pid}/elements/delete`, "POST", { id: r.id })))) { setSelEdge(null); onSelectEdge(null); onSelectElement(null); }
    } else if (selectedEl) {
      if (await act(() => api<View>(`/projects/${pid}/elements/delete`, "POST", { id: selectedEl.id }))) onSelectElement(null);
    }
  };
  /** 復原或重做一步。伺服器會把救回來的項目的位置一起帶回來。 */
  const stepHistory = async (dir: "undo" | "redo") => {
    if (readOnly || busy || !view.history?.[dir]) return;
    setBusy(true);
    try {
      await lastSave.current;
      const r = await api<View & { layout: Layout; diagrams: Diagrams }>(`/projects/${pid}/${dir}`, "POST", {});
      multiRef.current = []; setMulti([]); setMenu(null); clearSel(); onSelectElement(null);
      applyLayout(r.layout, false);
      extraRef.current = r.diagrams; onExtra(r.diagrams);
      onChanged(r);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  const stepRef = useRef(stepHistory); stepRef.current = stepHistory;
  // Ctrl+Z 復原、Ctrl+Y 或 Ctrl+Shift+Z 重做；正在打字時交給輸入框自己處理
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input,textarea,select,[contenteditable],.cm-editor")) return;
      const k = e.key.toLowerCase();
      const dir = k === "z" ? (e.shiftKey ? "redo" : "undo") : k === "y" ? "redo" : null;
      if (!dir) return;
      e.preventDefault();
      stepRef.current(dir);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const deleteDiagram = () => {
    const cur = extraRef.current;
    const rest = { ...cur.notes }; delete rest[def.id];
    onExtra({ custom: cur.custom.filter((c) => c.id !== def.id), notes: rest });
  };
  const rename = (title: string) => {
    const cur = extraRef.current;
    if (title.trim() && title.trim() !== def.title) onExtra({ ...cur, custom: cur.custom.map((c) => (c.id === def.id ? { ...c, title: title.trim().slice(0, 60) } : c)) });
    setPanel(null);
  };
  const togglePin = (key: "els" | "links", id: string) => setPins((p) => { const next = { ...p, [key]: p[key].includes(id) ? p[key].filter((x) => x !== id) : [...p[key], id] }; store("jri.tools.custom", next); return next; });
  const toggleCollapsed = () => setCollapsed((c) => { store("jri.toolbox", { collapsed: !c }); return !c; });

  // 圖框：包住目前所有節點與標註，跟著內容伸縮
  const frame = useMemo(() => {
    // 貼在圖框邊上的節點不算在內：圖框由其餘的節點決定，它們再排到框線上（shapes.ts 的 frameLayout，匯出相同）
    const inner = nodes.filter((n) => !n.data.g?.boundary);
    const boxes = inner.map((n) => ({ x: n.position.x, y: n.position.y, w: n.data.g?.width ?? n.width ?? n.data.a?.w ?? 0, h: n.data.g?.height ?? n.height ?? n.data.a?.h ?? 0 }));
    if (!nodes.length) return null;
    const edge = nodes.filter((n) => n.data.g?.boundary).map((n) => ({ id: n.id, boundary: n.data.g!.boundary!, width: n.data.g!.width, height: n.data.g!.height }));
    const { x, y, w, h } = frameLayout(boxes, edge, FRAME_PAD);
    return { x, y, w, h, svg: frameSvg(frameLabel(def), 0, 0, w, h, SCREEN) };
  }, [nodes, def]);

  const exportAs = (kind: "svg" | "png") => {
    const placed = (flow.getNodes() as FlowNode[]).filter((n) => n.data.g).map((n) => ({ g: n.data.g!, x: n.position.x, y: n.position.y }));
    const drafts = withDraft ? notes : []; // 草稿標註不是模型的一部分，預設不輸出
    if (placed.length + drafts.length === 0) return;
    const bends = new Map(graph.edges.map((e) => [e.key ?? e.id, bendsOf(layoutRef.current[def.id], e.key ?? e.id)] as const).filter(([, b]) => b.length > 0));
    const svg = toSvg(frameLabel(def), placed, graph.edges, vertical, straight, drafts, bends, analysis);
    const name = `${view.project.id}-${def.code}-${def.title}`;
    if (kind === "svg") downloadSvg(svg, name); else downloadPng(svg, name).catch((e) => onError((e as Error).message));
  };

  const activeLink = allowedLinks.find((t) => t.kind === tool);
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,textarea,select")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && canDelete) { e.preventDefault(); setConfirm("selection"); }
    if (e.key === "Escape") { setTool("select"); setConfirm(null); setPanel(null); setMenu(null); pkgFor.current = null; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); selectAll(); }
  };

  const catOf = (c: string | null) => meta.categories.find((x) => x.id === c);
  const q = query.trim().toLowerCase();
  const match = (...s: (string | null | undefined)[]) => !q || s.some((x) => x?.toLowerCase().includes(q));
  const memberSet = new Set(def.members ?? []);
  const candidates = panel === "add" ? modelItems(view.analysis.elements).filter((e) => !memberSet.has(e.id) && match(e.name, e.shortName, catOf(e.category)?.zh)) : [];
  // 分解圖上的「加入零件」（階段 3b）：加到選取的定義，沒有選取時加到圖的根定義
  const partOwner = def.kind === "decomp" ? (selectedEl?.kind === "PartDefinition" && onThisDiagram ? selectedEl : byId.get(def.context ?? "")) : undefined;
  const partTypes = panel === "part" && partOwner ? view.analysis.elements.filter((e) => e.kind === "PartDefinition" && e.id !== partOwner.id && match(e.name, e.shortName, e.qualifiedName)) : [];
  const pickPart = (type: Element) => setPartPick({ type, name: suggestPartName(type.name, view.analysis.elements.filter((e) => e.owner === partOwner?.id).map((e) => e.name)) });
  const addPart = async () => { if (partOwner && partPick && await act(() => api<View>(`/projects/${pid}/parts`, "POST", { owner: partOwner.id, type: partPick.type.id, name: partPick.name }))) { setPartPick(null); setPanel(null); } };
  const NA = "這張圖不顯示這類項目。要把不同類別放在一起，請用自訂圖。";
  const empty = graph.nodes.length + notes.length === 0;

  // ───────── 分析圖（P2）：要回答的問題、還缺什麼、元素清單（釘選亮色、其他暗色）─────────
  const missingList = useMemo(() => { if (!analysis || !av?.missing) return []; try { return av.missing(view.analysis); } catch { return [{ id: null, text: "這張圖的檢查無法執行" }]; } }, [analysis, av, view.analysis]);
  const palette = useMemo(() => (analysis && av ? analysisPalette(view.analysis, av, def.members ?? []) : { pinned: [], other: [] }), [analysis, av, view.analysis, def.members]);
  const [listOpen, setListOpen] = useState(() => load("jri.analysisList", { open: true }).open);
  const [listQ, setListQ] = useState("");
  const lq = listQ.trim().toLowerCase();
  const hitEl = (e: Element) => !lq || [e.name, e.shortName, e.keyword, catOf(e.category)?.zh, zhKeyword(e.keyword).zh].some((x) => x?.toLowerCase().includes(lq));
  const gateZh = (g: string) => { const m = meta.gates.find((x) => x.id === g); return m ? `${m.zh}（${m.en}）` : g; };
  /** 放進這張圖；at 是放下的位置（拖進來的），沒有就由畫面找空位 */
  const addToView = (ids: string[], at?: { x: number; y: number }) => {
    if (readOnly || ids.length === 0) return;
    if (at && ids.length === 1) place(ids[0], at);
    setMembers((m) => [...m, ...ids.filter((x) => !m.includes(x))]);
  };
  const DRAG_TYPE = "application/x-jri-element";
  const onDrop = (ev: React.DragEvent) => {
    const id = ev.dataTransfer.getData(DRAG_TYPE);
    if (!id || !analysis) return;
    ev.preventDefault();
    let p = { x: 24, y: 24 };
    try { p = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }); } catch { /* 畫布還沒有建立時放在左上角 */ }
    addToView([id], { x: snap(p.x - 110), y: snap(p.y - 24) });
  };
  const pkgZh = (e: Element) => { const top = e.qualifiedName.split("::")[1]; return top ? PACKAGE_ZH[top] ?? top : ""; };
  const elRow = (e: Element, bright: boolean) => {
    const c = catOf(e.category), k = zhKeyword(e.keyword);
    return (
      <li key={e.id} className={`el-item ${bright ? "pinned" : "dim"}`} draggable={!readOnly} onDragStart={(ev) => { ev.dataTransfer.setData(DRAG_TYPE, e.id); ev.dataTransfer.effectAllowed = "copy"; }}
        title={`${e.qualifiedName}${readOnly ? "" : "\n拖進圖裡，或按「放入」"}`}>
        <span className="el-name">{e.shortName ? `${e.shortName} ` : ""}{e.unnamed ? `（${e.name}）` : e.name}</span>
        <span className="el-kind">{c ? c.zh : k.zh || k.en}<small>{c ? c.en : k.zh ? k.en : ""}</small>{pkgZh(e) && <small>　{pkgZh(e)}</small>}</span>
        {!readOnly && <button className="tbtn" onClick={() => addToView([e.id])} aria-label={`把 ${e.name} 放入這張圖`}>放入</button>}
      </li>
    );
  };
  const OTHER_LIMIT = 200;
  const otherHits = analysis ? palette.other.filter(hitEl) : [];
  const listPanel = analysis && av && listOpen && (
    <aside className="analysis-list" aria-label="這張圖的元素清單">
      <div className="section-head"><h2 className="section-title">元素</h2><button className="tbtn" onClick={() => setListOpen(() => { store("jri.analysisList", { open: false }); return false; })}>收合</button></div>
      <input className="input" type="search" value={listQ} onChange={(e) => setListQ(e.target.value)} placeholder="搜尋名稱、類別、關鍵字" aria-label="搜尋元素" />
      <p className="caption">每種 SysML v2 元素都可以拉進這張圖。亮色是這一步預設會用到的（釘選），暗色的照樣可以拉進來。</p>
      {!readOnly && palette.pinned.length > 0 && <button className="tbtn" onClick={() => addToView(palette.pinned.map((e) => e.id))}>放入全部釘選的元素（{palette.pinned.length}）</button>}
      <h3 className="label">釘選　{av.pinned.map((c) => catOf(c)?.zh ?? c).join("、")}</h3>
      {palette.pinned.filter(hitEl).length ? <ul className="el-list">{palette.pinned.filter(hitEl).map((e) => elRow(e, true))}</ul> : <p className="caption muted">{lq ? "沒有符合的。" : "模型裡還沒有，或都已經在圖上了。可以用左邊工具列的「元素」新增。"}</p>}
      <h3 className="label">其他元素</h3>
      {otherHits.length ? <ul className="el-list">{otherHits.slice(0, OTHER_LIMIT).map((e) => elRow(e, false))}</ul> : <p className="caption muted">{lq ? "沒有符合的。" : "沒有其他元素。"}</p>}
      {otherHits.length > OTHER_LIMIT && <p className="caption">還有 {otherHits.length - OTHER_LIMIT} 個，請用搜尋縮小範圍。</p>}
    </aside>
  );
  const seen = new Set<string>();
  const analysisHead = analysis && av && (
    <div className="analysis-head" role="region" aria-label="這一步要回答的問題">
      <div className="analysis-q">
        <span className="tag">圖 {av.order}</span>
        <span className="tag" title="對應的審查節點">{gateZh(av.gate)}</span>
        <p className="body">{expandFirst(av.question, seen)}</p>
        {!listOpen && <button className="tbtn" onClick={() => setListOpen(() => { store("jri.analysisList", { open: true }); return true; })}>元素清單</button>}
      </div>
      {missingList.length === 0
        ? <p className="caption"><span className="tag done">齊了</span>　這一步要的項目都有了。可以繼續往下一張圖。</p>
        : <details className="analysis-missing" open={missingList.length <= 4}>
          <summary className="caption">還缺 {missingList.length} 項（只是提示，不擋你往下做）</summary>
          <ul>{missingList.map((m, i) => <li key={i} className="caption">{m.id ? <button className="linklike" onClick={() => onSelectElement(m.id)}>{m.text}</button> : m.text}</li>)}</ul>
        </details>}
    </div>
  );
  const selFlowEdge = edges.find((e) => e.selected);
  const selBends = (selFlowEdge?.data as EData | undefined)?.bends ?? [];

  return (
    <div className="diagram">
      <div className={`toolbox ${collapsed ? "collapsed" : ""}`} role="toolbar" aria-label="圖形編輯工具">
        <div className="tool-group">
          <span className="label" title={analysis ? av?.question : undefined}>{analysis ? def.title : `${def.code} · ${def.title}`}</span>
          <Tool onClick={toggleCollapsed} glyph={collapsed ? "»" : "«"} text={collapsed ? "展開工具列" : "收合工具列"} />
          <Tool on={tool === "select"} onClick={() => setTool("select")} icon="select" text="選取" sub="Shift＋捲動平移" title="點選、拖曳移動。在空白處拖曳可以框選多個一起移動；按住 Ctrl 或 Shift 點選可以加選；Ctrl+A 全選。按右鍵有快速功能。要移動畫面：按住 Shift 捲動（滾輪或觸控板兩指滑動）；也可以按住滑鼠右鍵或中鍵拖曳，或按住空白鍵拖曳。" />
        </div>
        {!readOnly && elTools.length > 0 && (
          <div className="tool-group">
            <span className="label">元素</span>
            {elTools.map((c) => <Tool key={c} onClick={() => newElement(c)} icon={CATEGORY_SHAPE[c] ?? "usage"} text={catOf(c)?.zh ?? c} title={catOf(c)?.help} />)}
          </div>
        )}
        {!readOnly && linkTools.length > 0 && (
          <div className="tool-group">
            <span className="label">連線</span>
            {linkTools.map((t) => <Tool key={t.kind} on={tool === t.kind} onClick={() => setTool(tool === t.kind ? "select" : t.kind)} icon={linkIconOf(t.kind)} text={t.zh} sub={t.en} title={t.hint} />)}
          </div>
        )}
        {!readOnly && (
          <div className="tool-group">
            <span className="label">組織</span>
            {!structural && <Tool on={panel === "pkg"} onClick={() => setPanel(panel === "pkg" ? null : "pkg")} icon="package" text="套件" sub="package" title="把屬於同一群的項目放在一起。把項目拖進框裡就歸屬這個套件，拖出來就移出。會寫進模型。" />}
            <Tool disabled={busy} onClick={() => addComment("註解", undefined, onThisDiagram && selectedEl?.kind !== "Comment" && selectedEl?.kind !== "Package" ? selectedEl?.id : undefined)} icon="comment" text="註解" sub="comment" title="先選一個項目再按，註解就會連到它；沒有選取就是整個模型的註解。會寫進模型。" />
          </div>
        )}
        {!readOnly && def.kind === "decomp" && partOwner && !partOwner.shared && (
          <div className="tool-group">
            <span className="label">零件</span>
            <Tool on={panel === "part"} disabled={busy} onClick={() => { setQuery(""); setPartPick(null); setPanel(panel === "part" ? null : "part"); }} glyph="◆" text="加入零件" sub="part" title={`在「${partOwner.name}」裡加入一個零件，型別可以是任何套件的零件定義；在別的套件時會自動補 import。先選圖上的定義就加到那個定義。`} />
          </div>
        )}
        {!readOnly && (
          <div className="tool-group">
            <span className="label">更多</span>
            <Tool on={panel === "all"} onClick={() => { setQuery(""); setPanel(panel === "all" ? null : "all"); }} glyph="⋯" text="全部工具" title="所有元素、連線與標註" />
            {custom && <Tool on={panel === "add"} onClick={() => { setQuery(""); setPanel(panel === "add" ? null : "add"); }} glyph="＋" text="加入既有項目" title="把模型裡已有的項目放進這張圖" />}
          </div>
        )}
        {!readOnly && (
          <div className="tool-group">
            <span className="label">編輯</span>
            {confirm === "selection"
              ? <><Tool danger onClick={doDelete} disabled={busy} glyph="✓" text="確定刪除" /><Tool onClick={() => setConfirm(null)} glyph="×" text="取消" /></>
              : <Tool disabled={!canDelete || busy} onClick={() => setConfirm("selection")} glyph="✕" text={multi.length ? `刪除選取（${delCount}）` : "刪除選取"} title={note ? "刪除選取的標註（Delete 鍵）" : "從模型刪除選取的元素或連線（Delete 鍵）"} />}
            {outIds.length > 0 && <Tool disabled={busy} onClick={moveOut} glyph="⇱" text="移出套件" title="把選取的項目移回上一層套件（也可以直接把它拖出框外）" />}
            {(custom || analysis) && <Tool disabled={!onThisDiagram || !(def.members ?? []).includes(selectedId ?? "")} onClick={() => { setMembers((ids) => ids.filter((x) => x !== selectedId)); onSelectElement(null); }} glyph="−" text="移出此圖" title="只從這張圖拿掉，模型裡仍然保留" />}
            {selFlowEdge && <Tool disabled={selBends.length === 0} onClick={() => onBends(selFlowEdge.id, [], true)} glyph="⟋" text="拉直連線" title="清掉這條線的轉折點。要加轉折點：選取連線後拖曳線段中間的圓點，或在線上按兩下。" />}
            <Tool disabled={busy || !view.history?.undo} onClick={() => stepHistory("undo")} glyph="↶" text="復原" sub="Ctrl+Z" title="回到上一步（對模型的修改）。可以連續按，一步一步往回。" />
            <Tool disabled={busy || !view.history?.redo} onClick={() => stepHistory("redo")} glyph="↷" text="重做" sub="Ctrl+Y" title="把剛才復原的那一步做回來。復原之後若做了新的修改，就不能再重做。" />
          </div>
        )}
        <div className="tool-group">
          <span className="label">檢視</span>
          <Tool onClick={() => flow.zoomIn()} glyph="＋" text="放大" />
          <Tool onClick={() => flow.zoomOut()} glyph="－" text="縮小" />
          <Tool onClick={() => flow.fitView({ padding: 0.15, maxZoom: 1 })} glyph="⤢" text="全覽" />
          <Tool onClick={resetLayout} glyph="▦" text="自動排列" title={hasBends ? "重新排列這張圖的所有節點（標註不動）；手動拉的轉折點會保留，跟著節點移動" : "重新排列這張圖的所有節點（標註不動）"} />
        </div>
        <div className="tool-group">
          <span className="label">匯出</span>
          <Tool onClick={() => exportAs("png")} glyph="P" text="PNG" />
          <Tool onClick={() => exportAs("svg")} glyph="S" text="SVG" />
          {notes.length > 0 && <Tool on={withDraft} onClick={() => setWithDraft((v: boolean) => { store("jri.export", { draft: !v }); return !v; })} glyph="✎" text="含草稿標註" title="草稿便箋、外框與文字不是模型的一部分，預設不會出現在匯出的圖上。" />}
        </div>
        {custom && !readOnly && (
          <div className="tool-group">
            <span className="label">這張圖</span>
            <Tool on={panel === "rename"} onClick={() => setPanel(panel === "rename" ? null : "rename")} glyph="✎" text="重新命名" />
            {confirm === "diagram"
              ? <><Tool danger onClick={deleteDiagram} glyph="✓" text="確定刪除" /><Tool onClick={() => setConfirm(null)} glyph="×" text="取消" /></>
              : <Tool onClick={() => setConfirm("diagram")} glyph="✕" text="刪除這張圖" title="只刪除這張圖，裡面的模型項目仍然保留" />}
          </div>
        )}
      </div>
      <div className="canvas-col">
      {analysisHead}
      <div ref={canvasRef} className={`canvas ${activeLink ? "linking" : ""}`} tabIndex={0} onKeyDown={onKey}
        onDragOver={analysis && !readOnly ? (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } } : undefined} onDrop={analysis && !readOnly ? onDrop : undefined}>
        {!!graph.folded && !activeLink && panel === null && !selectedId && !selNote && (
          <div className="canvas-hint"><span className="tag warn">上限</span><span className="caption">這張圖最多畫 {NODE_LIMIT} 個節點，其餘 {graph.folded} 個改列在節點的隔間裡。</span></div>
        )}
        {activeLink && <div className="canvas-hint"><span className="tag done">{activeLink.zh}</span><span className="caption">{activeLink.hint}。按 Esc 結束。</span></div>}
        {note && !readOnly && !activeLink && panel === null && (
          <div className="canvas-hint">
            <span className="tag">{NOTE_ZH[note.type]}</span>
            <input key={note.id} className="input" style={{ width: 280 }} defaultValue={note.text} maxLength={500} aria-label={`${NOTE_ZH[note.type]}的文字`}
              onChange={(e) => { const v = e.target.value; setNotes((l) => l.map((n) => (n.id === note.id ? { ...n, text: v } : n))); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            {note.type === "frame" && <button className="tbtn" disabled={busy} onClick={() => frameToPackage(note)} title="建立同名的套件，把框裡的項目搬進去。會寫進模型。">轉成套件</button>}
            {note.type === "note" && <button className="tbtn" disabled={busy} onClick={async () => { if (await addComment(note.text, { x: note.x, y: note.y })) { setNotes((l) => l.filter((n) => n.id !== note.id)); setSelNote(null); } }} title="改成 SysML 的 comment，寫進模型。">寫進模型</button>}
            <span className="caption">草稿，不進模型</span>
          </div>
        )}
        {selectedEl?.kind === "Comment" && onThisDiagram && !readOnly && !activeLink && panel === null && (
          <div className="canvas-hint">
            <span className="tag">註解</span>
            <input key={selectedEl.id + selectedEl.doc} className="input" style={{ width: 320 }} defaultValue={selectedEl.doc} maxLength={500} aria-label="註解的內容"
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== selectedEl.doc) saveComment(selectedEl.id, v); }} />
            <span className="caption">comment，已寫進模型</span>
          </div>
        )}
        {panel === "pkg" && (
          <div className="canvas-hint">
            <span className="tag">套件</span>
            <input className="input" style={{ width: 240 }} placeholder="套件名稱，例如：射場作業" maxLength={60} aria-label="新套件的名稱" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") addPackage((e.target as HTMLInputElement).value); if (e.key === "Escape") { pkgFor.current = null; setPanel(null); } }} />
            <span className="caption">{pkgFor.current ? `按 Enter 建立，並把選取的 ${pkgFor.current.length} 個項目放進去` : "按 Enter 建立"}</span>
          </div>
        )}
        {panel === "rename" && (
          <div className="canvas-hint">
            <span className="tag">名稱</span>
            <input className="input" style={{ width: 240 }} defaultValue={def.title} maxLength={60} aria-label="圖的名稱" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} onBlur={(e) => rename(e.target.value)} />
          </div>
        )}
        {panel === "part" && partOwner && (
          <div className="canvas-panel" role="dialog" aria-label="加入零件">
            <div className="section-head"><h2 className="section-title">加入零件到「{partOwner.name}」</h2><button className="tbtn" onClick={() => setPanel(null)}>關閉</button></div>
            <input className="input" placeholder="搜尋零件定義" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="搜尋零件定義" autoFocus />
            {partPick && (
              <form className="part-name" onSubmit={(e) => { e.preventDefault(); void addPart(); }}>
                <label className="caption">零件名稱（型別 {partPick.type.name}）
                  <input className="input" value={partPick.name} onChange={(e) => setPartPick({ ...partPick, name: e.target.value })} aria-label="零件名稱" autoFocus />
                </label>
                <button className="tbtn" type="submit" disabled={busy || !partPick.name.trim()}>加入</button>
                <button className="tbtn" type="button" onClick={() => setPartPick(null)}>取消</button>
              </form>
            )}
            {partTypes.length === 0
              ? <p className="caption muted">{q ? "沒有符合的零件定義。" : "模型裡沒有其他零件定義。"}</p>
              : <ul className="tree">{partTypes.slice(0, 200).map((e) => (
                <li key={e.id}><button className="tree-row" disabled={busy} aria-pressed={partPick?.type.id === e.id} onClick={() => pickPart(e)} title={`選 ${e.name} 當型別，再填零件名稱`}>
                  <span className="tid">{e.shortName ?? ""}</span><span className="tn">{e.name}</span><span className="tc">{e.qualifiedName.split("::").slice(0, -1).join("::")}</span>
                </button></li>
              ))}</ul>}
          </div>
        )}
        {(panel === "all" || panel === "add") && (
          <div className="canvas-panel" role="dialog" aria-label={panel === "all" ? "全部工具" : "加入既有項目"}>
            <div className="section-head"><h2 className="section-title">{panel === "all" ? "全部工具" : "加入既有項目"}</h2><button className="tbtn" onClick={() => setPanel(null)}>關閉</button></div>
            <input className="input" placeholder="搜尋" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="搜尋" autoFocus />
            {panel === "all" && <>
              {Object.entries(meta.pillars).map(([p, pzh]) => {
                const cats = meta.categories.filter((c) => c.pillar === p && match(c.zh, c.id));
                if (cats.length === 0) return null;
                return (
                  <div className="tool-group" key={p}>
                    <span className="label">{pzh}</span>
                    {cats.map((c) => {
                      const ok = custom || analysis || elTools.includes(c.id);
                      return (
                        <div className="tool-row" key={c.id}>
                          <Tool disabled={!ok} onClick={() => newElement(c.id)} icon={CATEGORY_SHAPE[c.id] ?? "usage"} text={c.zh} title={ok ? c.help : NA} />
                          {custom && <button className="pin" aria-pressed={pins.els.includes(c.id)} onClick={() => togglePin("els", c.id)} title={pins.els.includes(c.id) ? "從常用移除" : "釘選到常用"}>{pins.els.includes(c.id) ? "已釘選" : "釘選"}</button>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div className="tool-group">
                <span className="label">連線</span>
                {ALL_LINKS.filter((t) => match(t.zh, t.en)).map((t) => {
                  const ok = allowedLinks.some((x) => x.kind === t.kind);
                  return (
                    <div className="tool-row" key={t.kind}>
                      <Tool disabled={!ok} on={tool === t.kind} onClick={() => { setTool(t.kind); setPanel(null); }} icon={linkIconOf(t.kind)} text={t.zh} sub={t.en} title={ok ? t.hint : "這張圖不使用這種連線。"} />
                      {custom && <button className="pin" aria-pressed={pins.links.includes(t.kind)} onClick={() => togglePin("links", t.kind)} title={pins.links.includes(t.kind) ? "從常用移除" : "釘選到常用"}>{pins.links.includes(t.kind) ? "已釘選" : "釘選"}</button>}
                    </div>
                  );
                })}
              </div>
              <div className="tool-group">
                <span className="label">組織（寫進模型）</span>
                {match("套件", "package") && <Tool onClick={() => setPanel("pkg")} icon="package" text="套件" sub="package" />}
                {match("註解", "comment") && <Tool onClick={() => addComment("註解")} icon="comment" text="註解" sub="comment" />}
              </div>
              <div className="tool-group">
                <span className="label">草稿標註（不進模型、預設不匯出）</span>
                {match("便箋", "note") && <Tool onClick={() => addNote("note")} icon="note" text="便箋" title="隨手記的便箋。要留在模型裡請用上面的「註解」。" />}
                {match("外框", "frame") && <Tool onClick={() => addNote("frame")} icon="frame" text="外框" title="先圈出一群項目；確定之後可以「轉成套件」。" />}
                {match("文字", "text") && <Tool onClick={() => addNote("text")} icon="text" text="文字" />}
              </div>
            </>}
            {panel === "add" && (candidates.length === 0
              ? <p className="caption muted">{q ? "沒有符合的項目。" : "模型裡的項目都已經在這張圖上了。"}</p>
              : <ul className="tree">{candidates.slice(0, 200).map((e) => (
                <li key={e.id}><button className="tree-row" onClick={() => setMembers((ids) => [...ids, e.id])} title="放進這張圖">
                  <span className="tid">{e.shortName ?? ""}</span><span className="tn">{e.name}</span><span className="tc">{catOf(e.category)?.zh}</span>
                </button></li>
              ))}</ul>)}
          </div>
        )}
        {menu && (() => {
          const close = () => setMenu(null);
          const run = (fn: () => void) => () => { close(); fn(); };
          const Item = ({ text, onClick, disabled, danger }: { text: string; onClick: () => void; disabled?: boolean; danger?: boolean }) => <button role="menuitem" className={danger ? "danger" : ""} disabled={disabled} onClick={onClick}>{text}</button>;
          const delText = multi.length ? `刪除 ${delCount} 個` : selEdge ? "刪除連線" : note ? "刪除標註" : "刪除";
          const commentable = !multi.length && !!selectedEl && onThisDiagram && selectedEl.kind !== "Comment" && selectedEl.kind !== "Package";
          return (
            <div className="ctx-menu" role="menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
              {menu.ask ? <>
                <span className="caption">{multi.length ? `確定刪除選取的 ${delCount} 個？` : "確定刪除？"}</span>
                <Item danger text="確定刪除" onClick={run(doDelete)} />
                <Item text="取消" onClick={close} />
              </> : menu.on === "pane" ? <>
                {!readOnly && elTools.map((c) => <Item key={c} text={`新增${catOf(c)?.zh ?? c}`} onClick={run(() => newElement(c))} />)}
                {!readOnly && !structural && <Item text="新增套件" onClick={run(() => { pkgFor.current = null; setPanel("pkg"); })} />}
                {!readOnly && <Item text="新增註解" onClick={run(() => addComment("註解"))} />}
                {!readOnly && <hr />}
                <Item text="全選　Ctrl+A" onClick={run(selectAll)} />
                <Item text="全覽" onClick={run(() => flow.fitView({ padding: 0.15, maxZoom: 1 }))} />
                <Item text="自動排列" onClick={run(resetLayout)} />
              </> : readOnly ? <Item text="全覽" onClick={run(() => flow.fitView({ padding: 0.15, maxZoom: 1 }))} /> : <>
                {multi.length > 0 && <span className="caption">已選取 {multi.length} 個</span>}
                {commentable && <Item text="加上註解" onClick={run(() => addComment("註解", undefined, selectedEl!.id))} />}
                {multiItems.length > 0 && <Item text="放進新套件" onClick={run(() => { pkgFor.current = multiItems.map((n) => n.id); setPanel("pkg"); })} />}
                {outIds.length > 0 && <Item text="移出套件" disabled={busy} onClick={run(moveOut)} />}
                {note?.type === "frame" && <Item text="轉成套件" disabled={busy} onClick={run(() => frameToPackage(note))} />}
                {(custom || analysis) && !multi.length && onThisDiagram && (def.members ?? []).includes(selectedId ?? "") && <Item text="移出此圖" onClick={run(() => { setMembers((ids) => ids.filter((x) => x !== selectedId)); onSelectElement(null); })} />}
                <Item danger text={delText} disabled={!canDelete || busy} onClick={() => setMenu({ ...menu, ask: true })} />
              </>}
            </div>
          );
        })()}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          {/* 連線端點的記號：實心與空心菱形、defined by、特化、重定義、參照子集。形狀和匯出檔共用 shapes.ts 的 MARKERS */}
          <defs dangerouslySetInnerHTML={{ __html: MARKER_DEFS }} />
        </svg>
        {empty ? <p className="body muted empty">{analysis ? "這張圖還是空的。從右邊的元素清單把元素拖進來（亮色是這一步預設會用到的），或用左邊工具列的「元素」新增。" : custom ? "這張圖還沒有內容。用工具列的「加入既有項目」放進模型裡已有的項目，或用「元素」建立新的。" : "這張圖還沒有內容。用左邊工具列的「元素」開始。"}</p> : (
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onEdgeDoubleClick={addBend} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart} onNodeDrag={onNodeDrag} onNodeDragStop={onNodeDragStop}
            onSelectionDragStart={(e, ns) => onNodeDragStart(e, ns[0] as FlowNode, ns as FlowNode[])} onSelectionDrag={(e, ns) => onNodeDrag(e, ns[0] as FlowNode, ns as FlowNode[])} onSelectionDragStop={(e, ns) => onNodeDragStop(e, ns[0] as FlowNode, ns as FlowNode[])} onConnect={onConnect} connectionMode={ConnectionMode.Loose} nodesConnectable={!readOnly} deleteKeyCode={null}
            snapToGrid snapGrid={[SNAP, SNAP]} fitView fitViewOptions={{ padding: 0.22, maxZoom: 1 }} minZoom={0.15}
            onSelectionChange={onSelectionChange} selectionOnDrag={!coarse} panOnDrag={coarse ? true : [1, 2]} selectionMode={SelectionMode.Full} multiSelectionKeyCode={["Control", "Meta", "Shift"]}
            onNodeClick={(e, n) => { setMenu(null); if (e.ctrlKey || e.metaKey || e.shiftKey) return; pick(n); }}
            onNodeContextMenu={(e, n) => { if (!multiRef.current.includes(n.id)) { only(n.id); pick(n); } openMenu(e, "item"); }}
            onSelectionContextMenu={(e) => openMenu(e, "item")}
            onEdgeContextMenu={(e, ed) => { const g = (ed.data as { g: GEdge }).g; if (!g.remove) { e.preventDefault(); return; } only(null); setSelNote(null); onSelectElement(null); setSelEdge(g); onSelectEdge(g); openMenu(e, "item"); }}
            onPaneContextMenu={(e) => openMenu(e as MouseEvent, "pane")} onMoveStart={() => setMenu(null)}
            onEdgeClick={(_e, ed) => { const g = (ed.data as { g: GEdge }).g; if (!g.remove) return; setSelNote(null); setSelEdge(g); setConfirm(null); onSelectEdge(g); }}
            onPaneClick={() => { setMenu(null); clearSel(); onSelectElement(null); }}
            style={{ color: "var(--ink)" }} proOptions={{ hideAttribution: true }}>
            <Background id="minor" variant={BackgroundVariant.Dots} gap={GRID} size={1.5} color="var(--grid-dot)" />
            <Background id="major" variant={BackgroundVariant.Cross} gap={GRID * 5} size={7} lineWidth={1} color="var(--grid-cross)" />
            {frame && <ViewportPortal><svg className="diagram-frame" width={frame.w} height={frame.h} style={{ position: "absolute", left: frame.x, top: frame.y, overflow: "visible", pointerEvents: "none" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: frame.svg }} /></ViewportPortal>}
          </ReactFlow>
        )}
      </div>
      </div>
      {listPanel}
    </div>
  );
}
