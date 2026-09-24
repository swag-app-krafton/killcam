import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackToClose } from '../lib/back';
import { copyText } from '../lib/clipboard';
import { useStore } from '../state/store';
import { dialogStore, dismissToast, toast, toastStore } from '../state/ui';
import { Icon } from './Icon';

// ---------------------------------------------------------------- buttons --

export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  className,
  size = 16,
  showLabel,
  kind,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  size?: number;
  showLabel?: boolean;
  kind?: 'danger' | 'primary';
}) {
  const cls = ['btn', showLabel ? '' : 'btn-icon', active ? 'active' : '', kind ?? '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <Icon name={icon} size={size} />
      {showLabel && <span>{label}</span>}
    </button>
  );
}

export function CopyButton({
  text,
  label = 'Copy',
  showLabel = false,
}: {
  text: string | (() => string);
  label?: string;
  showLabel?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={showLabel ? 'btn' : 'btn btn-icon'}
      aria-label={label}
      title={label}
      onClick={async () => {
        const ok = await copyText(typeof text === 'function' ? text() : text);
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } else toast('Copy failed', 'error');
      }}
    >
      <Icon name={done ? 'check' : 'copy'} />
      {showLabel && <span>{done ? 'Copied' : label}</span>}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={checked ? 'switch on' : 'switch'}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="switch-knob" />
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size,
}: {
  options: readonly (T | { value: T; label: ReactNode; title?: string })[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm';
}) {
  return (
    <div className={size === 'sm' ? 'seg seg-sm' : 'seg'} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={v === value}
            className={v === value ? 'on' : ''}
            title={typeof o === 'string' ? undefined : o.title}
            onClick={() => onChange(v)}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({
  on,
  onClick,
  children,
  className,
  title,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={['chip', on ? 'on' : '', className ?? ''].filter(Boolean).join(' ')}
      aria-pressed={on}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Filter',
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <label className="search" style={width ? { width } : undefined}>
      <Icon name="search" size={14} />
      <input
        data-search
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (value) onChange('');
            else (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }
        }}
      />
      <kbd className="search-kbd">/</kbd>
    </label>
  );
}

// ------------------------------------------------------------------ misc --

export function EmptyState({
  icon = 'info',
  title,
  children,
  tone,
}: {
  icon?: string;
  title: ReactNode;
  children?: ReactNode;
  tone?: 'error';
}) {
  return (
    <div className={tone === 'error' ? 'empty empty-error' : 'empty'}>
      <div className="empty-icon">
        <Icon name={icon} size={22} />
      </div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function KeyValueTable({ rows, mono = true }: { rows: [ReactNode, ReactNode][]; mono?: boolean }) {
  return (
    <table className={mono ? 'kv mono' : 'kv'}>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  right,
}: {
  tabs: readonly { id: T; label: ReactNode; badge?: ReactNode }[];
  value: T;
  onChange: (t: T) => void;
  right?: ReactNode;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          className={t.id === value ? 'tab on' : 'tab'}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge != null && <span className="tab-badge">{t.badge}</span>}
        </button>
      ))}
      {right && <div className="tabs-right">{right}</div>}
    </div>
  );
}

// ----------------------------------------------------------------- modal --

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 560,
  className,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useBackToClose(onClose);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      '[data-autofocus], input:not([type=hidden]), textarea, select',
    );
    (first ?? ref.current)?.focus();
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
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={className ? `modal ${className}` : 'modal'}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function DialogHost() {
  const d = useStore(dialogStore, (s) => s.dialog);
  const [value, setValue] = useState('');
  useEffect(() => setValue(d?.initial ?? ''), [d]);
  if (!d) return null;
  const close = (v: string | null) => {
    dialogStore.set({ dialog: null });
    d.resolve(v);
  };
  const ok = () => close(d.kind === 'prompt' ? value : 'ok');
  return (
    <Modal
      title={d.title}
      onClose={() => close(null)}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={() => close(null)}>
            Cancel
          </button>
          <button
            type="button"
            className={d.danger ? 'btn danger-solid' : 'btn primary'}
            onClick={ok}
            data-autofocus={d.kind === 'confirm' ? true : undefined}
          >
            {d.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      {d.message && <p className="dialog-msg">{d.message}</p>}
      {d.kind === 'prompt' && (
        <input
          className="input full"
          value={value}
          placeholder={d.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ok();
          }}
        />
      )}
    </Modal>
  );
}

export function Toasts() {
  const toasts = useStore(toastStore, (s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          <Icon name={t.kind === 'error' ? 'warning' : t.kind === 'ok' ? 'check' : 'info'} size={15} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
