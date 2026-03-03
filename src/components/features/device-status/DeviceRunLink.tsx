import Link from 'next/link';

interface DeviceRunLinkProps {
    runTestCaseId: string;
    runId?: string;
    runTestCaseDisplayId: string | null | undefined;
    runTestCaseName: string | null | undefined;
    fallbackLabel: string;
}

export default function DeviceRunLink({
    runTestCaseId,
    runId,
    runTestCaseDisplayId,
    runTestCaseName,
    fallbackLabel,
}: DeviceRunLinkProps) {
    if (!runId) {
        return null;
    }

    return (
        <div className="mt-1.5 ml-0.5">
            <Link
                href={`/test-cases/${runTestCaseId}/history/${runId}`}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
            >
                -&gt; {runTestCaseDisplayId ?? fallbackLabel} &ldquo;{runTestCaseName}&rdquo;
            </Link>
        </div>
    );
}
