import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitTree, placeTreeLabel, treeConnector, zoomTree } from '../src/lib/tree-viewport';

test('zoom preserves the point beneath the cursor and the camera aspect ratio', () => {
  const view = { x:20, y:30, width:1000, height:600 }, anchor = { x:240, y:170 };
  const next = zoomTree(view, 1.5, anchor, 1000);
  assert.ok(Math.abs((anchor.x-view.x)/view.width - (anchor.x-next.x)/next.width) < 1e-10);
  assert.ok(Math.abs((anchor.y-view.y)/view.height - (anchor.y-next.y)/next.height) < 1e-10);
  assert.ok(Math.abs(next.height / next.width - .6) < 1e-10);
});
test('zoom is bounded and zooming in then out recovers the view', () => {
  const view = { x:0, y:0, width:1000, height:600 }, anchor = { x:500,y:300 };
  assert.equal(zoomTree(view, 100, anchor, 1000).width, 250);
  assert.ok(Math.abs(zoomTree(view, .001, anchor, 1000).width - 1000/.35) < 1e-9);
  const next = zoomTree(zoomTree(view, 1.25, anchor, 1000), 1/1.25, anchor, 1000);
  assert.deepEqual(next, view);
});
test('Fit all includes nodes dragged outside the original tree and their raised surfaces', () => {
  const points = [{x:-600,y:800}, {x:1300,y:-200}];
  const view = fitTree(points);
  for (const point of points) {
    assert.ok(point.x >= view.x && point.x+220 <= view.x+view.width);
    assert.ok(point.y >= view.y && point.y+100 <= view.y+view.height);
  }
});
test('connections follow moved nodes, including nodes moved above or left of their parent', () => {
  const parent = {x:300,y:300};
  const left = treeConnector(parent, {x:0,y:300});
  assert.ok(left.d.startsWith('M300 334'));
  assert.ok(left.d.endsWith('210 334'));
  const above = treeConnector(parent, {x:300,y:0});
  assert.ok(above.d.startsWith('M405 300'));
  assert.ok(above.d.endsWith('405 68'));
  assert.notEqual(treeConnector(parent, {x:700,y:400}).d, treeConnector(parent, {x:800,y:500}).d);
});


test('relationship captions move out of card faces and avoid other captions', () => {
  const nodes = [{x:100,y:100},{x:400,y:100}];
  const first = placeTreeLabel({x:180,y:140}, 'contains', nodes);
  const second = placeTreeLabel({x:180,y:140}, 'changed', nodes, [first]);
  const overlaps = (a, b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
  for (const label of [first, second]) for (const node of nodes) assert.equal(overlaps(label,{...node,width:219,height:80}), false);
  assert.equal(overlaps(first,second), false);
  assert.ok(first.width >= 100 && first.height >= 24);
});
