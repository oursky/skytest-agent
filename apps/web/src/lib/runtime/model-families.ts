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
    mainModel: 'qwen/qwen3.6-plus',
    mainModelFamily: 'qwen3.6',
    planningModel: 'qwen/qwen3.6-plus',
    planningModelFamily: 'qwen3.6',
    insightModel: 'qwen/qwen3.6-plus',
    insightModelFamily: 'qwen3.6',
    temperature: 0.2,
};
