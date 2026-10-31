import type { ReactNode } from 'react';

export function LoadingIndicator({ children }: { children: ReactNode }) {
  return <div className="loading-indicator" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /><span>{children}</span></div>;
}
