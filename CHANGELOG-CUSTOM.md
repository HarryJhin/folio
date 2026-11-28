# Folio fork changelog

Changes integrated into the `custom` branch, dated by source commit. Since 2026-11-28 the branch builds on upstream `main` at `726bf53`, six commits after Folio 0.4.6. The first entries cover the fork from `726bf53` through `8b196e0`. [Compare the two revisions](https://github.com/HarryJhin/folio/compare/726bf539b7ef592ec84947916f09a278261df482...8b196e0da096b1fa2e5fa962465e839464ca4319).

## 2026-11-28

- `custom` builds on upstream `main` at `726bf53`, six commits after Folio 0.4.6. Upstream released the offline Markdown reader in 0.4.6, so the fork's own offline reader commits were dropped. Upstream's `065_access_request_page.sql` has the same number as the fork's `065_space_first_view.sql`. The migration runner records file names, so both apply. [Upstream PR #27](https://github.com/evergreen-it-dev/folio/pull/27) · [Upstream base](https://github.com/evergreen-it-dev/folio/commit/726bf539b7ef592ec84947916f09a278261df482)
- Shared pages send the visitor's session again. A signed-in visitor sees the account and can request access. A visitor who can already read the page is taken to it in their own account; `?as=guest` keeps the guest view. Since PR #5 the fork had loaded shared pages without credentials. [df19164](https://github.com/HarryJhin/folio/commit/df1916428594a0122866926d4ef34e44970bfafe)
- Added Korean for the strings that upstream added in 0.4.6 and the commits after it: page access requests, the shared-page header and banners, the link popover, table pinning and the offline reader. [e753a2b](https://github.com/HarryJhin/folio/commit/e753a2b0dbf07644824da1dbd9f221380e3c7709)

## 2026-11-27

- Agents can attach files to a page through MCP. `request_upload` issues a signed upload URL per file, and `PUT /mcp/uploads/*` stores the bytes after it checks the token, the roles, the size and the sha256. An OAuth access token also works on this route. [Compare the revisions](https://github.com/HarryJhin/folio/compare/9af5edbdc002cf6d88709180f6f47a8473234cb4...93f018b24d2bdff2c64cd0feb7b24f767b825461)
- Markdown and MDX documents offer owner, verification date, next review and tags on first open. Turning off wiki properties on one document preserves its stored values and pauses reminders. Verification checks the displayed body revision. [PR #11](https://github.com/HarryJhin/folio/pull/11)
- Added Korean to the interface, including the editor and offline reader. [PR #10](https://github.com/HarryJhin/folio/pull/10)
- The space switcher and MCP list every accessible space. [PR #9](https://github.com/HarryJhin/folio/pull/9)

## 2026-11-25

### Sharing and files

- **Shared artifacts and forms** — A share link or published HTML artifact checks each requested bundle file against the current share or publication. A visitor can submit a directly shared form when the form accepts anonymous responses. Published and nested forms stay read-only for guests. [PR #8](https://github.com/HarryJhin/folio/pull/8)

- **New pages in folders** — Creating a page from the sidebar uses the open folder’s Git path. A folder name containing spaces or Korean characters used to produce a second directory. Folder links also preserve literal `%`, `#` and `?`. [PR #7](https://github.com/HarryJhin/folio/pull/7)

- **Shared-page header** — Removed the “What is Folio?” badge and introduction card from shared pages. [PR #6](https://github.com/HarryJhin/folio/pull/6)

- **Private attachments and shared file viewers** — Private downloads require a current session or token. Shared and published pages check the file against the page that grants access. Shared PDFs and Office documents open in their read-only viewers. Guest edits and open collaboration sockets respect the grant, including after access changes. An editor must explicitly approve or upload a file introduced by a guest. [PR #5](https://github.com/HarryJhin/folio/pull/5)

- **Attachment grants after migration or restore** — Migration 067 recovers stored-attachment grants from indexed references, Markdown, typed table cells and covers. Older edit shares and trash entries can lack a record of editor approval, so the owner may have to attach the intended files again. Trash restore preserves its original destination and file permissions on retry. [PR #5](https://github.com/HarryJhin/folio/pull/5)

### Reading and sign-in

- **CJK emphasis** — The online and offline Markdown readers both render bold text followed immediately by a Korean particle, including when the bold text ends in a closing parenthesis. [PR #4](https://github.com/HarryJhin/folio/pull/4)

- **Automatic sign-in and Pocket ID sessions** — Operators can start the configured SSO provider on first visit and use `/login?local` for local recovery. With the optional Pocket ID policy, 14 idle days expire the browser session and 30 days require a fresh passkey. Only foreground use extends the idle deadline. After expiry a focused tab starts sign-in once and can return to the document. Migration 066 stores the deadlines. [3ea4132](https://github.com/HarryJhin/folio/commit/3ea4132a81922cc09a4fd41f2a0cf37d25ea7f59) · [PR #3](https://github.com/HarryJhin/folio/pull/3)

### Builds

- **Builds and releases** — PR #1 added native ARM64 image publishing for the fork. PR #2 removed that publisher. Pushes to `custom` and pull requests run read-only CI for type checking, the SSO screen test and the production build. The release publisher runs only in the upstream repository. [PR #1](https://github.com/HarryJhin/folio/pull/1) · [PR #2](https://github.com/HarryJhin/folio/pull/2)

### Spaces and documents

- **Space entry and home** — Spaces open in the graph by default. An admin can select Space home in Space settings. `/s/<slug>/home` goes directly to the index document or folder listing. A newly created space opens its own first view even when the switcher order is fixed. Migration `065_space_first_view.sql` stores the preference. [356e6bf](https://github.com/HarryJhin/folio/commit/356e6bfacda645de447c7f64214b418088f59ef4) · [632b5a4](https://github.com/HarryJhin/folio/commit/632b5a48c09e81632dcb52fe44f26be6c582fa39)

- **Offline Markdown reader** — Install Folio in a supported browser and choose **Save for offline reading** on a trusted device. Reopen the app or the document link offline to read a saved copy. The library is tied to one account, loads the selected body on demand and rechecks access when the server returns. The installed title bar follows the selected theme offline as well. Upstream now ships this reader: [upstream PR #27](https://github.com/evergreen-it-dev/folio/pull/27) · [Folio 0.4.6](https://github.com/evergreen-it-dev/folio/commit/22ae828c18ccf17bc6f969c9e35caaad36d84d90)

- **Concurrent edits, page history and trash** — REST and MCP reject stale conditional saves. Page history follows a rename within its mounted root, including artifact previews at earlier revisions. A restore keeps the file’s compound type and handles identity when a name is already taken. Editor DOM regression tests now run with the production router. [8f09327](https://github.com/HarryJhin/folio/commit/8f093275c50edf500984b27f8bb3738670a15818) · [e89c36f](https://github.com/HarryJhin/folio/commit/e89c36ffe74d2fb1060c77f342b7e6500e800b33) · [1531f04](https://github.com/HarryJhin/folio/commit/1531f04516d7c3c5a68c3f1faf1cbbc477864946) · [1dc7e7b](https://github.com/HarryJhin/folio/commit/1dc7e7b02b8a71f6001980da6f561e944fb8b46d)

- **Table rows and exports** — Duplicating a row assigns a new ID, and reading old tables repairs duplicate IDs. With a filter applied, insertion follows the selected source row. Current-view export respects hidden columns and saved column settings. The toolbar’s YAML export retains saved views for reimport. [b9051c7](https://github.com/HarryJhin/folio/commit/b9051c7c68c7be4aeffd56596e113584e0220247) · [f210b8b](https://github.com/HarryJhin/folio/commit/f210b8ba23f88ddea53b6a714631f20bcdb421b7)

### Agent and identity integrations

- **MCP and OAuth clients** — Clients can connect with `initialize` (2025-11-25) or `server/discover` (2026-07-28). The HTTP endpoint checks browser origins, challenges insufficient OAuth scope and returns protocol errors for invalid JSON or a missing prompt. PKCE code exchange accepts an omitted redirect URI and dynamic registration returns the registered client URI. [dffd67a](https://github.com/HarryJhin/folio/commit/dffd67ab29e24efd1b1c9655639b3b42176b66c7) · [8d1b697](https://github.com/HarryJhin/folio/commit/8d1b697d54117d5538f81205d5cdbf4c2678c120) · [34beeac](https://github.com/HarryJhin/folio/commit/34beeac385661ff77ee12c244506bbe45463b9e3)

- **Identity providers and provisioning** — OIDC sign-in always requests `openid`, deduplicates scopes and selects the token endpoint authentication method from provider metadata and the configured secret. SAML validates the bearer recipient against the receiving endpoint. SCIM user and group responses honor requested attributes, including sub-attributes. [c31d8e5](https://github.com/HarryJhin/folio/commit/c31d8e5e7477f07b34d2faa40f62f9c0c1d3852d) · [e7b4148](https://github.com/HarryJhin/folio/commit/e7b414824f94e77d20bd55a55a93c73a352d5fb5)

- **Cross-space link reporting** — Ordinary Markdown links resolve through the catalog before navigation. MCP reports unresolved links according to the viewer’s access and reports the correct child folder for Form and Base links. [632b5a4](https://github.com/HarryJhin/folio/commit/632b5a48c09e81632dcb52fe44f26be6c582fa39) · [8f09327](https://github.com/HarryJhin/folio/commit/8f093275c50edf500984b27f8bb3738670a15818)

## 2026-11-24

- **Primary and reference spaces** — Operators choose the order of primary spaces in the switcher, home redirect and MCP. `list_spaces` accepts `includeAll` for reference spaces. Global search prefers a readable topic copy of the same file and can group duplicates. Searching one named space stays scoped to it. [b607f43](https://github.com/HarryJhin/folio/commit/b607f432d5106f5fe8d961316f22cb7893d45c48) · [5b32e8b](https://github.com/HarryJhin/folio/commit/5b32e8b1af9470c986ae207435b62d66715b384f)

- **Links in imported collections** — Repository-root note links work across visible folder-backed spaces on the same branch. For imported collections, an exact per-file catalog can also route wiki links and local Markdown links to a readable document on another branch of the same repository. [e30a439](https://github.com/HarryJhin/folio/commit/e30a439bf7f8270ca01b85c80aca1839e79195e6) · [b607f43](https://github.com/HarryJhin/folio/commit/b607f432d5106f5fe8d961316f22cb7893d45c48) · [c7c07a9](https://github.com/HarryJhin/folio/commit/c7c07a9e46aa30638d65fee463d76f1c7a0554e4)

- **Built-in Ask AI** — Set `FOLIO_DISABLE_ASSISTANT=1` to remove built-in chat entry points for members and public-site readers and disable the corresponding server routes. External MCP clients can still use Folio. [accae97](https://github.com/HarryJhin/folio/commit/accae978b043453f4c361ff004d46fb7a82a7f3c)
