import type { RunPageTestData } from './import-export-helpers';

export async function ensureTestCaseFromDataHelper(input: {
    data: RunPageTestData;
    suppressAlert: boolean;
    testCaseId: string | null;
    currentTestCaseId: string | null;
    projectId: string | null;
    projectIdFromTestCase: string | null;
    displayId: string;
    getAccessToken: () => Promise<string | undefined | null>;
    t: (key: string) => string;
    setCurrentTestCaseId: (testCaseId: string) => void;
    setInitialData: (data: RunPageTestData) => void;
    setRefreshFilesTestCaseId: (testCaseId: string) => void;
}): Promise<string> {
    const {
        data,
        suppressAlert,
        testCaseId,
        currentTestCaseId,
        projectId,
        projectIdFromTestCase,
        displayId,
        getAccessToken,
        t,
        setCurrentTestCaseId,
        setInitialData,
        setRefreshFilesTestCaseId,
    } = input;

    if (testCaseId) return testCaseId;
    if (currentTestCaseId) return currentTestCaseId;

    const effectiveProjectId = projectId || projectIdFromTestCase;
    if (!effectiveProjectId) {
        if (!suppressAlert) {
            alert(t('run.error.selectProjectUpload'));
        }
        throw new Error(t('run.error.noProjectSelected'));
    }

    const normalizedDisplayId = (data.displayId ?? displayId ?? '').trim();
    if (!normalizedDisplayId) {
        if (!suppressAlert) {
            alert(t('run.error.testCaseIdRequired'));
        }
        throw new Error(t('run.error.testCaseIdRequired'));
    }

    try {
        const token = await getAccessToken();
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };

        const usedPlaceholderName = !data.name || data.name.trim() === '';
        const untitledName = t('testCase.untitled');
        const payload: RunPageTestData = {
            ...data,
            name: !usedPlaceholderName ? data.name : untitledName,
            displayId: normalizedDisplayId,
        };

        if (!payload.url || payload.url.trim() === '') {
            payload.url = 'about:blank';
        }

        const payloadHasSteps = Array.isArray(payload.steps) && payload.steps.length > 0;
        if (!payload.prompt && !payloadHasSteps) {
            payload.prompt = 'Draft';
        }

        const response = await fetch(`/api/projects/${effectiveProjectId}/test-cases`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to create test case');
        }

        const newTestCase = await response.json() as { id: string };
        setCurrentTestCaseId(newTestCase.id);
        setRefreshFilesTestCaseId(newTestCase.id);
        window.history.replaceState(null, "", `?testCaseId=${newTestCase.id}&projectId=${effectiveProjectId}`);

        if (usedPlaceholderName) {
            setInitialData({ ...data, name: untitledName });
        }

        return newTestCase.id;
    } catch (error) {
        console.error('Failed to create test case for upload', error);
        if (!suppressAlert) {
            alert(t('run.error.failedCreateTestCaseUpload'));
        }
        throw error;
    }
}
