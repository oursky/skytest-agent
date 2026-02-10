'use client';

import { useRef } from 'react';
import { useI18n } from '@/i18n';
import type { ConfigItem } from '@/types';
import InsertVariableDropdown from './InsertVariableDropdown';

interface SimpleFormProps {
    url: string;
    setUrl: (value: string) => void;
    username: string;
    setUsername: (value: string) => void;
    password: string;
    setPassword: (value: string) => void;
    showPassword: boolean;
    setShowPassword: (value: boolean) => void;
    prompt: string;
    setPrompt: (value: string) => void;
    readOnly?: boolean;
    projectConfigs?: ConfigItem[];
    testCaseConfigs?: ConfigItem[];
}

export default function SimpleForm({
    url,
    setUrl,
    username,
    setUsername,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    prompt,
    setPrompt,
    readOnly,
    projectConfigs,
    testCaseConfigs,
}: SimpleFormProps) {
    const { t } = useI18n();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const hasConfigs = (projectConfigs && projectConfigs.length > 0) || (testCaseConfigs && testCaseConfigs.length > 0);

    const handleInsertVariable = (ref: string) => {
        const textarea = textareaRef.current;
        if (!textarea) {
            setPrompt(prompt + ref);
            return;
        }
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = prompt.substring(0, start) + ref + prompt.substring(end);
        setPrompt(newValue);
        requestAnimationFrame(() => {
            textarea.focus();
            const cursorPos = start + ref.length;
            textarea.setSelectionRange(cursorPos, cursorPos);
        });
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Target URL */}
            <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                    {t('simpleForm.targetUrl')}
                </label>
                <input
                    type="url"
                    required
                    className="input-field"
                    placeholder={t('simpleForm.urlPlaceholder')}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={readOnly}
                />
            </div>

            {/* Credentials */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                        {t('simpleForm.username')} <span className="text-gray-400 font-normal">{t('simpleForm.optional')}</span>
                    </label>
                    <input
                        type="text"
                        className="input-field"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        disabled={readOnly}
                    />
                </div>
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                        {t('simpleForm.password')} <span className="text-gray-400 font-normal">{t('simpleForm.optional')}</span>
                    </label>
                    <div className="relative">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            className={`input-field pr-10 ${!showPassword ? 'text-security-disc' : ''}`}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="off"
                            data-1p-ignore
                            disabled={readOnly}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            disabled={readOnly}
                        >
                            {showPassword ? t('common.hide') : t('common.show')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Instructions */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-foreground">
                        {t('simpleForm.instructions')}
                    </label>
                    {!readOnly && hasConfigs && (
                        <InsertVariableDropdown
                            projectConfigs={projectConfigs || []}
                            testCaseConfigs={testCaseConfigs || []}
                            onInsert={handleInsertVariable}
                        />
                    )}
                </div>
                <textarea
                    ref={textareaRef}
                    required
                    className="input-field min-h-[200px] resize-y"
                    placeholder={t('simpleForm.instructionsPlaceholder')}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={readOnly}
                />
            </div>
        </div>
    );
}

export type { SimpleFormProps };
