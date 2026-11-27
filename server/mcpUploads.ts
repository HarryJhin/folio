import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { McpUploadTarget } from '../shared/contracts.js';
import { isDemoMode } from './demo.js';
import type { McpActor, checkPageRole, checkSpaceRole } from './mcp.js';
import { outputSchemas } from './mcpOutputSchemas.js';
import * as proposals from './proposals.js';
import { signUploadToken, uploadMaxBytes } from './mcpUploadToken.js';

export const REQUEST_UPLOAD_TOOL = 'request_upload';

const MAX_FILES_PER_CALL = 200;

export interface RequestUploadDeps {
  checkPageRole: typeof checkPageRole;
  checkSpaceRole: typeof checkSpaceRole;
  baseUrl: string;
}

const DESCRIPTION =
  'Issues one signed, short-lived upload URL per file, so that a file can be attached to a page without passing its bytes through the model. ' +
  'Send the bytes from a shell with PUT to each returned url, using the same API token as for this MCP connection and Content-Type: application/octet-stream, for example `curl --fail-with-body -X PUT -H @"$HEADER_FILE" -H "Content-Type: application/octet-stream" --data-binary @report.pdf "<url>"`. ' +
  'HEADER_FILE names a file that holds the line `Authorization: Bearer <token>`: create it with mode 600 and delete it after sending. ' +
  'Never put the token on the command line or into any output. ' +
  'Each url accepts exactly the name, size and sha256 declared here, until expiresAt; sending the same bytes again stores no second copy. ' +
  'Sending with a different token than the one that requested the url gets 403. ' +
  "Requires a write-scoped token and the editor role in the page's space and on the page.";

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function registerRequestUploadTool(server: McpServer, actor: McpActor, deps: RequestUploadDeps): void {
  server.registerTool(
    REQUEST_UPLOAD_TOOL,
    {
      title: 'Request upload URLs for a page',
      description: DESCRIPTION,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      outputSchema: outputSchemas.request_upload,
      inputSchema: {
        page: z.string().describe('Id of the page the files are attached to'),
        files: z
          .array(
            z.object({
              name: z.string().min(1).describe('File name, including its extension'),
              size: z.number().int().positive().describe('Exact size of the file in bytes'),
              sha256: z.string().regex(/^[0-9a-f]{64}$/).describe('SHA-256 of the file content as 64 lowercase hex characters'),
            }),
          )
          .min(1)
          .max(MAX_FILES_PER_CALL)
          .describe('The files to upload, one entry per file'),
      },
    },
    async ({ page, files }) => {
      if (isDemoMode()) return errorResult('uploads are not available in the demo');
      if (!actor.scopes.includes('write')) return errorResult('this action requires a token with write scope');
      const { entry, error } = await deps.checkPageRole(actor, page, 'editor');
      if (error || !entry) return errorResult(error ?? 'page not found');
      const spaceError = await deps.checkSpaceRole(actor, entry.space, 'editor');
      if (spaceError) return errorResult(spaceError);
      if ((await proposals.getAgentWriteMode(entry.space)) === 'review') return errorResult(proposals.reviewRefusal(`the tool ${REQUEST_UPLOAD_TOOL}`));

      const maxBytes = uploadMaxBytes();
      const tooLarge = files.find((file) => file.size > maxBytes);
      if (tooLarge) return errorResult(`file "${tooLarge.name}" is larger than the limit of ${maxBytes} bytes`);

      const uploads: McpUploadTarget[] = files.map((file) => {
        const { token, expiresAt } = signUploadToken({ uid: actor.user.id, tid: actor.tokenId, page: entry.id, name: file.name, size: file.size, sha256: file.sha256 });
        return { name: file.name, size: file.size, sha256: file.sha256, url: `${deps.baseUrl}/mcp/uploads/${token}`, expiresAt };
      });
      const result = { uploads };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },
  );
}
