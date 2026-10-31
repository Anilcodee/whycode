/** Content stays visible unless a working observer has opted it into a reveal. */
export function observeScrollReveals(root: Pick<Document, 'querySelectorAll'>, motion: boolean,
  Observer: typeof IntersectionObserver | undefined = globalThis.IntersectionObserver) {
  const elements = Array.from(root.querySelectorAll('[data-reveal], [data-scroll-reveal]'));
  const show = (element: Element) => {
    element.setAttribute('data-visible', 'true');
    element.removeAttribute('data-reveal-pending');
  };
  let observer: IntersectionObserver | undefined;
  if (!motion || !Observer) elements.forEach(show);
  else {
    try {
      observer = new Observer(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
          show(entry.target);
          observer?.unobserve(entry.target);
        }
      }, { threshold: 0 });
      for (const element of elements) {
        if (element.getAttribute('data-visible') === 'true') continue;
        observer.observe(element);
        element.setAttribute('data-reveal-pending', 'true');
      }
    } catch {
      observer?.disconnect();
      elements.forEach(show);
    }
  }
  return () => {
    observer?.disconnect();
    elements.forEach(element => element.removeAttribute('data-reveal-pending'));
  };
}
