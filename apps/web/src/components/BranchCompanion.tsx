import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const PHONE_OR_TOUCH_SCREEN = '(max-width: 767px), (hover: none) and (pointer: coarse)';

/** A decorative git-branch guide. The headline orbit flows into direction-aware scroll routes. */
export function BranchCompanion({ motion, showTrail = true }: { motion: boolean; showTrail?: boolean }) {
  const [hideDecorations, setHideDecorations] = useState(() => window.matchMedia(PHONE_OR_TOUCH_SCREEN).matches);
  useEffect(() => {
    const screen = window.matchMedia(PHONE_OR_TOUCH_SCREEN);
    const update = () => setHideDecorations(screen.matches);
    update();
    screen.addEventListener('change', update);
    return () => screen.removeEventListener('change', update);
  }, []);
  const guide = useRef<HTMLDivElement>(null);
  const surface = useRef<SVGSVGElement>(null);
  const body = useRef<SVGPathElement>(null);
  const orbitBody = useRef<SVGPathElement>(null);
  const orbitGroup = useRef<SVGGElement>(null);
  const scrollGroup = useRef<SVGGElement>(null);
  const orbitCars = useRef<Array<SVGCircleElement | null>>([]);
  const orbitForks = useRef<Array<SVGPathElement | null>>([]);
  const forks = useRef<Array<SVGPathElement | null>>([]);

  
  const cars = useRef<Array<SVGCircleElement | null>>([]);
  useEffect(() => {
    if (!motion || hideDecorations) return;
    let frame = 0, previous = window.scrollY, direction = 1, targetDirection = 1;
    let width = 0, height = 0, pageHeight = 0, cx = 0, cy = 0, rx = 0, ry = 0;
    let lastTime = 0, phase = 0, smoothScroll = window.scrollY, lastMove = -1000;
    let pointer: { x: number; y: number } | null = null;
    let follower: { x: number; y: number } | null = null;
    function wake() {
      if (!frame && !document.hidden) {
        lastTime = 0;
        frame = requestAnimationFrame(paint);
      }
    }
    function follow(event: globalThis.PointerEvent) {
      if (event.pointerType !== 'mouse') return;
      pointer = { x: event.clientX, y: event.clientY };
      lastMove = performance.now();
      guide.current?.classList.add('cursor-following');
      wake();
    }
    function layout() {
      width = document.documentElement.clientWidth; height = window.innerHeight;
      const title = document.querySelector('.hero-title')?.getBoundingClientRect();
      cx = width / 2;
      cy = title ? title.top + window.scrollY + title.height / 2 : height * .38;
      rx = Math.min(width * .43, (title?.width ?? width * .6) / 2 + 80);
      ry = Math.min(height * .3, (title?.height ?? 200) / 2 + 38);
      pageHeight = document.documentElement.scrollHeight;
      surface.current?.setAttribute('viewBox', `0 0 ${width} ${pageHeight}`);
      surface.current?.style.setProperty('height', `${pageHeight}px`);
      wake();
    }
    function paint(now: number) {
      frame = 0;
      const dt = lastTime ? Math.min(40, now - lastTime) : 16;
      lastTime = now; phase += dt * .00014;
      const scroll = window.scrollY;
      const delta = scroll - previous;
      if (Math.abs(delta) > .5) targetDirection = delta > 0 ? 1 : -1;
      previous = scroll;
      direction += (targetDirection - direction) * (1 - Math.exp(-dt / 380));
      smoothScroll += (scroll - smoothScroll) * (1 - Math.exp(-dt / 150));
      const progress = Math.min(1, scroll / Math.max(1, pageHeight - height));
      const blend = Math.max(0, Math.min(1, (scroll - height * .08) / Math.max(200, height * .5)));
      const eased = blend * blend * (3 - 2 * blend);
      orbitGroup.current?.setAttribute('opacity', String(1 - eased));
      scrollGroup.current?.setAttribute('opacity', String(eased));
      const orbitLength = Math.PI * 2 * Math.max(180, rx) * .98;
      function draw(isOrbit: boolean) {
        const length = isOrbit ? orbitLength : Math.min(1000, width * 1.1);
        const pointAt = (distance: number) => {
          if (isOrbit) {
            const angle = phase - distance / Math.max(180, rx);
            const tilt = -.09;
            const x = Math.cos(angle) * rx, y = Math.sin(angle) * ry;
            return { x: cx + x * Math.cos(tilt) - y * Math.sin(tilt),
              y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) };
          }
          // Reversal shifts the lane, never the trail's spacing or orientation.
          const angle = (smoothScroll - distance) * .0025;
          return { x: width * (.5 + direction * .06) + Math.sin(angle) * width * .31,
            y: scroll + height * .52 - distance * .48 };
        };
        const points: string[] = [];
        for (let distance = length; distance >= 0; distance -= 7) {
          const point = pointAt(distance); points.push(`${points.length ? 'L' : 'M'}${point.x},${point.y}`);
        }
        (isOrbit ? orbitBody : body).current?.setAttribute('d', points.join(' '));
        (isOrbit ? orbitCars : cars).current.forEach((car, index) => {
          const distance = index * 65, point = pointAt(distance);
          const span = 85;
          const end = pointAt(distance + span);
          if (car) { car.setAttribute('cx', String(point.x)); car.setAttribute('cy', String(point.y)); car.style.opacity = distance < length ? '1' : '0'; }
          const fork = (isOrbit ? orbitForks : forks).current[index];
          if (fork) {
            const dx = end.x - point.x, dy = end.y - point.y, norm = Math.max(1, Math.hypot(dx, dy));
            const offset = (index % 2 ? 1 : -1) * 26;
            const nx = -dy / norm * offset, ny = dx / norm * offset;
            const start = `M${point.x} ${point.y}`;
            const branch = `${start} C${point.x+nx} ${point.y+ny} ${end.x+nx} ${end.y+ny} ${end.x} ${end.y}`;
            fork.setAttribute('d', branch);
            fork.style.opacity = distance + span < length ? '.45' : '0';
          }
        });
      }
      if (surface.current) {
        if (eased < 1) draw(true);
        if (eased > 0) draw(false);
      }
      const size = width <= 580 ? 20 : width < 1320 ? 30 : 52;
      const gutter = (width - 1320) / 2 + 48;
      const x = width <= 580 ? 0 : width < 1320 ? width - size - 2 : width - gutter / 2 - size / 2;
      const fallbackY = 116 + Math.max(0, height - 240) * progress;
      if (!follower) follower = { x, y: fallbackY };
      const characterHeight = size * 100 / 64;
      const targetX = pointer ? Math.max(5, Math.min(width - size - 5, pointer.x + (pointer.x > width - size - 40 ? -size - 22 : 22))) : x;
      const targetY = pointer ? Math.max(5, Math.min(height - characterHeight - 5, pointer.y + (pointer.y > height - characterHeight - 35 ? -characterHeight - 18 : 18))) : fallbackY;
      const ease = 1 - Math.exp(-dt / 110);
      follower.x += (targetX - follower.x) * ease;
      follower.y += (targetY - follower.y) * ease;
      guide.current?.style.setProperty('transform', `translate3d(${follower.x}px, ${follower.y}px, 0)`);
      if (Math.abs(delta) > .5) lastMove = now;
      guide.current?.classList.toggle('is-travelling', now - lastMove < 160);
      document.documentElement.style.setProperty('--journey-progress', String(progress));
      const following = Math.abs(targetX - follower.x) > .1 || Math.abs(targetY - follower.y) > .1;
      if (showTrail || following || now - lastMove < 180) frame = requestAnimationFrame(paint);
    }
    const observer = new ResizeObserver(layout);
    const main = document.querySelector('.main-content'); if (main) observer.observe(main);
    layout();
    window.addEventListener('resize', layout);
    window.addEventListener('pointermove', follow, { passive: true });
    window.addEventListener('scroll', wake, { passive: true });
    const visibility = () => { cancelAnimationFrame(frame); frame = 0; wake(); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('scroll', wake);
      guide.current?.classList.remove('cursor-following');
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', layout);
      document.removeEventListener('visibilitychange', visibility);
      document.documentElement.style.removeProperty('--journey-progress');
    };
  }, [motion, showTrail, hideDecorations]);
  if (!motion || hideDecorations) return null;
  return <>{createPortal(<div ref={guide} className="branch-companion" aria-hidden="true">
    <svg viewBox="0 0 64 100" fill="none">
      <ellipse cx="32" cy="94" rx="17" ry="3" fill="#246553" opacity=".12" />
      <g className="branch-body">
        <path d="M32 75V30M32 57C32 41 10 49 10 27M32 44C32 25 53 38 53 15" stroke="#246553" strokeWidth="4" strokeLinecap="round" />
        <circle cx="10" cy="24" r="7" fill="#e7ece0" stroke="#246553" strokeWidth="3" />
        <circle cx="53" cy="13" r="7" fill="#d8a080" stroke="#a55b3c" strokeWidth="3" />
        <circle cx="32" cy="30" r="15" fill="#fbfaf4" stroke="#246553" strokeWidth="3" />
        <path d="M27 28v3m10-3v3m-10 5q5 5 10 0" stroke="#246553" strokeWidth="2.3" strokeLinecap="round" />
        <path className="branch-foot foot-left" d="M32 74 22 86h-7" stroke="#246553" strokeWidth="4" strokeLinecap="round" />
        <path className="branch-foot foot-right" d="m32 74 10 12h7" stroke="#246553" strokeWidth="4" strokeLinecap="round" />
      </g>
    </svg>
  </div>, document.body)}{showTrail && <svg ref={surface} className="history-snake" fill="none" aria-hidden="true">
    <g ref={orbitGroup} className="snake-orbit"><path ref={orbitBody} className="snake-spine" />
      {Array.from({length:64}, (_, index) => <g key={index}>
        {index % 5 === 1 && <path ref={element => { orbitForks.current[index] = element; }} className={`snake-fork branch-kind-${index % 4}`} />}
        <circle ref={element => { orbitCars.current[index] = element; }} r={index === 0 ? 8 : 4} className={index === 0 ? 'snake-head' : 'snake-commit'} />
      </g>)}
    </g>
    <g ref={scrollGroup} className="snake-scroll" opacity="0"><path ref={body} className="snake-spine" />
      {Array.from({length:16}, (_, index) => <g key={index}>
        {index % 4 === 1 && <path ref={element => { forks.current[index] = element; }} className="snake-fork" />}
        <circle ref={element => { cars.current[index] = element; }} r={index === 0 ? 8 : 4} className={index === 0 ? 'snake-head' : 'snake-commit'} />
      </g>)}
    </g>
  </svg>}</>;
}


