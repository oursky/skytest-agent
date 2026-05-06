import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { apiError } from '@/lib/security/api-route-standards';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import {
    DEFAULT_SLACK_FAILURE_TEMPLATE,
    DEFAULT_SLACK_SUCCESS_TEMPLATE,
    renderTemplate,
} from '@/lib/integrations/slack/template';
import { TEST_STATUS } from '@/types';

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
                slackFailureTemplate: true,
                slackSuccessTemplate: true,
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
            status?: string | null;
        };
        const status = body.status === TEST_STATUS.PASS
            ? TEST_STATUS.PASS
            : TEST_STATUS.FAIL;
        const fallbackTemplate = status === TEST_STATUS.PASS
            ? DEFAULT_SLACK_SUCCESS_TEMPLATE
            : DEFAULT_SLACK_FAILURE_TEMPLATE;

        const template = normalizeTemplate(body.template)
            ?? (status === TEST_STATUS.PASS ? project.slackSuccessTemplate : project.slackFailureTemplate)
            ?? fallbackTemplate;

        const rendered = renderTemplate(template, {
            projectName: project.name,
            testCaseName: 'Checkout flow',
            runId: 'run_preview_001',
            triggeredBy: 'qa@example.com',
            startedAt: '2026-04-29T12:00:00Z',
            completedAt: '2026-04-29T12:00:42Z',
            durationSeconds: 42,
            errorSummary: status === TEST_STATUS.FAIL ? 'Element not found' : '-',
        }, {
            fallbackTemplate,
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
