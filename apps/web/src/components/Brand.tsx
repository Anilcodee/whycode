import { CodeMark } from './CodeMark';

export function Brand({ onHome }: { onHome?: () => void }) { return <a className="brand" href="/" aria-label="WhyCode home" onClick={event => { if (onHome && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onHome(); } }}><CodeMark className="brand-symbol" /><span>Why<span className="wordmark-code">Code</span></span></a>; }
