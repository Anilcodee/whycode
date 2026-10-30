import type { Answer } from '../types/workspace';
import { EmptyState } from './EmptyState';
import { date, SourceLink, sourceNames } from './SourcePresentation';

export function TimelineView({ timeline }: { timeline: Answer['decisionTimeline'] }) {
  return <>
    <div className="view-intro">
      <h2>A record of the changes.</h2>
      <p>Chronological context. Newer activity alone does not mean an earlier decision was replaced.</p>
    </div>
    {timeline.length ? (
      <ol className="timeline">
        {timeline.map(item => (
          <li key={`${item.evidenceId}-${item.date}`}>
            <span className="timeline-dot" />
            <time>{date(item.date)}</time>
            <span className="source-kind">{sourceNames[item.type]}</span>
            <SourceLink source={item.url}>{item.title}</SourceLink>
          </li>
        ))}
      </ol>
    ) : <EmptyState icon="clock" title="No dated history" text="The matching records do not provide a dated decision trail." />}
  </>;
}
