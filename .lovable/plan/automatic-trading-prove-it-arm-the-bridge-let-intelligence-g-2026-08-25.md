# Automatic trading: prove it, arm the bridge, let intelligence gate it

Three separate pieces of work, in this order. Each one can only ever _reduce_ what is sent; no existing safety gate is weakened, and nothing here can change what the scanner publishes or any statistic.

## 1. Prove the demo auto path end to end

Right now two demo accounts are armed and ready, demo auto is on system-wide, and the delivery ledger is completely empty. That is consistent with no A+/A/B setup having published since the enqueue moved into the publication path — but it is not proof, and today there is nowhere to look.

- **Record every enqueue decision.** The publication path already computes an outcome (enqueued / filtered / a named reason such as `no_armed_account`, `automatic_execution_disabled`, `filtered_by_user_rules`, `c_grade_never_executes`). Persist the last outcome per scan cycle so it is readable instead of only appearing in server logs.
- **Show it where the user already looks.** The Automatic trading summary gains a live line: the last enqueue decision, its reason in plain words, and when it happened. When the reason is a user rule, the summary names which rule.
- **Admin diagnostic.** A read-only panel in the Admin terminal showing the recent delivery ledger (state, dry-run, destination, reason) plus the last enqueue decisions, so a queued-but-never-sent order is visible without a database query.
- **A safe forced rehearsal.** An admin-only action that queues the most recent alert-eligible active setup to an armed demo account as an explicit dry run. It exercises enqueue → claim → revalidate → sizing → submission decision and stops before the broker call, so the whole path can be proven on demand rather than waiting for the next A-Grade.

No synthetic setups are created for this. If there is no eligible active setup, the rehearsal says so.

## 2. Arm the webhook bridge for live

Live bridge orders are blocked by three independent things today: the system-wide live switch is off, the live host allow-list is empty, and no per-user live confirmation is pinned. PineConnector stays dry-run-only permanently — its quantity syntax is unverified and will not be guessed.

- **Admin controls for the live plane.** The Execution switch panel gains the two switches it currently cannot write (`live_execution_enabled`, `live_auto_enabled`) and an editable live host allow-list. Both switches remain admin-only, are independent of demo auto, and turning them on does not authorise any individual user.
- **Per-user live arming, JSON format only.** The Notifications tab's automated-execution block gets an explicit live path: choose live instead of dry run, then tick a confirmation that names the destination host, the policy (`single_exit_first_target`), the sizing basis, and states that eligible setups may create real broker orders. Selecting live with the PineConnector format is refused with that reason shown.
- **Confirmation stays pinned.** The existing behaviour is kept: the confirmation is bound to the configuration version and to system-wide live availability, so changing the URL, credential, risk inputs or eligibility rules — or a later global live enable — requires a fresh confirmation.
- **Preflight before live is offered.** Live cannot be selected until the URL has passed validation, its host is on the allow-list, and at least one dry-run delivery has been acknowledged. Each unmet condition is listed as a checklist with the reason.

## 3. Let intelligence gate automatic orders

Learning output (fill rate, win-if-filled, replay joint rate, regime tier) is observation-only today, and grading is untouched by it. This adds an **optional, off-by-default, reduce-only** gate on automatic orders — never on the feed, alerts, grading, replay or any statistic.

- A new opt-in setting: require a minimum win-if-filled rate, with a minimum sample size behind it, before an automatic order is queued.
- Thin or absent statistics never authorise anything: with the gate on, a setup whose regime has no mature sample is **not** queued, and the reason says the sample was insufficient rather than implying a prediction.
- Off by default, and the summary states in plain words that the gate is a filter on orders only — your feed and alerts are unchanged by it.
- The gate's refusals are named (`intelligence_gate_below_threshold`, `intelligence_gate_sample_insufficient`) and appear in the ledger and the summary.

## Technical notes

- Enqueue decisions get their own small log table with the reason, counts and timestamp, written from the contained `try` block in the publication path so a write failure still cannot affect a publish.
- The intelligence gate reads `regime_stats` through the existing `lookupRegime` / `MIN_N_*` helpers, applied inside `direct-enqueue.server.ts` after eligibility. The scanner-independence invariant test is unaffected: the dependency direction stays delivery → learning, never scanner → delivery.
- `live_execution_enabled`, `live_auto_enabled` and `allowed_live_hosts` become writable only through the authenticated admin server function after its role check; column privileges on the user-facing authorisation fields are unchanged.
- Tests: enqueue-decision persistence and copy; live-arming refusals (format, unvalidated URL, host not allow-listed, missing confirmation, stale confirmation after a config bump); intelligence gate reduce-only, off-by-default, and refusal on insufficient sample.
- Zero-Hallucination respected throughout: no seeded signals, no invented broker or statistical figures, and unavailable numbers render as unavailable rather than zero.
