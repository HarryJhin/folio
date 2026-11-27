import { describe, expect, it } from 'vitest';
import { redactRequestUrl } from './logRedaction.js';

describe('redactRequestUrl', () => {
  it('redacts the signed token of an MCP upload URL', () => {
    expect(redactRequestUrl('/mcp/uploads/abc.def')).toBe('/mcp/uploads/[redacted]');
  });
});
