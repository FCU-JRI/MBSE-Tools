import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, useEdgesState, useNodesState } from "@xyflow/react";
import type { Connection, Edge, Node, NodeProps } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import { api } from "./api.ts";
import type { Layout, Meta, View } from "./api.ts";
import { buildGraph, CONNECT_KIND, PALETTE, REQ_LINK_KINDS } from "./model.ts";
import type { DiagramDef, GEdge, GNode, Graph } from "./model.ts";

type NData = { g: GNode; horizontal: boolean };
type FlowNode = Node<NData, "el">;

function ElementNode({ data }: NodeProps<FlowNode>) {
  const { g, horizontal } = data;
  return (
    <div className="node">
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} />
      <div className="node-head">
        <div className="node-st">{g.stereotype}</div>
        <div className="node-name">{g.el.name}</div>
        {g.el.shortName && <div className="node-id">{g.el.shortName}</div>}
      </div>
      {g.lines.length > 0 && <div className="node-comp">{g.lines.slice(0, 5).map((l, i) => <div key={i}>{l}</div>)}</div>}
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} />
    </div>
  );
}
const nodeTypes = { el: ElementNode };

const nodeSize = (g: GNode) => ({ width: 200, height: 58 + (g.el.shortName ? 14 : 0) + (g.lines.length ? Math.min(g.lines.length, 5) * 16 + 9 : 0) });

function autoLayout(graph: Graph): Record<string, { x: number; y: number }> {
  const dg = new dagre.graphlib.Graph();
  dg.setGraph({ rankdir: graph.direction, nodesep: 36, ranksep: 64, marginx: 24, marginy: 24 });
  dg.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) dg.setNode(n.id, nodeSize(n));
  for (const e of graph.edges) if (e.source !== e.target) dg.setEdge(e.source, e.target);
  dagre.layout(dg);
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of graph.nodes) {
    const p = dg.node(n.id);
    const s = nodeSize(n);
    out[n.id] = { x: Math.round(p.x - s.width / 2), y: Math.round(p.y - s.height / 2) };
  }
  return out;
}

function toEdge(e: GEdge): Edge {
  const dashed = ["derive", "refine", "trace", "satisfy", "verify"].includes(e.kind);
  const base: Edge = { id: e.id, source: e.source, target: e.target, label: e.label || undefined, data: { g: e }, type: e.kind === "compose" ? "smoothstep" : "default",
    style: { strokeWidth: 1, strokeDasharray: dashed ? "5 4" : undefined }, labelBgPadding: [4, 2] };
  if (e.kind === "compose") return { ...base, markerStart: "jri-diamond" };
  return { ...base, markerEnd: { type: dashed ? MarkerType.Arrow : MarkerType.ArrowClosed, color: "currentColor", width: 16, height: 16 } };
}

export interface DiagramProps {
  view: View; meta: Meta; def: DiagramDef;
  selectedId: string | null;
  onSelectElement: (id: string | null) => void;
  onSelectEdge: (e: GEdge | null) => void;
  onNew: (category: string, parentId: string | null) => void;
  onChanged: (v: View) => void;
  onError: (m: string) => void;
}

export function Diagram({ view, meta, def, selectedId, onSelectElement, onSelectEdge, onNew, onChanged, onError }: DiagramProps) {
  const pid = view.project.id;
  const graph = useMemo(() => buildGraph(def, view.analysis), [def, view.analysis]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [linkKind, setLinkKind] = useState("derive");
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const layoutRef = useRef<Layout>({});

  useEffect(() => { api<Layout>(`/projects/${pid}/layout`).then((l) => { layoutRef.current = l; setLayout(l); }).catch(() => setLayout({})); }, [pid]);

  useEffect(() => {
    if (!layout) return;
    const saved = layout[def.id] ?? {};
    const auto = autoLayout(graph);
    const horizontal = graph.direction === "LR";
    setNodes(graph.nodes.map((g) => ({ id: g.id, type: "el", position: saved[g.id] ?? auto[g.id], data: { g, horizontal }, selected: g.id === selectedId })));
    setEdges(graph.edges.map(toEdge));
    // selectedId 的變化由下一個 effect 處理，避免重排版面
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, layout, def.id]);

  useEffect(() => { setNodes((ns) => ns.map((n) => (n.selected === (n.id === selectedId) ? n : { ...n, selected: n.id === selectedId }))); }, [selectedId, setNodes]);

  const saveLayout = useCallback((next: Layout) => {
    layoutRef.current = next;
    api(`/projects/${pid}/layout`, "PUT", { layout: next }).catch((e) => onError((e as Error).message));
  }, [pid, onError]);

  const onNodeDragStop = useCallback((_e: unknown, _n: FlowNode, moved: FlowNode[]) => {
    const cur = { ...(layoutRef.current[def.id] ?? {}) };
    for (const n of moved) cur[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    saveLayout({ ...layoutRef.current, [def.id]: cur });
  }, [def.id, saveLayout]);

  const resetLayout = () => {
    const next = { ...layoutRef.current };
    delete next[def.id];
    saveLayout(next);
    setLayout(next);
  };

  const onConnect = useCallback(async (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const kind = CONNECT_KIND[def.kind] ?? linkKind;
    try { onChanged(await api<View>(`/projects/${pid}/relations`, "POST", { kind, from: c.source, to: c.target })); }
    catch (e) { onError((e as Error).message); }
  }, [def.kind, linkKind, pid, onChanged, onError]);

  const linkHint: Record<string, string> = {
    bdd: "從上層拉線到下層＝加入零件", ibd: "在零件之間拉線＝連接", act: "拉線＝排定先後",
    req: "從下層拉到上層＝建立所選關係",
  };

  return (
    <>
      <div className="canvas-bar">
        <span className="label">{def.code} · {def.title}</span>
        {PALETTE[def.kind].length > 0 && (
          <div className="tbtn-row">
            <span className="label">新增</span>
            {PALETTE[def.kind].map((c) => <button key={c} className="tbtn" onClick={() => onNew(c, def.kind === "act" ? def.context : null)}>{meta.categories.find((x) => x.id === c)?.zh}</button>)}
          </div>
        )}
        {def.kind === "req" && (
          <label className="tbtn-row"><span className="label">拉線建立</span>
            <select className="input" style={{ width: "6rem", height: 28, fontSize: 13 }} value={linkKind} onChange={(e) => setLinkKind(e.target.value)}>
              {REQ_LINK_KINDS.map((k) => <option key={k} value={k}>{meta.relations[k]?.zh}</option>)}
            </select>
          </label>
        )}
        <span style={{ flex: 1 }} />
        <span className="caption">{linkHint[def.kind]}</span>
        <button className="tbtn" onClick={resetLayout}>自動排列</button>
      </div>
      <div className="canvas">
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <defs>
            <marker id="jri-diamond" viewBox="0 0 20 12" markerWidth="20" markerHeight="12" refX="1" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M1 6 L10 1 L19 6 L10 11 Z" fill="var(--ink)" stroke="var(--ink)" strokeWidth="1" />
            </marker>
          </defs>
        </svg>
        {graph.nodes.length === 0 ? <p className="body muted empty">這張圖還沒有內容。用上方的「新增」開始。</p> : (
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop} onConnect={onConnect} deleteKeyCode={null} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.2}
            onNodeClick={(_e, n) => { onSelectEdge(null); onSelectElement(n.id); }}
            onEdgeClick={(_e, ed) => onSelectEdge((ed.data as { g: GEdge }).g)}
            onPaneClick={() => { onSelectElement(null); onSelectEdge(null); }}
            style={{ color: "var(--ink)" }} proOptions={{ hideAttribution: true }}>
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </>
  );
}
