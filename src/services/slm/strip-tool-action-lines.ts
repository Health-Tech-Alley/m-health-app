/**
 * Shared defensive scrub for surfaces that stream Concierge text but never
 * execute tools (in-card mini-chat, Care plan ask chat, explain sheet).
 *
 * The main chat parses ACTION lines and executes the matching tools. Other
 * surfaces only display text, so any ACTION line the model emits would leak
 * raw. Strip both known ACTION formats before rendering.
 */

import { stripProposeCarePlanUpdateAction } from './plan-tool-nlp';
import { stripEvaluateHypotheticalAction } from './vitals-tool-nlp';

export function stripKnownToolActionLines(text: string): string {
  return stripProposeCarePlanUpdateAction(stripEvaluateHypotheticalAction(text));
}
