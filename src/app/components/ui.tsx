/**
 * Small shared building blocks for the console.
 */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ROLE_LABELS, type MemberRole } from '../../core/roles.js';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconCheckCircle,
  IconClose,
  IconCopy,
  IconTrash,
} from './icons.js';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center-screen">
      <div className="spinner" role="status" aria-label={label ?? 'Loading'} />
      {label ? <p>{label}</p> : null}
    </div>
  );
}

const ALERT_ICON = {
  error: IconAlertCircle,
  success: IconCheckCircle,
  warn: IconAlertTriangle,
};

export function Alert({
  kind,
  children,
}: {
  kind: 'error' | 'success' | 'warn';
  children: ReactNode;
}) {
  const Icon = ALERT_ICON[kind];
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon className="alert__icon" size={17} />
      <div className="alert__body">{children}</div>
    </div>
  );
}

export function RoleBadge({ role }: { role: MemberRole }) {
  return <span className={`badge badge--${role}`}>{ROLE_LABELS[role]}</span>;
}

/**
 * A read-only URL with a copy button.
 *
 * Copying is the entire point of these fields — the operator's next move is
 * pasting the URL into OBS or a browser on another machine — so the button
 * confirms in place rather than firing a toast that may be off-screen.
 */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access is denied in some embedded contexts; selecting the
      // text is a workable fallback that needs no permission.
      const input = document.getElementById(`copy-${label}`) as HTMLInputElement | null;
      input?.select();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [value, label]);

  return (
    <div className="copy-field">
      <input id={`copy-${label}`} type="text" readOnly value={value} aria-label={label} />
      <button type="button" className="btn btn--sm" onClick={() => void copy()}>
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card">
        <div className="modal-card__head">
          <h2>{title}</h2>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            onClick={onClose}
            aria-label="Close"
          >
            <IconClose size={16} />
          </button>
        </div>
        {children}
        {footer ? <div className="modal-card__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * A label paired with one form control.
 *
 * The label and its control render as siblings (for the `.field` layout CSS),
 * which means the browser cannot associate them implicitly the way nesting an
 * `<input>` inside a `<label>` would — without an explicit `id`/`htmlFor` link,
 * the pairing that makes a screen reader announce "Email, edit text" instead of
 * just "edit text", and that makes clicking the label focus the field, silently
 * doesn't exist. `useId` generates that id and `cloneElement` attaches it (and
 * the hint, via `aria-describedby`) to the single child control, so every call
 * site just writes `<Field label="…"><input /></Field>` and gets a properly
 * wired label for free.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const inputId = useId();
  const hintId = hint ? `${inputId}-hint` : undefined;

  const control =
    isValidElement(children) && typeof children.type === 'string'
      ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string }>, {
          id: (children.props as { id?: string }).id ?? inputId,
          'aria-describedby': hintId,
        })
      : children;

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      {control}
      {hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Confirms a destructive action by requiring the exact name to be typed. */
export function ConfirmDelete({
  title,
  expected,
  description,
  onCancel,
  onConfirm,
  busy,
}: {
  title: string;
  expected: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const [typed, setTyped] = useState('');
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={typed !== expected || busy}
            onClick={onConfirm}
          >
            {busy ? null : <IconTrash size={15} />}
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </>
      }
    >
      <p className="muted">{description}</p>
      <Field label={`Type “${expected}” to confirm`}>
        <input
          type="text"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoFocus
          autoComplete="off"
        />
      </Field>
    </Modal>
  );
}
