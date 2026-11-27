export function configuredSpaceOrder() {
  const slugs = (value?: string) => (value ?? '').split(',').map(slug => slug.trim()).filter(Boolean);
  return { primary: slugs(process.env.FOLIO_PRIMARY_SPACES), references: slugs(process.env.FOLIO_REFERENCE_SPACES) };
}

/** Apply navigation preferences only after the caller has filtered the list for access. */
export function spaceNavigation<T extends { slug: string }>(visible: T[]): {
  spaces: T[]; defaultSpace?: string;
} {
  const { primary: primaryOrder, references: referenceOrder } = configuredSpaceOrder();
  if (!primaryOrder.length && !referenceOrder.length) return { spaces: visible };
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
  const references = takeVisible(referenceOrder);
  return {
    defaultSpace: primary.find(space => space.slug === process.env.FOLIO_DEFAULT_SPACE)?.slug,
    spaces: [...primary, ...references, ...remaining.values()],
  };
}
