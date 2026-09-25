import "server-only";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { sb, supabaseEnabled } from "./supabase";

/**
 * One Supabase Realtime subscription per server process, fanned out to every
 * open admin tab through /api/live (Server-Sent Events).
 */
export type LiveEvent = {
  collection: "clients" | "documents" | "leads" | "inquiries" | "handoffs";
  type: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  kind?: string;
  name?: string;
  clientId?: string;
  at: string;
};

type Listener = (e: LiveEvent) => void;
type Hub = { listeners: Set<Listener>; channel: RealtimeChannel | null; status: string };

const g = globalThis as unknown as { __ebtLiveHub?: Hub };
const hub: Hub = (g.__ebtLiveHub ??= { listeners: new Set(), channel: null, status: "idle" });

const TABLES: Record<string, LiveEvent["collection"]> = {
  profiles: "clients",
  portal_documents: "documents",
  leads: "leads",
  inquiries: "inquiries",
  client_handoffs: "handoffs",
};

function ensureChannel() {
  if (hub.channel || !supabaseEnabled()) return;
  let ch = sb().channel("ebt-admin-live");
  for (const table of Object.keys(TABLES)) {
    ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const row: any = payload.eventType === "DELETE" ? payload.old : payload.new;
      const event: LiveEvent = {
        collection: TABLES[table],
        type: payload.eventType as LiveEvent["type"],
        id: row?.id ?? "",
        kind: row?.kind ?? row?.status ?? undefined,
        name: row?.original_name ?? ([row?.first_name, row?.last_name].filter(Boolean).join(" ") || row?.name || undefined),
        clientId: row?.customer_id ?? row?.client_id ?? undefined,
        at: new Date().toISOString(),
      };
      for (const l of hub.listeners) l(event);
    });
  }
  hub.channel = ch.subscribe((status, err) => {
    hub.status = status;
    if (err) console.error("[live] realtime:", err.message);
    // On a dropped connection, rebuild the channel the next time someone listens.
    if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      const old = hub.channel;
      hub.channel = null;
      if (old) sb().removeChannel(old).catch(() => {});
      if (hub.listeners.size) setTimeout(ensureChannel, 3000);
    }
  });
}

export function subscribe(listener: Listener) {
  hub.listeners.add(listener);
  ensureChannel();
  return () => {
    hub.listeners.delete(listener);
  };
}

export const liveStatus = () => hub.status;
