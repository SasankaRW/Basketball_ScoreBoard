/**
 * The control panel's shortcut editor.
 *
 * One row per command, grouped the way the panel itself is laid out. "Change"
 * arms a capture: the next keypress becomes that command's shortcut, so nobody
 * has to know that the key next to the left Shift is called `Backquote`.
 *
 * The layout is a tenant setting, shared by the whole organisation, so this
 * editor is read-only for anyone below admin — `canEdit` reflects
 * `canManageTenantSettings`, the same split the security rules enforce on
 * `settings.keymap`. A read-only editor still lists every binding, because an
 * operator needs to *see* the keys they are scoring with even when changing
 * them is not theirs to do.
 *
 * Capturing listens on the document in the **capture phase** and stops the
 * event there. Two things are downstream that must not see these keys — the
 * `Modal`'s own Escape-to-close handler, and the control panel's live
 * shortcuts — and running first is what lets Escape mean "cancel this capture"
 * while the editor is armed, and lets someone rebind `↑` without scoring a
 * point in the process.
 */
import { useEffect, useState } from 'react';
import {
  bindingsEqual,
  commandLabel,
  COMMAND_GROUPS,
  COMMANDS,
  formatBinding,
  formatCode,
  isBindableCode,
  isDefaultKeymap,
  isModifierCode,
  isShiftOnlyCode,
  withBinding,
  withoutBinding,
  type CommandId,
  type Keymap,
} from '../../core/keymap.js';
import { Alert, Modal } from './ui.js';

export function ShortcutEditor({
  keymap,
  canEdit,
  error,
  onChange,
  onReset,
  onClose,
}: {
  keymap: Keymap;
  canEdit: boolean;
  error: string | null;
  onChange: (keymap: Keymap) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [capturing, setCapturing] = useState<CommandId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;

    // Shared by both input types: given whatever the browser calls the
    // physical control that was pressed, either bind it or explain why not.
    const tryBind = (code: string, shift: boolean, meta: boolean, ctrl: boolean, alt: boolean) => {
      if (meta || ctrl || alt) {
        setNotice(
          'Only a plain key/button or Shift + key/button can be used — Ctrl, Alt and ⌘ are reserved.',
        );
        return;
      }
      if (!isBindableCode(code, shift)) {
        setNotice(
          isShiftOnlyCode(code)
            ? `${formatCode(code)} presses the buttons on this page — hold Shift and use it for a Shift + ${formatCode(code)} shortcut.`
            : `${formatCode(code)} cannot be used as a shortcut.`,
        );
        return;
      }

      const binding = { code, shift };
      const { keymap: next, displaced } = withBinding(keymap, capturing, binding);
      onChange(next);
      setNotice(
        displaced
          ? `${formatBinding(binding)} was on “${commandLabel(displaced)}”, which now has no shortcut.`
          : null,
      );
      setCapturing(null);
    };

    const onKey = (event: KeyboardEvent) => {
      // Swallowed whether or not it turns into a binding: while the prompt is
      // armed every key belongs to it, including the ones it rejects.
      event.preventDefault();
      event.stopPropagation();

      // `Shift+R` arrives as ShiftLeft and then KeyR. Waiting through the
      // first is the whole reason modifiers are separated out.
      if (isModifierCode(event.code)) return;

      if (event.code === 'Escape') {
        setCapturing(null);
        return;
      }
      tryBind(event.code, event.shiftKey, event.metaKey, event.ctrlKey, event.altKey);
    };

    const onMouseDown = (event: MouseEvent) => {
      // The bare left click is how this editor is itself operated — letting it
      // through is what lets someone click a different row's "Change", or
      // "Done", instead of pressing Escape to get out of a capture they no
      // longer want. So it is not swallowed, and cannot be bound; it only
      // leaves behind the hint that Shift is what makes it bindable. Every
      // control that reacts to that same click clears the notice again
      // (`assign` and `clear` both do), so the hint survives only a click that
      // did nothing else.
      if (event.button === 0 && !event.shiftKey) {
        setNotice('Left click presses the buttons on this page — hold Shift and click to bind it.');
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      tryBind(`Mouse${event.button}`, event.shiftKey, event.metaKey, event.ctrlKey, event.altKey);
    };

    // A right-click's menu is a separate event from `mousedown`, dispatched
    // regardless of what that mousedown did — left open, it would bury the
    // capture prompt under the browser's own context menu.
    const onContextMenu = (event: Event) => event.preventDefault();

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [capturing, keymap, onChange]);

  const assign = (id: CommandId) => {
    setNotice(null);
    setCapturing(id);
  };

  const clear = (id: CommandId) => {
    setNotice(null);
    setCapturing(null);
    onChange(withoutBinding(keymap, id));
  };

  return (
    <Modal
      title="Keyboard shortcuts"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn"
            hidden={!canEdit}
            disabled={isDefaultKeymap(keymap)}
            onClick={() => {
              setNotice(null);
              setCapturing(null);
              onReset();
            }}
          >
            Reset to defaults
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="field__hint shortcut-editor__intro">
        {canEdit ? (
          <>
            Press <strong>Change</strong>, then press the key or click the mouse button you want.
            Hold Shift while you do it for a Shift shortcut — left click is the one button that
            needs Shift, since on its own it is what presses the buttons on this page. These are
            saved for your whole organisation, on every board.
          </>
        ) : (
          <>
            These shortcuts are set for your whole organisation. An owner or admin can change them;
            they then apply on every board, for everyone.
          </>
        )}
      </p>

      {error ? <Alert kind="error">{error}</Alert> : null}

      {capturing ? (
        <p className="shortcut-editor__prompt" role="status">
          Press a key or click a mouse button for “{commandLabel(capturing)}” — Shift + click for
          left click — Escape to cancel.
        </p>
      ) : null}

      {notice ? (
        <p className="shortcut-editor__notice" role="status">
          {notice}
        </p>
      ) : null}

      {COMMAND_GROUPS.map((group) => (
        <section className="shortcut-editor__group" key={group}>
          <h4 className="shortcut-editor__group-title">{group}</h4>
          {COMMANDS.filter((command) => command.group === group).map((command) => {
            const binding = keymap[command.id];
            const armed = capturing === command.id;
            return (
              <div className="shortcut-editor__row" key={command.id}>
                <span className="shortcut-editor__label">{command.label}</span>
                <kbd
                  className={`shortcut-editor__key${armed ? ' shortcut-editor__key--armed' : ''}${
                    binding ? '' : ' shortcut-editor__key--unset'
                  }`}
                >
                  {armed ? 'Press a key…' : formatBinding(binding)}
                </kbd>
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-label={`Change shortcut for ${command.label}`}
                      onClick={() => assign(command.id)}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      aria-label={`Clear shortcut for ${command.label}`}
                      disabled={!binding}
                      onClick={() => clear(command.id)}
                    >
                      Clear
                    </button>
                  </>
                ) : null}
                {bindingsEqual(binding, command.defaultBinding) ? null : (
                  <span className="shortcut-editor__changed" aria-hidden="true">
                    •
                  </span>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </Modal>
  );
}
