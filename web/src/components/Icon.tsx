const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  board: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16M15 4v16',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2',
  lab: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3',
  user: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  pen: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v6M12 7.5v.5',
  back: 'm15 6-6 6 6 6',
  users: 'M9 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM2.5 20c1.2-3.5 3.6-5.5 6.5-5.5s5.3 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.8c1.7.7 2.9 2.4 3.5 5.2',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.8-4.8',
  chevron: 'm9 6 6 6-6 6',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  alignJustify: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  listBullet: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  listOrdered: 'M10 6h10M10 12h10M10 18h10M4 4h1.5v4M4 8h3M4 14.5a1.5 1.5 0 0 1 3 0c0 1.5-3 2-3 3.5h3',
  indent: 'M4 6h16M11 10h9M11 14h9M4 18h16M4 9.5 7 12l-3 2.5',
  outdent: 'M4 6h16M11 10h9M11 14h9M4 18h16M7 9.5 4 12l3 2.5',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  pageBreak: 'M6 3v5h12V3M6 21v-5h12v5M3 12h2M8 12h2M14 12h2M19 12h2',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 8.5h.01',
  heading: 'M6 4v16M18 4v16M6 12h12',
  paragraph: 'M4 6h16M4 10h16M4 14h16M4 18h10',
  textField: 'M3 7h18v10H3zM7 10v4',
  zone: 'M4 7V4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M8 10h8M8 14h5',
  number: 'M5 9h15M4 15h15M10 4 8 20M16 4l-2 16',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  choice: 'M3 7h18v10H3zM14 11l2 2 2-2',
  checkbox: 'M4 4h16v16H4zM8 12l3 3 5-6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  header: 'M4 4h16v6H4zM4 14h16M4 18h10',
  footer: 'M4 14h16v6H4zM4 6h16M4 10h10',
  branch: 'M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9c0 5-6 4-11.2 6.6',
  more: 'M5 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2zM12 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2zM19 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2z',
};

export type IconName = keyof typeof PATHS;

/** Line icons (stroke 2), decorative: pair with visible text or aria-label. */
export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
