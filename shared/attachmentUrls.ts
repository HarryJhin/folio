/** The reading context for same-origin attachment links. Only scoped anonymous routes carry a share credential. */
export interface AttachmentContext {
  space: string;
  pageId?: string;
  shareToken?: string;
  publicSite?: { space: string; instanceUrl?: string };
  origin?: string;
}

export function attachmentUrl(href: string, ctx: AttachmentContext): string {
  if (!/^\/(?:a|files)\//.test(href) && !/^https?:\/\//i.test(href)) return href;
  const rootRelative = href.startsWith('/');
  // A placeholder is enough to normalize root-relative paths outside the browser (exports, SSR).
  const base = ctx.origin || ctx.publicSite?.instanceUrl || 'https://folio.invalid';
  let url: URL;
  try {
    url = new URL(href, base);
    if (url.username || url.password || (!rootRelative && ![ctx.origin, ctx.publicSite?.instanceUrl].some(
      (origin) => origin && new URL(origin).origin === url.origin,
    ))) return href;
  } catch { return href; }

  const { pathname } = url;
  const blob = /^\/a\/([a-f0-9]{64}\/[^/]+)$/.exec(pathname);
  if (blob && ctx.pageId) {
    const page = encodeURIComponent(ctx.pageId);
    if (ctx.shareToken) url.pathname = `/api/share/${encodeURIComponent(ctx.shareToken)}/pages/${page}/assets/${blob[1]}`;
    else if (ctx.publicSite) url.pathname = `/api/public/spaces/${encodeURIComponent(ctx.publicSite.space)}/pages/${page}/assets/${blob[1]}`;
    else url.searchParams.set('page', ctx.pageId);
  } else if (pathname.startsWith(`/files/${encodeURIComponent(ctx.space)}/`) && (ctx.shareToken || ctx.publicSite)) {
    url.searchParams.delete('share');
    url.searchParams.delete('publicSite');
    if (ctx.shareToken) url.searchParams.set('share', ctx.shareToken);
    else url.searchParams.set('publicSite', ctx.space);
  } else {
    return href;
  }
  return url.pathname + url.search.replace(/\+/g, '%20') + url.hash;
}
