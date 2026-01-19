'use client';

import { useState, useEffect } from 'react';
import { TestStep, BrowserConfig, TestCaseFile } from '@/types';
import { config } from '@/config/app';
import SimpleForm from './SimpleForm';
import BuilderForm from './BuilderForm';
import { useI18n } from '@/i18n';

interface TestData {
    url: string;
    username?: string;
    password?: string;
    prompt: string;
    name?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig>;
}

interface TestFormProps {
    onSubmit: (data: TestData) => void;
    isLoading: boolean;
    initialData?: TestData;
    showNameInput?: boolean;
    readOnly?: boolean;
    onExport?: () => void;
    onImport?: () => void;
    testCaseId?: string;
    files?: TestCaseFile[];
    onFilesChange?: (testCaseId?: string, uploadedFiles?: TestCaseFile[]) => void | Promise<void>;
    onEnsureTestCase?: (data: TestData) => Promise<string>;
    onSaveDraft?: (data: TestData) => Promise<void>;
    onDiscard?: () => void;
    isSaving?: boolean;
    displayId?: string;
    onDisplayIdChange?: (id: string) => void;
}

interface BrowserEntry {
    id: string;
    config: BrowserConfig;
}

export default function TestForm({ onSubmit, isLoading, initialData, showNameInput, readOnly, onExport, onImport, testCaseId, files, onFilesChange, onEnsureTestCase, onSaveDraft, onDiscard, isSaving, displayId, onDisplayIdChange }: TestFormProps) {
    const { t } = useI18n();

    const [name, setName] = useState(() => initialData?.name || '');
    const [prompt, setPrompt] = useState(() => initialData?.prompt || '');

    const [mode, setMode] = useState<'simple' | 'builder'>(() => {
        if (!initialData) return 'simple';
        const hasSteps = initialData.steps && initialData.steps.length > 0;
        const hasBrowserConfig = initialData.browserConfig && Object.keys(initialData.browserConfig).length > 0;
        return (hasSteps || hasBrowserConfig) ? 'builder' : 'simple';
    });

    const [simpleUrl, setSimpleUrl] = useState(() => initialData?.url || '');
    const [simpleUsername, setSimpleUsername] = useState(() => initialData?.username || '');
    const [simplePassword, setSimplePassword] = useState(() => initialData?.password || '');
    const [showSimplePassword, setShowSimplePassword] = useState(false);

    const [browsers, setBrowsers] = useState<BrowserEntry[]>(() => {
        if (initialData?.browserConfig) {
            return Object.entries(initialData.browserConfig).map(([id, config]) => ({
                id,
                config: {
                    url: config.url || '',
                    username: config.username || '',
                    password: config.password || ''
                }
            }));
        }
        return [{
            id: 'browser_a',
            config: {
                url: initialData?.url || '',
                username: initialData?.username || '',
                password: initialData?.password || ''
            }
        }];
    });

    const [steps, setSteps] = useState<TestStep[]>(() => initialData?.steps || []);
    const [showPasswordMap, setShowPasswordMap] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!initialData) return;

        queueMicrotask(() => {
            if (initialData.name) setName(initialData.name);
            if (initialData.prompt) setPrompt(initialData.prompt);

            const hasSteps = initialData.steps && initialData.steps.length > 0;
            const hasBrowserConfig = initialData.browserConfig && Object.keys(initialData.browserConfig).length > 0;

            if (hasSteps || hasBrowserConfig) {
                setMode('builder');
                if (initialData.browserConfig) {
                    setBrowsers(Object.entries(initialData.browserConfig).map(([id, config]) => ({
                        id,
                        config: {
                            url: config.url || '',
                            username: config.username || '',
                            password: config.password || ''
                        }
                    })));
                } else if (!initialData.browserConfig && hasSteps) {
                    const defaultConfig = {
                        url: initialData.url || '',
                        username: initialData.username || '',
                        password: initialData.password || ''
                    };
                    setBrowsers([{ id: 'browser_a', config: defaultConfig }]);
                }

                if (initialData.steps) setSteps(initialData.steps);
            } else {
                setMode('simple');
                if (initialData.url) setSimpleUrl(initialData.url);
                if (initialData.username) setSimpleUsername(initialData.username);
                if (initialData.password) setSimplePassword(initialData.password);
            }
        });
    }, [initialData]);

    useEffect(() => {
        if (mode !== 'builder' || steps.length !== 0) return;

        queueMicrotask(() => {
            setSteps((current) => {
                if (current.length !== 0) return current;
                const newStep: TestStep = {
                    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
                    target: browsers[0]?.id || 'browser_a',
                    action: '',
                    type: 'ai-action',
                };
                return [newStep];
            });
        });
    }, [mode, steps.length, browsers]);

    const handleLoadSampleData = () => {
        const usernamePlaceholder = config.test.security.credentialPlaceholders.username;
        const passwordPlaceholder = config.test.security.credentialPlaceholders.password;
        const placeholderVars = { username: usernamePlaceholder, password: passwordPlaceholder };

        if (mode === 'simple') {
            setName(t('sample.simple.name'));
            setSimpleUrl('https://www.saucedemo.com');
            setSimpleUsername('standard_user');
            setSimplePassword('secret_sauce');
            setPrompt(t('sample.simple.instructions', placeholderVars));
            onDisplayIdChange?.('TC-SAMPLE-001');
        } else {
            setName(t('sample.multi.name'));
            setBrowsers([
                { id: 'browser_a', config: { url: 'https://www.saucedemo.com', username: 'standard_user', password: 'secret_sauce' } },
                { id: 'browser_b', config: { url: 'https://www.saucedemo.com', username: 'visual_user', password: 'secret_sauce' } }
            ]);
            setSteps([
                { id: "1", target: "browser_a", action: t('sample.multi.step1', placeholderVars) },
                { id: "2", target: "browser_b", action: t('sample.multi.step2', placeholderVars) },
                { id: "3", target: "browser_a", action: t('sample.multi.step3') },
                { id: "4", target: "browser_b", action: t('sample.multi.step4') },
                { id: "5", target: "browser_a", action: t('sample.multi.step5') },
                { id: "6", target: "browser_b", action: t('sample.multi.step6') }
            ]);
            onDisplayIdChange?.('TC-SAMPLE-002');
        }
    };

    const buildCurrentData = (): TestData => {
        let data: TestData;
        if (mode === 'simple') {
            data = {
                name: showNameInput ? name : undefined,
                url: simpleUrl,
                prompt: prompt,
                username: simpleUsername || undefined,
                password: simplePassword || undefined,
                steps: undefined,
                browserConfig: undefined
            };
        } else {
            const browserConfigMap: Record<string, BrowserConfig> = {};
            browsers.forEach(b => {
                browserConfigMap[b.id] = b.config;
            });

            data = {
                name: showNameInput ? name : undefined,
                url: browsers[0]?.config.url || '',
                prompt: '',
                username: undefined,
                password: undefined,
                steps: steps,
                browserConfig: browserConfigMap
            };
        }
        return data;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const data = buildCurrentData();
        onSubmit(data);
    };

    return (
        <form onSubmit={handleSubmit} className="glass-panel h-[800px] flex flex-col">
            <div className={`p-6 ${!readOnly ? 'pb-4 border-b border-gray-200' : 'pb-6'}`}>
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
                                    onClick={onExport}
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
                {!readOnly && (
                    <div className="flex justify-between items-center mt-4">
                        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
                            <button
                                type="button"
                                onClick={() => setMode('simple')}
                                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${mode === 'simple'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900'
                                    }`}
                            >
                                {t('testForm.mode.simple')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('builder')}
                                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${mode === 'builder'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900'
                                    }`}
                            >
                                {t('testForm.mode.builder')}
                            </button>
                        </div>

                        <button
                            type="button"
                            onClick={handleLoadSampleData}
                            className="text-xs flex items-center gap-1.5 text-purple-600 hover:text-purple-700 font-medium px-3 py-1.5 rounded-lg hover:bg-purple-50 transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            {t('testForm.sampleData')}
                        </button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
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

                {mode === 'simple' ? (
                    <SimpleForm
                        url={simpleUrl}
                        setUrl={setSimpleUrl}
                        username={simpleUsername}
                        setUsername={setSimpleUsername}
                        password={simplePassword}
                        setPassword={setSimplePassword}
                        showPassword={showSimplePassword}
                        setShowPassword={setShowSimplePassword}
                        prompt={prompt}
                        setPrompt={setPrompt}
                        readOnly={readOnly}
                    />
                ) : (
                    <BuilderForm
                        browsers={browsers}
                        setBrowsers={setBrowsers}
                        steps={steps}
                        setSteps={setSteps}
                        showPasswordMap={showPasswordMap}
                        setShowPasswordMap={setShowPasswordMap}
                        readOnly={readOnly}
                        testCaseId={testCaseId}
                        files={files}
                        onFilesChange={onFilesChange}
                        onEnsureTestCase={onEnsureTestCase ? async () => onEnsureTestCase(buildCurrentData()) : undefined}
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
