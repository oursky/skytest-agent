'use client';

import { useState, useEffect } from 'react';

interface TestData {
    url: string;
    username?: string;
    password?: string;
    prompt: string;
    name?: string;
}

interface TestFormProps {
    onSubmit: (data: TestData) => void;
    isLoading: boolean;
    initialData?: TestData;
    showNameInput?: boolean;
}

export default function TestForm({ onSubmit, isLoading, initialData, showNameInput }: TestFormProps) {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('https://www.saucedemo.com/');
    const [username, setUsername] = useState('standard_user');
    const [password, setPassword] = useState('secret_sauce');
    const [prompt, setPrompt] = useState(`Login with the provided credentials.
Add the "Sauce Labs Backpack" to the cart.
Click on the cart icon.
Verify that "Sauce Labs Backpack" is in the cart.`);

    useEffect(() => {
        if (initialData) {
            if (initialData.name) setName(initialData.name);
            if (initialData.url) setUrl(initialData.url);
            if (initialData.username) setUsername(initialData.username);
            if (initialData.password) setPassword(initialData.password);
            if (initialData.prompt) setPrompt(initialData.prompt);
        }
    }, [initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({ name: showNameInput ? name : undefined, url, username, password, prompt });
    };

    return (
        <form onSubmit={handleSubmit} className="glass-panel h-[800px] p-6 space-y-6 flex flex-col">
            {/* Header */}
            <div className="pb-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-foreground">Test Configuration</h2>
                <p className="text-sm text-muted-foreground mt-1">Configure your automated test parameters</p>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto">
                {/* Test Case Name */}
                {showNameInput && (
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-foreground">
                            Test Case Name
                        </label>
                        <input
                            type="text"
                            required
                            className="input-field"
                            placeholder="e.g. Login and Add to Cart"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                )}

                {/* Target URL */}
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                        Target URL
                    </label>
                    <input
                        type="url"
                        required
                        className="input-field"
                        placeholder="https://app.example.com"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                    />
                </div>

                {/* Credentials */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-foreground">
                            Username
                        </label>
                        <input
                            type="text"
                            className="input-field"
                            placeholder="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-foreground">
                            Password
                        </label>
                        <input
                            type="password"
                            className="input-field"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                </div>

                {/* Test Scenario */}
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                        Test Instructions
                    </label>
                    <textarea
                        required
                        className="input-field min-h-[200px] resize-y"
                        placeholder="Enter step-by-step test instructions, for example:&#10;• Login with the provided credentials&#10;• Navigate to the products page&#10;• Add first item to cart&#10;• Verify cart contains the item"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                        Provide clear, step-by-step instructions in plain language
                    </p>
                </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4 flex-shrink-0 border-t border-gray-200">
                <button
                    type="submit"
                    disabled={isLoading}
                    className="btn-primary w-full flex justify-center items-center gap-2"
                >
                    {isLoading ? (
                        <>
                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>Running Test...</span>
                        </>
                    ) : (
                        <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>Run Test</span>
                        </>
                    )}
                </button>
            </div>
        </form>
    );
}
