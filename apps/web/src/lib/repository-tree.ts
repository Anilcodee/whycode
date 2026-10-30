export type TreeNode = { id: string; type: string; label: string; url?: string };
export type TreeEdge = { from: string; to: string; type: string };
export type TreeGraph = { nodes: TreeNode[]; edges: TreeEdge[] };

/** A stable spanning tree; reverse traversal preserves the real relationship direction. */
export function buildRepositoryTree(graph: TreeGraph, aspect = 1.7) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const root = graph.nodes.find(node => node.type === 'repository')?.id ?? graph.nodes[0]?.id;
  const adjacent = new Map<string, { id: string; edge: number }[]>();
  graph.edges.forEach((edge, index) => {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;
    adjacent.set(edge.from, [...(adjacent.get(edge.from) ?? []), { id: edge.to, edge: index }]);
    adjacent.set(edge.to, [...(adjacent.get(edge.to) ?? []), { id: edge.from, edge: index }]);
  });
  const parent = new Map<string, { id: string; edge: number }>();
  const depth = new Map<string, number>();
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const ordered = [...graph.nodes].sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
  for (const start of [root, ...ordered.map(node => node.id)]) {
    if (!start || depth.has(start)) continue;
    roots.push(start); depth.set(start, 0);
    const queue = [start];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      const neighbors = [...(adjacent.get(id) ?? [])].sort((a, b) => {
        const first = nodes.get(a.id)!, second = nodes.get(b.id)!;
        return first.type.localeCompare(second.type) || first.label.localeCompare(second.label);
      });
      for (const next of neighbors) {
        if (depth.has(next.id)) continue;
        depth.set(next.id, depth.get(id)! + 1); parent.set(next.id, { id, edge: next.edge });
        children.set(id, [...(children.get(id) ?? []), next.id]); queue.push(next.id);
      }
    }
  }
  const positions = new Map<string, { x: number; y: number }>();
  let leaf = 0;
  function place(id: string): number {
    const nested = children.get(id) ?? [];
    const rows = nested.map(place);
    const y = rows.length ? (rows[0] + rows[rows.length - 1]) / 2 : 50 + leaf++ * 112;
    positions.set(id, { x: 30 + depth.get(id)! * 300, y });
    return y;
  }
  roots.forEach(place);
  let packedWidth: number | undefined, packedHeight: number | undefined;
  if (leaf > 8) {
    // Large fan-outs wrap across each depth layer rather than creating one very tall column.
    const levels: string[][] = [];
    function collect(id: string) {
      const level = depth.get(id)!; (levels[level] ??= []).push(id);
      (children.get(id) ?? []).forEach(collect);
    }
    roots.forEach(collect);
    const targetAspect = Math.max(.4, Math.min(4, aspect));
    let bestRows = 1, bestScore = -Infinity;
    const maximum = Math.max(1, ...levels.map(level => level.length));
    for (let rows = 1; rows <= maximum; rows++) {
      const width = 60 + levels.reduce((sum, level) => sum + Math.ceil(level.length / rows) * 246, 0) + (levels.length-1)*70;
      const height = Math.min(rows, maximum) * 112 + 75;
      const score = Math.min(targetAspect / width, 1 / height);
      if (score > bestScore) { bestScore = score; bestRows = rows; }
    }
    packedHeight = bestRows * 112 + 75;
    let left = 30;
    levels.forEach(level => {
      const columns = Math.ceil(level.length / bestRows);
      level.forEach((id, index) => {
        const column = Math.floor(index / bestRows), row = index % bestRows;
        const inColumn = Math.min(bestRows, level.length-column*bestRows);
        positions.set(id, { x:left + column*246, y:38 + (row+(bestRows-inColumn)/2)*112 });
      });
      left += columns*246 + 70;
    });
    packedWidth = left-70+10;
  }
  return { root, roots, nodes, parent, positions, packed: Boolean(packedWidth),
    width: packedWidth ?? Math.max(270, 280 + Math.max(0, ...depth.values()) * 300),
    height: packedHeight ?? Math.max(190, leaf * 112 + 80) };
}

export function repositoryPath(tree: ReturnType<typeof buildRepositoryTree>, selected: string | null) {
  const ids: string[] = [], edges: number[] = [];
  let id = selected;
  while (id && tree.nodes.has(id)) {
    ids.unshift(id);
    const previous = tree.parent.get(id);
    if (!previous) break;
    edges.unshift(previous.edge); id = previous.id;
  }
  return { ids, edges, rooted: ids.length > 0 && ids[0] === tree.root };
}
