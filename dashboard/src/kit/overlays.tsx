import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, DockPanel, IconButton, PanelBar, PanelBody, PanelHeader, Stack, Text, Toast } from '@/design';
import { useBackToClose } from '../lib/back';
import { useIsNarrow } from '../lib/media';
import { load, save } from '../lib/storage';
import { appStore } from '../state/app';
import { useStore } from '../state/store';
import { dialogStore, dismissToast, toastStore } from '../state/ui';
import { TextInput } from './controls';
import { IconBtn } from './controls';
import s from './overlays.module.css';
// Class names only: the point menu wears the design system's Popover.
import pop from '@/design/components/Popover.module.css';

// ---------------------------------------------------------------- sheet --

/** Bottom sheet: thumb-reachable; closes on the scrim, Esc, ✕ or Android Back. */
export function Sheet({ title, onClose, children, footer }: { title?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useBackToClose(onClose, true);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);
  return createPortal(
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={s.sheet} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}>
        <div className={s.grip} aria-hidden />
        {title != null && (
          <div className={s.head}>
            <div className={s.title}>{title}</div>
            <IconBtn icon="x" label="Close" size="lg" onClick={onClose} />
          </div>
        )}
        <div className={s.body}>{children}</div>
        {footer && <div className={s.foot}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A 52px sheet row: icon, label (+ hint), and something on the right. */
export function SheetItem({
  icon,
  label,
  hint,
  onClick,
  right,
  danger,
  disabled,
  active,
}: {
  icon: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  right?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  active?: boolean;
}) {
  const cls = [s.item, danger && s.danger, active && s.active].filter(Boolean).join(' ');
  const inner = (
    <>
      <span className={s.itemIcon}>{icon}</span>
      <span className={s.itemText}>
        <span className={s.itemLabel}>{label}</span>
        {hint && <span className={s.itemHint}>{hint}</span>}
      </span>
      {right != null && <span className={s.itemRight}>{right}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-current={active || undefined}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export const SheetSection = ({ children }: { children: ReactNode }) => <div className={s.section}>{children}</div>;

// ----------------------------------------------------------------- dock --

/** A detail pane: the design system's DockPanel, docked at the viewport's
 *  right edge beside the page (the shell's #kc-dock slot), resizable; full
 *  screen with a back arrow on phones. `closeOnBack` gives it a history
 *  entry, for panes that are not already a route. */
export function Dock({
  label,
  title,
  subtitle,
  actions,
  bar,
  children,
  onClose,
  closeOnBack,
}: {
  label: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  bar?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeOnBack?: boolean;
}) {
  const embed = useStore(appStore, (x) => x.embed);
  const narrow = useIsNarrow();
  const fullscreen = embed || narrow;
  const [width, setWidth] = useState(() => load<number>('killcam.dock.width', 560));
  const [slot, setSlot] = useState<HTMLElement | null>(() => document.getElementById('kc-dock'));
  useEffect(() => {
    if (!slot) setSlot(document.getElementById('kc-dock'));
  }, [slot]);
  useBackToClose(onClose, fullscreen && !!closeOnBack);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!slot) return null;
  const max = Math.max(420, Math.min(1000, window.innerWidth - 360));
  return createPortal(
    <DockPanel
      label={label}
      width={Math.min(width, max)}
      fullscreen={fullscreen}
      resize={{
        min: 360,
        max,
        onResize: (w) => {
          const next = Math.round(Math.max(360, Math.min(max, w)));
          setWidth(next);
          save('killcam.dock.width', next);
        },
      }}
    >
      <PanelHeader
        leading={fullscreen ? <IconBtn icon="back" label="Back" size="lg" onClick={onClose} /> : undefined}
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {actions}
            {!fullscreen && <IconButton icon="close" label="Close (Esc)" onClick={onClose} />}
          </>
        }
      />
      {bar && <PanelBar>{bar}</PanelBar>}
      <PanelBody>{children}</PanelBody>
    </DockPanel>,
    slot,
  );
}

// --------------------------------------------------------------- dialog --

/** The design system's Dialog; on the phone, Android Back closes it too. */
export function KDialog(props: Parameters<typeof Dialog>[0]) {
  useBackToClose(props.onClose, props.open && appStore.get().embed);
  return <Dialog {...props} />;
}

/** Confirm and prompt, answered in a Dialog (a Sheet on the phone). The
 *  WebView has no window.confirm/prompt. */
export function DialogHost() {
  const d = useStore(dialogStore, (x) => x.dialog);
  const embed = useStore(appStore, (x) => x.embed);
  const [value, setValue] = useState('');
  useEffect(() => setValue(d?.initial ?? ''), [d]);
  if (!d) return null;
  const close = (v: string | null) => {
    dialogStore.set({ dialog: null });
    d.resolve(v);
  };
  const ok = () => close(d.kind === 'prompt' ? value : 'ok');
  const body = (
    <Stack gap={16}>
      {d.message && (
        <Text as="p" variant="body">
          {d.message}
        </Text>
      )}
      {d.kind === 'prompt' && (
        <TextInput autoFocus value={value} placeholder={d.placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
      )}
    </Stack>
  );
  const buttons = (
    <>
      <Button variant="secondary" onClick={() => close(null)}>
        Cancel
      </Button>
      <Button variant="primary" onClick={ok} autoFocus={d.kind === 'confirm'}>
        {d.confirmLabel ?? 'OK'}
      </Button>
    </>
  );
  if (embed) {
    return (
      <Sheet title={d.title} onClose={() => close(null)} footer={buttons}>
        <div style={{ padding: '12px 20px 4px' }}>{body}</div>
      </Sheet>
    );
  }
  return (
    <KDialog open onClose={() => close(null)} title={d.title} width={480}>
      <Stack gap={24}>
        {body}
        <Stack direction="row" gap={8} justify="end">
          {buttons}
        </Stack>
      </Stack>
    </KDialog>
  );
}

/** The design system's Toast: one message at a time, the newest wins. */
export function ToastHost() {
  const toasts = useStore(toastStore, (x) => x.toasts);
  const embed = useStore(appStore, (x) => x.embed);
  const t = toasts[toasts.length - 1] ?? null;
  const text = t ? `${t.kind === 'error' ? '✕ ' : t.kind === 'ok' ? '✓ ' : ''}${t.message}` : null;
  const toast = <Toast message={text} id={t?.id} onDismiss={() => t && dismissToast(t.id)} duration={t?.kind === 'error' ? 4800 : 2400} />;
  return embed ? <div className={s.liftToast}>{toast}</div> : toast;
}

// ------------------------------------------------------------ point menu --

export interface PointMenuItem {
  label: ReactNode;
  onPick: () => void;
}

/** A menu at a click point (a log line's tag), in the design system's
 *  Popover and OptionList look. Closes on a click elsewhere or Esc. */
export function PointMenu({ x, y, items, onClose, label }: { x: number; y: number; items: PointMenuItem[]; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close.current();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key, true);
    };
  }, []);
  const width = 260;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.min(y + 6, window.innerHeight - (items.length * 34 + 24));
  return createPortal(
    <div ref={ref} className={pop.popover} style={{ position: 'fixed', left, top, right: 'auto', width }} role="menu" aria-label={label}>
      <div className={pop.list}>
        {items.map((it, i) => (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={pop.option}
            onClick={() => {
              close.current();
              it.onPick();
            }}
          >
            <span className={pop.optLabel}>{it.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
