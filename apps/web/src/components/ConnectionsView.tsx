import type { Graph } from '../types/workspace';
import { EmptyState } from './EmptyState';
import { RepositoryTree } from './RepositoryTree';
import { LoadingIndicator } from './LoadingIndicator';

type Props = { graph: Graph | null; busy: boolean; error: string; onRetry: () => void };

export function ConnectionsView({ graph, busy, error, onRetry }: Props) {
  return <>
    <div className="view-intro">
      <h2>Follow the connections.</h2>
      <p>Select any source to highlight its route from the repository. The complete overview stays in place.</p>
    </div>
    {busy ? <LoadingIndicator>Loading relationships…</LoadingIndicator>
      : error ? (
        <div className="graph-message"><p>{error}</p><button className="secondary" onClick={onRetry}>Retry map</button></div>
      ) : graph?.nodes.length ? <RepositoryTree graph={graph} />
        : <EmptyState icon="branch" title="No connected records" text="Try the repository overview to see the available relationships." />}
  </>;
}
