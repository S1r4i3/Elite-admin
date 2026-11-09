# Elite B Tax — Tax Workflow

State machine stored in the database:

* `public.profiles.stage` — where each client is now
* `public.workflow_transitions` — every allowed decision (from → to, who may do it)
* `public.wf_transition(client, action, actor, note)` — the only way a decision is applied
  (checks role, holder, stage and required documents; moves the client; writes the history row)
* `public.client_handoffs` — full history (hand-offs, decisions, automatic assignments)
* `preparer_email / reviewer_email / filer_email` — remembered per client so rework returns to the **same person**

## Flow

```
CLIENT registers on the website
   │   AUTOMATIC: assigned to the least-busy Document Handler who can sign in
   ▼
DH – Document Handler                         Stage: documents
   • Client uploads documents (go straight to this DH)
   • Collect / verify / organize
   • Doc status: pending → received
   • "Move to →" a Tax Preparer        (immediate, no approval)
   ▼
TP – Tax Preparer                             Stage: preparation
   • Prepare return, calculations
   • Upload the draft estimation (stays internal — the client can't see it yet)
   • "Move to →" a Tax Reviewer        (immediate)
   • (can send back to DH if documents are missing)
   ▼
TR – Tax Reviewer (RV1)                       Stage: review
   • Checks the return and the preparer's draft estimation
   • "Approve return"  ──────────────► CLIENT REVIEW (the draft is released to the client now)
   • "Request changes" (reason) ─────► back to the SAME TP  ↺
   ▼
CLIENT REVIEW (client dashboard)              Stage: client_review
   • Client clicks "Approve"  ───────► TAX FILER (automatic)
   • Client "Request changes" ───────► back to the SAME TP  ↺
   ▼
TF – Tax Filer                                Stage: filing
   • "Mark as e-filed"
   ▼
ACCEPTED                                      Stage: accepted
   • TF uploads final documents for the client
   • "Close case"
   ▼
CLOSED  (end)                                 Stage: closed
```

Rework: after "Request changes" (reviewer or client) the TP fixes it and clicks
**"Corrections done → back to reviewer"**, which returns it to the same TR.

## Transitions

| Action | From → To | Who | Rule |
|---|---|---|---|
| auto-assign | (new client) → documents | system | Least-busy active DH who can sign in |
| move to TP | documents → preparation | DH | Immediate; doc status must be "received" |
| move to TR | preparation → review | TP | Immediate |
| move to DH | preparation → documents | TP | Immediate (missing documents) |
| `review_approve` | review → client_review | TR | A draft must exist; internal drafts are released to the client first |
| `review_changes` | review → preparation | TR | Reason required · back to the same TP |
| `resubmit_review` | preparation → review | TP | Only during rework · back to the same TR |
| `client_approve` | client_review → filing | Client | Auto-assigns the Tax Filer |
| `client_reject` | client_review → preparation | Client | Comment required · back to the same TP |
| `efile` | filing → accepted | TF | |
| `close` | accepted → closed | TF | At least one final document must be shared |

## Client dashboard (7 steps)

1. Account created
2. Documents uploaded
3. Documents received by our team
4. Tax return prepared
5. Reviewed by a tax reviewer
6. Draft approved by you
7. Final documents delivered

## Roles

* **Admin** — never part of the automatic flow (new clients go straight to a DH), but can step in anytime: every workflow button on any client (approve, request changes, e-file, close, and recording the client's approval or rejection given by phone/email) and moving any client to anyone. Every Admin step is recorded in the history.
* Staff are shown as code + full role everywhere, e.g. `DH1 · Document Handler`, `TP1 · Tax Preparer`, `RV1 · Tax Reviewer`, `TF1 · Tax Filer`.
* **Employees page** — current clients, total clients handled and moves per employee; click a name for their open clients and full move history.
* **Uploads** — drafts / finals (admin) and client documents (website) go straight from the browser to Supabase Storage with a signed URL, so files up to 15 MB work on Vercel (its functions refuse bodies over ~4.5 MB).
* **Document Handler / Tax Preparer** — "Move to →" in the client list.
* **Tax Reviewer / Tax Filer** — "Review →" / "Take action →" opens the client's workflow buttons.
* An employee sees only the clients they currently hold (and those clients' documents).

## Guided uploads
* Tax Reviewer clicks **Approve return** with no draft shared → a message explains a draft is needed and the "Share draft estimation" upload opens for that client; after the upload the return is approved automatically.
* Tax Filer clicks **Mark as e-filed** → the "Share final document" upload opens straight away; then **Close case**.

## Client dashboard (8 steps)
Account created · Documents uploaded · Documents received by our team · Tax return prepared · Reviewed by a tax reviewer · Draft approved by you · Return e-filed successfully · Final documents delivered (only after e-filing).

## Speed
Both apps run their server functions in Vercel region `sin1` (vercel.json), next to the Supabase database (ap-southeast-1). Every database call was previously crossing from Washington (iad1) to Singapore.
