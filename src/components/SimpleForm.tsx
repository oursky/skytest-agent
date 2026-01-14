'use client';

import { config } from '@/config/app';

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
    readOnly
}: SimpleFormProps) {
    return (
        <div className="space-y-6 animate-fade-in">
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
                    disabled={readOnly}
                />
            </div>

            {/* Credentials */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                        Username <span className="text-gray-400 font-normal">(Optional)</span>
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
                        Password <span className="text-gray-400 font-normal">(Optional)</span>
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
                            {showPassword ? 'Hide' : 'Show'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Instructions */}
            <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                    Test Instructions
                </label>
                <textarea
                    required
                    className="input-field min-h-[200px] resize-y"
                    placeholder="Enter step-by-step test instructions..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={readOnly}
                />
            </div>
        </div>
    );
}

export type { SimpleFormProps };
