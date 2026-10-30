import type { Answer } from '../types/workspace';
import { Icon } from './Icon';
import { EvidenceTrail } from './EvidenceTrail';
import { richText, SourceLink } from './SourcePresentation';

type Props = {
  answer: Answer;
  copied: boolean;
  onCopy: () => Promise<void>;
  inspectSource: (id: string | null) => void;
};

export function AnswerView({ answer, copied, onCopy, inspectSource }: Props) {
  const paragraphs = (answer.translatedAnswer ?? answer.answer ?? answer.abstentionReason ?? '').split(/\n\n+/);
  const citedEvidence = answer.evidence.filter(item => answer.citedEvidenceIds.includes(item.id));

  return <>
    <div className="explanation-heading">
      <span className={`answer-icon ${answer.abstained ? 'abstained' : ''}`}>
        <Icon name={answer.abstained ? 'search' : 'check'} size={20} />
      </span>
      <div>
        <p className="eyebrow">{answer.abstained ? 'INSUFFICIENT EVIDENCE' : 'THE EXPLANATION'}</p>
        <h2>{answer.abstained ? 'The evidence stops here.' : 'What the sources tell us.'}</h2>
      </div>
      {!answer.abstained && (
        <button className="icon-button copy-button" aria-label="Copy answer" onClick={onCopy}>
          <Icon name={copied ? 'check' : 'copy'} size={17} />
        </button>
      )}
    </div>
    <div className="answer-prose">
      {paragraphs.map((paragraph, index) => <p key={index}>{richText(paragraph, answer.evidence)}</p>)}
    </div>
    <EvidenceTrail evidence={citedEvidence} onInspect={inspectSource} />
    {answer.translatedAnswer && (
      <details className="original-answer">
        <summary>Read the original English answer</summary>
        <p>{richText(answer.answer ?? answer.abstentionReason ?? '', answer.evidence)}</p>
      </details>
    )}
    <section className="answer-review" aria-label="Evidence checks and limitations">
      <h3>Evidence checks</h3>
      <div className="answer-assessment">
        <span className={`assessment-badge ${answer.abstained ? 'neutral' : ''}`}>
          <Icon name={answer.abstained ? 'info' : 'shield'} size={14} />
          {answer.abstained ? 'Explanation withheld' : 'Quotes checked · Model reviewed'}
        </span>
        <span className="temporal-badge"><Icon name="clock" size={13} />{answer.temporalStatus}</span>
      </div>
      <p className="assessment-reason">{answer.confidence.reason}</p>
      {answer.temporalReason && <p className="temporal-reason">{answer.temporalReason}</p>}
    </section>
    {answer.validation && answer.validation.claims.length > 0 && (
      <details className="claim-details">
        <summary>Why this answer is supported<Icon name="chevron" size={14} /></summary>
        {answer.validation.claims.map((claim, index) => (
          <div key={index}>
            <p>{richText(claim.text, answer.evidence)}</p>
            {claim.quotes.map((quote, number) => (
              <blockquote key={number}>
                {quote.quote}
                <button onClick={() => inspectSource(quote.evidenceId)}>Inspect source <Icon name="arrow" size={12} /></button>
              </blockquote>
            ))}
          </div>
        ))}
        <small>Model review can miss errors. Verify important decisions against the source.</small>
      </details>
    )}
    {answer.externalContext && (
      <div className="web-reading">
        <h3>Further reading <span>WEB CONTEXT</span></h3>
        <p>Background reading, separate from repository evidence.</p>
        {answer.externalContext.map((item, index) => (
          <SourceLink key={index} source={item.url}><Icon name="external" size={14} />{item.title}</SourceLink>
        ))}
      </div>
    )}
  </>;
}
