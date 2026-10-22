import type { Experimental_EvaluationModel } from 'ai';

/** Local adaptation: EvoLink predicate probabilities map directly to SDK booleans. */
export function directLuna(
  apiKey: string,
  transport: typeof fetch,
): Exclude<Experimental_EvaluationModel, string> {
  if (!apiKey.trim()) throw new Error('EVOLINK_KEY_REQUIRED');
  return {
    specificationVersion: 'v4',
    provider: 'evolink',
    modelId: 'gpt-6-luna-decisions',
    supportedQuestionTypes: ['boolean'],
    async doEvaluate({ state, questions, abortSignal }) {
      abortSignal?.throwIfAborted();
      const entries = Object.entries(questions);
      const response = await transport('https://direct.evolink.ai/v1/decisions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-6-luna-decisions',
          input: typeof state === 'string' ? state : JSON.stringify(state),
          questions: entries.map(([name, question]) => ({
            type: 'predicate',
            name,
            instructions: question.instructions,
          })),
        }),
        signal: abortSignal,
        credentials: 'omit',
        redirect: 'error',
      });
      if (!response.ok)
        throw Object.assign(new Error('Provider request failed'), { statusCode: response.status });
      const data: unknown = await response.json().catch(() => null);
      const rows = (data as { answers?: unknown } | null)?.answers;
      if (!Array.isArray(rows) || rows.length !== entries.length)
        throw new Error('INVALID_MODEL_RESPONSE');
      const answers: Record<string, { type: 'boolean'; probability: number }> = {};
      for (const row of rows) {
        if (
          !row ||
          typeof row !== 'object' ||
          typeof row.name !== 'string' ||
          !Object.hasOwn(questions, row.name) ||
          Object.hasOwn(answers, row.name) ||
          row.type !== 'predicate' ||
          typeof row.probability !== 'number' ||
          !Number.isFinite(row.probability) ||
          row.probability < 0 ||
          row.probability > 1
        )
          throw new Error('INVALID_MODEL_RESPONSE');
        Object.defineProperty(answers, row.name, {
          value: { type: 'boolean', probability: row.probability },
          enumerable: true,
        });
      }
      return { answers, warnings: [] };
    },
  };
}
