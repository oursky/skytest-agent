import { RUN_TRIGGER_SOURCE } from '@/types';

export function isSchedulerTriggered(run: { triggerSource?: string | null }): boolean {
    return run.triggerSource === RUN_TRIGGER_SOURCE.SCHEDULER;
}
