import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackToClose } from '../lib/back';
import { IconButton } from './ui';

/** Bottom sheet: thumb-reachable, dismiss by backdrop, Esc, the ✕ or Android Back. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  className,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useBackToClose(onClose);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={className ? `sheet ${className}` : 'sheet'} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}>
        <div className="sheet-grip" aria-hidden />
        {title != null && (
          <div className="sheet-head">
            <div className="sheet-title">{title}</div>
            <IconButton icon="x" label="Close" onClick={onClose} />
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A full-width, 52px sheet row: icon, label (+ hint), optional right side. */
export function SheetItem({
  icon,
  label,
  hint,
  onClick,
  right,
  tone,
  disabled,
  active,
}: {
  icon: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  right?: ReactNode;
  tone?: 'danger' | 'accent';
  disabled?: boolean;
  active?: boolean;
}) {
  const cls = ['sheet-item', tone ? `tone-${tone}` : '', active ? 'active' : ''].filter(Boolean).join(' ');
  const inner = (
    <>
      <span className="sheet-item-icon">{icon}</span>
      <span className="sheet-item-text">
        <span className="sheet-item-label">{label}</span>
        {hint && <span className="sheet-item-hint">{hint}</span>}
      </span>
      {right != null && <span className="sheet-item-right">{right}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
