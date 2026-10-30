import type { ReactNode } from 'react';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    branch: <><circle cx="6" cy="5" r="2.5" /><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M6 8v8m0-3c0-5 12 1 12-5" /></>,
    book: <path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2Z" />,
    github: <path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .1-2-1-3 4 0 6-2 6-5 0-2-1-3-1-3 0-1 0-3-1-4-2 0-3 1-3 1a14 14 0 0 0-6 0S7 3 5 3C4 4 4 6 5 7c-1 1-1 2-1 3 0 3 2 5 6 5-1 1-1 2-1 3v4" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    file: <path d="M14 2H5v20h14V7Zm0 0v6h5M8 12h8m-8 4h6" />,
    link: <path d="m9 15 6-6m-7 3-2 2a4 4 0 0 0 6 6l2-2m-2-12 2-2a4 4 0 0 1 6 6l-2 2" />,
    layers: <path d="m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5M3 18l9 5 9-5" />,
    code: <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    plus: <path d="M12 5v14M5 12h14" />,
    external: <path d="M14 3h7v7m0-7L10 14M10 4H3v17h17v-7" />,
    shield: <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z" /><path d="m8 12 3 3 5-6" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></>,
    refresh: <path d="M20 7a9 9 0 1 0 1 8M20 2v6h-6" />,
    spark: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    logout: <path d="M9 3H3v18h6m6-15 6 6-6 6m-7-6h13" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.file}</svg>;
}
