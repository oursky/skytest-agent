import { MutableRefObject } from 'react';
import { useI18n } from '@/i18n';
import type { AndroidTargetConfig, BrowserConfig, ConfigItem } from '@/types';
import { normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import { normalizeBrowserConfig } from '@/lib/config/browser-target';
import {
    AndroidDeviceOption,
    getAndroidDeviceSelectorLabel,
    isSameAndroidDeviceSelector,
} from './device-utils';
import type { BrowserEntry } from './types';

interface TargetConfigurationsPanelProps {
    readOnly?: boolean;
    projectId?: string;
    browsers: BrowserEntry[];
    androidDeviceOptions: AndroidDeviceOption[];
    urlConfigs: ConfigItem[];
    appIdConfigs: ConfigItem[];
    urlDropdownOpen: string | null;
    setUrlDropdownOpen: (value: string | null) => void;
    avdDropdownOpen: string | null;
    setAvdDropdownOpen: (value: string | null) => void;
    appDropdownOpen: string | null;
    setAppDropdownOpen: (value: string | null) => void;
    urlDropdownRefs: MutableRefObject<Map<string, HTMLDivElement>>;
    avdDropdownRefs: MutableRefObject<Map<string, HTMLDivElement>>;
    appDropdownRefs: MutableRefObject<Map<string, HTMLDivElement>>;
    onAddBrowser: () => void;
    onAddAndroid: () => void;
    onRemoveBrowser: (index: number) => void;
    onUpdateTarget: (index: number, updates: Partial<BrowserConfig & AndroidTargetConfig>) => void;
}

function isAndroidConfig(config: BrowserEntry['config']): config is AndroidTargetConfig {
    return 'type' in config && config.type === 'android';
}

export default function TargetConfigurationsPanel({
    readOnly,
    projectId,
    browsers,
    androidDeviceOptions,
    urlConfigs,
    appIdConfigs,
    urlDropdownOpen,
    setUrlDropdownOpen,
    avdDropdownOpen,
    setAvdDropdownOpen,
    appDropdownOpen,
    setAppDropdownOpen,
    urlDropdownRefs,
    avdDropdownRefs,
    appDropdownRefs,
    onAddBrowser,
    onAddAndroid,
    onRemoveBrowser,
    onUpdateTarget,
}: TargetConfigurationsPanelProps) {
    const { t } = useI18n();
    const colors = ['bg-blue-500', 'bg-purple-500', 'bg-orange-500', 'bg-green-500', 'bg-pink-500'];

    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">{t('configs.section.browserConfig')}</label>
            <div className="border border-gray-200 rounded-lg bg-white">
                <div className="px-4 py-3">
                    <div className="space-y-3">
                        {browsers.map((browser, index) => {
                            const colorClass = colors[index % colors.length];
                            const android = isAndroidConfig(browser.config);
                            const defaultLabel = android
                                ? `Android ${String.fromCharCode('A'.charCodeAt(0) + index)}`
                                : `Browser ${String.fromCharCode('A'.charCodeAt(0) + index)}`;

                            if (android) {
                                const cfg = browser.config as AndroidTargetConfig;
                                const normalizedAndroidConfig = normalizeAndroidTargetConfig(cfg);
                                const selectedDeviceOption = androidDeviceOptions.find((option) =>
                                    isSameAndroidDeviceSelector(option.selector, normalizedAndroidConfig.deviceSelector)
                                );
                                const selectedDeviceLabel = selectedDeviceOption?.label || getAndroidDeviceSelectorLabel(normalizedAndroidConfig.deviceSelector);
                                const physicalDeviceOptions = androidDeviceOptions.filter((option) => option.group === 'physical');
                                const emulatorDeviceOptions = androidDeviceOptions.filter((option) => option.group === 'emulator');
                                return (
                                    <div key={browser.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2.5 h-2.5 rounded-full ${colorClass}`}></span>
                                                <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{cfg.name || defaultLabel}</span>
                                            </div>
                                            {browsers.length > 1 && !readOnly && (
                                                <button type="button" onClick={() => onRemoveBrowser(index)} className="text-xs text-gray-400 hover:text-red-500">
                                                    {t('common.remove')}
                                                </button>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 gap-2">
                                            <div>
                                                <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.name')}</label>
                                                <input
                                                    type="text"
                                                    value={cfg.name || ''}
                                                    onChange={(e) => onUpdateTarget(index, { name: e.target.value })}
                                                    placeholder={t('configs.android.name.placeholder')}
                                                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                    disabled={readOnly}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.android.device')}</label>
                                                <div
                                                    className="relative mt-0.5"
                                                    ref={(el) => {
                                                        if (el) avdDropdownRefs.current.set(browser.id, el);
                                                        else avdDropdownRefs.current.delete(browser.id);
                                                    }}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => !readOnly && setAvdDropdownOpen(avdDropdownOpen === browser.id ? null : browser.id)}
                                                        disabled={readOnly}
                                                        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-50"
                                                    >
                                                        <span className={selectedDeviceLabel ? 'text-gray-800' : 'text-gray-400'}>
                                                            {selectedDeviceLabel || t('configs.android.device.placeholder')}
                                                        </span>
                                                        <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </button>
                                                    {avdDropdownOpen === browser.id && !readOnly && (
                                                        <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 min-w-full max-h-80 overflow-y-auto">
                                                            {androidDeviceOptions.length === 0 ? (
                                                                <div className="px-3 py-2 text-xs text-gray-400">{t('configs.android.device.none')}</div>
                                                            ) : (
                                                                <>
                                                                    {physicalDeviceOptions.length > 0 && (
                                                                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                                                                            {t('device.section.connected')}
                                                                        </div>
                                                                    )}
                                                                    {physicalDeviceOptions.map((option) => (
                                                                        <button
                                                                            key={option.id}
                                                                            type="button"
                                                                            onClick={() => {
                                                                                if (option.disabled) return;
                                                                                onUpdateTarget(index, { deviceSelector: option.selector });
                                                                                setAvdDropdownOpen(null);
                                                                            }}
                                                                            disabled={option.disabled}
                                                                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 ${selectedDeviceOption && isSameAndroidDeviceSelector(selectedDeviceOption.selector, option.selector) ? 'bg-gray-50 font-medium' : 'text-gray-700'}`}
                                                                        >
                                                                            <div className="flex items-center justify-between gap-2">
                                                                                <div className="min-w-0">
                                                                                    <div className="truncate">{option.label}</div>
                                                                                    <div className="text-[10px] text-gray-400 truncate">{option.detail}</div>
                                                                                </div>
                                                                                <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${option.statusColorClass}`}>
                                                                                    {t(option.statusKey)}
                                                                                </span>
                                                                            </div>
                                                                        </button>
                                                                    ))}
                                                                    {emulatorDeviceOptions.length > 0 && (
                                                                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                                                                            {t('device.section.profiles')}
                                                                        </div>
                                                                    )}
                                                                    {emulatorDeviceOptions.map((option) => (
                                                                        <button
                                                                            key={option.id}
                                                                            type="button"
                                                                            onClick={() => {
                                                                                onUpdateTarget(index, { deviceSelector: option.selector });
                                                                                setAvdDropdownOpen(null);
                                                                            }}
                                                                            disabled={option.disabled}
                                                                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 ${selectedDeviceOption && isSameAndroidDeviceSelector(selectedDeviceOption.selector, option.selector) ? 'bg-gray-50 font-medium' : 'text-gray-700'}`}
                                                                        >
                                                                            <div className="flex items-center justify-between gap-2">
                                                                                <div className="min-w-0">
                                                                                    <div className="truncate">{option.label}</div>
                                                                                    <div className="text-[10px] text-gray-400 truncate">{option.detail}</div>
                                                                                </div>
                                                                                <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${option.statusColorClass}`}>
                                                                                    {t(option.statusKey)}
                                                                                </span>
                                                                            </div>
                                                                        </button>
                                                                    ))}
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-medium text-gray-500 uppercase">
                                                    {t('configs.android.appId')} {!readOnly && <span className="text-red-500">*</span>}
                                                </label>
                                                <div className={`flex mt-0.5 border border-gray-300 rounded bg-white ${readOnly ? '' : 'focus-within:ring-1 focus-within:ring-primary focus-within:border-primary'}`}>
                                                    <input
                                                        type="text"
                                                        value={cfg.appId || ''}
                                                        onChange={(e) => onUpdateTarget(index, { appId: e.target.value })}
                                                        placeholder={t('configs.android.appId.placeholder')}
                                                        className={`flex-1 px-2 py-1.5 text-xs bg-white focus:outline-none ${appIdConfigs.length > 0 && !readOnly ? 'rounded-l' : 'rounded'}`}
                                                        disabled={readOnly}
                                                    />
                                                    {appIdConfigs.length > 0 && !readOnly && (
                                                        <div
                                                            className="relative"
                                                            ref={(el) => {
                                                                if (el) appDropdownRefs.current.set(browser.id, el);
                                                                else appDropdownRefs.current.delete(browser.id);
                                                            }}
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() => setAppDropdownOpen(appDropdownOpen === browser.id ? null : browser.id)}
                                                                className="h-full px-2 border-l border-gray-300 rounded-r bg-white hover:bg-gray-50 text-gray-500 flex items-center"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                                </svg>
                                                            </button>
                                                            {appDropdownOpen === browser.id && (
                                                                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 min-w-[220px]">
                                                                    {appIdConfigs.map((appConfig) => (
                                                                        <button
                                                                            key={appConfig.id}
                                                                            type="button"
                                                                            onClick={() => {
                                                                                onUpdateTarget(index, { appId: appConfig.value });
                                                                                setAppDropdownOpen(null);
                                                                            }}
                                                                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"
                                                                        >
                                                                            <span className="font-mono font-medium text-gray-700">{appConfig.name}</span>
                                                                            <span className="text-gray-400 ml-2 truncate">{appConfig.value}</span>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="space-y-2 rounded border border-gray-200 bg-white p-2">
                                                <label className="flex items-start gap-2 text-xs text-gray-700">
                                                    <input
                                                        type="checkbox"
                                                        checked={cfg.clearAppState}
                                                        onChange={(e) => onUpdateTarget(index, { clearAppState: e.target.checked })}
                                                        disabled={readOnly}
                                                        className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                                                    />
                                                    <span>
                                                        <span className="block font-medium">{t('configs.android.clearAppState')}</span>
                                                    </span>
                                                </label>
                                                <label className="flex items-start gap-2 text-xs text-gray-700">
                                                    <input
                                                        type="checkbox"
                                                        checked={cfg.allowAllPermissions}
                                                        onChange={(e) => onUpdateTarget(index, { allowAllPermissions: e.target.checked })}
                                                        disabled={readOnly}
                                                        className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                                                    />
                                                    <span>
                                                        <span className="block font-medium">{t('configs.android.allowAllPermissions')}</span>
                                                    </span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            const cfg = normalizeBrowserConfig(browser.config as BrowserConfig);
                            return (
                                <div key={browser.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2.5 h-2.5 rounded-full ${colorClass}`}></span>
                                            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{defaultLabel}</span>
                                        </div>
                                        {browsers.length > 1 && !readOnly && (
                                            <button
                                                type="button"
                                                onClick={() => onRemoveBrowser(index)}
                                                className="text-xs text-gray-400 hover:text-red-500"
                                            >
                                                {t('common.remove')}
                                            </button>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 gap-2">
                                        <div>
                                            <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.name')}</label>
                                            <input
                                                type="text"
                                                value={cfg.name || ''}
                                                onChange={(e) => onUpdateTarget(index, { name: e.target.value })}
                                                placeholder={t('configs.browser.name.placeholder')}
                                                className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                disabled={readOnly}
                                            />
                                        </div>
                                        <div className="relative">
                                            <label className="text-[10px] font-medium text-gray-500 uppercase">
                                                {t('configs.browser.url')} {!readOnly && <span className="text-red-500">*</span>}
                                            </label>
                                            <div className={`flex mt-0.5 border border-gray-300 rounded bg-white ${readOnly ? '' : 'focus-within:ring-1 focus-within:ring-primary focus-within:border-primary'}`}>
                                                <input
                                                    type="text"
                                                    value={cfg.url}
                                                    onChange={(e) => onUpdateTarget(index, { url: e.target.value })}
                                                    placeholder={t('configs.browser.url.placeholder')}
                                                    className={`flex-1 px-2 py-1.5 text-xs bg-white focus:outline-none ${urlConfigs.length > 0 && !readOnly ? 'rounded-l' : 'rounded'}`}
                                                    disabled={readOnly}
                                                />
                                                {urlConfigs.length > 0 && !readOnly && (
                                                    <div className="relative" ref={(el) => { if (el) urlDropdownRefs.current.set(browser.id, el); }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => setUrlDropdownOpen(urlDropdownOpen === browser.id ? null : browser.id)}
                                                            className="h-full px-2 border-l border-gray-300 rounded-r bg-white hover:bg-gray-50 text-gray-500 flex items-center"
                                                        >
                                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                            </svg>
                                                        </button>
                                                        {urlDropdownOpen === browser.id && (
                                                            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 min-w-[200px]">
                                                                {urlConfigs.map((uc) => (
                                                                    <button
                                                                        key={uc.id}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            onUpdateTarget(index, { url: uc.value });
                                                                            setUrlDropdownOpen(null);
                                                                        }}
                                                                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"
                                                                    >
                                                                        <span className="font-mono font-medium text-gray-700">{uc.name}</span>
                                                                        <span className="text-gray-400 ml-2 truncate">{uc.value}</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.width')}</label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={cfg.width}
                                                    onChange={(e) => {
                                                        const width = Number.parseInt(e.target.value, 10);
                                                        if (Number.isFinite(width) && width > 0) {
                                                            onUpdateTarget(index, { width });
                                                        }
                                                    }}
                                                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                    disabled={readOnly}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.height')}</label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={cfg.height}
                                                    onChange={(e) => {
                                                        const height = Number.parseInt(e.target.value, 10);
                                                        if (Number.isFinite(height) && height > 0) {
                                                            onUpdateTarget(index, { height });
                                                        }
                                                    }}
                                                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                    disabled={readOnly}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {!readOnly && (
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={onAddBrowser}
                                    className="flex-1 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors text-xs font-medium flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    {t('configs.browser.addBrowser')}
                                </button>
                                {projectId && androidDeviceOptions.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={onAddAndroid}
                                        className="flex-1 py-2 border-2 border-dashed border-green-300 rounded-lg text-green-600 hover:border-green-400 hover:text-green-700 transition-colors text-xs font-medium flex items-center justify-center gap-1.5"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        {t('configs.target.addAndroid')}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
