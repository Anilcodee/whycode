import { PointerEvent, useRef, useState } from 'react';

const steps = [
  { name: 'Code', title: 'What the code does', description: 'A function retries a request three times. The implementation tells you what happens.' },
  { name: 'Change', title: 'When the choice appeared', description: 'A commit introduces the limit. The diff connects the current code to a particular change.' },
  { name: 'Discussion', title: 'Where the reason lives', description: 'A linked discussion may explain the tradeoff. If the records do not establish a reason, WhyCode says so.' },
];
export function OriginScene({ motion = true }: { motion?: boolean }) {
  const [active, setActive] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (!motion || event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
    stage.current?.style.setProperty('--orbit-x', `${-y * 4}deg`);
    stage.current?.style.setProperty('--orbit-y', `${x * 5}deg`);
  }
  function reset() { stage.current?.style.setProperty('--orbit-x', '0deg'); stage.current?.style.setProperty('--orbit-y', '0deg'); }
  return <figure className="origin-scene evidence-object" data-scroll-reveal aria-label="Interactive illustrated example of tracing code to its history">
    <div className="object-question"><span>A QUESTION WORTH ASKING</span><p>Why stop at <em>three retries?</em></p></div>
    <div ref={stage} className={`evidence-universe focus-${active}`} onPointerMove={tilt} onPointerLeave={reset} aria-hidden="true">
      <svg className="orbit-map" viewBox="0 0 520 385" fill="none">
        <defs>
          <radialGradient id="orbit-core" cx=".32" cy=".24" r=".85"><stop stopColor="#fffefa" /><stop offset=".48" stopColor="#eeeadd" /><stop offset=".82" stopColor="#cbd3bf" /><stop offset="1" stopColor="#a2b49a" /></radialGradient>
          <radialGradient id="orbit-code" cx=".3" cy=".22" r=".85"><stop stopColor="#c2d6bb" /><stop offset=".6" stopColor="#67916f" /><stop offset="1" stopColor="#345e46" /></radialGradient>
          <radialGradient id="orbit-commit" cx=".3" cy=".22" r=".85"><stop stopColor="#f9e3b3" /><stop offset=".65" stopColor="#c5a165" /><stop offset="1" stopColor="#9a743e" /></radialGradient>
          <radialGradient id="orbit-discussion" cx=".3" cy=".22" r=".85"><stop stopColor="#f6d9c4" /><stop offset=".65" stopColor="#c28b6c" /><stop offset="1" stopColor="#9c6249" /></radialGradient>
          <linearGradient id="orbit-rim" x1="204" y1="128" x2="306" y2="227" gradientUnits="userSpaceOnUse"><stop stopColor="#fffefa" /><stop offset=".5" stopColor="#b4c0a8" /><stop offset="1" stopColor="#f8f6ed" /></linearGradient>
        </defs>
        <ellipse className="universe-shadow" cx="261" cy="313" rx="118" ry="13" />
        <g className="orbit-guides"><path d="M40 178h16m408 0h16M260 24v14m0 300v11" /><circle cx="260" cy="178" r="153" strokeDasharray="1 10" /></g>
        <ellipse className={`orbital-ring ring-code ${active === 0 ? 'ring-selected' : ''}`} cx="260" cy="178" rx="184" ry="74" transform="rotate(25 260 178)" />
        <ellipse className={`orbital-ring ring-commit ${active === 1 ? 'ring-selected' : ''}`} cx="260" cy="178" rx="184" ry="74" transform="rotate(-25 260 178)" />
        <ellipse className={`orbital-ring ring-discussion ${active === 2 ? 'ring-selected' : ''}`} cx="260" cy="178" rx="111" ry="151" transform="rotate(28 260 178)" />
        <ellipse className="orbital-current" cx="260" cy="178" rx="184" ry="74" transform="rotate(-25 260 178)" />
        <g className="central-lens"><circle cx="262" cy="183" r="62" fill="#5d70511a" /><circle cx="260" cy="178" r="61" fill="url(#orbit-rim)" /><circle cx="260" cy="178" r="56" fill="url(#orbit-core)" /><path className="lens-glint" d="M219 159a45 45 0 0 1 56-23" /><text className="lens-mark" x="260" y="190" textAnchor="middle">{'<?>'}</text></g>
        <g className="orbital-node code-orb" data-highlight={active === 0}><circle className="orb-aura" cx="108" cy="103" r="32" /><ellipse className="orb-shadow" cx="111" cy="124" rx="23" ry="5" /><circle cx="108" cy="103" r="22" fill="url(#orbit-code)" /><path className="orb-symbol" d="m104 96-6 7 6 7m8-14 6 7-6 7" /><path className="orb-label-line" d="M102 79V78H86" /><text className="orb-label" x="62" y="44">Code</text><text className="orb-detail" x="62" y="68">retry.ts</text></g>
        <g className="orbital-node commit-orb" data-highlight={active === 1}><circle className="orb-aura" cx="428" cy="143" r="29" /><ellipse className="orb-shadow" cx="430" cy="162" rx="19" ry="4" /><circle cx="428" cy="143" r="19" fill="url(#orbit-commit)" /><circle className="orb-symbol" cx="428" cy="143" r="5" /><path className="orb-symbol" d="M417 143h6m10 0h6" /><path className="orb-label-line" d="M436 164v28h30" /><text className="orb-label" x="466" y="212" textAnchor="end">Commit</text><text className="orb-detail" x="466" y="236" textAnchor="end">The change</text></g>
        <g className="orbital-node discussion-orb" data-highlight={active === 2}><circle className="orb-aura" cx="187" cy="286" r="30" /><ellipse className="orb-shadow" cx="189" cy="305" rx="20" ry="4" /><circle cx="187" cy="286" r="20" fill="url(#orbit-discussion)" /><path className="orb-symbol" d="M179 280h16v10h-7l-5 4v-4h-4z" /><path className="orb-label-line" d="M166 290h-34v29H97" /><text className="orb-label" x="49" y="337">Discussion</text><text className="orb-detail" x="49" y="361">The reasoning</text></g>
        <text className="universe-caption" x="345" y="338">Context, connected.</text>
      </svg>
    </div>
    <div className="object-steps" role="tablist" aria-label="Explore the illustrated evidence trail">
      {steps.map((step, index) => <button key={step.name} id={`object-step-${index}`} ref={element => { buttons.current[index] = element; }} role="tab" aria-selected={active === index} aria-controls="object-explanation" tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : undefined;
        if (next !== undefined) { event.preventDefault(); setActive(next); buttons.current[next]?.focus(); }
      }}><span>0{index + 1}</span>{step.name}<i aria-hidden="true">{index === 2 ? '↗' : '→'}</i></button>)}
    </div>
    <div id="object-explanation" className="object-explanation" role="tabpanel" aria-labelledby={`object-step-${active}`}><strong>{steps[active].title}</strong><p>{steps[active].description}</p></div>
    <figcaption><span>Illustrated example. Your answers use your repository’s sources.</span></figcaption>
  </figure>;
}
