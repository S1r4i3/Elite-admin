import { allowedClientIds, requireAccess } from "@/lib/access";
import { subscribe, liveStatus, type LiveEvent } from "@/lib/live";
import { supabaseEnabled } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/live — Server-Sent Events stream of website data changes. */
export async function GET(req: Request) {
  let access;
  try {
    access = await requireAccess();
  } catch (r) {
    return r as Response;
  }
  // Employees only get events for the clients assigned to them.
  let allowed = await allowedClientIds(access);
  const refreshAllowed = async () => {
    allowed = await allowedClientIds(access);
  };
  const visible = async (e: LiveEvent) => {
    if (allowed === null) return true;
    if (e.collection === "clients") {
      await refreshAllowed(); // an assignment may just have changed
      return allowed!.has(e.id) || e.type === "UPDATE"; // an UPDATE may have removed them — let the table reload
    }
    if (e.collection === "documents") return !!e.clientId && allowed.has(e.clientId);
    return false; // leads, inquiries and hand-off requests are Admin only
  };
  if (!supabaseEnabled()) return new Response("Live updates need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY", { status: 503 });

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = subscribe((e: LiveEvent) => {
        void visible(e).then((ok) => ok && send("change", e));
      });
      const ping = setInterval(() => send("ping", { status: liveStatus() }), 20000);
      send("hello", { status: liveStatus() });
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
