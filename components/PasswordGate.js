"use client";

import { useEffect, useState } from "react";

const KEY = "ammex_unlocked_until"; // stores an expiry timestamp (ms)
const REMEMBER_DAYS = 14;

export default function PasswordGate({ children }) {
  const [ready, setReady] = useState(false);
  const [ok, setOk] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);

  const expected = process.env.NEXT_PUBLIC_APP_PASSWORD || "ammex";

  useEffect(() => {
    try {
      const until = Number(localStorage.getItem(KEY) || 0);
      setOk(until > Date.now());
    } catch {
      setOk(false);
    }
    setReady(true);
  }, []);

  function submit(e) {
    e.preventDefault();
    if (pw === expected) {
      try {
        const until = Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000;
        localStorage.setItem(KEY, String(until));
      } catch {}
      setOk(true);
      setErr(false);
    } else {
      setErr(true);
    }
  }

  if (!ready) return null;
  if (ok) return children;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gunmetal px-5">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="eyebrow text-rebar text-xs">Ammex Rebar Placers</div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">Bid Calculator</h1>
        </div>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-white/60">Access password</label>
        <input
          autoFocus
          type="password"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setErr(false);
          }}
          className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-3 text-white outline-none focus:border-rebar focus:ring-2 focus:ring-rebar/30"
          placeholder="Enter password"
        />
        {err && <p className="mt-2 text-sm text-rebarLite">That password didn’t match. Try again.</p>}
        <button
          type="submit"
          className="mt-4 w-full rounded-md bg-rebar py-3 font-display font-semibold uppercase tracking-wide text-white transition hover:bg-rebarLite active:translate-y-px"
        >
          Open calculator
        </button>
        <p className="mt-3 text-center text-[11px] text-white/40">Stays unlocked on this device for {REMEMBER_DAYS} days.</p>
      </form>
    </div>
  );
}
