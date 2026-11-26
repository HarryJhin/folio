# Default wiki properties implementation plan

> For implementation agents: read the design first. Use the repository's contract-first workflow and the superpowers:executing-plans or superpowers:subagent-driven-development skill. Each checkbox describes one verifiable change.

**Goal** — Expose owner, verification date, review deadline and tags on existing and new document pages in every space, with a reversible page-level opt-out.

**Architecture** — Derive field availability from document kind and one optional Git-backed marker. Keep actual values under the existing keys. Let the REST and MCP detail views, web UI and reminder job consume the same rule.

**Stack** — TypeScript, Zod, Fastify, PostgreSQL's existing front matter index, React, TanStack Query and Vitest. [Design proposal](../design/2026-11-27-default-wiki-properties.md).

## Global constraints

- Target `kind: doc` across all spaces. Scope the switch to one page, including a backing home document. Keep title, edit time and existing tags in search independently of the switch.
- Preserve Git as the source of truth, the page ID, body revision checks, Yjs state, user-defined front matter and existing template behavior. Reads must not create files or modify content.
- The proposed marker is `folio_wiki_properties: disabled`. An ordinary enabled document needs no marker. Keep the classic behavior for clients connected to an older server.
- Follow page-level permissions and agent review rules. Existing jobs must not start sending reminders simply because empty fields are visible.

## Review focus

| Input or failure | Expected result | Task |
| --- | --- | --- |
| Light-footprint file with no front matter, including a historical document | No disk write, new ID, timestamp change or inferred owner on read | 1 |
| An old full-map writer, a foreign marker value or a stale toggle | Preserve the opt-out and foreign bytes; reject stale writes | 2 |
| Opt-out races with verification; a disabled page is already overdue | No verification stamp or new reminder from the disabled state | 2, 3 |
| A legacy `labels` list, body tags and a user-defined property on a disabled page | Preserve storage, tag search and independent property editing | 1, 4 |
| A home opened by two routes or a live second client | The same page policy everywhere, including after reconnect | 4, 5 |

## Task 1. Define the four fields and return them from detail reads

**Files** — `shared/contracts.ts`, `shared/verification.ts`, `server/properties.ts`, `server/indexV2/read.ts`, `server/mcp.ts`, `server/mcpOutputSchemas.ts`. Tests in `shared/verification.test.ts`, `server/properties.test.ts` and `server/mcpVerification.test.ts`.

- [ ] Add tests for `wikiPropertiesFor(kind, frontmatter)`. An empty doc yields `{ enabled: true, keys: ['owner', 'verified', 'review_by', 'tags'] }`. The recognized marker yields `{ enabled: false, keys: [] }`. An unknown value yields the enabled default; a non-document yields `undefined`.
- [ ] Add a red integration test for a blank native document and an existing light-footprint document. Capture file bytes, ID, modification time, ETag and actual property inventory after normal creation/indexing. Read from REST and MCP twice, then assert identical snapshots, no computed verification and the expected descriptor.
- [ ] Define the descriptor type and the two field lists in shared code. Add the optional descriptor to `PagePropertiesResponse`, `PageMetadata` and the document `read_page` output. Use one helper. In REST `GET /api/pages/:id/meta` and MCP `get_page_metadata`, return the document's `propertyEtag: string | null` from the same fresh property snapshot as its descriptor and stored property map. Keep the rest of the index metadata on its existing query path.
- [ ] Run `npm test -- shared/verification.test.ts server/properties.test.ts server/mcpVerification.test.ts`. Check that plain docs still have no `verification` and that the property registry counts only real fields. Commit the shared contract and detail reads.

## Task 2. Persist the page switch without losing concurrent edits

**Files** — `shared/contracts.ts`, `server/properties.ts`, `server/propertiesRoutes.ts`, `server/storage.ts`, `server/mcp.ts`, `server/mcpOutputSchemas.ts`, `server/verification.ts`. Tests in `server/properties.test.ts`, `server/mcpTagsProperties.test.ts`, `server/verification.test.ts`.

- [ ] Test `true → false → false → true` in native and light-footprint docs. Assert exactly one marker when disabled, idempotent retries, the original body/other keys/formatting, and no content timestamp change on a mode-only write. An unchanged foreign marker may be echoed by older clients. An attempted overwrite of a foreign marker through the switch fails without touching it.
- [ ] Add optional `wikiPropertiesEnabled` to the existing property write schemas and response descriptor. Make `properties` optional only when a switch is supplied. REST and MCP accept `{wikiPropertiesEnabled: false, etag}` (plus MCP `id`); no user property may change. An explicit whole-map `properties: {}` retains its existing replacement semantics for ordinary keys. Cover both forms as separate tests. Require an explicit matching ETag on toggles, accepting `null` for initially bare files. Reject a mode change on another page kind. Preserve the internal marker on omission, reject raw attempts to change it, and keep normal replacement semantics for ordinary keys.
- [ ] Extend the collision and ETag checks inside the existing locked front matter mutation. Apply the switch and property edits in the same mutation. Run the mutation under `rewriteDocFrontmatter` / `withDocFileLock`; do not call a locking writer from inside the same lock. Use the existing property event and audit paths. Preserve the text modification timestamp on a pure switch, including a toggle racing a body save. Do not restore an older timestamp over a newer body edit.
- [ ] Exercise a controlled race: read ETag A, commit an owner edit or a disable, submit the stale write with A, expect the existing 409/conflict and the winning data. Verify that stale `markVerified` cannot commit after disable. Return a disabled/conflict result from the verification action; resuming requires a fresh page read. Also test viewer and read-only PAT refusal, a cookie editor in review mode, and refusal of an agent toggle through both MCP and REST with `assertTokenMayWriteDirect`. Keep the existing behavior for ordinary requests without the new switch.
- [ ] Run `npm test -- server/properties.test.ts server/mcpTagsProperties.test.ts server/verification.test.ts`. Commit the server and MCP write behavior.

## Task 3. Align badges, agent summaries and reminders

**Files** — `server/storage.ts`, `server/verification.ts`, `shared/verification.ts`, `server/mcp.ts`. Tests in `server/verification.test.ts` and `server/mcpVerification.test.ts`.

- [ ] Start with enabled and disabled documents having identical overdue dates. Only the enabled page may produce an overdue summary and a new reminder. Confirm non-document reminders, archived/template filtering and weekly deduplication still follow the existing rules.
- [ ] Propagate the effective mode into the indexed entry used by `toPageMeta`, without adding a per-row disk read to tree/fetch. Use the same rule in the reminder candidate path. Include the candidate kind when applying it. Add the mode to the internal minimal tree SQL projection alongside existing verification keys. Leave AI proposal notification routing tied to the stored owner. Recheck a pending candidate before delivery if a toggle invalidated the snapshot. Keep raw dates and tag indexing intact.
- [ ] Verify `read_page`, `fetch`, the tree badge and the reminder runner after disabling and re-enabling. Compare a real intervening content edit with a mode-only edit. Re-enabled state must be computed with the stored timestamps and current deadline.
- [ ] Run `npm test -- server/verification.test.ts server/mcpVerification.test.ts`. Commit the lifecycle behavior.

## Task 4. Show defaults and a reversible switch in the web client

**Files** — `web/src/app/properties/PropertiesPanel.tsx`, `web/src/app/properties/VerificationRows.tsx`, `web/src/app/properties/usePageProperties.ts`, `web/src/app/properties/propertyValues.ts`, `web/src/app/api.ts`, `web/src/app/header/PageActionsMenu.tsx`, and `web/src/app/i18n/{en,uk}.json`. Tests in `web/src/app/properties/PropertiesPanel.test.tsx`, `web/src/app/header/PageActionsMenu.test.tsx` and `web/src/app/routes/SpaceHome.test.tsx`.

- [ ] Write UI tests for an empty enabled page in reading and editing mode, an opted-out home with no other keys, a tagged legacy document, a collapsed panel, and an older server with no descriptor. Assert that the viewer cannot edit, the editor can re-enable an empty page, and displaying or dismissing empty fields issues zero writes.
- [ ] Derive document rows from the descriptor and stored values. Render each built-in once; use the existing owner/verification/date widgets and tag editor. Keep body tags in search; normalize `labels` only for presentation. If both `tags` and `labels` exist, reuse the existing union for display and preserve their original arrays on unrelated edits. Exclude the recognized marker from the ordinary properties form. Preserve the stored input map when saving unrelated edits on a disabled page.
- [ ] Expose one **Wiki properties** page control in an always-reachable editor surface. Reuse the current authorization checks and `usePageProperties` mutation. Open the document panel by default for the new enabled experience while respecting a saved browser preference. Keep the old fallback for other page kinds and older servers.
- [ ] Test toggling the root index and opening it again from the tree, separately from a nested README, a root README fallback and a synthetic home listing. Confirm two connected clients refresh the page, properties and tree badge via existing property events; invalidate those query keys if missing. Offline, show cached state and use an authoritative ETag after reconnect before committing the switch.
- [ ] Run `npm test -- web/src/app/properties/PropertiesPanel.test.tsx web/src/app/properties/propertiesLive.test.tsx web/src/app/header/PageActionsMenu.test.tsx web/src/app/routes/SpaceHome.test.tsx`. Commit controls, copy and client behavior.

## Task 5. Verify compatibility and prepare the release

- [ ] Extend `server/pageTemplates.test.ts` and `server/lightFootprint.test.ts`: instantiate an opted-out document template, move or rename the page, reindex, and check that only that document stays opted out. Read a plain template copy with no marker: the default must be enabled. Verify native and light-footprint files preserve other YAML.
- [ ] Update `docs/FEATURES.md`, `docs/MCP.md`, `docs/HANDOFF.md` and `CHANGELOG.md` once the behavior is implemented. Document the switch, its effect on reminders, explicit empty ETags, the four empty states and the older-server fallback.
- [ ] Run the task tests, then `npm run typecheck` and `npm run build`. Run the additional template and light-footprint suites with `npm test -- server/pageTemplates.test.ts server/lightFootprint.test.ts`. Server integration tests require a test PostgreSQL instance and `DATABASE_URL` as documented by the repository. Treat skipped database cases as outstanding verification. Prefer an existing headless Playwright workflow for the built-container browser check when available. Exercise two roles and two pages, compare REST and MCP results, and inspect the Git diff before opening, after opt-out and after restoring defaults. Record the tested environment, viewport, display scaling and browser zoom separately when reporting the UI check.
- [ ] Release evidence should show one explicit page change, zero files changed by viewing defaults, and no verification recorded without a verification action. Commit the regression tests and documentation; submit the feature for the project owner's behavior review.
