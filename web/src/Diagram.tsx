import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, ConnectionMode, Handle, MarkerType, NodeResizer, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from "@xyflow/react";
import type { Connection, Edge, Node, NodeProps } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import { api } from "./api.ts";
import type { Annotation, Diagrams, Layout, Meta, View } from "./api.ts";
import { ALL_LINKS, buildGraph, CATEGORY_SHAPE, CUSTOM_DEFAULT, LINK_TOOLS, modelItems, PALETTE } from "./model.ts";
import type { DiagramDef, GEdge, GNode, Graph, LinkTool } from "./model.ts";
import { annotationSvg, iconSvg, nodeSvg, SCREEN } from "./shapes.ts";
import { downloadPng, downloadSvg, toSvg } from "./exportSvg.ts";

/** g：模型元素的節點；a：標註（註解、外框、文字）。 */
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
    </div>
  );
}

const NOTE_ZH: Record<Annotation["type"], string> = { note: "註解", frame: "外框", text: "文字" };
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
const nodeTypes = { el: ElementNode, note: NoteNode };

function autoLayout(graph: Graph): Record<string, { x: number; y: number }> {
  const dg = new dagre.graphlib.Graph();
  dg.setGraph({ rankdir: graph.direction, nodesep: 40, ranksep: 72, marginx: 24, marginy: 24 });
  dg.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) dg.setNode(n.id, { width: n.width, height: n.height });
  const rev = new Set(graph.reverse ?? []);
  for (const e of graph.edges) if (e.source !== e.target) { if (rev.has(e.kind)) dg.setEdge(e.target, e.source); else dg.setEdge(e.source, e.target); }
  dagre.layout(dg);
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of graph.nodes) { const p = dg.node(n.id); out[n.id] = { x: snap(p.x - n.width / 2), y: snap(p.y - n.height / 2) }; }
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

function toEdge(e: GEdge, pos: Map<string, Box>, vertical: boolean, straight: boolean): Edge {
  const a = pos.get(e.source), b = pos.get(e.target);
  const [sh, th] = a && b ? sides(a, b, vertical) : vertical ? [Position.Bottom, Position.Top] : [Position.Right, Position.Left];
  return {
    id: e.id, source: e.source, target: e.target, sourceHandle: sh, targetHandle: th, label: e.label || undefined, data: { g: e },
    type: straight ? "straight" : "smoothstep", pathOptions: { borderRadius: 0 },
    style: { strokeWidth: 1, strokeDasharray: e.dashed ? "6 4" : undefined }, labelBgPadding: [4, 2],
    markerStart: e.tail === "diamond" ? "jri-diamond" : undefined,
    markerEnd: e.head === "open" ? { type: MarkerType.Arrow, color: "currentColor", width: 18, height: 18, strokeWidth: 1.2 } : undefined,
    selectable: e.remove !== null, focusable: e.remove !== null,
  } as Edge;
}
const boxes = (list: { id: string; position: { x: number; y: number }; data: NData }[]) =>
  new Map<string, Box>(list.filter((n) => n.data.g).map((n) => [n.id, { x: n.position.x, y: n.position.y, w: n.data.g!.width, h: n.data.g!.height }]));

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
const newId = (prefix: string) => `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const linkIconOf = (k: string, uc: boolean): IconName => (k === "compose" ? "diamond" : ["derive", "refine", "satisfy", "trace", "allocate"].includes(k) && !uc ? "dashed" : "line");

function Canvas({ readOnly, view, meta, def, extra, onExtra, selectedId, onSelectElement, onSelectEdge, onNew, onChanged, onError }: DiagramProps) {
  const pid = view.project.id;
  const flow = useReactFlow();
  const custom = def.kind === "custom";
  const graph = useMemo(() => buildGraph(def, view.analysis), [def, view.analysis]);
  const notes = useMemo(() => extra.notes[def.id] ?? [], [extra, def.id]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [tool, setTool] = useState<string>("select"); // "select" 或連線種類
  const [selEdge, setSelEdge] = useState<GEdge | null>(null);
  const [selNote, setSelNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "selection" | "diagram">(null);
  const [panel, setPanel] = useState<null | "all" | "add" | "rename">(null);
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

  // 第一層工具：一般的圖用該圖固定的項目，自訂圖用釘選的項目
  const elTools = custom ? pins.els.filter((c) => meta.categories.some((x) => x.id === c)) : PALETTE[def.kind];
  const allowedLinks = LINK_TOOLS[def.kind];
  const linkTools: LinkTool[] = custom ? ALL_LINKS.filter((t) => pins.links.includes(t.kind)) : allowedLinks;

  useEffect(() => { api<Layout>(`/projects/${pid}/layout`).then((l) => { layoutRef.current = l; setLayout(l); }).catch(() => setLayout({})); }, [pid]);
  useEffect(() => { setTool("select"); setSelEdge(null); setSelNote(null); setConfirm(null); setPanel(null); pending.current = null; }, [def.id]);

  const vertical = graph.direction === "TB" || graph.direction === "BT";
  const straight = def.kind === "uc"; // 使用案例圖的關聯畫直線，其餘走直角折線
  const saveLayout = useCallback((next: Layout) => {
    layoutRef.current = next;
    if (readOnly) return; // 唯讀時位置只留在這次瀏覽
    api(`/projects/${pid}/layout`, "PUT", { layout: next }).catch((e) => onError((e as Error).message));
  }, [pid, onError, readOnly]);

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
    const next = { ...cur, custom: cur.custom.map((c) => (c.id === def.id ? { ...c, members: fn(c.members) } : c)) };
    extraRef.current = next; onExtra(next);
  }, [def.id, onExtra]);
  const onResize = useCallback((id: string, b: { x: number; y: number; w: number; h: number }) => setNotes((l) => l.map((n) => (n.id === id ? { ...n, ...b } : n))), [setNotes]);

  // 自訂圖：剛建立的項目放進這張圖
  useEffect(() => {
    if (!custom || !pending.current) return;
    const before = pending.current;
    const fresh = modelItems(view.analysis.elements).filter((e) => !before.has(e.id)).map((e) => e.id);
    if (fresh.length === 0) return;
    pending.current = null;
    setMembers((ids) => [...ids, ...fresh.filter((x) => !ids.includes(x))]);
  }, [view.analysis, custom, setMembers]);

  useEffect(() => {
    if (!layout) return;
    // 位置一旦決定就存起來，之後編輯模型不會重排；只有「自動排列」會整張重排。
    const saved = layoutRef.current[def.id] ?? {};
    const missing = graph.nodes.filter((g) => !saved[g.id]);
    let pos = saved;
    if (missing.length > 0) {
      pos = { ...saved, ...(Object.keys(saved).length === 0 ? autoLayout(graph) : placeNew(graph, saved)) };
      saveLayout({ ...layoutRef.current, [def.id]: pos });
    }
    const els: FlowNode[] = graph.nodes.map((g) => ({ id: g.id, type: "el", position: pos[g.id], data: { g }, selected: g.id === selectedId, selectable: !!g.el, width: g.width, height: g.height }));
    const marks: FlowNode[] = notes.map((a) => ({ id: a.id, type: "note", position: { x: a.x, y: a.y }, data: { a, editable: !readOnly, onResize }, selected: a.id === selNote, draggable: !readOnly, connectable: false, width: a.w, height: a.h, zIndex: a.type === "frame" ? -1 : 2 }));
    setNodes([...marks.filter((n) => n.data.a!.type === "frame"), ...els, ...marks.filter((n) => n.data.a!.type !== "frame")]);
    setEdges(graph.edges.map((e) => toEdge(e, boxes(els), vertical, straight)));
    // selectedId 的變化由下一個 effect 處理，避免重排版面
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, layout, def.id, notes]);

  useEffect(() => {
    const want = (n: FlowNode) => (n.data.a ? n.id === selNote : n.id === selectedId);
    setNodes((ns) => ns.map((n) => (n.selected === want(n) ? n : { ...n, selected: want(n) })));
  }, [selectedId, selNote, setNodes]);

  const onNodeDragStop = useCallback((_e: unknown, _n: FlowNode, moved: FlowNode[]) => {
    const cur = { ...(layoutRef.current[def.id] ?? {}) };
    const marks = new Map<string, { x: number; y: number }>();
    for (const n of moved) {
      const p = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      if (n.data.a) marks.set(n.id, p); else cur[n.id] = p;
    }
    if (moved.some((n) => !n.data.a)) saveLayout({ ...layoutRef.current, [def.id]: cur });
    if (marks.size > 0) setNotes((l) => l.map((a) => (marks.has(a.id) ? { ...a, ...marks.get(a.id)! } : a)));
    // 節點移動後重新挑選連接點
    setEdges(graph.edges.map((e) => toEdge(e, boxes(flow.getNodes() as FlowNode[]), vertical, straight)));
  }, [def.id, saveLayout, setNotes, graph, flow, setEdges, vertical, straight]);

  const resetLayout = () => { const next = { ...layoutRef.current }; delete next[def.id]; saveLayout(next); setLayout(next); setTimeout(() => flow.fitView({ padding: 0.15, maxZoom: 1 }), 60); };

  const act = useCallback(async (fn: () => Promise<View>) => {
    setBusy(true);
    try { onChanged(await fn()); return true; } catch (e) { onError((e as Error).message); return false; } finally { setBusy(false); }
  }, [onChanged, onError]);

  const onConnect = useCallback((c: Connection) => {
    if (readOnly || !c.source || !c.target || c.source === c.target) return;
    const kind = tool !== "select" ? tool : linkTools[0]?.kind;
    if (!kind) return;
    act(() => api<View>(`/projects/${pid}/relations`, "POST", { kind, from: c.source, to: c.target }));
  }, [readOnly, tool, linkTools, pid, act]);

  const clearSel = () => { setSelEdge(null); setSelNote(null); setConfirm(null); onSelectEdge(null); };
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

  const selectedEl = selectedId ? view.analysis.elements.find((e) => e.id === selectedId) : undefined;
  const note = selNote ? notes.find((n) => n.id === selNote) : undefined;
  const onThisDiagram = !!selectedEl && graph.nodes.some((n) => n.id === selectedEl.id);
  const canDelete = !readOnly && !!(note || (selEdge && selEdge.remove && selEdge.kind !== "verify") || (selectedEl && !selectedEl.shared));
  const doDelete = async () => {
    setConfirm(null);
    if (note) { setNotes((l) => l.filter((n) => n.id !== note.id)); setSelNote(null); return; }
    if (selEdge?.remove) {
      const r = selEdge.remove;
      if (await act(() => (r.type === "relation" ? api<View>(`/projects/${pid}/relations/delete`, "POST", { kind: r.kind, from: r.from, to: r.to }) : api<View>(`/projects/${pid}/elements/delete`, "POST", { id: r.id })))) { setSelEdge(null); onSelectEdge(null); onSelectElement(null); }
    } else if (selectedEl) {
      if (await act(() => api<View>(`/projects/${pid}/elements/delete`, "POST", { id: selectedEl.id }))) onSelectElement(null);
    }
  };
  const undo = () => act(() => api<View>(`/projects/${pid}/undo`, "POST", {}));
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

  const exportAs = (kind: "svg" | "png") => {
    const placed = (flow.getNodes() as FlowNode[]).filter((n) => n.data.g).map((n) => ({ g: n.data.g!, x: n.position.x, y: n.position.y }));
    if (placed.length + notes.length === 0) return;
    const svg = toSvg(`${def.code} · ${def.title} — ${view.project.name}`, placed, graph.edges, vertical, straight, notes);
    const name = `${view.project.id}-${def.code}-${def.title}`;
    if (kind === "svg") downloadSvg(svg, name); else downloadPng(svg, name).catch((e) => onError((e as Error).message));
  };

  const activeLink = allowedLinks.find((t) => t.kind === tool);
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,textarea,select")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && canDelete) { e.preventDefault(); setConfirm("selection"); }
    if (e.key === "Escape") { setTool("select"); setConfirm(null); setPanel(null); }
  };

  const catOf = (c: string | null) => meta.categories.find((x) => x.id === c);
  const q = query.trim().toLowerCase();
  const match = (...s: (string | null | undefined)[]) => !q || s.some((x) => x?.toLowerCase().includes(q));
  const memberSet = new Set(def.members ?? []);
  const candidates = panel === "add" ? modelItems(view.analysis.elements).filter((e) => !memberSet.has(e.id) && match(e.name, e.shortName, catOf(e.category)?.zh)) : [];
  const NA = "這張圖不顯示這類項目。要把不同類別放在一起，請用自訂圖。";
  const empty = graph.nodes.length + notes.length === 0;

  return (
    <div className="diagram">
      <div className={`toolbox ${collapsed ? "collapsed" : ""}`} role="toolbar" aria-label="圖形編輯工具">
        <div className="tool-group">
          <span className="label">{def.code} · {def.title}</span>
          <Tool onClick={toggleCollapsed} glyph={collapsed ? "»" : "«"} text={collapsed ? "展開工具列" : "收合工具列"} />
          <Tool on={tool === "select"} onClick={() => setTool("select")} icon="select" text="選取" sub="移動、點選" />
        </div>
        {!readOnly && elTools.length > 0 && (
          <div className="tool-group">
            <span className="label">元素</span>
            {elTools.map((c) => <Tool key={c} onClick={() => newElement(c)} icon={CATEGORY_SHAPE[c] ?? "requirement"} text={catOf(c)?.zh ?? c} title={catOf(c)?.help} />)}
          </div>
        )}
        {!readOnly && linkTools.length > 0 && (
          <div className="tool-group">
            <span className="label">連線</span>
            {linkTools.map((t) => <Tool key={t.kind} on={tool === t.kind} onClick={() => setTool(tool === t.kind ? "select" : t.kind)} icon={linkIconOf(t.kind, def.kind === "uc")} text={t.zh} sub={t.en} title={t.hint} />)}
          </div>
        )}
        {!readOnly && (
          <div className="tool-group">
            <span className="label">標註</span>
            <Tool onClick={() => addNote("note")} icon="note" text="註解" title="折角便箋，寫說明用。不進模型。" />
            <Tool onClick={() => addNote("frame")} icon="frame" text="外框" title="把幾個節點圈成一組。不進模型。" />
            <Tool onClick={() => addNote("text")} icon="text" text="文字" title="單純的文字標籤。不進模型。" />
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
              : <Tool disabled={!canDelete || busy} onClick={() => setConfirm("selection")} glyph="✕" text="刪除選取" title={note ? "刪除選取的標註（Delete 鍵）" : "從模型刪除選取的元素或連線（Delete 鍵）"} />}
            {custom && <Tool disabled={!onThisDiagram} onClick={() => { setMembers((ids) => ids.filter((x) => x !== selectedId)); onSelectElement(null); }} glyph="−" text="移出此圖" title="只從這張圖拿掉，模型裡仍然保留" />}
            <Tool disabled={busy} onClick={undo} glyph="↶" text="復原上一步" title="還原上一次對模型的修改；再按一次會還原這次的還原" />
          </div>
        )}
        <div className="tool-group">
          <span className="label">檢視</span>
          <Tool onClick={() => flow.zoomIn()} glyph="＋" text="放大" />
          <Tool onClick={() => flow.zoomOut()} glyph="－" text="縮小" />
          <Tool onClick={() => flow.fitView({ padding: 0.15, maxZoom: 1 })} glyph="⤢" text="全覽" />
          <Tool onClick={resetLayout} glyph="▦" text="自動排列" title="重新排列這張圖的所有節點（標註不動）" />
        </div>
        <div className="tool-group">
          <span className="label">匯出</span>
          <Tool onClick={() => exportAs("png")} glyph="P" text="PNG" />
          <Tool onClick={() => exportAs("svg")} glyph="S" text="SVG" />
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
      <div ref={canvasRef} className={`canvas ${activeLink ? "linking" : ""}`} tabIndex={0} onKeyDown={onKey}>
        {activeLink && <div className="canvas-hint"><span className="tag done">{activeLink.zh}</span><span className="caption">{activeLink.hint}。按 Esc 結束。</span></div>}
        {note && !readOnly && !activeLink && panel === null && (
          <div className="canvas-hint">
            <span className="tag">{NOTE_ZH[note.type]}</span>
            <input key={note.id} className="input" style={{ width: 280 }} defaultValue={note.text} maxLength={500} aria-label={`${NOTE_ZH[note.type]}的文字`}
              onChange={(e) => { const v = e.target.value; setNotes((l) => l.map((n) => (n.id === note.id ? { ...n, text: v } : n))); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            <span className="caption">拖曳邊框可調整大小</span>
          </div>
        )}
        {panel === "rename" && (
          <div className="canvas-hint">
            <span className="tag">名稱</span>
            <input className="input" style={{ width: 240 }} defaultValue={def.title} maxLength={60} aria-label="圖的名稱" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} onBlur={(e) => rename(e.target.value)} />
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
                      const ok = custom || PALETTE[def.kind].includes(c.id);
                      return (
                        <div className="tool-row" key={c.id}>
                          <Tool disabled={!ok} onClick={() => newElement(c.id)} icon={CATEGORY_SHAPE[c.id] ?? "requirement"} text={c.zh} title={ok ? c.help : NA} />
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
                      <Tool disabled={!ok} on={tool === t.kind} onClick={() => { setTool(t.kind); setPanel(null); }} icon={linkIconOf(t.kind, def.kind === "uc")} text={t.zh} sub={t.en} title={ok ? t.hint : "這張圖不使用這種連線。"} />
                      {custom && <button className="pin" aria-pressed={pins.links.includes(t.kind)} onClick={() => togglePin("links", t.kind)} title={pins.links.includes(t.kind) ? "從常用移除" : "釘選到常用"}>{pins.links.includes(t.kind) ? "已釘選" : "釘選"}</button>}
                    </div>
                  );
                })}
              </div>
              <div className="tool-group">
                <span className="label">標註</span>
                {match("註解", "comment") && <Tool onClick={() => addNote("note")} icon="note" text="註解" sub="comment" />}
                {match("外框", "frame") && <Tool onClick={() => addNote("frame")} icon="frame" text="外框" sub="frame" />}
                {match("文字", "text") && <Tool onClick={() => addNote("text")} icon="text" text="文字" sub="text" />}
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
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <defs>
            <marker id="jri-diamond" viewBox="0 0 20 12" markerWidth="20" markerHeight="12" refX="1" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M1 6 L10 1 L19 6 L10 11 Z" fill="var(--ink)" stroke="var(--ink)" strokeWidth="1" />
            </marker>
          </defs>
        </svg>
        {empty ? <p className="body muted empty">{custom ? "這張圖還沒有內容。用工具列的「加入既有項目」放進模型裡已有的項目，或用「元素」建立新的。" : "這張圖還沒有內容。用左邊工具列的「元素」開始。"}</p> : (
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop} onConnect={onConnect} connectionMode={ConnectionMode.Loose} nodesConnectable={!readOnly} deleteKeyCode={null}
            snapToGrid snapGrid={[SNAP, SNAP]} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.15}
            onNodeClick={(_e, n) => {
              if (n.data.a) { setSelEdge(null); setConfirm(null); onSelectEdge(null); onSelectElement(null); setSelNote(n.id); return; }
              if (!n.data.g?.el) return;
              clearSel(); onSelectElement(n.id);
            }}
            onEdgeClick={(_e, ed) => { const g = (ed.data as { g: GEdge }).g; if (!g.remove) return; setSelNote(null); setSelEdge(g); setConfirm(null); onSelectEdge(g); }}
            onPaneClick={() => { clearSel(); onSelectElement(null); }}
            style={{ color: "var(--ink)" }} proOptions={{ hideAttribution: true }}>
            <Background id="minor" variant={BackgroundVariant.Dots} gap={GRID} size={1.5} color="var(--grid-dot)" />
            <Background id="major" variant={BackgroundVariant.Cross} gap={GRID * 5} size={7} lineWidth={1} color="var(--grid-cross)" />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
