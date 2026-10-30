import { useState } from 'react';
import { OriginScene } from './OriginScene';
import { CodeMark } from './CodeMark';

export function HomeStory({ motion, onStart }: { motion: boolean; onStart: () => void }) {
  const [question, setQuestion] = useState<'behavior' | 'reason'>('behavior');
  const [sourceOpen, setSourceOpen] = useState(false);
  return <div className="home-story">
    <nav className="story-navigation" aria-label="Explore WhyCode"><a href="#connected-context"><span>01</span>Follow the trail<span aria-hidden="true">↓</span></a><a href="#read-the-evidence"><span>02</span>Read the evidence<span aria-hidden="true">↓</span></a><a href="#start-exploring"><span>03</span>Make it yours<span aria-hidden="true">↓</span></a></nav>

    <section className="journey-section journey-evidence" id="connected-context" aria-labelledby="context-title" data-reveal>
      <div className="journey-copy" data-scroll-reveal><p className="journey-eyebrow"><span>01 /</span> THE CONNECTIONS</p><h2 id="context-title">The why lives<br /><em>between things.</em></h2><p>A file is a starting point. A commit shows what changed. A conversation can reveal the choice behind it.</p><p>WhyCode brings those records together, so you can follow a question beyond the current implementation.</p><div className="journey-margin-note"><span aria-hidden="true">↳</span><p>Try the diagram.<br /><strong>One question. Three perspectives.</strong></p></div></div>
      <OriginScene motion={motion} />
    </section>

    <section className="journey-section journey-reading" id="read-the-evidence" aria-labelledby="evidence-title" data-reveal>
      <div className="journey-copy" data-scroll-reveal><p className="journey-eyebrow"><span>02 /</span> THE RECEIPTS</p><h2 id="evidence-title">An explanation.<br /><em>With its evidence.</em></h2><p>Open the source behind a claim. Check the quote. See the difference between a recorded fact and an unanswered question.</p><p>When the evidence doesn’t establish a reason, the useful answer is to say so.</p><a className="journey-next" href="#start-exploring">Bring your own question<span aria-hidden="true">↗</span></a></div>
      <div className="reading-example" data-scroll-reveal><div className="example-topline"><span className="example-led" />AN ILLUSTRATED INVESTIGATION<span>retry.ts</span></div>
        <div className="example-switch" role="group" aria-label="Choose an example question"><button aria-pressed={question === 'behavior'} onClick={() => { setQuestion('behavior'); setSourceOpen(false); }}>What does it do?</button><button aria-pressed={question === 'reason'} onClick={() => { setQuestion('reason'); setSourceOpen(false); }}>Why this limit?</button></div>
        <div className="example-question"><span>THE QUESTION</span><h3>{question === 'behavior' ? 'How many times does this retry?' : 'Why three attempts, rather than five?'}</h3></div>
        <div className={`example-response ${question === 'reason' ? 'example-withheld' : ''}`} key={question}>
          <div className="example-response-label"><span aria-hidden="true">{question === 'behavior' ? '↳' : '?'}</span>{question === 'behavior' ? 'What the code establishes' : 'Where the evidence stops'}</div>
          <p>{question === 'behavior' ? <>This function makes at most three attempts. It returns early if a request succeeds.<button className="example-citation" aria-label="Inspect example source 1" aria-expanded={sourceOpen} aria-controls="example-source" onClick={() => setSourceOpen(value => !value)}>[1]</button></> : 'The code records the limit. It does not record why the team chose it. A linked discussion or design note would be needed to establish that reason.'}</p>
          {question === 'reason' && <span className="example-boundary">Rationale not established by this snippet</span>}
        </div>
        <button className="example-source-toggle" aria-expanded={sourceOpen} aria-controls="example-source" onClick={() => setSourceOpen(value => !value)}><span>{sourceOpen ? 'Close the source' : 'Look at the source'}</span><span aria-hidden="true">{sourceOpen ? '−' : '+'}</span></button>
        <div id="example-source" className="example-source-code" hidden={!sourceOpen}><div><span>retry.ts</span><span>ILLUSTRATIVE CODE</span></div><pre><code>{'for (let attempt = 0; attempt < 3; attempt++) {\n  const result = await request();\n  if (result.ok) return result;\n}\nthrow new Error("Retry limit reached");'}</code></pre></div>
        <p className="example-disclaimer">Illustrated code and explanation. Your investigations use your repository’s indexed sources.</p>
      </div>
    </section>

    <section className="journey-section journey-closing" id="start-exploring" aria-labelledby="start-title" data-reveal>
      <div className="closing-mark" data-scroll-reveal aria-hidden="true"><CodeMark className="closing-code-mark" /></div><p className="journey-eyebrow"><span>03 /</span> YOUR TURN</p><h2 id="start-title" data-scroll-reveal>Bring a question.<br />Leave with <em>context.</em></h2><p>A function you inherited. A decision you’re revisiting.<br />Start with the repository, then pull on a thread.</p><button className="primary closing-action" onClick={onStart}>Explore your repository<span aria-hidden="true">↑</span></button>
      <div className="closing-principles" data-scroll-reveal><div><span aria-hidden="true">↗</span><strong>Start in public.</strong><p>No account needed for public repositories.</p></div><div><span aria-hidden="true">◇</span><strong>Read, without rewriting.</strong><p>Exploration does not change your repository.</p></div><div><span aria-hidden="true">[1]</span><strong>Keep your judgment.</strong><p>Inspect the sources behind important decisions.</p></div></div>
    </section>
  </div>;
}
