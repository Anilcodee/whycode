export function SourceCode({ content, firstLine }: { content: string; firstLine: number }) {
  return <code className="source-code">{content.split('\n').map((line, index) => <span className={`code-line ${/^\s*(?:\/\/|\/\*|\*|#)/.test(line) ? 'code-comment' : line.includes('return ') ? 'code-return' : ''}`} key={index}><span className="line-number" aria-hidden="true">{firstLine + index}</span><span>{line || ' '}</span></span>)}</code>;
}
