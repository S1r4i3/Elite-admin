"use client";

import { useEffect, useState } from "react";

/**
 * App-wide toast notifications. Call toast.success("Saved") / toast.error("…") from anywhere in the browser;
 * <Toaster /> (mounted once in the root layout) shows them. Errors stay until dismissed or 8 s.
 */
type Kind = "success" | "error" | "info";
type Item = { id: number; kind: Kind; text: string };
const EVENT = "ebt:toast";
let seq = 0;

function emit(kind: Kind, text: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<Item>(EVENT, { detail: { id: ++seq, kind, text } }));
}
export const toast = {
  success: (t: string) => emit("success", t),
  error: (t: string) => emit("error", t),
  info: (t: string) => emit("info", t),
};

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const item = (e as CustomEvent<Item>).detail;
      setItems((s) => [...s.slice(-3), item]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== item.id)), item.kind === "error" ? 8000 : 4000);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <div className="toaster" aria-live="polite" role="status">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : undefined}>
          <span aria-hidden>{t.kind === "success" ? "✓" : t.kind === "error" ? "!" : "i"}</span>
          <p>{t.text}</p>
          <button type="button" aria-label="Dismiss" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
