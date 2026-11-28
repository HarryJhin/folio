# Built-in wiki properties on document pages

Final design, 2026-11-27. Implementation targets the fork’s `custom` branch, reviewed at `3ea3fa5`. [Implementation plan](../plans/2026-11-27-default-wiki-properties.md).

A new article should already offer an owner, a verification date, a next review date and tags. Opening an existing article should offer the same four fields. A team can keep its space home free of these fields with one page setting. Showing an empty verification field must never imply that someone reviewed the article.

## What a reader and an editor see

| Page | On first open | After an editor acts |
| --- | --- | --- |
| Existing or new Markdown document in any space | The built-in fields are available under the title. An empty owner or date displays as unset. Tags starts empty unless the document has stored tags. | Assigning an owner leaves the other three page values unset. Marking a document verified uses Folio's existing date and review-deadline rules. |
| A document with existing values | Owner, verification date, next review and tags show their stored values once. Other page properties remain editable as before. | Clearing an owner, deadline or tags leaves an empty field. The verification control keeps its existing explicit mark action. |
| A document used as a space home | The same default applies. An editor can turn off **Wiki properties** for this page. | Fields and the verification badge disappear, and review reminders pause. An editor can turn them back on from the same page menu. The switch explains that review reminders pause while it is off and resume against the saved deadline. |
| A home that only lists files | There is no backing document to configure. | Creating or choosing a home document gives that document the ordinary behavior. |

**Scope.** Use one on/off switch for the four fields per document, shared by all viewers. An opt-out on the space home affects only that document. A nested README or a document reached through a different URL keeps its own setting. Default the group to on even on a real home until an editor chooses otherwise. Keep title and last-edit time as existing page metadata outside the switch. The feature covers pages with `kind: doc`, including Markdown and MDX, across native and light-footprint spaces. Other page kinds keep their existing property surfaces.

The title-area Properties section opens by default on first use for an enabled document. Respect an explicit collapse already saved for this browser and space. Even with zero stored values, the toggle remains visible to a reader. Editors see the existing owner picker, verification action, date input and tag editor. Readers see values and empty states. Turning the group off must leave other properties accessible and the editor's page switch reachable even when all properties are empty.

## Source of truth

| Field | Stored value | What an empty field means |
| --- | --- | --- |
| `owner` | One Folio username | No one has been assigned. Creating the page does not assign its author. |
| `verified` | Existing verification timestamp or legacy date | No verification has been recorded. Only the existing explicit verification action stamps the current time. |
| `review_by` | Existing review deadline | No deadline, no reminder. Marking a page verified retains Folio's existing interval behavior. |
| `tags` | Existing front matter list, including the supported `labels` alias | No tags assigned in front matter. Inline tags still belong to the text and its search index. |

Provide these field definitions on read. Opening, querying and rescanning add zero wiki-property bytes. Compare against the file after normal creation or first indexing: Folio's existing native-space ID initialization still applies. No upgrade batch, database migration, backfilled owner, or manufactured review date is required. User-defined properties such as `accessed` are outside the defaults. Preserve any such values that existing documents already hold.

An explicit opt-out adds one Folio-managed key to that document’s front matter.

```yaml
folio_wiki_properties: disabled
```

Absence means enabled. Re-enabling removes only the recognized marker. Keep existing values through either transition. Folio already carries front matter with a document when Git moves it or a page is copied from a template. An option inside the file follows those operations without a second path or registry to synchronize. Treat an unrecognized value at this key as foreign data: keep it byte-for-byte, use the ordinary default, and explain the collision if someone tries to change the mode.

Two alternatives matter here. Prepopulating four empty keys would make the fields visible to generic Markdown tools. It would also require rewriting existing documents to provide the same behavior there. A template can seed new pages but relies on the author selecting it and does not reach existing pages. Folio and its API expose the definitions on read. Third-party Markdown readers see the values that have actually been saved.

## API and editor contract

Expose an additive `wikiProperties` descriptor on document detail reads. Its two members are `enabled` and `keys`. An enabled document returns the four built-in keys in the order above. A disabled document returns an empty key list. Keep the existing `properties` map faithful to what is stored, including foreign data. A client reads definitions from the descriptor and values from the map. A missing descriptor from an older server or another page kind selects the existing client behavior.

- **Read.** Include the descriptor in REST page properties and indexed page metadata, and MCP `get_page_metadata` and document `read_page`. The compact tree, property inventory, Bases and search continue to describe actual values. A reader may see empty slots without being given editing rights.
- **Toggle.** Extend REST property updates and MCP `set_page_properties` with an optional `wikiPropertiesEnabled` boolean. A switch-only request needs the desired state and the current property ETag. MCP also takes the page ID. With no `properties` member the switch is the only change. An explicit map retains its existing whole-map or merge semantics.
- **Version and permissions.** On a fresh, parseable file read, return `propertyEtag` alongside the property map and descriptor on REST properties, REST metadata and MCP `get_page_metadata`. A file with a block has a string token. A confirmed bare file has `propertyEtag: null`. If only cached index data is available, or the YAML is malformed, omit `propertyEtag` and expose the snapshot as read-only. Preserve the existing `etag` field on the properties route for legacy clients. A switch requires an explicitly supplied `etag`, including `null` for a confirmed bare file. A missing precondition returns HTTP 428 on REST or a precondition error in MCP. The server must read and parse the actual file before accepting it. A reader’s token does not confer write access. A cookie editor may toggle in an agent-review space. A token in that space cannot change the page mode through REST or MCP. Other requests keep their existing review rules.
- **Compatibility.** Reading or echoing the stored marker is safe. Omitting it from a whole-map replacement preserves it. Only the typed switch changes it through property APIs. Apply the ordinary map and switch atomically. Check the supplied ETag even if the desired state already matches. A retry after a lost response first re-reads the page. If the state already matches, it is finished. On Git import, the recognized marker in the file is authoritative.
- **Turn off.** Preserve the stored owner, dates, front matter tags and inline tags. Suppress the computed verification badge, agent verification summary and new `review_due` notifications for the page. Ownership of unrelated AI edit proposals continues to use the stored owner. Stored tags remain searchable and exportable. Raw metadata remains readable to an authorized user. The switch controls the built-in feature; it is never an access restriction.
- **Turn on again.** Show preserved values and recompute the ordinary verification state from the actual deadline and content modification time. A real edit while disabled can therefore result in “changed” on return. Changing only the switch must preserve the document's content timestamp. A dormant deadline can become overdue while the group is off. Resume the usual reminder schedule and deduplication rules when enabled.
- **Conflicting writes.** Reject a stale toggle with the existing conflict response and current metadata. A verification action guarded by the old enabled state must not stamp a document after another editor disables it. Perform the mode check, update and preservation of content modification time inside the document's existing lock, without nesting a second acquisition. Protect a competing body save from an older timestamp being restored after the lock is released. Deliberate edits of raw stored properties retain normal semantics. Editing a date directly is distinct from the verification action that stamps the reviewed body. Unrelated property or body saves must not erase an opt-out or rewrite foreign YAML.

## Verifying a document

The **Mark as verified** action on a document requires `baseRevision`, the existing Folio body revision for the text the person reviewed. The web client captures the displayed Markdown at the click and uses its revision. An API client returns the `bodyRevision` from its document read. A refresh in the background cannot substitute a different revision. Owner and deadline edits do not need a body revision. Older clients calling the document verification action without a revision receive HTTP 428 with instructions to reload or update. Non-document verification keeps its existing contract.

Check the active mode and the body revision at the point the stamp becomes authoritative. Use the room text when collaboration is live, including an edit that has not yet reached disk. A disabled document or a stale revision returns HTTP 409 and changes neither date. A room edit received while a file write is being prepared must take effect before the check or after publication. Existing rules for computing the badge from dates still apply to edits made after verification.

## Delivering review reminders

For a document, the scheduler and the switch serialize on the same page through Folio’s existing single-server document lock. Under the lock, read the current file, verify its mode, owner and deadline, recheck eligibility and weekly deduplication, and hold the lock through notification-row insertion. An unreadable file cannot authorize a new reminder. Candidate selection alone never authorizes delivery. If disabling finishes first, no row can be inserted. If insertion finishes first, the existing notification remains in history even if a socket delivers it later. Enabling a page resumes the ordinary schedule for its saved deadline.

## Editing tags and switching offline

Show one front matter tags row. Read `tags` first and then `labels`, showing a shared tag once in first-seen order. Compare chip identities using the existing tag normalization. Preserve the spelling, order and source key of surviving entries. Removing a chip removes matching entries from both keys. Add new chips to `tags` unless only `labels` exists, in which case add them there. Unrelated edits preserve both original values byte-for-byte. Inline tags stay in the body and in search. If a legacy value cannot be interpreted by the existing tag editor, show its raw value read-only and preserve it on other edits.

The page switch is available online to editors. A disconnected tab may display its last known state, with the switch disabled. The installed offline reader retains its existing read-only document format. A reconnect refreshes the descriptor and token before a new user action. No switch intent is queued or replayed. If the network drops after a request has been sent, re-read on reconnect to establish its outcome.

## Acceptance

1. Open a new document and a pre-existing document with no front matter. All four fields are available to the web client and MCP. A subsequent Git diff against the ordinary post-creation/post-indexing baseline is empty in both native and light-footprint spaces.
2. Use a document with a legacy verification date, `labels`, an inline tag and a custom property. The panel shows one tags row, preserves the legacy spelling on edits, and a read does not alter these values.
3. Disable a home with a populated owner and an overdue deadline. A second reader sees it disabled via both the home and direct page URLs; a neighboring document stays enabled. No new reminder or verification badge appears. Re-enable it and confirm the same owner, deadline and tag values.
4. Race an opt-out against verification and an unrelated metadata edit. Stale operations receive a conflict, a document cannot be stamped while disabled, and committed independent data survives retry. A viewer and a read-only token cannot toggle the setting.
5. Reindex after a Git move, instantiate a template with an opt-out, and reopen after reconnecting. Each resulting page reflects its stored setting. Actual files, API output, the editor and reminders agree.
6. Read revision A, edit only the body to B, then submit verification for A. Both a cold file and an open room with unflushed text return 409 without changing `verified` or `review_by`. A missing revision returns 428. A fresh B can be verified.
7. Pause the runner after it selects an overdue page, finish disabling it, then resume. No new notification row or push is produced. Reverse the order and retain exactly the already-inserted notification.
8. Start with `tags: [api, shared]` and `labels: [legacy, shared]`. Remove `shared` and add `new`. The stored lists become `[api, new]` and `[legacy]`. An unrelated edit preserves both source lists. A labels-only file keeps that key.
9. Compare a bare file, an unreadable file with an index entry and malformed YAML. Only the confirmed bare file returns an explicit null `propertyEtag`. A disconnected client sends zero switch writes, including on reconnect.

## Implementation references

- [Property and page contracts](../../shared/contracts.ts) and [verification state calculation](../../shared/verification.ts)
- [Front matter writes and ETags](../../server/properties.ts), [verification writes and reminders](../../server/verification.ts) and [MCP property tools](../../server/mcp.ts)
- [Document property panel](../../web/src/app/properties/PropertiesPanel.tsx), [verification rows](../../web/src/app/properties/VerificationRows.tsx) and [space home resolution](../../web/src/app/routes/SpaceHome.tsx)
