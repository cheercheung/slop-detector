import type { GptzeroResult, GptzeroUsage, Verdict } from './shared';
import { isRecord } from './shared';

const probability = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
export function validGptzeroResult(value: unknown): value is GptzeroResult {
  const v = value as GptzeroResult | undefined;
  const p = v?.probabilities;
  return (
    !!v &&
    ['human', 'mixed', 'ai'].includes(v.classification) &&
    !!p &&
    probability(p.human) &&
    probability(p.mixed) &&
    probability(p.ai) &&
    Math.abs(p.human + p.mixed + p.ai - 1) < 0.02 &&
    (v.confidence === undefined || ['high', 'medium', 'low'].includes(v.confidence))
  );
}
export function parseGptzeroResponse(value: unknown, started: number, now = Date.now()): Verdict {
  const documents = isRecord(value) && Array.isArray(value.documents) ? value.documents : [];
  const doc: unknown = documents[0];
  if (!isRecord(doc) || !isRecord(doc.class_probabilities))
    throw new Error('INVALID_MODEL_RESPONSE');
  const raw = doc.class_probabilities;
  const legacyClasses: Record<string, string> = {
    HUMAN_ONLY: 'human',
    MIXED: 'mixed',
    AI_ONLY: 'ai',
  };
  const classification =
    doc.predicted_class ??
    (typeof doc.document_classification === 'string'
      ? legacyClasses[doc.document_classification]
      : undefined);
  const result = {
    classification,
    probabilities: { human: raw.human, mixed: raw.mixed, ai: raw.ai },
    ...(doc.confidence_category !== undefined ? { confidence: doc.confidence_category } : {}),
  };
  if (!validGptzeroResult(result)) throw new Error('INVALID_MODEL_RESPONSE');

  return {
    probability: result.probabilities.ai,
    evaluatedAt: now,
    latencyMs: now - started,
    gptzero: result,
  };
}
export function normalizeGptzeroVerdict(value: unknown): Verdict {
  const v = value as Verdict | undefined;
  if (
    !v ||
    !validGptzeroResult(v.gptzero) ||
    !probability(v.probability) ||
    !Number.isFinite(v.evaluatedAt) ||
    v.evaluatedAt < 0 ||
    !Number.isFinite(v.latencyMs) ||
    v.latencyMs < 0
  )
    throw new Error('Invalid GPTZero score');
  const ai = v.gptzero.probabilities.ai;

  const legacy = Math.min(1, ai + v.gptzero.probabilities.mixed);
  if (Math.abs(v.probability - ai) > 0.000001 && Math.abs(v.probability - legacy) > 0.000001)
    throw new Error('Invalid GPTZero score');
  return {
    probability: ai,
    evaluatedAt: v.evaluatedAt,
    latencyMs: v.latencyMs,
    gptzero: v.gptzero,
  };
}
export function validUsage(value: unknown): value is GptzeroUsage {
  const v = value as GptzeroUsage | undefined;
  return (
    !!v &&
    [v.limit, v.used, v.remaining, v.resetsAt].every((n) => Number.isSafeInteger(n) && n >= 0) &&
    v.remaining === Math.max(0, v.limit - v.used)
  );
}
