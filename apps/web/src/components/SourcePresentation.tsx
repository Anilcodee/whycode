import type { ReactNode } from 'react';
import type { Evidence } from '../types/workspace';

export const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Undated';
export const safeHref = (value?: string) => { try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } };
export const sourceNames: Record<string, string> = { commit: 'Commit', pull_request: 'Pull request', issue: 'Issue', comment: 'Comment', file: 'Code', document: 'Document' };
export function richText(text: string, evidence: Evidence[]) {
  return text.split(/(\[[^\]\n]+\]|`[^`\n]+`)/g).map((part, index) => {
    const position = evidence.findIndex(item => `[${item.id}]` === part);
    if (position >= 0) return <a className="citation" href="#source-inspector" data-source-id={evidence[position].id} title={evidence[position].title} key={index}>[{position + 1}]</a>;
    return part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part;
  });
}
export function SourceLink({ source, children, className }: { source?: string; children: ReactNode; className?: string }) { const safe = safeHref(source); return safe ? <a href={safe} target="_blank" rel="noopener noreferrer" className={className}>{children}</a> : <span className={className}>{children}</span>; }
