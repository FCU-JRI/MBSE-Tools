// 進站：登入畫面與歡迎畫面。
import { useEffect } from "react";
import "./login.css";

/** 進站的歡迎畫面：一條線長出來，名字淡入，約兩秒後進入首頁。點一下或按任意鍵可跳過；每次開瀏覽器只出現一次。 */
export function Welcome({ name, role, onDone }: { name: string; role: string; onDone: () => void }) {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(onDone, reduce ? 900 : 2300);
    const key = () => onDone();
    window.addEventListener("keydown", key);
    return () => { clearTimeout(t); window.removeEventListener("keydown", key); };
  }, [onDone]);
  const d = new Date();
  const stamp = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()]}`;
  return (
    <button className="welcome" onClick={onDone} aria-label="進入">
      <span className="welcome-brand">JRI MBSE</span>
      <span className="welcome-line" aria-hidden="true" />
      <span className="welcome-hello">歡迎，{name}</span>
      <span className="label welcome-meta">{role} · {stamp}</span>
    </button>
  );
}

export function Login({ google, github }: { google: boolean; github: boolean }) {
  return (
    <div className="shell enter">
      <header className="topbar"><span className="brand">JRI MBSE</span><span className="label">噴射推進研究社</span></header>
      <main className="page login" style={{ width: "100%", maxWidth: 480 }}>
        <p className="welcome-brand" style={{ marginBottom: 8 }}>JRI MBSE</p>
        <span className="welcome-line" aria-hidden="true" style={{ display: "block", marginBottom: 32 }} />
        <section className="section">
          <div className="section-head"><h1 className="section-title">登入</h1></div>
          <p className="body" style={{ marginBottom: 16 }}>JRI 成員請用 Google 帳號登入。第一次登入會送出加入申請，總工程師核准後就能使用。</p>
          <div className="tbtn-row">
            {google ? <a className="btn" href="/auth/google">用 Google 登入</a> : <p className="msg"><span className="tag">未設定</span>Google 登入尚未設定，請聯絡管理員。</p>}
            {github && <a className="tbtn" href="/auth/github">改用 GitHub 登入</a>}
          </div>
          <p className="caption" style={{ marginTop: 24 }}>外部審查委員請直接開啟收到的唯讀連結。</p>
        </section>
      </main>
    </div>
  );
}
