import React, { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { dataConfig, validateManifest } from "./cloudConfig";
const CONFIG = (() => {
  try {
    return dataConfig(import.meta.env);
  } catch (e) {
    return { error: e.message };
  }
})();
export async function downloadCloudJson(client, path) {
  const { data, error } = await client.storage
    .from("nba-props-private")
    .download(path);
  if (error)
    throw Error(
      "無法讀取私有數據。請確認帳戶讀取權限、資料上傳狀態及網絡連線。",
    );
  try {
    return JSON.parse(await data.text());
  } catch {
    throw Error("雲端數據不是有效 JSON。");
  }
}
export default function CloudGate({ children }) {
  const client = useMemo(
    () =>
      CONFIG.mode === "supabase"
        ? createClient(CONFIG.url, CONFIG.key, {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: false,
            },
          })
        : null,
    [],
  );
  const [session, setSession] = useState(null),
    [checking, setChecking] = useState(Boolean(client)),
    [membership, setMembership] = useState("checking"),
    [memberUser, setMemberUser] = useState(null),
    [error, setError] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!client) return;
    let active = true;
    client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setError("無法恢復登入狀態，請重新登入。");
      setSession(data.session);
      setChecking(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, s) => {
      if (active) {
        setSession(s);
        setChecking(false);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);
  const uid = session?.user?.id;
  useEffect(() => {
    if (!client || !uid) {
      setMembership("checking");
      return;
    }
    let active = true;
    setMembership("checking");
    client
      .from("nba_app_members")
      .select("user_id")
      .eq("user_id", uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (active) {
          setMemberUser(uid);
          setMembership(error ? "error" : data ? "allowed" : "denied");
          if (error) setError("無法確認帳戶權限，請稍後重試。");
        }
      });
    return () => {
      active = false;
    };
  }, [client, uid]);
  async function signIn(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setError("登入失敗，請檢查電郵、密碼或帳戶狀態。");
      else setPassword("");
    } catch {
      setError("連線失敗，請稍後重試。");
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setError("");
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) {
      setError("登出失敗，請重試。");
      return;
    }
    setSession(null);
    setPassword("");
  }
  if (CONFIG.error)
    return (
      <div className="cloud-shell">
        <a className="brand" href="#teams">
          NBA / PROPS
        </a>
        <section className="panel auth-card">
          <h1>雲端設定未完成</h1>
          <p role="alert">{CONFIG.error}</p>
        </section>
      </div>
    );
  if (!client) return children({ mode: "local" });
  if (checking)
    return (
      <div className="cloud-shell">
        <p role="status">正在確認登入狀態…</p>
      </div>
    );
  if (session && membership === "allowed" && memberUser === uid)
    return (
      <>
        <div className="sessionbar">
          <span>私人數據 · 已登入</span>
          <button onClick={signOut}>登出</button>
          {error && <small role="alert">{error}</small>}
        </div>
        {children({
          mode: "supabase",
          client,
          userId: uid,
          loadManifest: () => loadCloudManifest(client),
          download: (path) => downloadCloudJson(client, path),
        })}
      </>
    );
  return (
    <div className="cloud-shell">
      <a className="brand" href="#teams">
        NBA / PROPS
      </a>
      <section className="panel auth-card">
        {!session ? (
          <>
            <p className="eyebrow">私人球員分析</p>
            <h1>登入你的分析空間</h1>
            <p>以已獲授權的帳戶查看球員數據與盤口。</p>
            <form onSubmit={signIn}>
              <label>
                電郵
                <input
                  aria-label="登入電郵"
                  autoComplete="username"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                密碼
                <input
                  aria-label="登入密碼"
                  autoComplete="current-password"
                  type="password"
                  required
                  minLength="6"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                {busy ? "正在登入…" : "登入"}
              </button>
            </form>
          </>
        ) : membership === "checking" || memberUser !== uid ? (
          <p role="status">正在確認數據讀取權限…</p>
        ) : (
          <>
            <h1>{membership === "denied" ? "尚未獲授權" : "無法確認權限"}</h1>
            <p>
              {membership === "denied"
                ? "請聯絡專案管理員為此帳戶開通讀取權限。"
                : "請檢查連線或聯絡專案管理員。"}
            </p>
            <button onClick={signOut}>返回登入</button>
          </>
        )}
        {error && (
          <p className="bad" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
export async function loadCloudManifest(client) {
  return validateManifest(await downloadCloudJson(client, "latest.json"));
}
