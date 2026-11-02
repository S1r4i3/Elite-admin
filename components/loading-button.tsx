"use client";

import { forwardRef } from "react";

/**
 * Button with a built-in pending state: while `loading` it is disabled (no double submits),
 * shows a spinner and an optional `loadingText`, and announces itself as busy to screen readers.
 * Uses the existing .btn classes, so it looks exactly like the other buttons.
 */
export const LoadingButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; loadingText?: React.ReactNode; spinnerDark?: boolean }
>(function LoadingButton({ loading = false, loadingText, spinnerDark, disabled, children, className = "btn btn-primary", ...rest }, ref) {
  return (
    <button ref={ref} className={className} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? (
        <>
          <span className={`spinner${spinnerDark ? " dark" : ""}`} aria-hidden /> {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
});
