"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentRow } from "@/lib/types";
import { Badge } from "./data-table";
import { UploadForm } from "./upload-form";
import { confirmDialog } from "./modal";

const fmtDate = (v: string) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtSize = (kb: number) => (kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : Math.round(kb) + " KB");

/** The three document groups on a client's page, with upload and delete. */
export function ClientDocuments({ clientId, initial }: { clientId: string; initial: DocumentRow[] }) {
  const router = useRouter();
  const [upload, setUpload] = useState<null | "upload" | "draft" | "final">(null);

  const group = (kind: DocumentRow["kind"], title: string) => {
    const rows = initial.filter((d) => d.kind === kind);
    return (
      <div className="card" key={kind}>
        <div className="card-head">
          <h2>
            {title} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>({rows.length})</span>
          </h2>
          <div className="actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setUpload(kind)}>
              ⬆ Upload
            </button>
          </div>
        </div>
        <div className="card-pad" style={{ paddingTop: 6 }}>
          {rows.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              None yet.
            </p>
          ) : (
            rows.map((d) => (
              <div className="list-row" key={d.id}>
                <span className="grow">
                  <strong>{d.name}</strong>
                  <small>
                    {d.type} · {fmtSize(d.sizeKb)} · {fmtDate(d.createdAt)}
                    {d.note ? ` · ${d.note}` : ""}
                  </small>
                  {d.clientComment ? (
                    <small style={{ color: "var(--warn)" }}>Client: {d.clientComment}</small>
                  ) : null}
                </span>
                {d.kind === "draft" && <Badge value={d.status} />}
                <a className="btn btn-secondary btn-sm" href={`/api/files/${d.id}`}>
                  Download
                </a>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Delete"
                  onClick={() =>
                    confirmDialog("Delete this document?", async () => {
                      await fetch(`/api/documents/${d.id}`, { method: "DELETE" });
                      router.refresh();
                    })
                  }
                >
                  🗑
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="stack">
      {group("upload", "Client uploads")}
      {group("draft", "Draft estimations")}
      {group("final", "Final documents")}
      {upload && (
        <UploadForm
          kind={upload}
          clientId={clientId}
          onClose={() => setUpload(null)}
          onDone={() => {
            setUpload(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
