# Default wiki properties implementation plan

Finalized 2026-11-27 for the Folio fork’s `custom` branch. The implementation baseline is `d8a7b0f`, which includes the Korean interface and the offline reader. Start the feature branch from the current `custom` tip and carry this plan and its [design](../design/2026-11-27-default-wiki-properties.md) with it. The checkboxes track implementation work.

**Goal.** Every existing and new document in every space offers owner, verification date, review deadline and tags. Each document has one reversible switch. A synthetic home listing has no document to configure.

**Architecture.** Derive the four fields from the document kind and its Git front matter. Values continue to use `owner`, `verified`, `review_by` and `tags`. One recognized `folio_wiki_properties: disabled` marker turns the group off. Share the rule between the web client, REST, MCP and reminders. Implementation uses the existing TypeScript/Zod contracts, file writer, PostgreSQL index, single-server collaboration rooms and React Query cache.

## Global constraints

- Reads add zero bytes after ordinary creation or indexing. Preserve IDs, foreign YAML, Yjs state, current body revision rules and permission checks. The feature needs no backfill or database migration.
- Title, edit time, searchable tags and proposal routing to a stored owner keep their existing roles. Empty values imply neither ownership nor verification. A page switch preserves existing values.
- The page action is online-only. Explain the effect in English, Korean and Ukrainian. Existing servers without the descriptor retain their current UI. On the new server, document verification requires the revision that was reviewed, including from older clients.

## Review focus

| Case | Required result | Task |
| --- | --- | --- |
| Confirmed bare file, unreadable indexed file, malformed YAML | Only the confirmed bare file issues a null write token | 1, 2 |
| Verification races a body-only edit or an opt-out | Stale or disabled verification writes neither date, including with a live room | 3 |
| Reminder delivery overlaps a toggle | No new notification row after disabling completes | 4 |
| Both tag keys contain the same chip | One displayed chip, deliberate removal from both lists, unchanged keys survive other edits | 5 |
| Offline click, reconnect, or lost response | No replay, refreshed state and a fresh explicit action if needed | 6 |

## 1. Expose defaults and trustworthy write tokens

**Files.** `shared/contracts.ts`, `shared/verification.ts`, `server/properties.ts`, `server/indexV2/read.ts`, `server/mcp.ts`, `server/mcpOutputSchemas.ts`.

- [ ] Test `wikiPropertiesFor(kind, frontmatter)`. For a document, expect `{enabled: true, keys: ['owner','verified','review_by','tags']}` by default and `{enabled: false, keys: []}` for the recognized marker. Foreign marker values use the default. Other kinds return `undefined`.
- [ ] Return that optional descriptor on REST properties and page metadata, MCP `get_page_metadata`, and document `read_page`. On the two property/metadata REST reads and MCP metadata, return the stored map, descriptor and optional `propertyEtag?: string | null` from one snapshot. Use a string for a parsed block, explicit null for a confirmed bare file, and omit the key on index fallback or unparseable YAML. Keep the legacy properties response’s `etag` and `canEdit` behavior. Raw maps contain stored keys only.
- [ ] Read native and light-footprint fixtures twice. Compare file bytes, service-visible ID, timestamp, body revision, property inventory and the verification summary. Exercise a failed file read with a populated index and malformed YAML separately. Assert field presence with an own-key check to distinguish null from absence.
- [ ] Run `npm test -- shared/verification.test.ts server/properties.test.ts server/mcpVerification.test.ts`; commit the read contracts after all selected cases pass.

## 2. Store a reversible page switch

**Files.** `shared/contracts.ts`, `server/properties.ts`, `server/propertiesRoutes.ts`, `server/storage.ts`, `server/mcp.ts`, `server/mcpOutputSchemas.ts`.

- [ ] Add `wikiPropertiesEnabled?: boolean` to REST property updates and MCP `set_page_properties`. A switch-only request is `{wikiPropertiesEnabled: false, etag}` plus MCP’s page ID. Require the `etag` member even when null. Missing it returns 428 on REST or a precondition error in MCP. Omitted properties means a switch-only write. An explicit map uses the route’s existing replacement or MCP merge semantics.
- [ ] Under `rewriteDocFrontmatter`’s existing lock, validate the actual file, supplied token, kind and marker before changing any bytes. A stale token returns the ordinary conflict and the current readable metadata. A same-state request with a matching token has no side effects. Preserve a marker omitted by a legacy full-map writer, accept an unchanged echo, and reject a raw attempt to change it. A foreign marker survives unrelated writes and blocks a typed change. A combined map and switch either both succeed or neither does.
- [ ] Preserve content time within the locked mutation for a mode-only change. Avoid the existing post-lock timestamp restoration for this path and the document verification path. Preserve an intervening body save, including on rescan. Retain normal indexing, audit and property events for successful changes. A native or light-footprint file that started bare must round-trip its original body bytes.
- [ ] Test cookie editor and viewer, read-only token, review-space cookie editor, and agent token over both REST and MCP. Apply the existing agent review guard to toggles. Submit a stale write, repeat a successful write with a fresh token, and check the read-back path after a lost response. Run `npm test -- server/properties.test.ts server/mcpTagsProperties.test.ts server/verification.test.ts` and commit.

## 3. Verify the exact document body the user reviewed

**Files.** `shared/contracts.ts`, `server/verification.ts`, `server/propertiesRoutes.ts`, `server/storage.ts`, `server/collab.ts`, `web/src/editor/index.tsx`, `web/src/app/routes/PageContent.tsx`, `web/src/app/properties/PropertiesPanel.tsx`, `web/src/app/properties/VerificationRows.tsx`, `web/src/app/api.ts`.

- [ ] Extend `UpdateVerificationBody` with `baseRevision?: string`. On `kind: doc` with `markVerified: true`, a missing revision returns HTTP 428 and reload/update guidance. A changed body returns 409 `revision_conflict`; an opted-out document also refuses the verification action with 409. Reject the whole request, including a combined owner or deadline change, before any write. Preserve the existing conditions for owner/deadline-only edits and non-document verification.
- [ ] On click, capture the Markdown the editor is displaying and send its revision using the same EOL normalization, UTF-8 and SHA-256 as `collab.bodyRevision`. Use a server-issued revision only when it belongs to that captured text. Do not substitute a refetched token or automatically retry a conflict. Make reload and an explicit second verification available.
- [ ] Serialize mode checks with toggles under the existing document lock. Use the authoritative room text when live and the current body from disk otherwise. Settle room seeding/closing or pending write-back outside that lock and retry with the original precondition. Stage from disk only after its body matches the reviewed revision. A file lock alone does not prevent a Yjs edit during awaited I/O. For a guarded stamp, stage the updated file using Folio’s atomic temp-file convention, then recheck the room identity, current body revision and mode immediately before publishing. Keep the final comparison and rename in one event-loop turn, preserve permissions and remove the temporary file on refusal. Retain the existing interval calculation and content time.
- [ ] Force edits at the write boundary using a test barrier. Cover a cold document, an unflushed live room, a room closing, an edit during staging, and disable winning before the stamp. Check unchanged `verified` and `review_by`, no successful audit or write event on rejection, and successful verification of the freshly reviewed body. Run `npm test -- server/verification.test.ts server/updatePageRevision.test.ts web/src/app/properties/PropertiesPanel.test.tsx` and commit.

## 4. Serialize reminder insertion with opt-out

**Files.** `server/storage.ts`, `shared/verification.ts`, `server/verification.ts`, `server/notifications/dispatch.ts`, `server/notifications/store.ts`, `server/mcp.ts`.

- [ ] Carry the effective mode through the minimal indexed tree projection and `toPageMeta`. Suppress computed badges and MCP verification summaries on disabled documents. Keep raw values available and avoid per-row file reads in trees. Preserve non-document behavior.
- [ ] Include the page kind in the reminder candidate query. For each due document, acquire the same per-page lock as the switch. Read the current file, owner, deadline, status and page eligibility, then recheck the weekly throttle under that lock. Use the existing recipient permission checks and owner-to-admin fallback. Hold the lock through insertion of any `review_due` rows. Fail closed on an unreadable or malformed document. Push only for committed rows. Previously inserted rows remain in history.
- [ ] In an integration test, pause after overdue candidate selection, complete opt-out, resume, and assert zero new rows and zero pushes. Reverse the order and expect exactly the already-committed reminder for one eligible recipient. Test re-enable with a past deadline, weekly throttling, archived/templates, lost recipient access and the ordinary non-document path. Run `npm test -- server/verification.test.ts server/mcpVerification.test.ts` and commit.

## 5. Edit legacy and current tags without migrating files

**Files.** `web/src/app/properties/propertyValues.ts`, `web/src/app/properties/PropertiesPanel.tsx`, `web/src/app/properties/usePageProperties.ts`, `server/properties.ts`.

- [ ] Build one ordered display list from `tags` followed by `labels`. Compare identities using the chip normalizer and preserve the original raw map for saving. Retain the source, spelling and order of surviving entries. Remove deleted chips from both lists. Add new chips to `tags` unless the file has only `labels`. Uninterpretable legacy values are read-only. Inline tags remain independently indexed.
- [ ] Test `tags: [api, shared]` plus `labels: [legacy, shared]`. The UI shows `[api, shared, legacy]`; removing `shared` and adding `new` stores `[api, new]` and `[legacy]`. Test an unrelated edit, clearing the row, a labels-only file, an inline-only tag, and a foreign value. Assert unrelated keys keep their original YAML bytes, including when the group is disabled. Preserve the raw API’s explicit key semantics for callers editing a particular list.
- [ ] Run `npm test -- web/src/app/properties/propertyValues.test.ts web/src/app/properties/PropertiesPanel.test.tsx server/mcpTagsProperties.test.ts` and commit.

## 6. Connect the page controls and verify the release

**Files.** `web/src/app/properties/PropertiesPanel.tsx`, `web/src/app/properties/VerificationRows.tsx`, `web/src/app/properties/usePageProperties.ts`, `web/src/app/properties/propertiesLive.ts`, `web/src/app/header/PageActionsMenu.tsx`, `web/src/app/i18n/{en,ko,uk}.json`.

- [ ] Render all four rows once for readers and editors on enabled documents. Open the panel on first use, honor an explicit saved collapse, and keep the page action reachable even with zero stored keys. Reading mode cannot change values. Show other properties independently and retain the classic UI on older servers. Localize the switch and explain that turning it off pauses review reminders and turning it on resumes them against the stored deadline.
- [ ] Disable switching offline. A cached tab may display its last state. The installed offline reader does not gain new persisted fields. On reconnect, fetch the current descriptor and authoritative token before enabling a new click. Never enqueue an offline switch or replay a request with a refreshed token. When a response was lost, re-read to determine its outcome. If another tab changes the mode, refresh the properties, page and tree badge.
- [ ] Test two roles, two connected tabs, an empty page, a populated home, a neighboring page, root README fallback, a synthetic home, a saved collapse, a new and an old server, disconnected/reconnected tabs and an interrupted response. Compare direct page and home URLs. Instantiate an opted-out template, move or rename it, and reindex in native and light-footprint spaces. Assert a view causes zero Git changes and a toggle preserves other YAML and actual values.
- [ ] Run `npm test -- web/src/app/properties/PropertiesPanel.test.tsx web/src/app/properties/propertiesLive.test.tsx web/src/app/header/PageActionsMenu.test.tsx web/src/app/routes/SpaceHome.test.tsx server/pageTemplates.test.ts server/lightFootprint.test.ts`, all preceding task suites, `npm run typecheck` and `npm run build`. Use the repository’s test PostgreSQL setup for the database cases. Skipped cases remain outstanding. Verify the built client in an existing headless browser workflow, including the Korean switch and reminder copy. Record the environment, viewport, display scaling and browser zoom with the results.
- [ ] Update `docs/FEATURES.md`, `docs/MCP.md`, `docs/HANDOFF.md` and the fork’s changelog when integration lands. Document 428/409, the three token states, offline behavior and the home exception. Commit the documentation and submit the verified behavior for the owner’s release review.
