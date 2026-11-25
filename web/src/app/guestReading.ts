import { readHostSiteSlug } from './public/publicSite';

/** Public and share readers never need to resolve a private browser identity. */
export function isGuestReading(pathname = globalThis.location?.pathname ?? ''): boolean {
  if (/^\/(?:public|share)(?:\/|$)/.test(pathname)) return true;
  return (pathname === '/' || pathname.startsWith('/p/')) && typeof document !== 'undefined' && Boolean(readHostSiteSlug());
}
