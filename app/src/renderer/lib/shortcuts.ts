import { currentPlatform } from "./platform.ts";

/** Keys that can't be written as themselves in the `+`-joined form. */
const NAMED_KEYS: Record<string, string> = { "+": "plus", " ": "space" };

/**
 * Shortcuts follow the platform: the registry's `mod` is ⌘ on macOS and Ctrl elsewhere, and keys show as glyphs
 * (`⌘⇧P`) on macOS and as words (`Ctrl+Shift+P`) elsewhere. Read when called, so tests can switch platforms.
 */
const isMac = () => currentPlatform() === "darwin";

/** The platform's main modifier is down: ⌘ on macOS, Ctrl elsewhere. For handlers that check keys by hand. */
export const modKey = (event: { metaKey: boolean; ctrlKey: boolean }) =>
  isMac() ? event.metaKey : event.ctrlKey;

/**
 * In the terminal, which keys are the app's rather than the shell's: ⌘ keys on macOS, where the shell has ⌃ and
 * ⌥; Ctrl+Shift keys elsewhere, where Ctrl+R, Ctrl+C and the rest are the shell's (as in Windows Terminal and VS Code).
 */
export const appKeyInTerminal = (event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) =>
  isMac() ? event.metaKey : event.ctrlKey && event.shiftKey;

/** The order modifiers are written in, as `shortcutFromEvent` writes them. */
const MODIFIERS = ["cmd", "ctrl", "alt", "shift"];

/** `cmd+shift+p` from a key event, or null for a bare modifier press. */
export function shortcutFromEvent(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
  code?: string;
}): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
  // Option changes the character on macOS (⌥P = π); use the physical key instead.
  const raw =
    event.altKey && event.code?.startsWith("Key")
      ? event.code.slice(3).toLowerCase()
      : event.key.toLowerCase();
  const key = NAMED_KEYS[raw] ?? raw;
  return [
    event.metaKey && "cmd",
    event.ctrlKey && "ctrl",
    event.altKey && "alt",
    event.shiftKey && "shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

/**
 * A stored shortcut in today's form. Earlier versions saved `+` and Space as themselves
 * (`cmd+shift++`, `cmd+ `), which can't be split on `+`; those read as `plus` and `space`.
 */
export function normalizeShortcut(shortcut: string): string {
  if (shortcut === "+" || shortcut.endsWith("++"))
    return `${shortcut.slice(0, -1)}plus`;
  if (shortcut === " " || shortcut.endsWith("+ "))
    return `${shortcut.slice(0, -1)}space`;
  // The registry writes the main modifier as `mod`: ⌘ on macOS, Ctrl elsewhere.
  if (isMac()) return shortcut.replace(/(^|\+)mod(?=\+)/g, "$1cmd");
  // Elsewhere ⌘ is Ctrl too: a shortcut saved on a Mac (a shared project action) says `cmd`, and the Windows key
  // belongs to Windows. A modifier written twice that way counts once.
  const parts = shortcut.split("+").map((part, i, all) => (i < all.length - 1 && (part === "mod" || part === "cmd") ? "ctrl" : part));
  const key = parts.pop()!;
  return [...MODIFIERS.filter((m) => parts.includes(m)), key].join("+");
}

const MAC_GLYPHS: Record<string, string> = {
  cmd: "⌘",
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  enter: "↩",
  backspace: "⌫",
  escape: "Esc",
  plus: "+",
  space: "Space",
  tab: "⇥",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/** Keys as Windows and Linux write them, joined with `+`: `Ctrl+Shift+P`. */
const WORDS: Record<string, string> = {
  ...MAC_GLYPHS,
  cmd: "Win",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  enter: "Enter",
  backspace: "Backspace",
  tab: "Tab",
};

const keyNames = () => (isMac() ? MAC_GLYPHS : WORDS);

/** `cmd+shift+p` as the platform shows it: `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere. */
export function formatShortcut(shortcut: string): string {
  const names = keyNames();
  return normalizeShortcut(shortcut)
    .split("+")
    .map((part) => names[part] ?? part.toUpperCase())
    .join(isMac() ? "" : "+");
}

/** macOS key glyphs in text, and the words for them elsewhere. */
const GLYPH_WORDS: Array<[RegExp, string]> = [
  [/[⌘⌃]/g, "Ctrl+"],
  [/⌥/g, "Alt+"],
  [/⇧/g, "Shift+"],
  [/[↵↩]/g, "Enter"],
  [/⌫/g, "Backspace"],
  [/⇥/g, "Tab"],
];

/**
 * Keys written as macOS glyphs (`⌘⇧L`, `⌥-click`, a hint such as `⌘⌫`) as this platform writes them: unchanged
 * on macOS, `Ctrl+Shift+L`, `Alt+click`, `Ctrl+Backspace` elsewhere.
 */
export function localizeKeys(text: string): string {
  if (isMac()) return text;
  let out = text;
  for (const [glyph, word] of GLYPH_WORDS) out = out.replace(glyph, word);
  // Only the words added above are tidied: hints also carry names and paths (`src/c++`, `repo+`) that stay as written.
  return out
    .replace(/(Ctrl\+)+/g, "Ctrl+")
    .replace(/\b(Ctrl|Alt|Shift)\+-click/g, "$1+click")
    .replace(/\b(Ctrl|Alt|Shift)\+(?=$|[\s·,.;:)])/g, "$1");
}

const ARIA_KEYS: Record<string, string> = {
  cmd: "Meta",
  ctrl: "Control",
  alt: "Alt",
  shift: "Shift",
  enter: "Enter",
  backspace: "Backspace",
  escape: "Escape",
  plus: "Plus",
  space: "Space",
  tab: "Tab",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
};

/** `cmd+shift+p` as `aria-keyshortcuts` spells it (`Meta+Shift+P`), so VoiceOver can announce an action's shortcut. */
export function ariaShortcut(shortcut: string): string {
  return normalizeShortcut(shortcut)
    .split("+")
    .map(
      (part) =>
        ARIA_KEYS[part] ?? (part.length === 1 ? part.toUpperCase() : part),
    )
    .join("+");
}

/** Modifiers, then a named key (`enter`, `p`, `1`) or one ASCII punctuation character other than `+` (`,`, `\`). */
const STORED =
  /^(?:(?:cmd|mod|ctrl|alt|shift)\+)*(?:[a-z0-9]+|[!-*,-\/:-@\[-`{-~])$/;

/** A stored shortcut (`cmd+enter`, `escape`, `cmd+,`) as opposed to glyphs typed for display (`⌘↵`, `Esc`). */
export const isStoredShortcut = (keys: string) =>
  STORED.test(normalizeShortcut(keys));

const GLYPH_MODIFIERS: Record<string, string> = {
  "⌘": "cmd",
  "⌃": "ctrl",
  "⌥": "alt",
  "⇧": "shift",
};
const GLYPH_KEYS: Record<string, string> = {
  "↵": "enter",
  "↩": "enter",
  "⌫": "backspace",
  esc: "escape",
  "↑": "arrowup",
  "↓": "arrowdown",
  "+": "plus",
  "⇥": "tab",
};

/**
 * Glyphs as people read them (`⌘↵`, `⌘⇧H`, `Esc`) back to the stored form (`cmd+enter`, `cmd+shift+h`,
 * `escape`), so a button that shows `⌘↵` can also announce it. A stored shortcut comes back in today's form.
 */
export function storedShortcut(keys: string): string {
  if (isStoredShortcut(keys)) return normalizeShortcut(keys);
  const parts: string[] = [];
  let rest = keys;
  while (rest && GLYPH_MODIFIERS[rest[0]!]) {
    parts.push(GLYPH_MODIFIERS[rest[0]!]!);
    rest = rest.slice(1);
  }
  const key = rest.toLowerCase();
  if (key) parts.push(GLYPH_KEYS[key] ?? key);
  return parts.join("+");
}

/** What a `<kbd>` shows for either form: a stored shortcut is formatted, glyphs are written the platform's way. */
export const shortcutGlyphs = (keys: string) =>
  isStoredShortcut(keys) ? formatShortcut(keys) : localizeKeys(keys);

/** Whether two stored shortcuts are the same keys, reading older forms the way they are read today. */
export const sameShortcut = (a: string, b: string) =>
  normalizeShortcut(a) === normalizeShortcut(b);

// The registry: every shortcut Hunkdory has, in one place, the way Switchboard keeps its own. Handlers ask
// `matches(event, id)`, buttons show `keysFor(id)` (`shortcut="…"`), and the shortcuts sheet (⌘/) reads from
// here, so a key is written down once.

/** Where you are, for `when()`. Built when the shortcuts sheet opens. */
export interface ShortcutContext {
  view: 'welcome' | 'home' | 'plan' | 'review' | 'finish' | 'done' | 'connect' | 'settings' | 'pick';
  /** A decision is open in the review. */
  decision: boolean;
  /** A skim folder is open on one page. */
  group: boolean;
  /** Where keyboard focus was. */
  focus: 'sidebar' | 'field' | 'other';
}

export type ShortcutSection = 'general' | 'sidebar' | 'plan' | 'review' | 'finish' | 'projects';

/** The sections' headings, in the sheet. */
export const SECTION_TITLES: Record<ShortcutSection, string> = {
  general: 'General',
  sidebar: 'Branches and sidebar',
  plan: 'Plan',
  review: 'In a review',
  finish: 'Finish',
  projects: 'Projects',
};

/** Where focus has to be for a key to do this. Two shortcuts on the same keys in different places don't collide. */
export type ShortcutPlace = 'sidebar' | 'view';

export interface ShortcutDef {
  id: string;
  /** Alternatives, each in the stored form (`mod+shift+p`, `mod` being ⌘). `mod+1..9` is a range. */
  keys: readonly string[];
  /** What it does, as the sheet says it. */
  action: string;
  section: ShortcutSection;
  /** When it works, in a few words under the action. */
  context?: string;
  /** Something more to know, after the context. */
  note?: string;
  /** Whether it works right now; always, when left out. */
  when?(ctx: ShortcutContext): boolean;
  /** Only while focus is there. */
  where?: ShortcutPlace;
  /** A menu bar item in main handles it, so it never reaches the page. */
  menu?: true;
  /** Not in `reservedShortcuts()`. */
  reserve?: false;
}

const inReview = (ctx: ShortcutContext) => ctx.view === 'review';
const inStep = (ctx: ShortcutContext) => inReview(ctx) && !ctx.group;
const withCode = (ctx: ShortcutContext) => ctx.view === 'plan' || ctx.view === 'review';
const reviewing = (ctx: ShortcutContext) => ctx.view === 'plan' || ctx.view === 'review';

export const SHORTCUTS = [
  // General
  { id: 'shortcuts', keys: ['mod+/'], action: 'Keyboard shortcuts', section: 'general' },
  { id: 'settings', keys: ['mod+,'], action: 'Open or close Settings', section: 'general' },
  { id: 'settings.close', keys: ['escape'], action: 'Close Settings', section: 'general', when: (ctx) => ctx.view === 'settings' },
  { id: 'home', keys: ['mod+shift+h'], action: 'Inbox', section: 'general', note: 'From a review, your place in it is kept' },
  { id: 'branch.goto', keys: ['mod+p'], action: 'Go to a branch', section: 'general', note: 'Opens the sidebar and its search' },
  { id: 'branch.other', keys: ['mod+n'], action: 'Review another branch', section: 'general' },
  { id: 'nav.back', keys: ['mod+['], action: 'Back', section: 'general', note: 'Also the mouse’s back button and a swipe' },
  { id: 'nav.forward', keys: ['mod+]'], action: 'Forward', section: 'general' },

  // Branches and sidebar
  { id: 'sidebar.toggle', keys: ['mod+b'], action: 'Show or hide the sidebar', section: 'sidebar', context: 'Not during a review: it stays out of the way there', when: (ctx) => ctx.view !== 'review' && ctx.view !== 'finish' },
  { id: 'branch.next', keys: ['ctrl+tab'], action: 'Next branch', section: 'sidebar' },
  { id: 'branch.previous', keys: ['ctrl+shift+tab'], action: 'Previous branch', section: 'sidebar' },
  { id: 'sidebar.move', keys: ['arrowup', 'arrowdown'], action: 'Move through branches', section: 'sidebar', where: 'sidebar' },
  { id: 'sidebar.open', keys: ['enter'], action: 'Open the branch', section: 'sidebar', where: 'sidebar' },
  { id: 'sidebar.ignore', keys: ['e'], action: 'Ignore the branch, or bring it back', section: 'sidebar', where: 'sidebar', note: 'Ignored branches stay out of To review' },

  // Plan
  { id: 'home.open', keys: ['mod+enter'], action: 'Open the first branch to review', section: 'plan', when: (ctx) => ctx.view === 'home' },
  { id: 'plan.start', keys: ['mod+enter'], action: 'Start or continue the review', section: 'plan', when: (ctx) => ctx.view === 'plan' },
  { id: 'find', keys: ['mod+f'], action: 'Search the branch’s code', section: 'plan', note: 'Select a name first to search for it', when: withCode },
  { id: 'review.finish', keys: ['mod+shift+enter'], action: 'Finish', section: 'plan', context: 'In the plan and in a review', when: reviewing },

  // In a review
  { id: 'review.next', keys: ['j'], action: 'Next step or decision', section: 'review', when: inReview },
  { id: 'review.previous', keys: ['k'], action: 'Previous step or decision', section: 'review', when: inReview },
  { id: 'review.good', keys: ['r'], action: 'Looks good, next', section: 'review', context: 'On a decision: its main answer', when: inReview },
  { id: 'review.fix', keys: ['n'], action: 'Needs a fix', section: 'review', when: (ctx) => inReview(ctx) && ctx.decision },
  { id: 'review.comment', keys: ['c'], action: 'Comment on the step', section: 'review', when: inStep },
  { id: 'review.ask', keys: ['a'], action: 'Ask Claude about the step', section: 'review', when: inStep },
  { id: 'review.layout', keys: ['s'], action: 'Unified or side by side', section: 'review', when: inReview },
  { id: 'review.whitespace', keys: ['w'], action: 'Hide or show whitespace changes', section: 'review', when: inReview },
  { id: 'review.context', keys: ['mod+shift+d'], action: 'Show or hide Context', section: 'review', when: inStep },
  { id: 'review.plan', keys: ['escape'], action: 'Back to the plan', section: 'review', when: inReview },

  // Finish
  { id: 'finish.pick', keys: ['1..4'], action: 'Pick what to do', section: 'finish', when: (ctx) => ctx.view === 'finish' },
  { id: 'finish.submit', keys: ['mod+enter'], action: 'Merge, post or send back', section: 'finish', when: (ctx) => ctx.view === 'finish' },
  { id: 'finish.back', keys: ['escape'], action: 'Keep reviewing', section: 'finish', when: (ctx) => ctx.view === 'finish' },
  { id: 'done.next', keys: ['mod+enter'], action: 'Review the next branch', section: 'finish', when: (ctx) => ctx.view === 'done' },

  // Projects
  { id: 'welcome.pick', keys: ['mod+1..9'], action: 'Connect a repo Hunkdory found', section: 'projects', when: (ctx) => ctx.view === 'welcome' || ctx.view === 'connect' },
  { id: 'connect.save', keys: ['mod+enter'], action: 'Connect the project, or save its settings', section: 'projects', when: (ctx) => ctx.view === 'connect' || ctx.view === 'welcome' },
  { id: 'pick.find', keys: ['mod+f'], action: 'Find a branch', section: 'projects', when: (ctx) => ctx.view === 'pick' },
] as const satisfies readonly ShortcutDef[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

const BY_ID = new Map<string, ShortcutDef>(SHORTCUTS.map((s) => [s.id, s]));

export function shortcutById(id: ShortcutId): ShortcutDef {
  return BY_ID.get(id)!;
}

/** Whether a shortcut works in `ctx`. */
export const available = (def: ShortcutDef, ctx: ShortcutContext) =>
  def.when?.(ctx) ?? true;

const RANGE = /^(.*?)(\d)\.\.(\d)$/;

/**
 * The key presses one combo stands for, in today's stored form: a range is each of its keys, a sequence
 * its steps, a click none (it isn't a key press).
 */
export function comboPresses(combo: string): string[] {
  const steps = [...new Set(combo.split(" "))];
  return steps.flatMap((step) => {
    if (step.endsWith("click")) return [];
    const range = RANGE.exec(step);
    if (!range) return [normalizeShortcut(step)];
    const [, prefix, from, to] = range;
    const keys: string[] = [];
    for (let n = Number(from); n <= Number(to); n++)
      keys.push(normalizeShortcut(`${prefix}${n}`));
    return keys;
  });
}

/** One character that isn't a letter or digit (`/`, `@`, `\`): typing it may need ⇧ on some keyboards, so ⇧ doesn't count. */
const SYMBOL = /^[^a-z0-9]$/;
const withoutShiftForSymbols = (press: string) => {
  const parts = press.split("+");
  return SYMBOL.test(parts.at(-1)!)
    ? parts.filter((p) => p !== "shift").join("+")
    : press;
};

/** Whether a key press is `id`'s shortcut (any of its alternatives). */
export function matches(
  event: Parameters<typeof shortcutFromEvent>[0],
  id: ShortcutId,
): boolean {
  const pressed = shortcutFromEvent(event);
  if (!pressed) return false;
  const key = withoutShiftForSymbols(pressed);
  return shortcutById(id).keys.some((combo) =>
    comboPresses(combo).some((press) => withoutShiftForSymbols(press) === key),
  );
}

/** A shortcut's main keys in the stored form (`cmd+j`), for a button's `kbd` or a palette row. */
export const keysFor = (id: ShortcutId) =>
  comboPresses(shortcutById(id).keys[0]!)[0]!;

/**
 * The click that does `id`, in the stored form (`shift+click`), for text such as a tooltip: `formatKeys(clickKeysFor(id))`.
 * `keysFor` is for key presses and skips clicks.
 */
export const clickKeysFor = (id: ShortcutId) =>
  shortcutById(id).keys.find((combo) => combo.endsWith("click")) ?? "";

/** Every key that runs `id`, as `aria-keyshortcuts` lists them (space-separated). */
export const ariaKeysFor = (id: ShortcutId) =>
  shortcutById(id)
    .keys.flatMap((combo) =>
      combo.includes("..") || combo.includes(" ") ? [] : comboPresses(combo),
    )
    .map(ariaShortcut)
    .join(" ");

/** A piece of a combo as the sheet draws it: a keycap, or a word between keycaps. */
export type KeyPiece =
  | { cap: string; spoken: string }
  | { word: "to" | "then" | "click" | "middle-click" };

const SPOKEN: Record<string, string> = {
  cmd: "Command",
  ctrl: "Control",
  alt: "Option",
  shift: "Shift",
  enter: "Return",
  escape: "Escape",
  backspace: "Delete",
  tab: "Tab",
  space: "Space",
  plus: "Plus",
  arrowup: "Up Arrow",
  arrowdown: "Down Arrow",
  arrowleft: "Left Arrow",
  arrowright: "Right Arrow",
  "\\": "Backslash",
  ",": "Comma",
  "/": "Slash",
  "@": "At",
  ".": "Period",
  "`": "Backtick",
};

/** What screen readers say for keys named differently off macOS. */
const SPOKEN_ELSEWHERE: Record<string, string> = {
  cmd: "Windows",
  alt: "Alt",
  enter: "Enter",
  backspace: "Backspace",
};

const capOf = (part: string): KeyPiece => ({
  cap: keyNames()[part] ?? part.toUpperCase(),
  spoken: (isMac() ? undefined : SPOKEN_ELSEWHERE[part]) ?? SPOKEN[part] ?? part.toUpperCase(),
});

/** One key press as keycaps: `mod+shift+p` is ⌘, ⇧, P. */
const pressPieces = (press: string): KeyPiece[] =>
  normalizeShortcut(press)
    .split("+")
    .map((part) =>
      part === "click"
        ? { word: "click" as const }
        : part === "middleclick"
          ? { word: "middle-click" as const }
          : capOf(part),
    );

/** A combo as keycaps and words: `mod+1..9` is ⌘ 1 to ⌘ 9, `mod+q mod+q` is ⌘ Q then ⌘ Q, `alt+click` is ⌥ click. */
export function keyPieces(combo: string): KeyPiece[] {
  return combo.split(" ").flatMap((step, index): KeyPiece[] => {
    const then: KeyPiece[] = index > 0 ? [{ word: "then" }] : [];
    const range = RANGE.exec(step);
    if (!range) return [...then, ...pressPieces(step)];
    const [, prefix, from, to] = range;
    return [
      ...then,
      ...pressPieces(`${prefix}${from}`),
      { word: "to" },
      ...pressPieces(`${prefix}${to}`),
    ];
  });
}

/**
 * A combo as text: `mod+shift+p` is ⌘⇧P, `mod+1..9` ⌘1 to ⌘9, `mod+q mod+q` ⌘Q then ⌘Q, `alt+click` ⌥-click,
 * `middleclick` Middle-click. Elsewhere the keys of one press are joined with `+`: Ctrl+Shift+P, Alt+click.
 */
export function formatKeys(combo: string): string {
  const join = isMac() ? "" : "+";
  let text = "";
  let afterCap = false;
  for (const piece of keyPieces(combo)) {
    if ("cap" in piece) text += (afterCap ? join : "") + piece.cap;
    else if (piece.word === "click") text += `${text ? (isMac() ? "-" : "+") : ""}click`;
    else if (piece.word === "middle-click") text += "Middle-click";
    else text += ` ${piece.word} `;
    afterCap = "cap" in piece;
  }
  return text;
}

/** A combo as a screen reader should say it: "Command, K"; "Command, Q, then Command, Q". */
export function spokenKeys(combo: string): string {
  const words: string[] = [];
  let press: string[] = [];
  const flush = () =>
    press.length && (words.push(press.join(", ")), (press = []));
  for (const piece of keyPieces(combo)) {
    if ("cap" in piece) press.push(piece.spoken);
    else if (piece.word === "click") press.push("click");
    else if (piece.word === "middle-click") press.push("middle click");
    else (flush(), words.push(piece.word));
  }
  flush();
  return words.join(" ");
}

/** Menu bar keys main and the standard Edit, View and Window menus own: menu shortcuts never reach the page. */
const MAC_MENU_KEYS = [
  "cmd+h",
  "cmd+alt+h",
  "cmd+c",
  "cmd+v",
  "cmd+x",
  "cmd+a",
  "cmd+z",
  "cmd+shift+z",
  "cmd+alt+shift+v",
  "cmd+w",
  "cmd+m",
  "cmd+r",
  "cmd+shift+r",
  "cmd+alt+i",
  "cmd+0",
  "cmd+=",
  "cmd+plus",
  "cmd+shift+plus",
  "cmd+-",
  "cmd+ctrl+f",
];

/** The same on Windows and Linux, where Electron's menu roles use Ctrl (redo is Ctrl+Y) and full screen is F11. */
const MENU_KEYS_ELSEWHERE = [
  "ctrl+c",
  "ctrl+v",
  "ctrl+x",
  "ctrl+a",
  "ctrl+z",
  "ctrl+y",
  "ctrl+shift+z",
  "ctrl+w",
  "ctrl+r",
  "ctrl+shift+r",
  "ctrl+shift+i",
  "ctrl+0",
  "ctrl+=",
  "ctrl+plus",
  "ctrl+shift+plus",
  "ctrl+-",
  "f11",
];

/**
 * Keys project actions may not take over: every shortcut in the registry with a modifier (bare keys such as
 * Esc can't be an action's), and the menu bar's. An action on a menu key would never run. Worked out when
 * asked, as `mod` depends on the platform.
 */
export const reservedShortcuts = () =>
  new Set([
    ...SHORTCUTS.flatMap((s: ShortcutDef) =>
      s.reserve === false ? [] : s.keys.flatMap(comboPresses),
    ).filter((press) => press.includes("+")),
    ...(isMac() ? MAC_MENU_KEYS : MENU_KEYS_ELSEWHERE),
  ]);
