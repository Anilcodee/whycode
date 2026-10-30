import type { Answer } from '../types/workspace';
import { Icon } from './Icon';
import { EmptyState } from './EmptyState';
import { date, sourceNames } from './SourcePresentation';

type Props = { answer: Answer; inspectedId?: string; onInspect: (id: string) => void };

export function EvidenceView({ answer, inspectedId, onInspect }: Props) {
  return (
    <div className="evidence-view">
      <div className="view-intro">
        <h2>The source material.</h2>
        <p>Primary records, with the path that connected them to your question.</p>
      </div>
      {answer.evidence.length ? answer.evidence.map((item, index) => (
        <button
          className={`source-row ${item.id === inspectedId ? 'inspected' : ''}`}
          id={`source-${encodeURIComponent(item.id)}`}
          key={item.id}
          onClick={() => onInspect(item.id)}
        >
          <span className={`source-icon ${item.type}`}><Icon name={item.type === 'commit' ? 'branch' : 'file'} size={18} /></span>
          <span className="source-row-copy">
            <span className="source-kind">
              {sourceNames[item.type] ?? item.type}
              {answer.citedEvidenceIds.includes(item.id) && <span className="cited-label">CITED</span>}
            </span>
            <strong>{item.title}</strong>
            <small>{item.author ?? 'Repository source'} · {date(item.date)}</small>
          </span>
          <span className="source-number">[{index + 1}]</span>
          <Icon name="chevron" size={15} />
        </button>
      )) : <EmptyState icon="file" title="No matching sources" text="Try naming a file, symbol, commit, or discussion number." />}
    </div>
  );
}
