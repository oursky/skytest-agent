'use client';

interface UnderlineTabItem<T extends string> {
    id: T;
    label: string;
    hidden?: boolean;
}

interface UnderlineTabsProps<T extends string> {
    tabs: Array<UnderlineTabItem<T>>;
    activeTab: T;
    onChange: (tabId: T) => void;
}

export default function UnderlineTabs<T extends string>({
    tabs,
    activeTab,
    onChange,
}: UnderlineTabsProps<T>) {
    return (
        <div className="border-b border-gray-200">
            <nav className="-mb-px flex gap-6">
                {tabs.filter((tab) => !tab.hidden).map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onChange(tab.id)}
                        className={`cursor-pointer border-b-2 pb-3 text-sm font-medium transition-colors ${activeTab === tab.id
                            ? 'border-primary text-primary'
                            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </nav>
        </div>
    );
}

export type { UnderlineTabItem, UnderlineTabsProps };
