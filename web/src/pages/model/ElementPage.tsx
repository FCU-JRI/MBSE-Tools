// 元素說明頁（C＋D）：為什麼、判定條件、各欄位，以及「被誰引用」（反向引用）。編輯在右欄。
import type { ReactNode } from "react";
import type { Model, U } from "./views.ts";
import { GATE_ZH } from "./views.ts";

const KIND_ZH: Record<string, string> = {
  source: "需求書條文", stakeholder: "利害關係人", concern: "關注", usecase: "使用情境", need: "需要", goal: "目標", moe: "MOE", req: "需求", alt: "候選集",
  trade: "方案比較", risk: "風險", decision: "決策", tpm: "TPM", part: "零件", iface: "介面", conflict: "衝突", action: "剖面節點", state: "模式",
};
const score = (L: number | null, C: number | null) => (L == null || C == null ? null : L * C);

export function ElementPage({ M, id, onElement, onView }: { M: Model; id: string; onElement: (id: string) => void; onView: (k: string) => void }) {
  const u = M.U.get(id);
  if (!u) return <p className="body">找不到這個元素，可能已被刪除。</p>;
  const ref = (x: string | null | undefined) => {
    const t = x ? M.U.get(x) : undefined;
    return t ? <button type="button" className="ep-ref" onClick={() => onElement(t.id)}>{t.sn || t.name}</button> : <>—</>;
  };
  const refs = (xs: string[]) => (xs.length ? xs.map((x, i) => <span key={x}>{i ? "、" : ""}{ref(x)}</span>) : <>—</>);
  const rows: [string, ReactNode][] = [];
  const add = (k: string, v: ReactNode) => { if (v != null && v !== "") rows.push([k, v]); };
  const w = M.where(id);
  add("種類", <>{KIND_ZH[u.kind] ?? u.kind}　<span className="label">{u.el.kind}{u.el.category ? ` : ${u.el.category}` : ""}</span></>);
  if (w) add("所在", <button type="button" className="ep-ref" onClick={() => onView(w)}>{M.V.get(w)?.short}</button>);
  add("為什麼", u.why ? <b>{u.why}</b> : <span className="caption">還沒寫（右欄「說明」）</span>);
  add("判定條件", u.judge || <span className="caption">還沒寫（右欄「說明」）</span>);
  add("內容", u.text);
  fields(u, add, ref, refs);
  add("被誰引用", refs([...new Set(M.back.get(id) ?? [])]));
  return (
    <div className="ep">
      <h2 className="heading">{u.sn && <span className="label">{u.sn}　</span>}{u.name}</h2>
      <dl className="ep-dl">{rows.map(([k, v]) => <div key={k} className={k === "為什麼" ? "ep-key" : ""}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </div>
  );
}

function fields(u: U, add: (k: string, v: ReactNode) => void, ref: (x: string | null) => ReactNode, refs: (xs: string[]) => ReactNode) {
  const pill = (t: string, c: string) => <span className={`ld-pill ld-pill-${c}`}>{t}</span>;
  switch (u.kind) {
    case "req":
      add("約束", u.expr && <code>{u.expr}</code>); add("«derive» 來源", refs(u.from)); add("#basis", refs(u.basis)); add("滿足者", ref(u.sat));
      add("驗證方法", u.el.attrs.verifyMethod); add("結果", <>{u.el.attrs.verifyResult ?? ""}　{u.st && pill({ ok: "通過", pend: "待驗證", bad: "不通過" }[u.st], u.st)}{u.el.attrs.judgeSource && <span className="caption">　判定來源：{u.el.attrs.judgeSource}</span>}</>); break;
    case "concern": add("利害關係人", ref(u.stakeholder)); add("來源", refs(u.from)); break;
    case "usecase": add("參與者", refs(u.actors)); add("關注", refs(u.concerns)); add("類型", u.abnormal ? "異常情境" : "正常情境"); break;
    case "need": case "goal": add("來源", refs(u.from)); break;
    case "moe": if (u.moe) add("門檻", <>最低 {u.moe.min}／完全 {u.moe.full}／延伸 {u.moe.ext} {u.moe.unit}；目前 <b>{u.moe.current}</b>；對應 {ref(u.req)}</>); break;
    case "alt": add("候選", <>{u.variants.map((v) => <div key={v.id}>{v.picked ? <>✓ <b>{v.name}</b>（選定）</> : <>✗ {v.name}{v.rejectWhy && <div className="caption">否決原因：{v.rejectWhy}</div>}</>}</div>)}</>); add("權重敏感度", u.sens); break;
    case "trade": add("候選集", ref(u.alt)); add("歸併需求", refs(u.merged)); add("決策", ref(u.dec));
      add("準則", <>{u.crit.map((c) => <div key={c.id}>{c.name} ×{c.w}{c.scale && `：${c.scale}`}</div>)}</>); add("敏感度", u.sens); break;
    case "risk": add("對應設計", refs(u.targets)); add("分數", `${u.L ?? "?"}×${u.C ?? "?"} = ${score(u.L, u.C) ?? "?"} → 殘餘 ${score(u.L2, u.C2) ?? "?"}　${u.state}`); add("緩解", u.mitig); add("回頭修正", u.fix); break;
    case "decision": add("候選集", ref(u.alt)); add("選定", u.chosen); add("決策人／日期", `${u.by}　${u.on}`); add("喊卡", u.gate === "ok" ? pill("已放行", "ok") : <>{pill("喊卡中", "hold")}　{u.holdWhy}</>); break;
    case "tpm": add("數值", <>門檻 {u.dir === "le" ? "≤" : "≥"} {u.thr ?? "—"} {u.unit}；{u.vals.map((v) => `${GATE_ZH[v.gate]} ${v.v}`).join("、") || "還沒有各節點的值"}；對應 {ref(u.req)}</>); break;
    case "part": add("上層", ref(u.parent)); add("質量", `配額 ${u.alloc ?? "—"} kg／目前 ${u.mass ?? "—"} kg`); add("負責", u.owner); add("組成", refs(u.kids)); break;
    case "iface": add("方向", <>{ref(u.a)} → {ref(u.b)}（{u.type}）</>);
      add("參數", u.params.length ? <>{u.params.map((p, i) => <div key={i}>{p.p}：A {p.a}｜B {p.b}　{p.ok ? pill("相容", "ok") : pill("不一致", "bad")}</div>)}</> : null);
      add("同意", `${u.agreeA || "A 端未同意"}　${u.agreeB || "B 端未同意"}`); break;
    case "conflict": add("來源與影響", refs(u.targets)); add("狀態", u.state); break;
    case "action": add("下一個", ref(u.next)); break;
    case "state": add("轉移", <>{u.transitions.map((t, i) => <div key={i}>→ {ref(t.to)}</div>)}</>); break;
  }
}
