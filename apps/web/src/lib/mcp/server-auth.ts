import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { isProjectMember } from '@/lib/security/permissions';

export type McpHandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export function getUserId(extra: McpHandlerExtra): string | null {
    return extra.authInfo?.clientId ?? null;
}

export async function verifyProjectAccess(projectId: string, userId: string): Promise<boolean> {
    return isProjectMember(userId, projectId);
}
