// 協作感知（F-38）：右上角的在線頭像，以及別人選取的元素／列／白板卡片上的顏色框與小頭像。
// 位置每次改變就回報（稍等 250 毫秒合併連續變化），另外每 15 秒回報一次表示還在；別人的變化由伺服器即時推送（SSE）。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

export interface PeerSpot { project: string; page: string; pageZh: string; detail: string; target: { kind: string; id: string; label: string } | null }
export interface Peer { key: string; name: string; role: string; color: string; avatar: boolean; spot: PeerSpot | null; at: number }

const HEARTBEAT_MS = 15_000;
const tab = (() => {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
})();

let peers: Peer[] = [];
let base: PeerSpot | null = null; // 工作區回報的位置
let card: PeerSpot["target"] = null; // 白板頁選取的卡片（蓋過元素選取）
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

let started = false, timer = 0, beat = 0;
function send(): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const spot = base ? { ...base, target: card ?? base.target } : null;
    fetch("/api/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tab, spot }) })
      .then((r) => (r.ok ? r.json() : null)).then((d: { peers?: Peer[] } | null) => { if (d?.peers) { peers = d.peers; emit(); } }).catch(() => undefined);
  }, 250);
}

/** 登入後呼叫一次：開始回報與接收。 */
export function startPresence(): void {
  if (started || typeof EventSource === "undefined") return;
  started = true;
  const es = new EventSource(`/api/presence/stream?tab=${tab}`);
  es.onmessage = (e) => { try { peers = (JSON.parse(e.data) as { peers: Peer[] }).peers; emit(); } catch { /* 略過壞掉的訊息 */ } };
  // 斷線重連時伺服器已把這個分頁移除，重新回報一次
  es.onopen = () => send();
  beat = window.setInterval(send, HEARTBEAT_MS);
  addEventListener("pagehide", () => {
    clearInterval(beat);
    navigator.sendBeacon?.("/api/presence/leave", new Blob([JSON.stringify({ tab })], { type: "application/json" }));
  });
  send();
}

/** 工作區回報自己在哪（null：在專案列表或管理頁）。 */
export function reportSpot(spot: PeerSpot | null): void {
  if (JSON.stringify(spot) === JSON.stringify(base)) return;
  base = spot;
  send();
}

/** 白板頁回報選取的卡片；離開白板或取消選取時給 null。 */
export function useReportCard(target: PeerSpot["target"]): void {
  const key = JSON.stringify(target);
  useEffect(() => {
    card = target;
    send();
    return () => { card = null; send(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** 其他在線的人；同一人開了多個分頁只算一次，取最近動過的那個位置。 */
export function usePeers(): Peer[] {
  const all = useSyncExternalStore(subscribe, () => peers);
  return useMemo(() => {
    const by = new Map<string, Peer>();
    for (const p of all) { const cur = by.get(p.key); if (!cur || p.at > cur.at) by.set(p.key, p); }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
}

/** 在同一個專案（含同一分支）裡選了 id 的人。 */
export function usePeersOn(id: string | null | undefined): Peer[] {
  const list = usePeers();
  if (!id || !base) return [];
  return list.filter((p) => p.spot?.project === base!.project && p.spot.target?.id === id);
}

/** 名字縮寫：中文取最後一個字（名），英文取前兩個字母。 */
function initials(name: string): string {
  const n = name.trim();
  if (!n) return "?";
  if (/[㐀-鿿]/.test(n)) return n.replace(/[^㐀-鿿]/g, "").slice(-1) || n[0];
  const parts = n.split(/[\s._@-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : n.slice(0, 2)).toUpperCase();
}

export function Avatar({ peer, size = 26 }: { peer: Pick<Peer, "key" | "name" | "color" | "avatar">; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, borderColor: peer.color, background: peer.color, fontSize: Math.round(size * 0.45) };
  return (
    <span className="pz-avatar" style={style} aria-hidden>
      {peer.avatar && !broken
        ? <img src={`/api/presence/avatar/${peer.key}`} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : initials(peer.name)}
    </span>
  );
}

export const whereText = (p: Peer, here: string | null) => {
  const s = p.spot;
  if (!s) return "在專案列表";
  const parts = [s.project === here ? "這個專案" : s.project, s.pageZh, s.detail, s.target?.label ? `選了「${s.target.label}」` : ""].filter(Boolean);
  return parts.join(" · ");
};

/** 右上角：其他在線的人。點一下跳到對方的位置（同一個專案時）。 */
export function PresenceBar({ here, onJump }: { here: string | null; onJump?: (p: Peer) => void }) {
  const list = usePeers();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // 點名單外面或按 Esc 就關
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (list.length === 0) return null;
  const shown = list.slice(0, 5);
  return (
    <div className="pz-bar" ref={box}>
      <button className="pz-stack" title={list.map((p) => p.name).join("、")} aria-label={`${list.length} 人在線`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {shown.map((p) => <Avatar key={p.key} peer={p} />)}
        {list.length > shown.length && <span className="pz-avatar pz-more">+{list.length - shown.length}</span>}
      </button>
      {open && (
        <div className="pz-pop" role="dialog" aria-label="在線成員">
          <div className="label">在線 {list.length} 人</div>
          {list.map((p) => {
            const canJump = !!onJump && p.spot?.project === here;
            return (
              <button key={p.key} className="pz-row" disabled={!canJump} onClick={() => { if (canJump) { onJump!(p); setOpen(false); } }} title={canJump ? "跳到他的位置" : undefined}>
                <Avatar peer={p} size={28} />
                <span className="pz-who"><b>{p.name}</b>{p.role && <span className="faint"> · {p.role}</span>}<span className="pz-where" style={{ color: p.color }}>{whereText(p, here)}</span></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 掛在元素／列／卡片上：選了它的人的小頭像。 */
export function PeerMarks({ id, size = 18 }: { id: string | null | undefined; size?: number }) {
  const on = usePeersOn(id);
  if (on.length === 0) return null;
  return <span className="pz-marks" title={on.map((p) => `${p.name} 正在看`).join("、")}>{on.slice(0, 3).map((p) => <Avatar key={p.key} peer={p} size={size} />)}</span>;
}

/** 選了 id 的第一個人的顏色，給外框用。 */
export function usePeerColor(id: string | null | undefined): string | null {
  const on = usePeersOn(id);
  return on[0]?.color ?? null;
}
