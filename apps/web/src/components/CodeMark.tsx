export function CodeMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 70 46" fill="none" aria-hidden="true">
    <path className="mark-bracket mark-left" d="M18 9 5 23l13 14" />
    <path className="mark-question" stroke="#a55b3c" d="M28 16a7 7 0 0 1 14 0c0 5-7 5-7 11" />
    <circle className="mark-dot" cx="35" cy="34" r="1.8" fill="currentColor" stroke="none" />
    <path className="mark-bracket mark-right" d="m52 9 13 14-13 14" />
  </svg>;
}
