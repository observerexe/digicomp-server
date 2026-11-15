import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/** A button with a drop-down: closes on Escape, on a click outside and after a choice. */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
  };
  return { open, setOpen, root, onKeyDown };
}
