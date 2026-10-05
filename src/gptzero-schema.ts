import type { GptzeroResult, GptzeroUsage, Verdict } from './shared';

const probability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
export function validGptzeroResult(value: unknown): value is GptzeroResult {
  const v = value as GptzeroResult | undefined;
  const p = v?.probabilities;
  return !!v && ['human', 'mixed', 'ai'].includes(v.classification) && !!p &&
    probability(p.human) && probability(p.mixed) && probability(p.ai) && Math.abs(p.human + p.mixed + p.ai - 1) < 0.02 &&
    (v.confidence === undefined || ['high', 'medium', 'low'].includes(v.confidence));
}
export function parseGptzeroResponse(value: unknown, started: number, now = Date.now()): Verdict {
  const doc = (value as { documents?: Array<Record<string, any>> })?.documents?.[0];
  const raw = doc?.class_probabilities;
  const classification = doc?.predicted_class ?? ({ HUMAN_ONLY: 'human', MIXED: 'mixed', AI_ONLY: 'ai' } as Record<string, string>)[doc?.document_classification];
  const result = { classification, probabilities: raw && { human: raw.human, mixed: raw.mixed, ai: raw.ai }, ...(doc?.confidence_category ? { confidence: doc.confidence_category } : {}) };
  if (!validGptzeroResult(result)) throw new Error('INVALID_MODEL_RESPONSE');
  // Preserve all three classes; the existing binary label represents any AI
  // involvement (AI + mixed), not the deprecated completely_generated_prob.
  return { probability: Math.min(1, result.probabilities.ai + result.probabilities.mixed), evaluatedAt: now, latencyMs: now - started, gptzero: result };
}
export function validUsage(value: unknown): value is GptzeroUsage {
  const v = value as GptzeroUsage | undefined;
  return !!v && [v.limit, v.used, v.remaining, v.resetsAt].every(n => Number.isSafeInteger(n) && n >= 0) && v.remaining === Math.max(0, v.limit - v.used);
}
