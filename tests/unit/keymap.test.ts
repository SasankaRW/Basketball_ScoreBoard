/**
 * The rules an editable keymap has to hold to, none of which need a browser.
 *
 * The ones worth having: a key drives exactly one command (so assigning a key
 * that is in use must take it, not shadow it), the shipped defaults still
 * reproduce the panel's original hard-coded keys, and a stored keymap survives
 * a round trip — including a deliberately cleared shortcut, which is the case
 * where "fall back to the default" is the wrong repair.
 */
import { describe, expect, it } from 'vitest';
import {
  bindingsEqual,
  commandBoundTo,
  commandForKey,
  commandLabel,
  COMMAND_GROUPS,
  COMMANDS,
  defaultKeymap,
  formatBinding,
  formatCode,
  isBindableCode,
  isDefaultKeymap,
  isModifierCode,
  isShiftOnlyCode,
  parseKeymap,
  withBinding,
  withoutBinding,
  type CommandId,
  type Keymap,
} from '../../src/core/keymap.js';

describe('the command catalog', () => {
  it('has unique ids', () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships no two commands on the same default key', () => {
    const bound = COMMANDS.map((command) => command.defaultBinding).filter((b) => b !== null);
    const printed = bound.map((binding) => formatBinding(binding));
    expect(new Set(printed).size).toBe(printed.length);
  });

  it('defaults to keys that can actually be bound', () => {
    for (const command of COMMANDS) {
      if (command.defaultBinding) expect(isBindableCode(command.defaultBinding.code)).toBe(true);
    }
  });

  it('groups every command under one of the listed groups', () => {
    for (const command of COMMANDS) {
      expect(COMMAND_GROUPS).toContain(command.group);
    }
  });

  /**
   * The panel's original switch, transcribed. If a default moves, this is the
   * test that says so — an operator who never opens the editor must find the
   * keys exactly where they left them.
   */
  it.each([
    ['KeyT', false, 'gameClock.toggle'],
    ['Space', false, 'shotClock.toggle'],
    ['KeyR', false, 'shotClock.reset'],
    ['KeyR', true, 'shotClock.resetShort'],
    ['ArrowUp', false, 'score.home.plus1'],
    ['ArrowDown', false, 'score.home.minus1'],
    ['ArrowRight', false, 'score.away.plus1'],
    ['ArrowLeft', false, 'score.away.minus1'],
    ['KeyF', false, 'foul.home.plus'],
    ['KeyF', true, 'foul.home.minus'],
    ['KeyJ', false, 'foul.away.plus'],
    ['KeyJ', true, 'foul.away.minus'],
    ['KeyZ', false, 'timeout.home.use'],
    ['KeyZ', true, 'timeout.home.restore'],
    ['KeyX', false, 'timeout.away.use'],
    ['KeyX', true, 'timeout.away.restore'],
    ['KeyQ', false, 'period.plus'],
    ['KeyQ', true, 'period.minus'],
    ['KeyB', false, 'possession.toggle'],
  ])('%s (shift: %s) still runs %s by default', (code, shift, expected) => {
    expect(commandForKey(defaultKeymap(), code, shift)).toBe(expected);
  });

  it('leaves the destructive commands unbound out of the box', () => {
    const keymap = defaultKeymap();
    expect(keymap['game.new']).toBeNull();
    expect(keymap['match.finish']).toBeNull();
    expect(keymap['period.next']).toBeNull();
  });
});

describe('lookup', () => {
  it('ignores a key nothing is bound to', () => {
    expect(commandForKey(defaultKeymap(), 'KeyY', false)).toBeNull();
  });

  /**
   * The one deliberate behaviour change from the old switch, which read `shift`
   * inside a case and so let `Shift+↑` fall through to plain `↑`. Exact
   * matching is what makes `R` and `Shift+R` separately assignable.
   */
  it('does not let a shifted press fall through to an unshifted binding', () => {
    expect(commandForKey(defaultKeymap(), 'ArrowUp', true)).toBeNull();
  });

  it('reports nothing for a command whose shortcut was cleared', () => {
    const keymap = withoutBinding(defaultKeymap(), 'possession.toggle');
    expect(commandForKey(keymap, 'KeyB', false)).toBeNull();
  });
});

describe('binding a key', () => {
  it('moves the command onto the new key', () => {
    const { keymap } = withBinding(defaultKeymap(), 'possession.toggle', {
      code: 'KeyP',
      shift: false,
    });
    expect(commandForKey(keymap, 'KeyP', false)).toBe('possession.toggle');
    expect(commandForKey(keymap, 'KeyB', false)).toBeNull();
  });

  it('takes the key from whatever held it, and says which', () => {
    const { keymap, displaced } = withBinding(defaultKeymap(), 'game.new', {
      code: 'KeyB',
      shift: false,
    });
    expect(displaced).toBe('possession.toggle');
    expect(keymap['possession.toggle']).toBeNull();
    expect(commandForKey(keymap, 'KeyB', false)).toBe('game.new');
  });

  it('reports no displacement when rebinding a command onto its own key', () => {
    const { displaced } = withBinding(defaultKeymap(), 'possession.toggle', {
      code: 'KeyB',
      shift: false,
    });
    expect(displaced).toBeNull();
  });

  it('leaves the original keymap untouched', () => {
    const original = defaultKeymap();
    withBinding(original, 'game.new', { code: 'KeyB', shift: false });
    expect(original['possession.toggle']).toEqual({ code: 'KeyB', shift: false });
  });

  it('never leaves one key on two commands', () => {
    let keymap: Keymap = defaultKeymap();
    for (const id of ['game.new', 'match.finish', 'period.next'] as CommandId[]) {
      keymap = withBinding(keymap, id, { code: 'KeyB', shift: false }).keymap;
    }
    const holders = COMMANDS.filter((command) =>
      bindingsEqual(keymap[command.id], { code: 'KeyB', shift: false }),
    );
    expect(holders).toHaveLength(1);
    expect(holders[0]?.id).toBe('period.next');
  });

  it('finds the command holding a key, excluding one under edit', () => {
    const keymap = defaultKeymap();
    const binding = { code: 'KeyB', shift: false };
    expect(commandBoundTo(keymap, binding)).toBe('possession.toggle');
    expect(commandBoundTo(keymap, binding, 'possession.toggle')).toBeNull();
  });
});

describe('bindable keys', () => {
  it.each(['Escape', 'Tab', 'ShiftLeft', 'ControlRight', 'MetaLeft', 'F5', 'F11', 'F12'])(
    'refuses %s',
    (code) => {
      expect(isBindableCode(code)).toBe(false);
      // Shift does not rescue these — an unbindable code is unbindable.
      expect(isBindableCode(code, true)).toBe(false);
    },
  );

  it.each(['KeyA', 'Digit4', 'ArrowUp', 'Space', 'Enter', 'Slash', 'Numpad7', 'F2'])(
    'accepts %s',
    (code) => {
      expect(isBindableCode(code)).toBe(true);
    },
  );

  /**
   * Mouse buttons bind through the same `code` string as a key — `Mouse0` (the
   * left click every button on the page is pressed with) is the one exception,
   * bindable only with Shift held so no bound shortcut can fire on an ordinary
   * click.
   */
  it.each(['Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'])('accepts mouse button %s', (code) => {
    expect(isBindableCode(code)).toBe(true);
  });

  it('accepts the left click only with Shift held', () => {
    expect(isBindableCode('Mouse0')).toBe(false);
    expect(isBindableCode('Mouse0', true)).toBe(true);
    expect(isShiftOnlyCode('Mouse0')).toBe(true);
  });

  it.each(['Mouse1', 'Mouse2', 'KeyA', 'Escape'])('does not treat %s as shift-only', (code) => {
    expect(isShiftOnlyCode(code)).toBe(false);
  });

  it('binds and looks up Shift + left click', () => {
    const binding = { code: 'Mouse0', shift: true };
    const { keymap } = withBinding(defaultKeymap(), 'score.home.plus1', binding);
    expect(commandForKey(keymap, 'Mouse0', true)).toBe('score.home.plus1');
    // The bare click must stay inert, or every press of a panel button scores.
    expect(commandForKey(keymap, 'Mouse0', false)).toBeNull();
  });

  it('keeps a stored Shift + left click across a round trip', () => {
    const { keymap } = withBinding(defaultKeymap(), 'score.home.plus1', {
      code: 'Mouse0',
      shift: true,
    });
    expect(parseKeymap(JSON.parse(JSON.stringify(keymap)))['score.home.plus1']).toEqual({
      code: 'Mouse0',
      shift: true,
    });
  });

  /**
   * Only reachable from hand-edited storage — the editor has never let a bare
   * left click through. It lands unbound rather than back on its default, the
   * same way a stored `null` does: a keymap that named a binding, even a bad
   * one, is not a keymap asking for the shipped key back.
   */
  it('drops a stored bare left click', () => {
    const stored = { ...defaultKeymap(), 'score.home.plus1': { code: 'Mouse0', shift: false } };
    expect(parseKeymap(stored)['score.home.plus1']).toBeNull();
  });

  it('binds and looks up a mouse button like any other code', () => {
    const { keymap } = withBinding(defaultKeymap(), 'possession.toggle', {
      code: 'Mouse2',
      shift: false,
    });
    expect(commandForKey(keymap, 'Mouse2', false)).toBe('possession.toggle');
  });

  /**
   * `Shift+R` arrives as ShiftLeft and then KeyR, so the editor has to wait
   * through the first rather than reject it.
   */
  it('separates bare modifiers from the other unbindable keys', () => {
    expect(isModifierCode('ShiftLeft')).toBe(true);
    expect(isModifierCode('Escape')).toBe(false);
    expect(isModifierCode('KeyR')).toBe(false);
  });
});

describe('persistence', () => {
  const roundTrip = (keymap: Keymap): Keymap =>
    parseKeymap(JSON.parse(JSON.stringify(keymap)) as unknown);

  it('round-trips the defaults', () => {
    expect(roundTrip(defaultKeymap())).toEqual(defaultKeymap());
  });

  it('round-trips a customised keymap', () => {
    const { keymap } = withBinding(defaultKeymap(), 'score.home.plus2', {
      code: 'Digit2',
      shift: false,
    });
    expect(roundTrip(keymap)).toEqual(keymap);
  });

  /**
   * The case that separates "repair the stored value" from "re-apply the
   * default": someone who cleared a shortcut meant it, and handing the key back
   * on the next page load would be the same bug pointing the other way.
   */
  it('keeps a deliberately cleared shortcut cleared', () => {
    const keymap = withoutBinding(defaultKeymap(), 'possession.toggle');
    expect(roundTrip(keymap)['possession.toggle']).toBeNull();
    expect(commandForKey(roundTrip(keymap), 'KeyB', false)).toBeNull();
  });

  it('gives a command missing from the stored map its default', () => {
    const stored = { ...defaultKeymap() } as Record<string, unknown>;
    delete stored['possession.toggle'];
    expect(parseKeymap(stored)['possession.toggle']).toEqual({ code: 'KeyB', shift: false });
  });

  it.each([null, undefined, 42, 'nonsense', []])('falls back to the defaults for %s', (raw) => {
    expect(parseKeymap(raw)).toEqual(defaultKeymap());
  });

  it('discards a stored binding whose key cannot be bound', () => {
    expect(
      parseKeymap({ 'possession.toggle': { code: 'Escape', shift: false } })['possession.toggle'],
    ).toBeNull();
  });

  it.each([{ shift: true }, { code: 7 }, 'KeyB', null])(
    'discards the malformed binding %s',
    (binding) => {
      expect(parseKeymap({ 'possession.toggle': binding })['possession.toggle']).toBeNull();
    },
  );

  /**
   * A hand-edited or half-migrated store can put one key on two commands.
   * Lookup has no correct answer for that, so parsing resolves it rather than
   * leaving a keymap whose behaviour depends on catalog order.
   */
  it('keeps only the first claimant of a duplicated key', () => {
    const keymap = parseKeymap({
      ...defaultKeymap(),
      'game.new': { code: 'KeyB', shift: false },
    });
    expect(keymap['possession.toggle']).toEqual({ code: 'KeyB', shift: false });
    expect(keymap['game.new']).toBeNull();
  });
});

describe('display', () => {
  it.each([
    ['KeyT', 'T'],
    ['Digit4', '4'],
    ['ArrowUp', '↑'],
    ['ArrowLeft', '←'],
    ['Space', 'Space'],
    ['Slash', '/'],
    ['Numpad7', 'Num 7'],
    ['F2', 'F2'],
    ['Mouse0', 'Left click'],
    ['Mouse1', 'Middle click'],
    ['Mouse2', 'Right click'],
    ['Mouse3', 'Back button'],
    ['Mouse4', 'Forward button'],
  ])('renders %s as %s', (code, expected) => {
    expect(formatCode(code)).toBe(expected);
  });

  it('prefixes a shifted binding', () => {
    expect(formatBinding({ code: 'KeyR', shift: true })).toBe('Shift + R');
    expect(formatBinding({ code: 'KeyR', shift: false })).toBe('R');
  });

  it('says so when a command has no key', () => {
    expect(formatBinding(null)).toBe('Not set');
  });

  it('labels every command', () => {
    for (const command of COMMANDS) {
      expect(commandLabel(command.id)).toBe(command.label);
      expect(command.label.length).toBeGreaterThan(0);
    }
  });
});

describe('isDefaultKeymap', () => {
  it('is true for a fresh keymap and false once one key moves', () => {
    expect(isDefaultKeymap(defaultKeymap())).toBe(true);
    const { keymap } = withBinding(defaultKeymap(), 'possession.toggle', {
      code: 'KeyP',
      shift: false,
    });
    expect(isDefaultKeymap(keymap)).toBe(false);
  });

  it('is false when a default shortcut is cleared', () => {
    expect(isDefaultKeymap(withoutBinding(defaultKeymap(), 'possession.toggle'))).toBe(false);
  });
});
