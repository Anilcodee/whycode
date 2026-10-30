import type { Answer, Evidence } from '../types/workspace';

export const WORKSPACE_STORAGE_KEY = 'whycode.workspace.v2';
const MAX_LENGTH = 2_000_000;
const MAX_HISTORY = 20;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const optionalText = (value: unknown) => value === undefined || text(value);
const list = (value: unknown, valid: (item: unknown) => boolean) => Array.isArray(value) && value.every(valid);

function evidence(value: unknown): value is Evidence {
  return record(value) && text(value.id) && text(value.type) && text(value.title)
    && text(value.relationToAnswer) && texts(value.graphPath)
    && ['excerpt', 'url', 'author', 'date', 'state', 'revision'].every(key => optionalText(value[key]))
    && (value.current === undefined || typeof value.current === 'boolean');
}

/** Browser storage is untrusted; validate fields consumed by all result views. */
export function isSavedAnswer(value: unknown): value is Answer {
  if (!record(value)) return false;
  return text(value.repositoryId) && text(value.question) && (value.answer === null || text(value.answer))
    && typeof value.abstained === 'boolean' && text(value.answeredAt) && text(value.temporalStatus)
    && ['abstentionReason', 'temporalReason', 'language', 'translatedAnswer'].every(key => optionalText(value[key]))
    && list(value.evidence, evidence) && texts(value.citedEvidenceIds) && texts(value.warnings)
    && record(value.confidence) && text(value.confidence.label) && text(value.confidence.reason)
    && list(value.decisionTimeline, item => record(item) && text(item.evidenceId) && text(item.title)
      && text(item.type) && optionalText(item.date) && optionalText(item.url))
    && (value.validation === undefined || record(value.validation) && text(value.validation.status)
      && text(value.validation.reason) && list(value.validation.claims, claim => record(claim)
        && text(claim.text) && texts(claim.evidenceIds) && list(claim.quotes, quote => record(quote)
          && text(quote.evidenceId) && text(quote.quote))))
    && (value.externalContext === undefined || list(value.externalContext, item => record(item)
      && text(item.title) && text(item.url) && text(item.snippet)));
}

export function restoreWorkspaceHistory(privateMode: boolean, storage?: StorageAccess) {
  if (privateMode) return null;
  const stored = (storage ?? window.localStorage).getItem(WORKSPACE_STORAGE_KEY);
  if (!stored || stored.length >= MAX_LENGTH) return null;
  const saved: unknown = JSON.parse(stored);
  if (!record(saved)) return null;
  return {
    selected: text(saved.selected) ? saved.selected : null,
    history: Array.isArray(saved.history) ? saved.history.filter(isSavedAnswer).slice(0, MAX_HISTORY) : [],
  };
}

export function saveWorkspaceHistory(privateMode: boolean, selected: string | null, history: Answer[], storage?: StorageAccess) {
  if (privateMode) return;
  const serialized = JSON.stringify({ selected, history: history.slice(0, MAX_HISTORY) });
  if (serialized.length >= MAX_LENGTH) throw new Error('Browser history exceeds its storage budget.');
  (storage ?? window.localStorage).setItem(WORKSPACE_STORAGE_KEY, serialized);
}

export function clearWorkspaceHistory(storage?: StorageAccess) {
  (storage ?? window.localStorage).removeItem(WORKSPACE_STORAGE_KEY);
}
