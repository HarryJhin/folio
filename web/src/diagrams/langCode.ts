// Excalidraw ships regional locale IDs for Korean and Ukrainian.
export function mapToExcalidrawLangCode(language: string | null | undefined): string {
  switch (language?.slice(0, 2).toLowerCase()) {
    case 'ko': return 'ko-KR';
    case 'uk': return 'uk-UA';
    default: return 'en';
  }
}
