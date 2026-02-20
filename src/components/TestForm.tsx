'use client';

import { useState, useEffect } from 'react';
import { TestStep, BrowserConfig, TargetConfig, ConfigItem, TestCaseFile } from '@/types';
import BuilderForm from './BuilderForm';
import ConfigurationsSection from './ConfigurationsSection';
import { useI18n } from '@/i18n';
import { useAuth } from '@/app/auth-provider';

interface TestData {
    url: string;
    prompt: string;
    name?: string;
    displayId?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}

interface TestFormProps {
    onSubmit: (data: TestData) => void;
    isLoading: boolean;
    initialData?: TestData;
    showNameInput?: boolean;
    readOnly?: boolean;
    onExport?: (data: TestData) => void;
    onImport?: () => void;
    testCaseId?: string;
    onSaveDraft?: (data: TestData) => Promise<void>;
    onDiscard?: () => void;
    isSaving?: boolean;
    displayId?: string;
    onDisplayIdChange?: (id: string) => void;
    projectId?: string;
    projectConfigs?: ConfigItem[];
    testCaseConfigs?: ConfigItem[];
    testCaseFiles?: TestCaseFile[];
    onTestCaseConfigsChange?: (id?: string) => void;
    onEnsureTestCase?: (data: TestData) => Promise<string | null>;
}

interface BrowserEntry {
    id: string;
    config: BrowserConfig | TargetConfig;
}

type TestFormTab = 'configurations' | 'test-steps';

const SAMPLE_URL_CONFIG_NAME = 'SAUCEDEMO_URL';
const SAMPLE_URL_CONFIG_VALUE = 'https://www.saucedemo.com';
const SAMPLE_USERNAME_CONFIG_NAME = 'USERNAME';
const SAMPLE_USERNAME_CONFIG_VALUE = 'standard_user';
const SAMPLE_USERNAME_VARIABLE_REF = `{{${SAMPLE_USERNAME_CONFIG_NAME}}}`;
const SAMPLE_PASSWORD_CONFIG_NAME = 'PASSWORD';
const SAMPLE_PASSWORD_CONFIG_VALUE = 'secret_sauce';
const SAMPLE_PASSWORD_VARIABLE_REF = `{{${SAMPLE_PASSWORD_CONFIG_NAME}}}`;

const SAMPLE_CONFIGS_TO_ENSURE = [
    { name: SAMPLE_URL_CONFIG_NAME, type: 'URL', value: SAMPLE_URL_CONFIG_VALUE },
    { name: SAMPLE_USERNAME_CONFIG_NAME, type: 'VARIABLE', value: SAMPLE_USERNAME_CONFIG_VALUE },
    { name: SAMPLE_PASSWORD_CONFIG_NAME, type: 'SECRET', value: SAMPLE_PASSWORD_CONFIG_VALUE },
] as const;

function createStepId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildBrowsers(data?: TestData): BrowserEntry[] {
    if (data?.browserConfig && Object.keys(data.browserConfig).length > 0) {
        return Object.entries(data.browserConfig).map(([id, cfg]) => {
            if ('type' in cfg && cfg.type === 'android') {
                return { id, config: cfg };
            }
            const browserCfg = cfg as BrowserConfig;
            return { id, config: { name: browserCfg.name || '', url: browserCfg.url || '' } };
        });
    }

    return [{
        id: 'browser_a',
        config: {
            url: data?.url || '',
        }
    }];
}

function buildSteps(data: TestData | undefined, browserId: string, validBrowserIds: Set<string>): TestStep[] {
    if (data?.steps && data.steps.length > 0) {
        return data.steps.map((step) => ({
            ...step,
            target: validBrowserIds.has(step.target) ? step.target : browserId,
            type: step.type || 'ai-action'
        }));
    }

    if (!data?.prompt) {
        return [];
    }

    return data.prompt
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((action, index) => ({
            id: createStepId(`prompt-${index}`),
            target: browserId,
            action,
            type: 'ai-action' as const
        }));
}

export default function TestForm({ onSubmit, isLoading, initialData, showNameInput, readOnly, onExport, onImport, testCaseId, onSaveDraft, onDiscard, isSaving, displayId, onDisplayIdChange, projectId, projectConfigs, testCaseConfigs, testCaseFiles, onTestCaseConfigsChange, onEnsureTestCase }: TestFormProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [activeTab, setActiveTab] = useState<TestFormTab>('configurations');
    const [name, setName] = useState(() => initialData?.name || '');
    const [browsers, setBrowsers] = useState<BrowserEntry[]>(() => buildBrowsers(initialData));
    const [steps, setSteps] = useState<TestStep[]>(() => {
        const initialBrowsers = buildBrowsers(initialData);
        const defaultBrowserId = initialBrowsers[0]?.id || 'browser_a';
        return buildSteps(initialData, defaultBrowserId, new Set(initialBrowsers.map((browser) => browser.id)));
    });

    useEffect(() => {
        if (!initialData) return;

        const nextBrowsers = buildBrowsers(initialData);
        const defaultBrowserId = nextBrowsers[0]?.id || 'browser_a';
        const validBrowserIds = new Set(nextBrowsers.map((browser) => browser.id));

        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setName(initialData.name || '');
            setBrowsers(nextBrowsers);
            setSteps(buildSteps(initialData, defaultBrowserId, validBrowserIds));
        });

        return () => {
            cancelled = true;
        };
    }, [initialData]);

    useEffect(() => {
        if (steps.length !== 0) return;

        queueMicrotask(() => {
            setSteps((current) => {
                if (current.length !== 0) return current;
                return [{
                    id: createStepId('step'),
                    target: browsers[0]?.id || 'browser_a',
                    action: '',
                    type: 'ai-action'
                }];
            });
        });
    }, [steps.length, browsers]);

    const ensureSampleConfigs = async (targetTestCaseId?: string) => {
        try {
            const existingNames = new Set(
                (targetTestCaseId ? (testCaseConfigs || []) : [...(projectConfigs || []), ...(testCaseConfigs || [])])
                    .map((cfg) => cfg.name)
            );
            const configsToCreate = SAMPLE_CONFIGS_TO_ENSURE.filter((cfg) => !existingNames.has(cfg.name));
            if (configsToCreate.length === 0) return;

            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            };
            if (targetTestCaseId) {
                let hasCreatedTestCaseConfig = false;
                for (const cfg of configsToCreate) {
                    const response = await fetch(`/api/test-cases/${targetTestCaseId}/configs`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(cfg)
                    });

                    if (response.ok || response.status === 409) {
                        hasCreatedTestCaseConfig = true;
                    }
                }

                if (hasCreatedTestCaseConfig) {
                    onTestCaseConfigsChange?.(targetTestCaseId);
                }
                return;
            }

            if (projectId) {
                for (const cfg of configsToCreate) {
                    const response = await fetch(`/api/projects/${projectId}/configs`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(cfg)
                    });

                    if (!response.ok && response.status !== 409) {
                        console.error(`Failed to create sample config on project: ${cfg.name}`);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to ensure sample configs', error);
        }
    };

    const handleLoadSampleData = async () => {
        const sampleName = t('sample.multi.name');
        const sampleDisplayId = t('sample.multi.testCaseId');
        const placeholderVars = { username: SAMPLE_USERNAME_VARIABLE_REF, password: SAMPLE_PASSWORD_VARIABLE_REF };
        const sampleBrowsers: BrowserEntry[] = [
            {
                id: 'browser_a',
                config: {
                    name: t('sample.multi.browserAName'),
                    url: SAMPLE_URL_CONFIG_VALUE,
                }
            },
            {
                id: 'browser_b',
                config: {
                    name: t('sample.multi.browserBName'),
                    url: SAMPLE_URL_CONFIG_VALUE,
                }
            }
        ];
        const sampleSteps: TestStep[] = [
            { id: createStepId('sample'), target: 'browser_a', action: t('sample.multi.step1', placeholderVars), type: 'ai-action' },
            { id: createStepId('sample'), target: 'browser_b', action: t('sample.multi.step2', placeholderVars), type: 'ai-action' },
            { id: createStepId('sample'), target: 'browser_a', action: t('sample.multi.step3'), type: 'ai-action' },
            { id: createStepId('sample'), target: 'browser_b', action: t('sample.multi.step4'), type: 'ai-action' },
            { id: createStepId('sample'), target: 'browser_a', action: t('sample.multi.step5'), type: 'ai-action' },
            { id: createStepId('sample'), target: 'browser_a', action: t('sample.multi.step6'), type: 'ai-action' },
            { id: createStepId('sample'), target: 'browser_a', action: t('sample.multi.step7'), type: 'ai-action' },
            { id: createStepId('sample'), target: 'browser_b', action: t('sample.multi.step8'), type: 'ai-action' },
            { id: createStepId('sample'), target: 'browser_b', action: t('sample.multi.step9'), type: 'ai-action' },
            { id: createStepId('sample'), target: 'browser_b', action: t('sample.multi.step10'), type: 'ai-action' }
        ];

        const sampleBrowserConfig: Record<string, BrowserConfig | TargetConfig> = {};
        sampleBrowsers.forEach((browser) => {
            sampleBrowserConfig[browser.id] = browser.config;
        });

        const sampleData: TestData = {
            name: showNameInput ? sampleName : undefined,
            displayId: sampleDisplayId || undefined,
            url: SAMPLE_URL_CONFIG_VALUE,
            prompt: '',
            steps: sampleSteps,
            browserConfig: sampleBrowserConfig,
        };

        let targetTestCaseId = testCaseId;
        if (!targetTestCaseId && onEnsureTestCase) {
            const ensured = await onEnsureTestCase(sampleData);
            targetTestCaseId = ensured || undefined;
        }

        await ensureSampleConfigs(targetTestCaseId);

        setName(sampleName);
        setBrowsers(sampleBrowsers);
        setSteps(sampleSteps);
        if (sampleDisplayId) {
            onDisplayIdChange?.(sampleDisplayId);
        }
        setActiveTab('test-steps');
    };

    const buildCurrentData = (): TestData => {
        const browserConfigMap: Record<string, BrowserConfig | TargetConfig> = {};
        browsers.forEach((browser) => {
            browserConfigMap[browser.id] = browser.config;
        });

        const firstConfig = browsers[0]?.config;
        const firstUrl = firstConfig && !('type' in firstConfig && firstConfig.type === 'android')
            ? (firstConfig as BrowserConfig).url || ''
            : '';

        return {
            name: showNameInput ? name : undefined,
            displayId: displayId || undefined,
            url: firstUrl,
            prompt: '',
            steps,
            browserConfig: browserConfigMap
        };
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(buildCurrentData());
    };

    return (
        <form onSubmit={handleSubmit} className="glass-panel h-[800px] flex flex-col">
            <div className="p-6 pb-0 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-foreground">{t('testForm.title')}</h2>
                    {(onExport || onImport) && (
                        <div className="flex items-center gap-2">
                            {onImport && (
                                <button
                                    type="button"
                                    onClick={onImport}
                                    className="px-3 py-1.5 bg-white text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1.5 text-sm"
                                    title={t('testForm.importTitle')}
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                    {t('testForm.import')}
                                </button>
                            )}
                            {onExport && (
                                <button
                                    type="button"
                                    onClick={() => onExport(buildCurrentData())}
                                    className="px-3 py-1.5 bg-white text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1.5 text-sm"
                                    title={t('testForm.exportTitle')}
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    {t('testForm.export')}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <div className="mt-4">
                    <div className="flex items-end justify-between gap-4">
                        <nav className="flex gap-6 -mb-px">
                            <button
                                type="button"
                                onClick={() => setActiveTab('configurations')}
                                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'configurations'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                {t('testForm.tab.configurations')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('test-steps')}
                                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'test-steps'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                {t('testForm.tab.testSteps')}
                            </button>
                        </nav>

                        {!readOnly && (
                            <button
                                type="button"
                                onClick={handleLoadSampleData}
                                className="mb-2 text-xs flex items-center gap-1.5 text-primary hover:text-primary/80 font-medium px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors whitespace-nowrap"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                {t('testForm.sampleData')}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                {activeTab === 'configurations' ? (
                    <div className="space-y-8">
                        {showNameInput && (
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-foreground">
                                    {t('testForm.testCaseName')} <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    className="input-field"
                                    placeholder={t('testForm.testCaseName.placeholder')}
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    disabled={readOnly}
                                />
                            </div>
                        )}

                        {showNameInput && onDisplayIdChange && (
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-foreground">
                                    {t('testForm.testCaseId')}
                                </label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder={t('testForm.testCaseId.placeholder')}
                                    value={displayId || ''}
                                    onChange={(e) => onDisplayIdChange(e.target.value)}
                                    disabled={readOnly}
                                />
                            </div>
                        )}

                        <ConfigurationsSection
                            projectId={projectId}
                            projectConfigs={projectConfigs || []}
                            testCaseConfigs={testCaseConfigs || []}
                            testCaseId={testCaseId}
                            onTestCaseConfigsChange={(updatedTestCaseId) => onTestCaseConfigsChange?.(updatedTestCaseId || testCaseId)}
                            onEnsureTestCaseId={onEnsureTestCase ? () => onEnsureTestCase(buildCurrentData()) : undefined}
                            readOnly={readOnly}
                            browsers={browsers}
                            setBrowsers={setBrowsers}
                        />
                    </div>
                ) : (
                    <BuilderForm
                        browsers={browsers}
                        steps={steps}
                        setSteps={setSteps}
                        readOnly={readOnly}
                        projectConfigs={projectConfigs}
                        testCaseConfigs={testCaseConfigs}
                        testCaseFiles={testCaseFiles}
                    />
                )}
            </div>

            {!readOnly && (
                <div className="p-6 pt-4 border-t border-gray-200 bg-white rounded-b-xl space-y-3">
                    {(onDiscard || onSaveDraft) && (
                        <div className="flex gap-3">
                            {onDiscard && (
                                <button
                                    type="button"
                                    onClick={onDiscard}
                                    className="flex-1 px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                                >
                                    {t('testForm.discard')}
                                </button>
                            )}
                            {onSaveDraft && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const data = buildCurrentData();
                                        onSaveDraft(data);
                                    }}
                                    disabled={isSaving || !name.trim()}
                                    className="flex-1 px-4 py-2.5 bg-primary/20 text-primary rounded-lg hover:bg-primary/30 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                                >
                                    {isSaving ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            <span>{t('testForm.saving')}</span>
                                        </>
                                    ) : (
                                        <span>{t('testForm.saveDraft')}</span>
                                    )}
                                </button>
                            )}
                        </div>
                    )}
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="btn-primary w-full flex justify-center items-center gap-2 h-11 text-base shadow-lg hover:shadow-xl transition-all"
                    >
                        {isLoading ? (
                            <>
                                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>{t('testForm.running')}</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>{t('testForm.run')}</span>
                            </>
                        )}
                    </button>
                </div>
            )}
        </form>
    );
}

export type { TestData, TestFormProps };
