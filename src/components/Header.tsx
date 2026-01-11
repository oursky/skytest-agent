'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useRouter } from 'next/navigation';

export default function Header() {
    const { isLoggedIn, user, logout, openSettings } = useAuth();
    const router = useRouter();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    useEffect(() => {
        const closeDropdown = (e: MouseEvent) => {
            if (isDropdownOpen) setIsDropdownOpen(false);
        };
        if (isDropdownOpen) document.addEventListener('click', closeDropdown);
        return () => document.removeEventListener('click', closeDropdown);
    }, [isDropdownOpen]);

    const handleLogout = async () => {
        await logout();
        router.push('/');
    };

    if (!isLoggedIn) return null;

    return (
        <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-8 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => router.push('/projects')}
                            className="text-xl font-bold text-blue-600 hover:text-blue-700 transition-colors"
                        >
                            SkyTest Agent
                        </button>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="relative">
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsDropdownOpen(!isDropdownOpen); }}
                                className="flex items-center gap-2 hover:bg-gray-50 p-2 rounded-lg transition-colors focus:outline-none"
                            >
                                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
                                    {(user?.email?.[0] || 'U').toUpperCase()}
                                </div>
                                <span className="text-sm font-medium text-gray-700 max-w-[150px] truncate hidden md:block">
                                    {user?.email || 'User'}
                                </span>
                                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {isDropdownOpen && (
                                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-100 py-2 z-50">
                                    <button
                                        onClick={() => openSettings()}
                                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                    >
                                        Account Settings
                                    </button>

                                    <button
                                        onClick={() => router.push('/usage')}
                                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                    >
                                        API Key & Usage
                                    </button>

                                    <div className="border-t border-gray-50 mt-1 pt-1">
                                        <button
                                            onClick={handleLogout}
                                            className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                        >
                                            Logout
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </header>
    );
}
