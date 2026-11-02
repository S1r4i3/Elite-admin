"use client";

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Field } from "@/lib/sections";
import { LoadingButton } from "./loading-button";

export function Modal({
  title,
  children,
  footer,
  wide,
  onClose,
  locked = false,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  onClose: () => void;
  /** While a save is running the dialog can't be dismissed (Esc / backdrop / ✕). */
  locked?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !locked && onClose();
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
    };
  }, [onClose, locked]);

  return (
    <>
      <div className="backdrop" onClick={locked ? undefined : onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className={`modal-card${wide ? " wide" : ""}`} onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close" disabled={locked}>
              ✕
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </>
  );
}

type FieldWithValue = Field & { value?: string };

/** Modal containing a generated form. `onSubmit` may throw to show an error. */
export function FormModal({
  title,
  fields,
  submitLabel = "Save",
  onSubmit,
  onClose,
}: {
  title: string;
  fields: FieldWithValue[];
  submitLabel?: string;
  onSubmit: (data: Record<string, string>) => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} wide={fields.length > 6} onClose={onClose} locked={busy}>
      <form id="modal-form" onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="grid grid-2" style={{ gap: "0 14px" }}>
          {fields.map((f) => (
            <div className="field" key={f.name} style={f.half ? undefined : { gridColumn: "1 / -1" }}>
              <label htmlFor={`f-${f.name}`}>{f.label}</label>
              {f.type === "select" ? (
                <select id={`f-${f.name}`} name={f.name} defaultValue={f.value ?? f.options?.[0] ?? ""} required={f.required}>
                  {(f.options || []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea id={`f-${f.name}`} name={f.name} defaultValue={f.value ?? ""} required={f.required} />
              ) : (
                <input id={`f-${f.name}`} name={f.name} type={f.type || "text"} defaultValue={f.value ?? ""} required={f.required} />
              )}
              {f.hint && <p className="hint">{f.hint}</p>}
            </div>
          ))}
        </div>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-foot" style={{ margin: "14px -20px -20px", borderRadius: 0 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <LoadingButton type="submit" className="btn btn-primary" loading={busy} loadingText="Saving…">
            {submitLabel}
          </LoadingButton>
        </div>
      </form>
    </Modal>
  );
}

/** Imperative confirm dialog (mounts itself, then cleans up). */
export function confirmDialog(message: string, onYes: () => Promise<void> | void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  function Dialog() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    return (
      <Modal
        title="Please confirm"
        onClose={close}
        locked={busy}
        footer={
          <>
            <button className="btn btn-secondary" onClick={close} disabled={busy}>
              Cancel
            </button>
            <LoadingButton
              className="btn btn-danger"
              loading={busy}
              loadingText="Deleting…"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onYes();
                  close();
                } catch (e) {
                  setError((e as Error).message || "Something went wrong. Please try again.");
                  setBusy(false);
                }
              }}
            >
              Delete
            </LoadingButton>
          </>
        }
      >
        <p style={{ margin: 0 }}>{message}</p>
        {error && (
          <p className="error" role="alert" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
      </Modal>
    );
  }
  root.render(<Dialog />);
}
