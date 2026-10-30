export type TreeViewport = { x: number; y: number; width: number; height: number };
export type TreePoint = { x: number; y: number };

export function zoomTree(view: TreeViewport, factor: number, anchor: TreePoint, baseWidth: number): TreeViewport {
  const zoom = Math.max(.35, Math.min(4, baseWidth / view.width * factor));
  const width = baseWidth / zoom, ratio = width / view.width;
  return { x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio,
    width, height: view.height * ratio };
}

export function fitTree(positions: Iterable<TreePoint>): TreeViewport {
  const points = [...positions];
  if (!points.length) return { x: 0, y: 0, width: 300, height: 200 };
  const x = Math.min(...points.map(point => point.x)) - 35;
  const y = Math.min(...points.map(point => point.y)) - 40;
  return { x, y, width: Math.max(300, Math.max(...points.map(point => point.x)) + 255 - x),
    height: Math.max(200, Math.max(...points.map(point => point.y)) + 120 - y) };
}

export function treeConnector(from: TreePoint, to: TreePoint, packed = false) {
  if (packed) {
    // Packed columns share clear row gutters; route above cards instead of through them.
    const startX = from.x + 210, startY = from.y + 34;
    const laneX = from.x + 232, rowY = to.y - 14, endX = to.x + 105;
    return { d: `M${startX} ${startY} H${laneX} V${rowY} H${endX} V${to.y}`,
      x:(laneX+endX)/2, y:rowY };
  }
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) < 240 && Math.abs(dy) > 100) {
    const down = dy > 0, x1 = from.x + 105, x2 = to.x + 105;
    const y1 = from.y + (down ? 68 : 0), y2 = to.y + (down ? 0 : 68), mid = (y1 + y2) / 2;
    return { d: `M${x1} ${y1} C${x1} ${mid},${x2} ${mid},${x2} ${y2}`, x: (x1+x2)/2, y: mid-14 };
  }
  const right = dx >= 0, x1 = from.x + (right ? 210 : 0), x2 = to.x + (right ? 0 : 210);
  const y1 = from.y + 34, y2 = to.y + 34, mid = (x1 + x2) / 2;
  return { d: `M${x1} ${y1} C${mid} ${y1},${mid} ${y2},${x2} ${y2}`, x: mid, y: (y1+y2)/2-17 };
}

export function placeTreeLabel(anchor: TreePoint, text: string, nodes: Iterable<TreePoint>, placed: {x:number;y:number;width:number;height:number}[] = []) {
  const width = Math.max(100, text.length * 7.6 + 24), height = 24;
  const obstacles = [...nodes].map(point => ({x:point.x,y:point.y,width:219,height:80}));
  const offsets = [{x:0,y:0}, ...[28,56,84,112,168,224].flatMap(distance => [
    {x:0,y:-distance},{x:0,y:distance},{x:-distance,y:0},{x:distance,y:0},
    {x:-distance,y:-distance},{x:distance,y:distance}])];
  for (const offset of offsets) {
    const box = {x:anchor.x + offset.x - width/2,y:Math.max(3,anchor.y+offset.y-height/2),width,height};
    if (![...obstacles,...placed].some(other => box.x < other.x+other.width && box.x+box.width > other.x && box.y < other.y+other.height && box.y+box.height > other.y)) return box;
  }
  return {x:anchor.x-width/2,y:Math.max(3,anchor.y-height/2),width,height};
}
