/**
 * The control panel's shortcut editor.
 *
 * One row per command, grouped the way the panel itself is laid out. "Change"
 * arms a capture: the next keypress becomes that command's shortcut, so nobody
 * has to know that the key next to the left Shift is called `Backquote`.
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
  withBinding,
  withoutBinding,
  type CommandId,
  type Keymap,
} from '../../core/keymap.js';
import { Modal } from './ui.js';

export function ShortcutEditor({
  keymap,
  onChange,
  onReset,
  onClose,
}: {
  keymap: Keymap;
  onChange: (keymap: Keymap) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [capturing, setCapturing] = useState<CommandId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;

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
      if (event.metaKey || event.ctrlKey || event.altKey) {
        setNotice('Only a plain key or Shift + key can be used — Ctrl, Alt and ⌘ are reserved.');
        return;
      }
      if (!isBindableCode(event.code)) {
        setNotice(`${formatCode(event.code)} cannot be used as a shortcut.`);
        return;
      }

      const binding = { code: event.code, shift: event.shiftKey };
      const { keymap: next, displaced } = withBinding(keymap, capturing, binding);
      onChange(next);
      setNotice(
        displaced
          ? `${formatBinding(binding)} was on “${commandLabel(displaced)}”, which now has no shortcut.`
          : null,
      );
      setCapturing(null);
    };

    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
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
        Press <strong>Change</strong>, then press the key you want. Hold Shift while you press it
        for a Shift shortcut. These are saved in this browser, for you.
      </p>

      {capturing ? (
        <p className="shortcut-editor__prompt" role="status">
          Press a key for “{commandLabel(capturing)}” — Escape to cancel.
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
