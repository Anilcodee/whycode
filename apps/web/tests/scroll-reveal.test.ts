import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeScrollReveals } from '../src/lib/scroll-reveal';

function fixture() {
  const attributes = new Map<string, string>();
  const element = { setAttribute:(name:string,value:string)=>attributes.set(name,value), removeAttribute:(name:string)=>attributes.delete(name), getAttribute:(name:string)=>attributes.get(name) ?? null } as unknown as Element;
  const root = { querySelectorAll:()=>[element] } as unknown as Pick<Document,'querySelectorAll'>;
  return {attributes,element,root};
}

test('reveals entering content and removes the pending state when observation ends', () => {
  const {attributes,element,root} = fixture();
  let callback!: IntersectionObserverCallback;
  const observed = new Set<Element>();
  let disconnected = false;
  class Observer {
    constructor(next:IntersectionObserverCallback) {callback=next;}
    observe(target:Element) {observed.add(target);}
    unobserve(target:Element) {observed.delete(target);}
    disconnect() {disconnected=true;}
  }
  const cleanup=observeScrollReveals(root,true,Observer as unknown as typeof IntersectionObserver);
  assert.equal(attributes.get('data-reveal-pending'),'true');
  assert.ok(observed.has(element));
  callback([{target:element,isIntersecting:true} as IntersectionObserverEntry], {} as IntersectionObserver);
  assert.equal(attributes.get('data-visible'),'true');
  assert.equal(attributes.has('data-reveal-pending'),false);
  assert.equal(observed.has(element),false);
  cleanup();
  assert.equal(disconnected,true);
});

test('cleanup cannot leave offscreen content hidden after a route or readiness change', () => {
  const {attributes,root}=fixture();
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const cleanup=observeScrollReveals(root,true,Observer as unknown as typeof IntersectionObserver);
  assert.equal(attributes.has('data-reveal-pending'),true);
  cleanup();
  assert.equal(attributes.has('data-reveal-pending'),false);
});

test('reduced motion, missing observers and setup failure leave content readable', () => {
  class BrokenObserver { observe() {throw new Error('Observer unavailable');} disconnect() {} }
  for (const [motion,Observer] of [[false,undefined],[true,undefined],[true,BrokenObserver]] as const) {
    const {root,attributes}=fixture();
    observeScrollReveals(root,motion,Observer as typeof IntersectionObserver | undefined);
    assert.equal(attributes.get('data-visible'),'true');
    assert.equal(attributes.has('data-reveal-pending'),false);
  }
});
