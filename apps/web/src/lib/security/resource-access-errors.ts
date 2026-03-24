import { prisma } from '@/lib/core/prisma';

interface ScopedResourceError {
    message: string;
    status: 403 | 404;
}

async function resolveForbiddenOrNotFound(
    exists: Promise<{ id: string } | null>,
    notFoundMessage: string
): Promise<ScopedResourceError> {
    const resource = await exists;
    if (resource) {
        return { message: 'Forbidden', status: 403 };
    }

    return { message: notFoundMessage, status: 404 };
}

export async function resolveProjectForbiddenOrNotFound(projectId: string): Promise<ScopedResourceError> {
    return resolveForbiddenOrNotFound(
        prisma.project.findUnique({
            where: { id: projectId },
            select: { id: true },
        }),
        'Project not found'
    );
}

export async function resolveTestCaseForbiddenOrNotFound(testCaseId: string): Promise<ScopedResourceError> {
    return resolveForbiddenOrNotFound(
        prisma.testCase.findUnique({
            where: { id: testCaseId },
            select: { id: true },
        }),
        'Not found'
    );
}
