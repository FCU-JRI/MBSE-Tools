import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, ConnectionMode, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from "@xyflow/react";
import type { Connection, Edge, Node, NodeProps } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import { api } from "./api.ts";
import type { Layout, Meta, View } from "./api.ts";
import { buildGraph, CATEGORY_SHAPE, LINK_TOOLS, PALETTE } from "./model.ts";
import type { DiagramDef, GEdge, GNode, Graph } from "./model.ts";
import { iconSvg, nodeSvg, SCREEN } from "./shapes.ts";
import { downloadPng, downloadSvg, toSvg } from "./exportSvg.ts";

type NData = { g: GNode };
type FlowNode = Node<NData, "el">;
const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

/** 節點：以 SysML 記法的 SVG 繪製；四邊各一個連接點，起訖都可用。 */
function ElementNode({ data, selected }: NodeProps<FlowNode>) {
  const { g } = data;
  const svg = useMemo(() => nodeSvg(g, 0, 0, SCREEN, selected ? 2 : 1), [g, selected]);
  return (
    <div className={`sysml-node ${selected ? "is-selected" : ""}`} style={{ width: g.width, height: g.height }}>
      <svg width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={`${g.keyword} ${g.name}`.trim() || g.shape} dangerouslySetInnerHTML={{ __html: svg }} />
      {SIDES.map((p) => <Handle key={p} id={p} type="source" position={p} isConnectable={!!g.el} style={g.el ? undefined : { visibility: "hidden" }} />)}
    </div>
  );
}
const nodeTypes = { el: ElementNode };

function autoLayout(graph: Graph): Record<string, { x: number; y: number }> {
  const dg = new dagre.graphlib.Graph();
  dg.setGraph({ rankdir: graph.direction, nodesep: 40, ranksep: 72, marginx: 24, marginy: 24 });
  dg.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) dg.setNode(n.id, { width: n.width, height: n.height });
  for (const e of graph.edges) if (e.source !== e.target) dg.setEdge(e.source, e.target);
  dagre.layout(dg);
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of graph.nodes) { const p = dg.node(n.id); out[n.id] = { x: Math.round(p.x - n.width / 2), y: Math.round(p.y - n.height / 2) }; }
  return out;
}

type Box = { x: number; y: number; w: number; h: number };
/** 依兩個節點的相對位置選最近的一對連接點，線才不會穿過圖形。 */
function sides(a: Box, b: Box): [Position, Position] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) * (a.h + b.h) > Math.abs(dy) * (a.w + b.w)) return dx > 0 ? [Position.Right, Position.Left] : [Position.Left, Position.Right];
  return dy > 0 ? [Position.Bottom, Position.Top] : [Position.Top, Position.Bottom];
}

function toEdge(e: GEdge, pos: Map<string, Box>): Edge {
  const a = pos.get(e.source), b = pos.get(e.target);
  const [sh, th] = a && b ? sides(a, b) : [Position.Bottom, Position.Top];
  return {
    id: e.id, source: e.source, target: e.target, sourceHandle: sh, targetHandle: th, label: e.label || undefined, data: { g: e },
    type: e.kind === "compose" || e.kind === "succession" || e.kind === "transition" ? "smoothstep" : "straight",
    style: { strokeWidth: 1, strokeDasharray: e.dashed ? "6 4" : undefined }, labelBgPadding: [4, 2],
    markerStart: e.tail === "diamond" ? "jri-diamond" : undefined,
    markerEnd: e.head === "open" ? { type: MarkerType.Arrow, color: "currentColor", width: 18, height: 18, strokeWidth: 1.2 } : undefined,
    selectable: e.remove !== null, focusable: e.remove !== null,
  };
}
const boxes = (list: { id: string; position: { x: number; y: number }; data: NData }[]) =>
  new Map<string, Box>(list.map((n) => [n.id, { x: n.position.x, y: n.position.y, w: n.data.g.width, h: n.data.g.height }]));

export interface DiagramProps {
  readOnly?: boolean;
  view: View; meta: Meta; def: DiagramDef;
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
function Tool({ on, onClick, icon, text, sub, disabled, title, danger }: { on?: boolean; onClick: () => void; icon?: IconName; text: string; sub?: string; disabled?: boolean; title?: string; danger?: boolean }) {
  return (
    <button className={`tool ${danger ? "danger" : ""}`} aria-pressed={on} disabled={disabled} onClick={onClick} title={title}>
      {icon && <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(icon, SCREEN) }} />}
      <span>{text}{sub && <small>{sub}</small>}</span>
    </button>
  );
}

function Canvas({ readOnly, view, meta, def, selectedId, onSelectElement, onSelectEdge, onNew, onChanged, onError }: DiagramProps) {
  const pid = view.project.id;
  const flow = useReactFlow();
  const graph = useMemo(() => buildGraph(def, view.analysis), [def, view.analysis]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const linkTools = LINK_TOOLS[def.kind];
  const [tool, setTool] = useState<string>("select"); // "select" 或連線種類
  const [selEdge, setSelEdge] = useState<GEdge | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const layoutRef = useRef<Layout>({});

  useEffect(() => { api<Layout>(`/projects/${pid}/layout`).then((l) => { layoutRef.current = l; setLayout(l); }).catch(() => setLayout({})); }, [pid]);
  useEffect(() => { setTool("select"); setSelEdge(null); setConfirm(false); }, [def.id]);

  useEffect(() => {
    if (!layout) return;
    const saved = layout[def.id] ?? {};
    const auto = autoLayout(graph);
    const next: FlowNode[] = graph.nodes.map((g) => ({ id: g.id, type: "el", position: saved[g.id] ?? auto[g.id], data: { g }, selected: g.id === selectedId, selectable: !!g.el, width: g.width, height: g.height }));
    setNodes(next);
    setEdges(graph.edges.map((e) => toEdge(e, boxes(next))));
    // selectedId 的變化由下一個 effect 處理，避免重排版面
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, layout, def.id]);

  useEffect(() => { setNodes((ns) => ns.map((n) => (n.selected === (n.id === selectedId) ? n : { ...n, selected: n.id === selectedId }))); }, [selectedId, setNodes]);

  const saveLayout = useCallback((next: Layout) => {
    layoutRef.current = next;
    if (readOnly) return; // 唯讀時位置只留在這次瀏覽
    api(`/projects/${pid}/layout`, "PUT", { layout: next }).catch((e) => onError((e as Error).message));
  }, [pid, onError, readOnly]);

  const onNodeDragStop = useCallback((_e: unknown, _n: FlowNode, moved: FlowNode[]) => {
    const cur = { ...(layoutRef.current[def.id] ?? {}) };
    for (const n of moved) cur[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    saveLayout({ ...layoutRef.current, [def.id]: cur });
    // 節點移動後重新挑選連接點
    setEdges(graph.edges.map((e) => toEdge(e, boxes(flow.getNodes() as FlowNode[]))));
  }, [def.id, saveLayout, graph, flow, setEdges]);

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

  const selectedEl = selectedId ? view.analysis.elements.find((e) => e.id === selectedId) : undefined;
  const canDelete = !readOnly && !!((selEdge && selEdge.remove && selEdge.kind !== "verify") || (selectedEl && !selectedEl.shared));
  const doDelete = async () => {
    setConfirm(false);
    if (selEdge?.remove) {
      const r = selEdge.remove;
      if (await act(() => (r.type === "relation" ? api<View>(`/projects/${pid}/relations/delete`, "POST", { kind: r.kind, from: r.from, to: r.to }) : api<View>(`/projects/${pid}/elements/delete`, "POST", { id: r.id })))) { setSelEdge(null); onSelectEdge(null); onSelectElement(null); }
    } else if (selectedEl) {
      if (await act(() => api<View>(`/projects/${pid}/elements/delete`, "POST", { id: selectedEl.id }))) onSelectElement(null);
    }
  };
  const undo = () => act(() => api<View>(`/projects/${pid}/undo`, "POST", {}));

  const exportAs = (kind: "svg" | "png") => {
    const placed = (flow.getNodes() as FlowNode[]).map((n) => ({ g: n.data.g, x: n.position.x, y: n.position.y }));
    if (placed.length === 0) return;
    const svg = toSvg(`${def.code} · ${def.title} — ${view.project.name}`, placed, graph.edges);
    const name = `${view.project.id}-${def.code}-${def.title}`;
    if (kind === "svg") downloadSvg(svg, name); else downloadPng(svg, name).catch((e) => onError((e as Error).message));
  };

  const activeLink = linkTools.find((t) => t.kind === tool);
  const linkIcon = (k: string): IconName => (k === "compose" ? "diamond" : ["derive", "refine", "satisfy", "trace"].includes(k) && def.kind !== "uc" ? "dashed" : "line");
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,textarea,select")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && canDelete) { e.preventDefault(); setConfirm(true); }
    if (e.key === "Escape") { setTool("select"); setConfirm(false); }
  };

  return (
    <div className="diagram">
      <div className="toolbox" role="toolbar" aria-label="圖形編輯工具">
        <div className="tool-group">
          <span className="label">{def.code} · {def.title}</span>
          <Tool on={tool === "select"} onClick={() => setTool("select")} icon="select" text="選取" sub="移動、點選" />
        </div>
        {!readOnly && PALETTE[def.kind].length > 0 && (
          <div className="tool-group">
            <span className="label">元素</span>
            {PALETTE[def.kind].map((c) => {
              const cat = meta.categories.find((x) => x.id === c);
              return <Tool key={c} onClick={() => { setTool("select"); onNew(c, def.kind === "act" || def.kind === "stm" ? def.context : null); }} icon={CATEGORY_SHAPE[c] ?? "requirement"} text={cat?.zh ?? c} title={cat?.help} />;
            })}
          </div>
        )}
        {!readOnly && linkTools.length > 0 && (
          <div className="tool-group">
            <span className="label">連線</span>
            {linkTools.map((t) => <Tool key={t.kind} on={tool === t.kind} onClick={() => setTool(tool === t.kind ? "select" : t.kind)} icon={linkIcon(t.kind)} text={t.zh} sub={t.en} title={t.hint} />)}
          </div>
        )}
        {!readOnly && (
          <div className="tool-group">
            <span className="label">編輯</span>
            {confirm
              ? <><Tool danger onClick={doDelete} disabled={busy} text="確定刪除" /><Tool onClick={() => setConfirm(false)} text="取消" /></>
              : <Tool disabled={!canDelete || busy} onClick={() => setConfirm(true)} text="刪除選取" title="刪除選取的元素或連線（Delete 鍵）" />}
            <Tool disabled={busy} onClick={undo} text="復原上一步" title="還原上一次對模型的修改；再按一次會還原這次的還原" />
          </div>
        )}
        <div className="tool-group">
          <span className="label">檢視</span>
          <Tool onClick={() => flow.zoomIn()} text="放大" />
          <Tool onClick={() => flow.zoomOut()} text="縮小" />
          <Tool onClick={() => flow.fitView({ padding: 0.15, maxZoom: 1 })} text="全覽" />
          <Tool onClick={resetLayout} text="自動排列" />
        </div>
        <div className="tool-group">
          <span className="label">匯出</span>
          <Tool onClick={() => exportAs("png")} text="PNG" />
          <Tool onClick={() => exportAs("svg")} text="SVG" />
        </div>
      </div>
      <div className={`canvas ${activeLink ? "linking" : ""}`} tabIndex={0} onKeyDown={onKey}>
        {activeLink && <div className="canvas-hint"><span className="tag done">{activeLink.zh}</span><span className="caption">{activeLink.hint}。按 Esc 結束。</span></div>}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <defs>
            <marker id="jri-diamond" viewBox="0 0 20 12" markerWidth="20" markerHeight="12" refX="1" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M1 6 L10 1 L19 6 L10 11 Z" fill="var(--ink)" stroke="var(--ink)" strokeWidth="1" />
            </marker>
          </defs>
        </svg>
        {graph.nodes.length === 0 ? <p className="body muted empty">這張圖還沒有內容。用左邊工具列的「元素」開始。</p> : (
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop} onConnect={onConnect} connectionMode={ConnectionMode.Loose} nodesConnectable={!readOnly} deleteKeyCode={null}
            fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.15}
            onNodeClick={(_e, n) => { if (!n.data.g.el) return; setSelEdge(null); setConfirm(false); onSelectEdge(null); onSelectElement(n.id); }}
            onEdgeClick={(_e, ed) => { const g = (ed.data as { g: GEdge }).g; if (!g.remove) return; setSelEdge(g); setConfirm(false); onSelectEdge(g); }}
            onPaneClick={() => { setSelEdge(null); setConfirm(false); onSelectElement(null); onSelectEdge(null); }}
            style={{ color: "var(--ink)" }} proOptions={{ hideAttribution: true }}>
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
