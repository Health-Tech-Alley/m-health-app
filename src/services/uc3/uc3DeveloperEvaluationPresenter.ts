import type { Uc3EvaluationServiceResult } from './uc3EvaluationService';

export type Uc3DeveloperEvaluationStatus = {
  title: string;
  lines: string[];
};

export function createManualUc3EvaluationKey(now: Date = new Date()): string {
  return `manual:${now.toISOString()}`;
}

export function describeUc3DeveloperEvaluationResult(
  result: Uc3EvaluationServiceResult,
): Uc3DeveloperEvaluationStatus {
  if (result.status === 'success') {
    const persisted = result.persistedResult;
    return {
      title: result.inserted ? 'UC3 evaluation saved' : 'UC3 evaluation already exists',
      lines: [
        `Result: ${persisted.resultId}`,
        `Event: ${persisted.eventType}`,
        `Severity: ${persisted.severity}`,
        `Review: ${persisted.requiresHumanReview ? 'needed' : 'not needed'}`,
        `Generated: ${persisted.generatedAt}`,
      ],
    };
  }

  if (result.status === 'not_ready') {
    return {
      title: 'UC3 evaluation not ready',
      lines: result.errors.map((issue) => `${issue.code}: ${issue.message}`),
    };
  }

  return {
    title: `UC3 ${result.status.replace(/_/g, ' ')}`,
    lines: [result.message],
  };
}
