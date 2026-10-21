# HermesEye business service — protocol v1 local preview

This service owns business objects, revisions, tombstones, durable mutation receipts,
Need/session bindings and execution records. Official Hermes remains unchanged.
Requires Python 3.10+ with SQLite; the launcher supports macOS/Linux (process lock via
`fcntl`). No third-party Python packages are required.

## Start locally

Set a distinct random `HERMES_EYE_TOKEN` (at least 32 characters) in the process environment,
then run `python3 backend/server.py`. Do not commit credentials or put them in documentation.
The default listener is **127.0.0.1:8787**; data is stored in ignored
`backend/.local/workspace.sqlite`. `--port` and `--data` override these defaults.
Keep the database, WAL and lock directory private; only one service process may open it.
Stop the service before copying its database for backup.

Without upstream configuration, sync works but session/run capabilities are false.
To test real Hermes later, set `HERMES_ROOT` to its service root (including any proxy prefix,
**without `/v1`**) and `HERMES_TOKEN` to its separate server-side credential.
Only HTTPS and loopback HTTP are accepted upstream; redirects and automatic retries are disabled.
`HERMES_EYE_ENABLE_RUNS=1` explicitly enables standalone runs. Runs do not inherit native
session history. Approvals, official Hermes jobs and deployment are not exposed. The V1 reading adapter and its local timer are described below.

The phone's **我的 → 独立业务服务（本地预览）** opens an isolated business replica.
Its token is used in memory for this page only. Reopening reads the offline replica;
reconnect before synchronizing/sending. The preview supports today's plan creation/deletion,
conflict choices, native session chat and original-operation lookup. It does not replace
legacy tabs or automatically upload their v2 data. A phone cannot reach the host's loopback
listener without an explicitly configured secure forwarding/reverse proxy; this change does
not expose a LAN listener or deploy a proxy.

## API

Every endpoint requires `Authorization: Bearer <business token>`. One database and token
represent one personal workspace; this is not a multi-user identity provider.

| Method/path (prefix `/eye/v1`) | Behavior |
|---|---|
| GET `/capabilities` | Stable persisted server/workspace identity and implemented capabilities |
| POST `/mutations` | `deviceId`, `mutationId`, `kind`, `id`, `baseRevision`, `deleted`, `payload`; accepted/conflict receipt |
| GET `/sync?cursor=0&limit=100` | Ordered revision log, next cursor, boundary, hasMore; tombstones retained |
| GET `/snapshot` | Consistent confirmed entities and cursor; retain client outbox when applying |
| POST `/operations` | `operationId`, `needId`, `kind` (`chat`/`run`), `input`; intent recorded before upstream execution |
| GET `/operations/{id}` | Original receipt; known runs can be polled, unknown chat is never replayed |
| GET `/operations/{id}/events?after=0` | Archived events with local sequence; no upstream replay guarantee |
| POST `/operations/{id}/stop` | Request stop; `stopping` is not `cancelled` |

Duplicate mutation IDs return their persisted receipt; changed payloads get 409.
Conflicts preserve the remote revision. Resolution submits a **new** mutation ID.
Unknown execution blocks further operations in that Need; reconcile manually with the
upstream before changing the business service. No automatic clearing or retry is provided.
Session rotation updates the binding, without uploading legacy history.

Event capture uses one collector per run in the service process. Restart/interruption records
an explicit gap; recovered status does not reconstruct missing events. SQLite is the local
transaction boundary, not an exactly-once guarantee for Hermes execution. The append-only
change/event/receipt tables have no retention cleanup in this preview.

## Tests and boundaries

Local Hermes debugging endpoint confirmed by the user on 2026-10-07:
`HERMES_ROOT=http://127.0.0.1:8642` (plain HTTP, no `/v1` suffix).
Pass the supplied upstream credential through `HERMES_TOKEN` in the server process
environment; never save its value in tracked files or logs. Keep `HERMES_EYE_TOKEN`
separate. The existing adapter permits loopback HTTP, so no TLS-policy change is needed.
Here `127.0.0.1` means the host running the business service, not the phone/emulator.
This configuration is user-provided; it is not evidence of a successful live test.

`python3 -m unittest discover -s backend/tests -v` runs isolated temporary databases and a
loopback HTTP server; Hermes is injected, not contacted. `node scripts/test-business.cjs`
tests production client rules/coordinator with injected platform adapters.
Both are stages in `bash scripts/verify.sh`. A sandbox must permit loopback listening.
See `docs/design/03-architecture.md` section 13 for implemented scope and outstanding integration.

Live validation on 2026-10-07 subsequently passed against the configured local Hermes:
authentication, native two-turn session history, duplicate-operation handling, and a new
business process reopening the test ledger. See [live evidence](../docs/testing/validation/2026-10-07-hermes-live/results.txt).
This does not cover phone connectivity, an upstream Hermes restart, runs/events or tools.

## V1 projects and reading (2026-10-11)

Project detail opens a project-specific business panel. Confirming an export queues its
name/goal/management preference/next step/kind/status/criteria/target date/milestones/reviews.
Synchronization retains CAS conflicts; it does not silently replace the local project form.
Milestones are limited to 100 and projected reviews to 200, within the 64KiB projection
limit. The stable `project-<id>` Need uses native Hermes sessions; the editable preview
includes recent reviews. Old conversations are not uploaded or silently migrated.

Set `WEREAD_API_KEY` only in the service environment to configure the WeRead source.
The phone uses the distinct business credential; neither source nor Hermes secrets enter
the reading replica. Source requests use HTTPS, skill version 1.0.4 and complete personal
thought pagination. A source upgrade response stops the batch. No IMA write is performed.

| Method/path (prefix `/eye/v1`) | Behavior |
|---|---|
| GET `/reading` | Books, policy, collection/organization states, source snapshots and actual question operations |
| POST `/reading/policy` | Exact fields: enabled, bookIds, intervalHours, timezone, consent |
| POST `/reading/collect` | cycleId; fetch all authorized books, then organize changed content using durable operations |
| POST `/reading/questions` | id, bookId, entryId, text; optional quote must be a continuous 1–1500 character source excerpt |
| POST `/reading/answer` | questionId, operationId, input; separate Need per question, original-operation lookup handles unknown results |

Default policy is disabled and unconsented with no book IDs. The local process checks
persisted nextAt every 30 seconds. Hours mean elapsed intervals; timezone is an IANA
display setting, not a cron rule. Pause keeps history and does not cancel in-flight work.
An unchanged fingerprint or an unknown operation is never automatically submitted again.
Long notes are split with source IDs and character offsets; only full completion publishes
a new successful organization. Missing source entries retain history. Failures retain the
last complete source snapshot and last successful result.

Preview limits: 30 books, 1–720 hour interval, 100 source pages, 2000 entries/book, 16000
characters/entry, 500KB source JSON/book, 1MiB client response. Oversized data fails
explicitly rather than being silently truncated. Question/input limits are 1000 characters
each, and the final request must still fit the existing 4000-character operation contract.
Prompts request no tool execution, but actual tool permissions remain Hermes configuration.

The service still binds loopback only. Configure secure forwarding for a phone separately.
Tests inject WeRead/Hermes sources and exercise real loopback HTTP; they do not authorize
or verify access to actual private books. Keep source credentials and SQLite backups private.
