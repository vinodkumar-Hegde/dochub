import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

type Props = {
  label: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  children: ReactNode;
};

/** A viewport-anchored menu, outside scrollable tables. Only one instance is open at a time. */
export function UploadsActionMenu({ label, open, onOpenChange, children }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(268, window.innerWidth - 24);
    const estimatedHeight = Math.min(410, window.innerHeight - 24);
    const below = window.innerHeight - rect.bottom;
    const top = below >= Math.min(estimatedHeight, 230)
      ? Math.min(rect.bottom + 6, window.innerHeight - 32)
      : Math.max(12, rect.top - estimatedHeight - 6);
    const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
    setPosition({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) onOpenChange(false);
    };
    const dismissOnScroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', dismissOutside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', dismissOnScroll);
    window.addEventListener('scroll', dismissOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', dismissOutside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', dismissOnScroll);
      window.removeEventListener('scroll', dismissOnScroll, true);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open && position && menu.current) {
      menu.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }, [open, position]);

  return <>
    <button ref={trigger} type="button" className="upload-kebab" title={label} aria-label={label}
      aria-haspopup="menu" aria-expanded={open} onClick={() => onOpenChange(!open)}>
      <MoreHorizontal size={19} aria-hidden="true" />
    </button>
    {open && position && createPortal(
      <div ref={menu} className="upload-floating-menu" role="menu" aria-label={label}
        style={{ top: position.top, left: position.left }}>
        {children}
      </div>,
      document.body
    )}
  </>;
}
