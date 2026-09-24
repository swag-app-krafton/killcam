import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
// Class names only: Killcam's icon buttons wear the design system's own button styles.
import btn from '@/design/components/Button.module.css';
import { Button, StatusPill, type Tone } from '@/design';
import type { NetworkSummary } from '../api/types';
import { copyText } from '../lib/clipboard';
import { statusClass } from '../lib/format';
import { toast } from '../state/ui';
import { KIcon } from './Icon';
import k from './kit.module.css';

/** The design system's IconButton, for Killcam's glyphs. `size="lg"` is the
 *  40px phone tap target. */
export function IconBtn({
  icon,
  label,
  pressed,
  outlined,
  size = 'md',
  className,
  type = 'button',
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: string; label: string; pressed?: boolean; outlined?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={[btn.btn, btn.ghost, size === 'sm' && btn.ghostSm, size === 'lg' && k.tap, outlined && btn.outlined, className].filter(Boolean).join(' ')}
      {...rest}
    >
      <KIcon name={icon} size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} />
    </button>
  );
}

/** "Copy" as a quiet toolbar action; the check confirms it. */
export function CopyAction({ text, label = 'Copy', iconOnly }: { text: string | (() => string); label?: string; iconOnly?: boolean }) {
  const [done, setDone] = useState(false);
  const go = async () => {
    const ok = await copyText(typeof text === 'function' ? text() : text);
    if (!ok) return toast('Could not copy', 'error');
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  if (iconOnly) return <IconBtn icon={done ? 'check' : 'copy'} label={label} onClick={go} />;
  return (
    <Button variant="quiet" onClick={go} aria-label={label}>
      <KIcon name={done ? 'check' : 'copy'} size={13} />
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

/** A text box in the design system's field look (the SearchInput's box). */
export function TextInput({ mono, className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; invalid?: boolean }) {
  return <input className={[k.input, mono && k.mono, invalid && k.invalid, className].filter(Boolean).join(' ')} spellCheck={false} {...rest} />;
}

export function TextArea({ mono, className, invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean; invalid?: boolean }) {
  return <textarea className={[k.input, k.textarea, mono && k.mono, invalid && k.invalid, className].filter(Boolean).join(' ')} spellCheck={false} {...rest} />;
}

/** A bare select in the field look, for tables and forms (SelectField has its own label box). */
export function SelectInput({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={[k.input, k.select, className].filter(Boolean).join(' ')} {...rest} />;
}

/** A labelled form row: the design system's field label over any control. */
export function FormField({ label, children, hint, grow }: { label: ReactNode; children: ReactNode; hint?: ReactNode; grow?: boolean }) {
  return (
    <label className={grow ? `${k.field} ${k.grow}` : k.field}>
      <span className={k.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={k.fieldHint}>{hint}</span>}
    </label>
  );
}

const STATUS_TONE: Record<string, Tone> = { '2xx': 'pass', '3xx': 'neutral', '1xx': 'neutral', '4xx': 'warn', '5xx': 'fail', failed: 'fail', pending: 'neutral' };

/** An HTTP call's status as a StatusPill: glyph and code, never colour alone. */
export function HttpStatus({ call }: { call: Pick<NetworkSummary, 'state' | 'status' | 'error'> }) {
  const k2 = statusClass(call);
  return (
    <span title={call.error ?? (k2 === 'pending' ? 'In flight' : undefined)} className={k2 === 'pending' ? k.pending : undefined}>
      <StatusPill tone={STATUS_TONE[k2] ?? 'neutral'}>{k2 === 'pending' ? '…' : k2 === 'failed' ? 'ERR' : String(call.status)}</StatusPill>
    </span>
  );
}

/** HTTP method in the mono face, tinted by verb (series colours, not status). */
export function MethodTag({ method }: { method: string }) {
  const m = method.toUpperCase();
  const cls = m === 'GET' ? k.get : m === 'POST' ? k.post : m === 'DELETE' ? k.del : m === 'PUT' || m === 'PATCH' ? k.put : '';
  return <span className={`${k.method} ${cls}`}>{m}</span>;
}
