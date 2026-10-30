type Source = { id: string; type: string; title: string };
export function EvidenceTrail({ evidence, onInspect }: { evidence: Source[]; onInspect: (id: string) => void }) {
  const groups = [
    { label: 'Implementation', types: ['file', 'document'], glyph: '<>', color: 'code' },
    { label: 'Change', types: ['commit'], glyph: '↳', color: 'change' },
    { label: 'Conversation', types: ['pull_request', 'issue', 'comment'], glyph: '“', color: 'discussion' },
  ];
  const sources = groups.flatMap(group => { const source = evidence.find(item => group.types.includes(item.type)); return source ? [{ ...group, source }] : []; });
  if (!sources.length) return null;
  return <section className="answer-trail" aria-label="Inspect the cited source records"><div className="trail-heading"><span>CITED SOURCES</span><small>Open a record to inspect it</small></div><ol>{sources.map(item => <li key={item.source.id}><button className={`trail-source ${item.color}`} onClick={() => onInspect(item.source.id)}><span className="trail-glyph" aria-hidden="true">{item.glyph}</span><span><small>{item.label}</small><strong>{item.source.title}</strong></span><span className="trail-arrow" aria-hidden="true">↗</span></button></li>)}</ol></section>;
}
