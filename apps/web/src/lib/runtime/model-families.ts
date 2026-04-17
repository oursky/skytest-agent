import { MODEL_FAMILY_VALUES, type TModelFamily } from '@midscene/shared/env/types';

export const VALID_MODEL_FAMILIES: readonly TModelFamily[] = MODEL_FAMILY_VALUES;

export type ValidModelFamily = TModelFamily;

export const MIDSCENE_MODEL_DEFAULTS: {
    baseUrl: string;
    mainModel: string;
    mainModelFamily: ValidModelFamily;
    planningModel: string;
    planningModelFamily: ValidModelFamily;
    insightModel: string;
    insightModelFamily: ValidModelFamily;
    temperature: number;
} = {
    baseUrl: 'https://openrouter.ai/api/v1',
    mainModel: 'qwen/qwen3.5-27b',
    mainModelFamily: 'qwen3.5',
    planningModel: 'qwen/qwen3.5-27b',
    planningModelFamily: 'qwen3.5',
    insightModel: 'qwen/qwen3.5-27b',
    insightModelFamily: 'qwen3.5',
    temperature: 0.2,
};
