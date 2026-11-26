# Built-in wiki properties on document pages

Design proposal for review. [Implementation plan](../plans/2026-11-27-default-wiki-properties.md).

A new article should already offer an owner, a verification date, a next review date and tags. Opening an existing article should offer the same four fields. A team can keep its space home free of these fields with one page setting. Showing an empty verification field must never imply that someone reviewed the article.

## What a reader and an editor see

| Page | On first open | After an editor acts |
| --- | --- | --- |
| Existing or new Markdown document in any space | The built-in fields are available under the title. An empty owner or date displays as unset. Tags starts empty unless the document has stored tags. | Assigning an owner writes only the owner. Marking a document verified uses Folio's existing date and review-deadline rules. |
| A document with existing values | Owner, verification date, next review and tags show their stored values once. Other page properties remain editable as before. | Clearing an owner, deadline or tags leaves an empty field. The verification control keeps its existing explicit mark action. |
| A document used as a space home | The same default applies. An editor can turn off **Wiki properties** for this page. | Fields and the verification badge disappear, and review reminders pause. An editor can turn them back on from the same page menu. |
| A home that only lists files | There is no backing document to configure. | Creating or choosing a home document gives that document the ordinary behavior. |

**Product choices proposed for review.** Use one on/off switch for the four fields per document, shared by all viewers. An opt-out on the space home affects only that document. A nested README or a document reached through a different URL keeps its own setting. Default the group to on even on a real home until an editor chooses otherwise. Keep title and last-edit time as existing page metadata outside the switch. The proposal covers pages with `kind: doc`, including Markdown and MDX, across native and light-footprint spaces. Other page kinds keep their existing property surfaces.

The title-area Properties section opens by default on first use for an enabled document. Respect an explicit collapse already saved for this browser and space. Even with zero stored values, the toggle remains visible to a reader. Editors see the existing owner picker, verification action, date input and tag editor. Readers see values and empty states. Turning the group off must leave other properties accessible and the editor's page switch reachable even when all properties are empty.

## Source of truth

| Field | Stored value | What an empty field means |
| --- | --- | --- |
| `owner` | One Folio username | No one has been assigned. Creating the page does not assign its author. |
| `verified` | Existing verification timestamp or legacy date | No verification has been recorded. Only the existing explicit verification action stamps the current time. |
| `review_by` | Existing review deadline | No deadline, no reminder. Marking a page verified retains Folio's existing interval behavior. |
| `tags` | Existing front matter list, including the supported `labels` alias | No tags assigned in front matter. Inline tags still belong to the text and its search index. |

Provide these field definitions on read. Opening, querying and rescanning add zero wiki-property bytes. Compare against the file after normal creation or first indexing: Folio's existing native-space ID initialization still applies. No upgrade batch, database migration, backfilled owner, or manufactured review date is required. User-defined properties such as `accessed` are outside the defaults. Preserve any such values that existing documents already hold.

The proposed Git representation for an explicit opt-out is one Folio-managed setting in that document's front matter:

```yaml
folio_wiki_properties: disabled
```

Absence means enabled. Re-enabling removes only the recognized marker. Keep existing values through either transition. Folio already carries front matter with a document when Git moves it or a page is copied from a template. An option inside the file follows those operations without a second path or registry to synchronize. Treat an unrecognized value at this key as foreign data: keep it byte-for-byte, use the ordinary default, and explain the collision if someone tries to change the mode.

Two alternatives matter here. Prepopulating four empty keys would make the fields visible to generic Markdown tools. It would also require rewriting existing documents to provide the same behavior there. A template can seed new pages but relies on the author selecting it and does not reach existing pages. The proposed read-time default serves Folio and its API without touching those files. **A requirement to expose empty keys to third-party Markdown readers would change this decision.**

## API and editor contract

Expose an additive `wikiProperties` descriptor on document detail reads. Its two members are `enabled` and `keys`. An enabled document returns the four built-in keys in the order above. A disabled document returns an empty key list. Keep the existing `properties` map faithful to what is stored, including foreign data. A client reads definitions from the descriptor and values from the map. A missing descriptor from an older server or another page kind selects the existing client behavior.

- **Read.** Include the descriptor in REST page properties and indexed page metadata, and MCP `get_page_metadata` and document `read_page`. The compact tree, property inventory, Bases and search continue to describe actual values. A reader may see empty slots without being given editing rights.
- **Toggle.** Extend REST property updates and MCP `set_page_properties` with an optional `wikiPropertiesEnabled` boolean. A switch-only request needs the desired state and the current property ETag. MCP also takes the page ID. With no `properties` member the switch is the only change. An explicit map retains its existing whole-map or merge semantics.
- **Version and permissions.** A bare light-footprint document has the explicit ETag `null`. Return `propertyEtag` on document metadata reads alongside the stored property map and descriptor, all from a single current front matter snapshot. A cookie editor may toggle in an agent-review space. Property writes by an agent token in that space are refused, including the new toggle over REST.
- **Compatibility.** Reading or echoing the stored marker is safe. Omitting it from a whole-map replacement preserves it. Only the typed switch changes it through property APIs. On Git import, the recognized marker in the file is authoritative.
- **Turn off.** Preserve the stored owner, dates, front matter tags and inline tags. Suppress the computed verification badge, agent verification summary and new `review_due` notifications for the page. Ownership of unrelated AI edit proposals continues to use the stored owner. Stored tags remain searchable and exportable. Raw metadata remains readable to an authorized user. The switch controls the built-in feature; it is never an access restriction.
- **Turn on again.** Show preserved values and recompute the ordinary verification state from the actual deadline and content modification time. A real edit while disabled can therefore result in “changed” on return. Changing only the switch must preserve the document's content timestamp. A dormant deadline can become overdue while the group is off. Resume the usual reminder schedule and deduplication rules when enabled.
- **Conflicting writes.** Reject a stale toggle with the existing conflict response and current metadata. A verification action guarded by the old enabled state must not stamp a document after another editor disables it. Perform the mode check, update and preservation of content modification time inside the document's existing lock, without nesting a second acquisition. Protect a competing body save from an older timestamp being restored after the lock is released. Deliberate edits of raw stored properties retain normal semantics. Unrelated property or body saves must not erase an opt-out or rewrite foreign YAML.

## Acceptance

1. Open a new document and a pre-existing document with no front matter. All four fields are available to the web client and MCP. A subsequent Git diff against the ordinary post-creation/post-indexing baseline is empty in both native and light-footprint spaces.
2. Use a document with a legacy verification date, `labels`, an inline tag and a custom property. The panel shows one tags row, preserves the legacy spelling on edits, and a read does not alter these values.
3. Disable a home with a populated owner and an overdue deadline. A second reader sees it disabled via both the home and direct page URLs; a neighboring document stays enabled. No new reminder or verification badge appears. Re-enable it and confirm the same owner, deadline and tag values.
4. Race an opt-out against verification and an unrelated metadata edit. Stale operations receive a conflict, a document cannot be stamped while disabled, and committed independent data survives retry. A viewer and a read-only token cannot toggle the setting.
5. Reindex after a Git move, instantiate a template with an opt-out, and reopen after reconnecting. Each resulting page reflects its stored setting. Actual files, API output, the editor and reminders agree.

## Implementation references

- [Property and page contracts](../../shared/contracts.ts) and [verification state calculation](../../shared/verification.ts)
- [Front matter writes and ETags](../../server/properties.ts), [verification writes and reminders](../../server/verification.ts) and [MCP property tools](../../server/mcp.ts)
- [Document property panel](../../web/src/app/properties/PropertiesPanel.tsx), [verification rows](../../web/src/app/properties/VerificationRows.tsx) and [space home resolution](../../web/src/app/routes/SpaceHome.tsx)
