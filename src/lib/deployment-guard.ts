import { config } from '@/config/app';

const SINGLE_NODE_OVERRIDE_ENV = 'ALLOW_UNSAFE_SINGLE_NODE_PRODUCTION';

function isLikelySqlite(databaseUrl: string): boolean {
    return databaseUrl.startsWith('file:') || /sqlite/i.test(databaseUrl) || /\.db(?:$|\?)/i.test(databaseUrl);
}

function isLikelyLocalUploadDir(uploadDir: string): boolean {
    return !/^(s3|gs|https?):\/\//i.test(uploadDir);
}

function getDeploymentRisks(): string[] {
    const risks = [
        'In-memory queue and SSE event bus require a single app instance.',
    ];

    const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';
    if (isLikelySqlite(databaseUrl)) {
        risks.push('SQLite database is not suitable for horizontal scaling under concurrent write load.');
    }

    if (isLikelyLocalUploadDir(config.files.uploadDir)) {
        risks.push('Local upload directory requires sticky single-node storage and is not shared across instances.');
    }

    return risks;
}

export function assertProductionRunSafety() {
    if (process.env.NODE_ENV !== 'production') {
        return;
    }

    if (process.env[SINGLE_NODE_OVERRIDE_ENV] === 'true') {
        return;
    }

    const risks = getDeploymentRisks();
    if (risks.length === 0) {
        return;
    }

    throw new Error(
        `Production run submission is blocked due to single-node deployment risks: ${risks.join(' ')} ` +
        `If you intentionally accept these risks, set ${SINGLE_NODE_OVERRIDE_ENV}=true.`
    );
}
