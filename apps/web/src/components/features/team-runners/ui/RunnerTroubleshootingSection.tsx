'use client';

import { CopyableCodeBlock } from '@/components/shared';
import type { TeamRunnerItem, TeamRunnersResponse } from '../model/types';

interface RunnerTroubleshootingSectionProps {
    isLoading: boolean;
    runners: TeamRunnersResponse | null;
    offlineRunners: TeamRunnerItem[];
    copiedCommandKey: string | null;
    onCopyCommand: (key: string, text: string) => Promise<void>;
    buildPairCommand: (token: string | null) => string;
    resolveRunnerDisplayId: (runner: Pick<TeamRunnerItem, 'id' | 'displayId'>) => string;
    buildStartRunnerCommand: (runnerDisplayId: string) => string;
    copyLabel: string;
    copiedLabel: string;
    t: (key: string, values?: Record<string, string | number>) => string;
}

export default function RunnerTroubleshootingSection({
    isLoading,
    runners,
    offlineRunners,
    copiedCommandKey,
    onCopyCommand,
    buildPairCommand,
    resolveRunnerDisplayId,
    buildStartRunnerCommand,
    copyLabel,
    copiedLabel,
    t,
}: RunnerTroubleshootingSectionProps) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">{t('team.runners.troubleshooting.title')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('team.runners.troubleshooting.subtitle')}</p>

            <div className="mt-4 space-y-4">
                {[
                    { key: 'get-runners', label: t('team.runners.troubleshooting.listRunners'), command: 'skytest get runners' },
                    { key: 'pair-runner', label: t('team.runners.troubleshooting.pairRunner'), command: buildPairCommand(null) },
                    { key: 'start-runner', label: t('team.runners.troubleshooting.start'), command: "skytest start runner '<runner-id>'" },
                    { key: 'stop-runner', label: t('team.runners.troubleshooting.stop'), command: "skytest stop runner '<runner-id>'" },
                    { key: 'logs-runner', label: t('team.runners.troubleshooting.logs'), command: "skytest logs runner '<runner-id>' --tail 200" },
                    { key: 'unpair-runner', label: t('team.runners.troubleshooting.unpairRunner'), command: "skytest unpair runner '<runner-id>'" },
                ].map(({ key, label, command }) => (
                    <div key={key}>
                        <p className="mb-1.5 text-xs font-medium text-gray-700">{label}</p>
                        <CopyableCodeBlock
                            code={command}
                            copied={copiedCommandKey === key}
                            onCopy={() => void onCopyCommand(key, command)}
                            copyLabel={copyLabel}
                            copiedLabel={copiedLabel}
                        />
                    </div>
                ))}
            </div>

            {!isLoading && runners && offlineRunners.length > 0 && (
                <div className="mt-6 space-y-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('team.runners.troubleshooting.offlineTitle')}</p>
                    {offlineRunners.map((runner) => {
                        const runnerDisplayId = resolveRunnerDisplayId(runner);
                        const startCommand = buildStartRunnerCommand(runnerDisplayId);
                        const commandKey = `${runner.id}-start`;

                        return (
                            <div key={runner.id} className="rounded-md border border-amber-200 bg-amber-50 p-4">
                                <div className="mb-3">
                                    <p className="text-sm font-medium text-gray-900">{runner.label}</p>
                                    <p className="text-xs text-gray-500">
                                        {t('team.runners.troubleshooting.runnerId', { id: runnerDisplayId })}
                                    </p>
                                </div>
                                <p className="mb-1.5 text-xs font-medium text-gray-700">{t('team.runners.troubleshooting.start')}</p>
                                <CopyableCodeBlock
                                    code={startCommand}
                                    copied={copiedCommandKey === commandKey}
                                    onCopy={() => void onCopyCommand(commandKey, startCommand)}
                                    copyLabel={copyLabel}
                                    copiedLabel={copiedLabel}
                                />
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

export type { RunnerTroubleshootingSectionProps };
