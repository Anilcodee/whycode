import { PointerEvent as ReactPointerEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildRepositoryTree, repositoryPath, TreeGraph } from '../lib/repository-tree';
import { fitTree, placeTreeLabel, treeConnector, TreePoint, TreeViewport, zoomTree } from '../lib/tree-viewport';

export function RepositoryTree({ graph }: { graph: TreeGraph }) {
  const [aspect, setAspect] = useState(1.7);
  const stage = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildRepositoryTree(graph, aspect), [graph, aspect]);
  useEffect(() => {
    const element = stage.current; if (!element) return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect; if (!box?.height || !box.width) return;
      const next = box.width / box.height;
      setAspect(previous => Math.abs(previous-next) > .04 ? next : previous);
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const marker = useId();
  const instructions = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [moved, setMoved] = useState<Record<string, TreePoint>>({});
  const [view, setView] = useState<TreeViewport | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; node: string | null; start: TreePoint; position: TreePoint; view: TreeViewport; inverse: DOMMatrix } | null>(null);
  const initial = useMemo(() => ({ x:0, y:0, width:tree.width, height:tree.height }), [tree]);
  const camera = view ?? initial;
  const positions = new Map([...tree.positions].map(([id, position]) => [id, moved[id] ?? position]));
  const zoom = tree.width / camera.width;
  useEffect(() => { setMoved({}); setView(null); setSelected(null); }, [graph]);
  useEffect(() => { setView(null); }, [aspect]);
  function zoomBy(factor: number) {
    setView(previous => { const current = previous ?? initial;
      return zoomTree(current, factor, { x:current.x+current.width/2, y:current.y+current.height/2 }, tree.width); });
  }
  function fit() { setView(fitTree(positions.values())); }
  function reset() { setMoved({}); setView(null); }
  useEffect(() => {
    const element = svg.current;
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      const matrix = element?.getScreenCTM(); if (!matrix) return;
      event.preventDefault();
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1);
      setView(previous => zoomTree(previous ?? initial, Math.exp(-Math.max(-200, Math.min(200, pixels))*.003), point, tree.width));
    }
    element?.addEventListener('wheel', wheel, { passive:false });
    return () => element?.removeEventListener('wheel', wheel);
  }, [initial, tree.width]);
  function startDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const matrix = svg.current?.getScreenCTM(); if (!matrix) return;
    const id = (event.target as Element).closest('.tree-card')?.getAttribute('data-node-id') ?? null;
    const inverse = matrix.inverse(), point = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    drag.current = { pointer:event.pointerId, node:id, start:point, position:id ? positions.get(id)! : {x:0,y:0}, view:camera, inverse };
    if (id) setSelected(id);
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); event.preventDefault();
  }
  function moveDrag(event: ReactPointerEvent<SVGSVGElement>) {
    const current = drag.current; if (!current || current.pointer !== event.pointerId) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(current.inverse);
    const dx = point.x-current.start.x, dy = point.y-current.start.y;
    if (current.node) { const id = current.node; setMoved(previous => ({...previous, [id]:{x:current.position.x+dx,y:current.position.y+dy}})); }
    else setView({...current.view, x:current.view.x-dx, y:current.view.y-dy});
  }
  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const path = repositoryPath(tree, selected);
  const active = new Set(path.ids), activeEdges = new Set(path.edges);
  const selectedNode = selected ? tree.nodes.get(selected) : undefined;
  const relationLabels: {text:string;x:number;y:number;width:number;height:number}[] = [];
  for (const [id, parent] of tree.parent) {
    if (!activeEdges.has(parent.edge)) continue;
    const connector = treeConnector(positions.get(parent.id)!, positions.get(id)!, tree.packed && Object.keys(moved).length === 0);
    const text = graph.edges[parent.edge].type.toLowerCase().replace(/_/g, ' ');
    relationLabels.push({...placeTreeLabel(connector, text, positions.values(), relationLabels),text});
  }
  return <div className="repository-tree">
    <div className="tree-toolbar"><div><strong>Repository tree</strong><span>Drag cards to arrange your view</span></div><div className="tree-controls" role="group" aria-label="Tree view controls"><button type="button" aria-label="Zoom out" disabled={zoom <= .351} onClick={() => zoomBy(1/1.25)}>−</button><output aria-label="Tree zoom level">{Math.round(zoom*100)}%</output><button type="button" aria-label="Zoom in" disabled={zoom >= 3.999} onClick={() => zoomBy(1.25)}>+</button><button type="button" onClick={fit}>Fit all</button><button type="button" onClick={reset}>Reset layout</button><button type="button" disabled={!selected} onClick={() => setSelected(null)}>Clear highlight</button></div></div>
    <p className="tree-gesture-guide" id={instructions}>Drag a card to move it · Drag empty space to pan · Ctrl/⌘ + scroll to zoom · Arrow keys move a focused card</p>
    <div ref={stage} className={`tree-stage ${tree.packed ? 'is-packed' : ''} ${dragging ? 'is-dragging' : ''}`} aria-label="Interactive repository tree">
      <svg ref={svg} viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`} preserveAspectRatio="xMidYMid meet" role="group" tabIndex={0} aria-label="Repository sources and their root connections" aria-describedby={instructions} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current=null; setDragging(false); }} onKeyDown={event => { if (event.key==='+' || event.key==='=') { event.preventDefault(); zoomBy(1.25); } else if (event.key==='-') { event.preventDefault(); zoomBy(1/1.25); } else if (event.key==='0') { event.preventDefault(); fit(); } }}>
        <defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="m1 1 6 3-6 3" fill="none" stroke="context-stroke" strokeWidth="1.3" /></marker></defs>
        {[...tree.parent].sort((a, b) => Number(activeEdges.has(a[1].edge)) - Number(activeEdges.has(b[1].edge))).map(([id, parent]) => {
          const from = positions.get(parent.id)!, to = positions.get(id)!;
          const connector = treeConnector(from, to, tree.packed && Object.keys(moved).length === 0);
          const edge = graph.edges[parent.edge];
          return <g key={id} className={`tree-branch ${activeEdges.has(parent.edge) ? 'on-path' : ''}`}>
            <path d={connector.d} markerEnd={edge.from === parent.id ? `url(#${marker})` : undefined} markerStart={edge.from !== parent.id ? `url(#${marker})` : undefined} />
          </g>;
        })}
        {graph.nodes.map(node => {
          const position = positions.get(node.id)!;
          const displayLabel = node.type === 'file' ? node.label.split('/').pop() || node.label : node.label;
          return <g key={node.id} role="button" tabIndex={0} aria-label={`Highlight path to ${node.label}`} aria-pressed={selected === node.id} data-node-id={node.id} data-type={node.type} className={`tree-card ${active.has(node.id) ? 'on-path' : ''} ${selected === node.id ? 'selected' : ''}`} onClick={() => setSelected(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(node.id); } else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 30 : 10; setMoved(previous => { const current = previous[node.id] ?? tree.positions.get(node.id)!; return {...previous,[node.id]:{x:current.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),y:current.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)}}; }); } }}>
            <title>{`${node.label} · ${node.type.replace(/_/g, ' ')}`}</title>
            <ellipse className="tree-shadow" cx={position.x+111} cy={position.y+86} rx={108} ry={9} />
            <rect className="tree-depth" x={position.x+7} y={position.y+9} width={210} height={68} rx={10} />
            <rect className="tree-face" x={position.x} y={position.y} width={210} height={68} rx={10} />
            <path className="tree-glint" d={`M${position.x+14} ${position.y+4} H${position.x+193}`} />
            <text className="tree-type" x={position.x+15} y={position.y+22}>{node.type.replace(/_/g, ' ')}</text>
            <text className="tree-label" x={position.x+15} y={position.y+47}>{displayLabel.length > 25 ? `${displayLabel.slice(0,24)}…` : displayLabel}</text>
          </g>;
        })}
        <g className="tree-label-overlay" aria-hidden="true">{relationLabels.map((label,index) => <g className="tree-relation" key={index}><rect x={label.x} y={label.y} width={label.width} height={label.height} rx={6} /><text x={label.x+label.width/2} y={label.y+label.height/2+4.5} textAnchor="middle">{label.text}</text></g>)}</g>
      </svg>
    </div>
    <div className="tree-selection" aria-live="polite"><strong>{selectedNode ? selectedNode.label : 'Select any source to trace its path.'}</strong><p>{selectedNode ? path.rooted ? path.ids.map(id => tree.nodes.get(id)!.label).join(' → ') : 'This source has no recorded connection to the repository root in this overview.' : 'Arrange the cards however you like. Copper highlights show the route from the repository to your selection.'}</p></div>
    <div className="tree-summary"><span>{graph.nodes.length} sources · {graph.edges.length} recorded connections</span><span>{tree.roots.length > 1 ? `${tree.roots.length - 1} disconnected source groups` : 'Fit all brings every source back into view'}</span></div>
    <details className="graph-text"><summary>Read all recorded relationships</summary><div className="connection-edges">{graph.edges.map((edge, index) => <div key={index}><span>{tree.nodes.get(edge.from)?.label ?? edge.from}</span><small>{edge.type.toLowerCase().replace(/_/g, ' ')}</small><span>→</span><span>{tree.nodes.get(edge.to)?.label ?? edge.to}</span></div>)}</div></details>
    <p className="tree-coverage">This is the indexed overview of recent commits and their linked sources. The tree uses one route per source; all recorded relationships are available below.</p>
  </div>;
}
