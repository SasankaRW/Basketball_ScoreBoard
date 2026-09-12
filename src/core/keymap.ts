/**
 * The control panel's editable keyboard shortcuts.
 *
 * The panel used to switch on `event.code` directly, which made the key for an
 * action a fact about the source. This turns that around: a *command* is the
 * stable thing (`score.home.plus1`), and which key reaches it is data an
 * operator owns. Every scorer has their own muscle memory — often from whatever
 * console they used before this one — and a scorer's table is the last place to
 * make someone translate.
 *
 * Pure and framework-free, like the rest of `src/core/`: no DOM, no storage, no
 * React. It takes a code and a shift flag and answers which command that is,
 * which is all `ControlPanelPage` needs and all a unit test needs to pin the
 * conflict and round-trip rules down. Persistence lives in
 * `src/app/keymapStorage.ts`.
 *
 * Bindings are `KeyboardEvent.code`, not `key`. `code` names the physical key,
 * so a binding survives a layout switch and — the reason it matters here — the
 * shift state stays a separate flag instead of being folded into the character:
 * `Shift+R` and `R` are two different bindings that can drive two different
 * commands, which is exactly what the shot-clock's 24/14 pair needs.
 *
 * A mouse button binds the same way: it is encoded as a synthetic `MouseN`
 * code (`N` is `MouseEvent.button`), so it round-trips through this same
 * `code`/`shift` shape without a parallel type. `Mouse0` — the plain left
 * click every button on this page is pressed with — is the one control that
 * binds *only* with Shift held; see `isBindableCode`.
 */

export interface KeyBinding {
  /** `KeyboardEvent.code` (e.g. `KeyR`, `ArrowUp`) or a synthetic `MouseN` id. */
  code: string;
  shift: boolean;
}

export type CommandGroup =
  'Clocks' | 'Score' | 'Fouls' | 'Timeouts' | 'Period' | 'Possession' | 'Game';

export interface CommandDefinition {
  readonly id: string;
  readonly group: CommandGroup;
  readonly label: string;
  /**
   * What this command is bound to on a keymap nobody has touched.
   *
   * The bound defaults reproduce the panel's original hard-coded switch key for
   * key, so upgrading changes nothing for an operator who never opens the
   * editor. Commands that had no key before start at `null` — every button in
   * the panel is bindable now, but nothing new starts firing on its own, least
   * of all the destructive ones.
   */
  readonly defaultBinding: KeyBinding | null;
}

const key = (code: string, shift = false): KeyBinding => ({ code, shift });

export const COMMANDS = [
  // --- Clocks ---
  {
    id: 'gameClock.toggle',
    group: 'Clocks',
    label: 'Start / stop game clock',
    defaultBinding: key('KeyT'),
  },
  { id: 'gameClock.set', group: 'Clocks', label: 'Set game time…', defaultBinding: key('Enter') },
  { id: 'gameClock.reset', group: 'Clocks', label: 'Reset game clock', defaultBinding: null },
  {
    id: 'shotClock.toggle',
    group: 'Clocks',
    label: 'Start / stop shot clock',
    defaultBinding: key('Space'),
  },
  {
    id: 'shotClock.reset',
    group: 'Clocks',
    label: 'Reset shot clock (full)',
    defaultBinding: key('KeyR'),
  },
  {
    id: 'shotClock.resetShort',
    group: 'Clocks',
    label: 'Reset shot clock (offensive rebound)',
    defaultBinding: key('KeyR', true),
  },

  // --- Score ---
  { id: 'score.home.plus1', group: 'Score', label: 'Home +1', defaultBinding: key('ArrowUp') },
  { id: 'score.home.plus2', group: 'Score', label: 'Home +2', defaultBinding: null },
  { id: 'score.home.plus3', group: 'Score', label: 'Home +3', defaultBinding: null },
  {
    id: 'score.home.minus1',
    group: 'Score',
    label: 'Home −1 (correction)',
    defaultBinding: key('ArrowDown'),
  },
  { id: 'score.away.plus1', group: 'Score', label: 'Away +1', defaultBinding: key('ArrowRight') },
  { id: 'score.away.plus2', group: 'Score', label: 'Away +2', defaultBinding: null },
  { id: 'score.away.plus3', group: 'Score', label: 'Away +3', defaultBinding: null },
  {
    id: 'score.away.minus1',
    group: 'Score',
    label: 'Away −1 (correction)',
    defaultBinding: key('ArrowLeft'),
  },

  // --- Fouls ---
  { id: 'foul.home.plus', group: 'Fouls', label: 'Home fouls +1', defaultBinding: key('KeyF') },
  {
    id: 'foul.home.minus',
    group: 'Fouls',
    label: 'Home fouls −1',
    defaultBinding: key('KeyF', true),
  },
  { id: 'foul.away.plus', group: 'Fouls', label: 'Away fouls +1', defaultBinding: key('KeyJ') },
  {
    id: 'foul.away.minus',
    group: 'Fouls',
    label: 'Away fouls −1',
    defaultBinding: key('KeyJ', true),
  },

  // --- Timeouts ---
  {
    id: 'timeout.home.use',
    group: 'Timeouts',
    label: 'Use home timeout',
    defaultBinding: key('KeyZ'),
  },
  {
    id: 'timeout.home.restore',
    group: 'Timeouts',
    label: 'Restore home timeout',
    defaultBinding: key('KeyZ', true),
  },
  {
    id: 'timeout.away.use',
    group: 'Timeouts',
    label: 'Use away timeout',
    defaultBinding: key('KeyX'),
  },
  {
    id: 'timeout.away.restore',
    group: 'Timeouts',
    label: 'Restore away timeout',
    defaultBinding: key('KeyX', true),
  },

  // --- Period ---
  { id: 'period.plus', group: 'Period', label: 'Period +1', defaultBinding: key('KeyQ') },
  { id: 'period.minus', group: 'Period', label: 'Period −1', defaultBinding: key('KeyQ', true) },
  { id: 'period.next', group: 'Period', label: 'Start next period', defaultBinding: null },

  // --- Possession ---
  {
    id: 'possession.toggle',
    group: 'Possession',
    label: 'Toggle possession',
    defaultBinding: key('KeyB'),
  },
  { id: 'possession.home', group: 'Possession', label: 'Possession to home', defaultBinding: null },
  { id: 'possession.away', group: 'Possession', label: 'Possession to away', defaultBinding: null },

  // --- Game ---
  { id: 'teamNames.edit', group: 'Game', label: 'Edit team names…', defaultBinding: key('KeyN') },
  { id: 'match.finish', group: 'Game', label: 'Finish match', defaultBinding: null },
  { id: 'game.new', group: 'Game', label: 'New game (discard)', defaultBinding: null },
] as const satisfies readonly CommandDefinition[];

export type CommandId = (typeof COMMANDS)[number]['id'];

/** The groups in the order they should be presented, derived from the catalog. */
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  ...new Set(COMMANDS.map((command) => command.group)),
];

export type Keymap = Readonly<Record<CommandId, KeyBinding | null>>;

export function defaultKeymap(): Keymap {
  const map = {} as Record<CommandId, KeyBinding | null>;
  for (const command of COMMANDS) {
    map[command.id] = command.defaultBinding ? { ...command.defaultBinding } : null;
  }
  return map;
}

export function isDefaultKeymap(keymap: Keymap): boolean {
  return COMMANDS.every((command) => bindingsEqual(keymap[command.id], command.defaultBinding));
}

export function bindingsEqual(a: KeyBinding | null, b: KeyBinding | null): boolean {
  if (a === null || b === null) return a === b;
  return a.code === b.code && a.shift === b.shift;
}

// ---------------------------------------------------------------------------
// What may be bound
// ---------------------------------------------------------------------------

/**
 * Keys the editor refuses to capture.
 *
 * `Escape` and `Tab` are how someone gets *out* of the capture prompt and
 * around the page — binding them would take away the exit. The bare modifiers
 * never arrive as a binding of their own (they are the `shift` flag instead),
 * and the browser keys are ones a page has no business taking from a venue PC
 * mid-game.
 */
const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'NumLock',
]);

const UNBINDABLE = new Set([...MODIFIER_CODES, 'Escape', 'Tab', 'ContextMenu', 'F5', 'F11', 'F12']);

/**
 * Controls that bind only with Shift held.
 *
 * The bare left click presses everything on the page — the panel's own
 * buttons, this editor's "Change" and "Done", the nav — and both the editor's
 * capture and the panel's dispatch listen on the *document*, so a command on
 * bare `Mouse0` would fire on all of them. `Shift` + left click collides with
 * nothing the console uses, so that combination is offered while the bare
 * click stays reserved for operating the UI.
 *
 * Kept apart from `UNBINDABLE` because the answer depends on the whole
 * binding rather than the code alone — which is why `isBindableCode` takes
 * `shift`, and why every caller has to pass it.
 */
const SHIFT_ONLY = new Set(['Mouse0']);

/** Whether `code` needs Shift before it can be bound at all. */
export function isShiftOnlyCode(code: string): boolean {
  return SHIFT_ONLY.has(code);
}

/**
 * A modifier pressed on its own.
 *
 * Distinguished from the rest of `UNBINDABLE` because the editor has to treat
 * it differently: `Shift+R` arrives as a `ShiftLeft` keydown *followed by* a
 * `KeyR` one, so a capture prompt that complained about the first would scold
 * the operator halfway through a perfectly good shortcut. These are ignored,
 * silently, while everything else that cannot be bound gets a reason.
 */
export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

export function isBindableCode(code: string, shift = false): boolean {
  if (code.length === 0 || UNBINDABLE.has(code)) return false;
  return shift || !SHIFT_ONLY.has(code);
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Which command a keypress runs, or `null` for a key this keymap ignores.
 *
 * The match is exact on both fields. That is a real change from the panel's
 * original switch, which read `shift` *inside* a case and so let `Shift+↑` fall
 * through to plain `↑` — but it is the price of `R` and `Shift+R` being
 * separately assignable, and an unassigned combination doing nothing is the
 * behaviour an editable keymap has to have.
 */
export function commandForKey(keymap: Keymap, code: string, shift: boolean): CommandId | null {
  for (const command of COMMANDS) {
    const binding = keymap[command.id];
    if (binding && binding.code === code && binding.shift === shift) return command.id;
  }
  return null;
}

/** Which command currently holds `binding`, ignoring `except`. */
export function commandBoundTo(
  keymap: Keymap,
  binding: KeyBinding,
  except?: CommandId,
): CommandId | null {
  for (const command of COMMANDS) {
    if (command.id === except) continue;
    if (bindingsEqual(keymap[command.id], binding)) return command.id;
  }
  return null;
}

export function commandLabel(id: CommandId): string {
  return COMMANDS.find((command) => command.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export interface BindResult {
  keymap: Keymap;
  /**
   * The command this binding was taken from, if any.
   *
   * One key runs one command, so assigning a key that is already in use has to
   * take it. Reporting which command lost it is what lets the editor say so out
   * loud instead of quietly leaving a hole in someone's muscle memory.
   */
  displaced: CommandId | null;
}

export function withBinding(keymap: Keymap, id: CommandId, binding: KeyBinding): BindResult {
  const displaced = commandBoundTo(keymap, binding, id);
  const next = { ...keymap, [id]: { ...binding } };
  if (displaced) next[displaced] = null;
  return { keymap: next, displaced };
}

export function withoutBinding(keymap: Keymap, id: CommandId): Keymap {
  return { ...keymap, [id]: null };
}

// ---------------------------------------------------------------------------
// Persistence format
// ---------------------------------------------------------------------------

function parseBinding(raw: unknown): KeyBinding | null {
  if (!raw || typeof raw !== 'object') return null;
  const { code, shift } = raw as { code?: unknown; shift?: unknown };
  const held = shift === true;
  if (typeof code !== 'string' || !isBindableCode(code, held)) return null;
  return { code, shift: held };
}

/**
 * Rebuilds a keymap from whatever was stored, which may be from an older
 * release, hand-edited, or garbage.
 *
 * Starts from the defaults so a command added after this keymap was saved
 * arrives with its default key rather than silently unbound. A stored `null` is
 * honoured, though — someone who cleared a shortcut meant it, and re-defaulting
 * it on the next page load would be the same bug in the other direction.
 *
 * Duplicates are resolved first-come, since a keymap where one key claims two
 * commands has no correct answer at lookup time.
 */
export function parseKeymap(raw: unknown): Keymap {
  const defaults = defaultKeymap();
  if (!raw || typeof raw !== 'object') return defaults;

  const stored = raw as Record<string, unknown>;
  const map = {} as Record<CommandId, KeyBinding | null>;
  const taken: KeyBinding[] = [];

  for (const command of COMMANDS) {
    const binding = Object.prototype.hasOwnProperty.call(stored, command.id)
      ? parseBinding(stored[command.id])
      : defaults[command.id];

    if (binding && taken.some((other) => bindingsEqual(other, binding))) {
      map[command.id] = null;
      continue;
    }

    map[command.id] = binding;
    if (binding) taken.push(binding);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * The glyphs and words a scorer would use for a key, rather than the DOM's
 * names for them. Anything not listed falls through to the prefix rules below.
 */
const CODE_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Insert: 'Insert',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  Mouse0: 'Left click',
  Mouse1: 'Middle click',
  Mouse2: 'Right click',
  Mouse3: 'Back button',
  Mouse4: 'Forward button',
};

export function formatCode(code: string): string {
  const known = CODE_LABELS[code];
  if (known) return known;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** What the `<kbd>` shows. `null` is a command with no key on it. */
export function formatBinding(binding: KeyBinding | null): string {
  if (!binding) return 'Not set';
  return binding.shift ? `Shift + ${formatCode(binding.code)}` : formatCode(binding.code);
}
