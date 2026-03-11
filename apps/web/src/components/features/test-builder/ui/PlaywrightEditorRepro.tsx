'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import PlaywrightCodeEditor from './PlaywrightCodeEditor';

type ReproMode = 'ai-action' | 'playwright-code';

export default function PlaywrightEditorRepro() {
    const { t } = useI18n();
    const [mode, setMode] = useState<ReproMode>('ai-action');
    const [aiAction, setAiAction] = useState('');
    const [codeAction, setCodeAction] = useState('');
    const [validationErrors, setValidationErrors] = useState<string[]>([]);

    const currentAction = useMemo(() => {
        return mode === 'ai-action' ? aiAction : codeAction;
    }, [aiAction, codeAction, mode]);

    return (
        <main className="mx-auto max-w-4xl p-6 space-y-4">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setMode('ai-action')}
                    className={`px-3 py-1.5 rounded-md text-sm border ${mode === 'ai-action'
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                        : 'bg-white border-gray-200 text-gray-600'
                        }`}
                >
                    {t('builderForm.stepType.ai')}
                </button>
                <button
                    type="button"
                    onClick={() => setMode('playwright-code')}
                    className={`px-3 py-1.5 rounded-md text-sm border ${mode === 'playwright-code'
                        ? 'bg-orange-50 border-orange-300 text-orange-700'
                        : 'bg-white border-gray-200 text-gray-600'
                        }`}
                >
                    {t('builderForm.stepType.code')}
                </button>
            </div>

            {mode === 'ai-action' ? (
                <textarea
                    value={currentAction}
                    onChange={(event) => setAiAction(event.target.value)}
                    placeholder={t('step.ai.placeholder')}
                    className="w-full text-sm border border-gray-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 min-h-[140px] py-3 px-3 resize-none bg-gray-50 focus:bg-white transition-colors"
                    rows={6}
                />
            ) : (
                <PlaywrightCodeEditor
                    value={currentAction}
                    onChange={(value) => setCodeAction(value)}
                    onValidationChange={(_, errors) => setValidationErrors(errors)}
                    height="280px"
                />
            )}

            {validationErrors.length > 0 && (
                <div className="text-xs text-red-500">{validationErrors[0]}</div>
            )}
        </main>
    );
}
