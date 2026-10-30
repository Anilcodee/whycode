import type { Evidence } from '../types/workspace';
import { Icon } from './Icon';
import { EmptyState } from './EmptyState';
import { SourceCode } from './SourceCode';
import { date, SourceLink, sourceNames } from './SourcePresentation';

type Props = {
  evidence: Evidence[];
  source?: Evidence;
  onInspect: (id: string | null) => void;
  onClose: () => void;
};

export function SourceInspector({ evidence, source, onInspect, onClose }: Props) {
  return (
    <aside id="source-inspector" tabIndex={-1} className="source-inspector" aria-label="Source inspector">
      {source ? <>
        <button className="text-button inspector-close" onClick={onClose}>
          Close source<Icon name="close" size={15} />
        </button>
        <div className="inspector-title">
          <span><Icon name="file" size={16} />SOURCE INSPECTOR</span>
          <span className="source-count">{evidence.findIndex(item => item.id === source.id) + 1} / {evidence.length}</span>
        </div>
        <div className="source-switcher">
          {evidence.map((item, index) => (
            <button
              aria-label={`Inspect source ${index + 1}: ${item.title}`}
              aria-pressed={source.id === item.id}
              key={item.id}
              className={source.id === item.id ? 'selected' : ''}
              onClick={() => onInspect(item.id)}
            >{index + 1}</button>
          ))}
        </div>
        <span className={`inspector-type ${source.type}`}>{sourceNames[source.type] ?? source.type}</span>
        <h3>{source.title}</h3>
        <div className="source-metadata">
          {source.author && <span><span className="author-avatar">{source.author[0]?.toUpperCase()}</span>{source.author}</span>}
          {source.date && <span><Icon name="clock" size={13} />{date(source.date)}</span>}
          {source.revision && <span><Icon name="code" size={13} />{source.revision.slice(0, 10)} · pinned revision</span>}
          {source.state && <span className="source-state">{source.state}</span>}
        </div>
        {source.excerpt ? (
          <div key={source.id} className={`source-excerpt ${source.type === 'file' ? 'code-excerpt' : ''}`}>
            <span>{source.type === 'file' ? 'SOURCE SNAPSHOT' : 'SOURCE EXCERPT'}</span>
            <pre>{source.type === 'file'
              ? <SourceCode content={source.excerpt} firstLine={Number(source.url?.match(/#L(\d+)/)?.[1] ?? 1)} />
              : source.excerpt}</pre>
          </div>
        ) : <p className="muted inspector-empty">No text excerpt is available for this record. Open the original source for the complete context.</p>}
        <div className="retrieval-reason"><Icon name="link" size={15} /><span>{source.relationToAnswer}</span></div>
        <SourceLink source={source.url} className="source-original">Open original source<Icon name="external" size={15} /></SourceLink>
      </> : <EmptyState icon="file" title="Your sources live here." text="Evidence will appear here as your investigation takes shape." />}
    </aside>
  );
}
