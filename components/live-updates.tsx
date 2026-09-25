"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type LiveChange = {
  collection: "clients" | "documents" | "leads" | "inquiries" | "handoffs";
  type: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  kind?: string;
  name?: string;
  clientId?: string;
};

/** Window event every table listens to: `ebt:live` with a LiveChange in `detail`. */
export const LIVE_EVENT = "ebt:live";

const describe = (c: LiveChange) => {
  if (c.type === "DELETE") return null;
  if (c.collection === "handoffs") return c.type === "INSERT" && c.kind === "pending" ? "New move request waiting for your approval" : null;
  if (c.collection === "documents" && c.type === "INSERT") {
    const what = c.kind === "upload" ? "New client upload" : c.kind === "draft" ? "Draft shared" : "Final shared";
    return `${what}${c.name ? `: ${c.name}` : ""}`;
  }
  if (c.collection === "documents" && c.kind === "draft") return `Draft updated${c.name ? `: ${c.name}` : ""}`;
  if (c.collection === "clients" && c.type === "INSERT") return `New client registered${c.name ? `: ${c.name}` : ""}`;
  if (c.collection === "leads" && c.type === "INSERT") return `New lead${c.name ? `: ${c.name}` : ""}`;
  if (c.collection === "inquiries" && c.type === "INSERT") return `New website inquiry${c.name ? `: ${c.name}` : ""}`;
  return null;
};

/**
 * Listens to /api/live and keeps every admin page current:
 * refreshes server-rendered pages, tells client tables to reload, and shows a toast.
 */
export function LiveUpdates({ onChange }: { onChange?: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState<"connecting" | "live" | "off">("connecting");
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      es = new EventSource("/api/live");
      es.addEventListener("hello", () => setStatus("live"));
      es.addEventListener("ping", () => setStatus("live"));
      es.addEventListener("change", (msg) => {
        const change = JSON.parse((msg as MessageEvent).data) as LiveChange;
        window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: change }));
        // Debounce: an upload can fire several row events at once.
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
          router.refresh();
          onChangeRef.current?.();
        }, 250);
        const text = describe(change);
        if (text) {
          const id = Date.now() + Math.random();
          setToasts((t) => [...t.slice(-3), { id, text }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
        }
      });
      es.onerror = () => {
        es?.close();
        if (closed) return;
        setStatus("off");
        retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [router]);

  return (
    <>
      <span
        className="pill"
        title={status === "live" ? "Connected to the website — changes appear instantly" : "Not receiving live updates"}
        style={status === "live" ? { background: "var(--ok-bg)", color: "var(--ok)" } : { background: "var(--canvas)", color: "var(--muted)" }}
      >
        {status === "live" ? "● Live" : status === "connecting" ? "○ Connecting…" : "○ Offline"}
      </span>
      {toasts.length > 0 && (
        <div className="toast-root" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div className="toast" key={t.id}>
              {t.text}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
