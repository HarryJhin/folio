# Folio fork changelog

Changes integrated into the `custom` branch, dated by source commit. The first entries cover the fork from `3fa892c` through `d361f0d`. [Compare the two revisions](https://github.com/HarryJhin/folio/compare/3fa892c37931a927228222c9956f3ddbb87e42ec...d361f0d6bc5d0adf5cbae71b1b5e22df86be50a5).

## 2026-11-25

### Sharing and files

- **Shared artifacts and forms** — A share link or published HTML artifact checks each requested bundle file against the current share or publication. A visitor can submit a directly shared form when the form accepts anonymous responses. Published and nested forms stay read-only for guests. [PR #8](https://github.com/HarryJhin/folio/pull/8)

- **New pages in folders** — Creating a page from the sidebar uses the open folder’s Git path. A folder name containing spaces or Korean characters used to produce a second directory. Folder links also preserve literal `%`, `#` and `?`. [PR #7](https://github.com/HarryJhin/folio/pull/7)

- **Shared-page header** — Removed the “What is Folio?” badge and introduction card from shared pages. [PR #6](https://github.com/HarryJhin/folio/pull/6)

- **Private attachments and shared file viewers** — Private downloads require a current session or token. Shared and published pages check the file against the page that grants access. Shared PDFs and Office documents open in their read-only viewers. Guest edits and open collaboration sockets respect the grant, including after access changes. An editor must explicitly approve or upload a file introduced by a guest. [PR #5](https://github.com/HarryJhin/folio/pull/5)

- **Attachment grants after migration or restore** — Migration 067 recovers stored-attachment grants from indexed references, Markdown, typed table cells and covers. Older edit shares and trash entries can lack a record of editor approval, so the owner may have to attach the intended files again. Trash restore preserves its original destination and file permissions on retry. [PR #5](https://github.com/HarryJhin/folio/pull/5)

### Reading and sign-in

- **CJK emphasis** — The online and offline Markdown readers both render bold text followed immediately by a Korean particle, including when the bold text ends in a closing parenthesis. [PR #4](https://github.com/HarryJhin/folio/pull/4)

- **Automatic sign-in and Pocket ID sessions** — Operators can start the configured SSO provider on first visit and use `/login?local` for local recovery. With the optional Pocket ID policy, 14 idle days expire the browser session and 30 days require a fresh passkey. Only foreground use extends the idle deadline. After expiry a focused tab starts sign-in once and can return to the document. Migration 066 stores the deadlines. [38823cc](https://github.com/HarryJhin/folio/commit/38823cc30d73c7d2728a8288fa055e7e4ebaf775) · [PR #3](https://github.com/HarryJhin/folio/pull/3)

### Builds

- **Builds and releases** — PR #1 added native ARM64 image publishing for the fork. PR #2 removed that publisher. Pushes to `custom` and pull requests run read-only CI for type checking, the SSO screen test and the production build. The release publisher runs only in the upstream repository. [PR #1](https://github.com/HarryJhin/folio/pull/1) · [PR #2](https://github.com/HarryJhin/folio/pull/2)

### Spaces and documents

- **Space entry and home** — Spaces open in the graph by default. An admin can select Space home in Space settings. `/s/<slug>/home` goes directly to the index document or folder listing. A newly created space opens its own first view even when the switcher order is fixed. Migration 065 stores the preference. [52535c9](https://github.com/HarryJhin/folio/commit/52535c998996d4ce9b7a75efe2552f362bf7779a) · [c743ac5](https://github.com/HarryJhin/folio/commit/c743ac559fee0441a43cc09e4726dbdecadea8d6)

- **Offline Markdown reader** — Install Folio in a supported browser and choose **Save for offline reading** on a trusted device. Reopen the app or the document link offline to read a saved copy. The library is tied to one account, loads the selected body on demand and rechecks access when the server returns. The installed title bar follows the selected theme offline as well. [11 offline reader commits](https://github.com/HarryJhin/folio/compare/3fa892c37931a927228222c9956f3ddbb87e42ec...630dd6f7b7edf2ff3473a54a5da97e6075c6c499)

- **Concurrent edits, page history and trash** — REST and MCP reject stale conditional saves. Page history follows a rename within its mounted root, including artifact previews at earlier revisions. A restore keeps the file’s compound type and handles identity when a name is already taken. Editor DOM regression tests now run with the production router. [ec70646](https://github.com/HarryJhin/folio/commit/ec70646728b8cdbbbbbc619995b0a6de8c32c6fc) · [3c5ab85](https://github.com/HarryJhin/folio/commit/3c5ab85f9cd9b8aef86f972524ee8b60a330714d) · [439f2b8](https://github.com/HarryJhin/folio/commit/439f2b84b6928d2e5cd4af1311f1110a96648379) · [49b19da](https://github.com/HarryJhin/folio/commit/49b19da721349038352e881473031ebec6bbdd78)

- **Table rows and exports** — Duplicating a row assigns a new ID, and reading old tables repairs duplicate IDs. With a filter applied, insertion follows the selected source row. Current-view export respects hidden columns and saved column settings. The toolbar’s YAML export retains saved views for reimport. [6eaf113](https://github.com/HarryJhin/folio/commit/6eaf113ebfe75b6cd32a36b4c9737d3f84edd3df) · [471350a](https://github.com/HarryJhin/folio/commit/471350ab4168c432acb9339ff8c025b7374fe720)

### Agent and identity integrations

- **MCP and OAuth clients** — Clients can connect with `initialize` (2025-11-25) or `server/discover` (2026-07-28). The HTTP endpoint checks browser origins, challenges insufficient OAuth scope and returns protocol errors for invalid JSON or a missing prompt. PKCE code exchange accepts an omitted redirect URI and dynamic registration returns the registered client URI. [1c8f515](https://github.com/HarryJhin/folio/commit/1c8f5151827e4574ac842c3e170d6ad1616d45de) · [7d8b183](https://github.com/HarryJhin/folio/commit/7d8b183b8983213019207b45ee1e2dc371dd8016) · [2ccbc79](https://github.com/HarryJhin/folio/commit/2ccbc79fac938d527f5c8216b50f2654fabfa399)

- **Identity providers and provisioning** — OIDC sign-in always requests `openid`, deduplicates scopes and selects the token endpoint authentication method from provider metadata and the configured secret. SAML validates the bearer recipient against the receiving endpoint. SCIM user and group responses honor requested attributes, including sub-attributes. [ad5c7e9](https://github.com/HarryJhin/folio/commit/ad5c7e917250569eeac94d790514ef04dbeb25a8) · [25835f6](https://github.com/HarryJhin/folio/commit/25835f676b31d4ccb9d130e7f39bdd62afd389f6)

- **Cross-space link reporting** — Ordinary Markdown links resolve through the catalog before navigation. MCP reports unresolved links according to the viewer’s access and reports the correct child folder for Form and Base links. [c743ac5](https://github.com/HarryJhin/folio/commit/c743ac559fee0441a43cc09e4726dbdecadea8d6) · [ec70646](https://github.com/HarryJhin/folio/commit/ec70646728b8cdbbbbbc619995b0a6de8c32c6fc)

## 2026-11-24

- **Primary and reference spaces** — Operators choose the order of primary spaces in the switcher, home redirect and MCP. `list_spaces` accepts `includeAll` for reference spaces. Global search prefers a readable topic copy of the same file and can group duplicates. Searching one named space stays scoped to it. [a36c6f3](https://github.com/HarryJhin/folio/commit/a36c6f3477c71ed57395a32e8df591bb7a216fe5) · [4f2929b](https://github.com/HarryJhin/folio/commit/4f2929b52b57c5debf200b988751f7e2f1285184)

- **Links in imported collections** — Repository-root note links work across visible folder-backed spaces on the same branch. For imported collections, an exact per-file catalog can also route wiki links and local Markdown links to a readable document on another branch of the same repository. [9a01f09](https://github.com/HarryJhin/folio/commit/9a01f09fc04782149f2c2603045aa088c9852d06) · [a36c6f3](https://github.com/HarryJhin/folio/commit/a36c6f3477c71ed57395a32e8df591bb7a216fe5) · [fad8096](https://github.com/HarryJhin/folio/commit/fad809640245b4a4365a3e5dceb2aa463dd3d2f5)

- **Built-in Ask AI** — Set `FOLIO_DISABLE_ASSISTANT=1` to remove built-in chat entry points for members and public-site readers and disable the corresponding server routes. External MCP clients can still use Folio. [3d9a07a](https://github.com/HarryJhin/folio/commit/3d9a07a654bdb0ff07d8990423c7091ed04b4b14)
