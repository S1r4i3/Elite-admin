import Link from "next/link";

export default function NotFound() {
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo">
          <img className="logo-mark logo-mark-lg" src="/brand/ebt-mark.png" alt="Elite B Tax Services" width={320} height={162} />
        </div>
        <h1>Page not found</h1>
        <p className="muted">That page doesn&apos;t exist in the admin panel.</p>
        <Link className="btn btn-primary btn-block" href="/">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
