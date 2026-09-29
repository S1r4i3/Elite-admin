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
   • "Move to →" a Tax Reviewer        (immediate)
   • (can send back to DH if documents are missing)
   ▼
TR – Tax Reviewer (RV1)                       Stage: review
   • Uploads/shares the draft estimation with the client
   • "Approve return"  ──────────────► CLIENT REVIEW
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
| `review_approve` | review → client_review | TR | A draft must be shared with the client |
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

* **Admin** — monitors all clients, stages and history; takes no workflow actions; can reassign a client.
* **Document Handler / Tax Preparer** — "Move to →" in the client list.
* **Tax Reviewer / Tax Filer** — "Review →" / "Take action →" opens the client's workflow buttons.
* An employee sees only the clients they currently hold (and those clients' documents).
