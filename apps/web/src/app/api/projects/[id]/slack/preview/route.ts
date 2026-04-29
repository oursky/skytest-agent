import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { apiError } from '@/lib/security/api-route-standards';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import {
    DEFAULT_SLACK_FAILURE_TEMPLATE,
    renderTemplate,
} from '@/lib/integrations/slack/template';

function normalizeTemplate(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const project = await prisma.project.findUnique({
            where: { id: guard.params.id },
            select: {
                name: true,
                slackMessageTemplate: true,
            },
        });
        if (!project) {
            return apiError({
                status: 404,
                code: 'NOT_FOUND',
                error: 'Project not found',
            });
        }

        const body = await request.json().catch(() => ({})) as {
            template?: string | null;
        };

        const template = normalizeTemplate(body.template)
            ?? project.slackMessageTemplate
            ?? DEFAULT_SLACK_FAILURE_TEMPLATE;

        const rendered = renderTemplate(template, {
            projectName: project.name,
            testCaseName: 'Checkout flow',
            runId: 'run_preview_001',
            runUrl: 'https://example.local/run?runId=run_preview_001',
            triggeredBy: 'qa@example.com',
            startedAt: '2026-04-29T12:00:00Z',
            completedAt: '2026-04-29T12:00:42Z',
            durationSeconds: 42,
            errorSummary: 'Element not found',
        });

        return NextResponse.json(rendered);
    } catch {
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to render Slack template preview',
        });
    }
}
