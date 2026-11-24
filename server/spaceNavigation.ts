/** Apply navigation preferences only after the caller has filtered the list for access. */
export function spaceNavigation<T extends { slug: string }>(visible: T[]): {
  spaces: T[]; primarySpaceCount?: number; navigationSpaceCount?: number; defaultSpace?: string;
} {
  const slugs = (value?: string) => (value ?? '').split(',').map(slug => slug.trim()).filter(Boolean);
  const primaryOrder = slugs(process.env.FOLIO_PRIMARY_SPACES);
  if (!primaryOrder.length) return { spaces: visible };
  const remaining = new Map(visible.map(space => [space.slug, space]));
  const takeVisible = (order: string[]) => {
    const selected: T[] = [];
    for (const slug of order) {
      const space = remaining.get(slug);
      if (space) {
        selected.push(space);
        remaining.delete(slug);
      }
    }
    return selected;
  };
  const primary = takeVisible(primaryOrder);
  const referenceOrder = slugs(process.env.FOLIO_REFERENCE_SPACES);
  const references = takeVisible(referenceOrder);
  return {
    defaultSpace: primary.find(space => space.slug === process.env.FOLIO_DEFAULT_SPACE)?.slug,
    spaces: [...primary, ...references, ...remaining.values()],
    primarySpaceCount: primary.length || undefined,
    navigationSpaceCount: referenceOrder.length ? primary.length + references.length : undefined,
  };
}
