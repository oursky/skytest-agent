'use client';

import Editor, { OnMount } from '@monaco-editor/react';
import { useCallback, useRef } from 'react';

interface PlaywrightCodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    readOnly?: boolean;
    onValidationChange?: (isValid: boolean, errors: string[]) => void;
    height?: string;
}

export default function PlaywrightCodeEditor({
    value,
    onChange,
    readOnly,
    onValidationChange,
    height = '180px'
}: PlaywrightCodeEditorProps) {
    const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

    const handleEditorDidMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;

        monaco.languages.typescript.javascriptDefaults.addExtraLib(
            `
            declare const page: {
                // Navigation
                goto(url: string, options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<any>;
                reload(options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<any>;
                goBack(options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<any>;
                goForward(options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<any>;

                // Actions
                click(selector: string, options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number }): Promise<void>;
                dblclick(selector: string, options?: any): Promise<void>;
                fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
                type(selector: string, text: string, options?: { delay?: number; timeout?: number }): Promise<void>;
                press(selector: string, key: string, options?: any): Promise<void>;
                check(selector: string, options?: any): Promise<void>;
                uncheck(selector: string, options?: any): Promise<void>;
                selectOption(selector: string, values: string | string[], options?: any): Promise<string[]>;
                hover(selector: string, options?: any): Promise<void>;
                focus(selector: string, options?: any): Promise<void>;

                // Waiting
                waitForSelector(selector: string, options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<any>;
                waitForTimeout(timeout: number): Promise<void>;
                waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }): Promise<void>;
                waitForURL(url: string | RegExp, options?: { timeout?: number }): Promise<void>;
                waitForFunction(fn: string | Function, arg?: any, options?: { timeout?: number }): Promise<any>;

                // Locators
                locator(selector: string): any;
                getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): any;
                getByText(text: string | RegExp, options?: { exact?: boolean }): any;
                getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): any;
                getByLabel(text: string | RegExp, options?: { exact?: boolean }): any;
                getByTestId(testId: string | RegExp): any;
                getByAltText(text: string | RegExp, options?: { exact?: boolean }): any;
                getByTitle(text: string | RegExp, options?: { exact?: boolean }): any;

                // Evaluation
                evaluate<T>(fn: string | Function, arg?: any): Promise<T>;
                evaluateHandle(fn: string | Function, arg?: any): Promise<any>;

                // Screenshots
                screenshot(options?: { path?: string; fullPage?: boolean; type?: 'png' | 'jpeg'; quality?: number }): Promise<Buffer>;

                // Content
                content(): Promise<string>;
                title(): Promise<string>;
                url(): string;

                // Frame
                mainFrame(): any;
                frames(): any[];
                frame(name: string): any;

                // Keyboard & Mouse
                keyboard: {
                    press(key: string, options?: { delay?: number }): Promise<void>;
                    type(text: string, options?: { delay?: number }): Promise<void>;
                    down(key: string): Promise<void>;
                    up(key: string): Promise<void>;
                    insertText(text: string): Promise<void>;
                };
                mouse: {
                    click(x: number, y: number, options?: any): Promise<void>;
                    dblclick(x: number, y: number, options?: any): Promise<void>;
                    move(x: number, y: number, options?: any): Promise<void>;
                    down(options?: any): Promise<void>;
                    up(options?: any): Promise<void>;
                    wheel(deltaX: number, deltaY: number): Promise<void>;
                };

                // Misc
                isClosed(): boolean;
                bringToFront(): Promise<void>;
                close(options?: { runBeforeUnload?: boolean }): Promise<void>;
                setViewportSize(size: { width: number; height: number }): Promise<void>;
                viewportSize(): { width: number; height: number } | null;
            };
            `,
            'ts:playwright.d.ts'
        );

        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ESNext,
            allowNonTsExtensions: true,
            moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
            module: monaco.languages.typescript.ModuleKind.ESNext,
            noEmit: true,
            lib: ['esnext'],
        });

        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: true,
            noSyntaxValidation: false,
        });
    };

    const handleEditorChange = useCallback((newValue: string | undefined) => {
        const code = newValue || '';
        onChange(code);

        if (onValidationChange) {
            try {
                const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
                new AsyncFunction('page', code);
                onValidationChange(true, []);
            } catch (e) {
                const error = e instanceof Error ? e.message : 'Syntax error';
                onValidationChange(false, [error]);
            }
        }
    }, [onChange, onValidationChange]);

    return (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
            <Editor
                height={height}
                defaultLanguage="javascript"
                value={value}
                onChange={handleEditorChange}
                onMount={handleEditorDidMount}
                theme="vs"
                options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    readOnly: readOnly,
                    wordWrap: 'off',
                    padding: { top: 8, bottom: 8 },
                    scrollbar: {
                        vertical: 'auto',
                        horizontal: 'auto',
                        verticalScrollbarSize: 8,
                        horizontalScrollbarSize: 8,
                    },
                }}
                loading={
                    <div className="h-full flex items-center justify-center bg-gray-50 text-gray-400 text-sm">
                        Loading editor...
                    </div>
                }
            />
        </div>
    );
}
