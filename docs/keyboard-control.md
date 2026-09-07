# Keyboard control

**Who:** everyone, on every screen
**Code:** `frontend/src/keyboard.jsx`, `Modal` in `frontend/src/utils.jsx`
**Test:** `scripts/uitest/keyboard-check.js`

---

## What it is

The people who use this software are accountants. They are faster and more
accurate on a keyboard than on a mouse, and they resent being made to reach for
one. Every screen can now be driven without touching it.

| Key | What it does |
|---|---|
| `↓` `↑` | next row / previous row |
| `PgDn` `PgUp` | ten rows at a time |
| `Home` `End` | first row / last row |
| `→` or `Enter` | open the selected row |
| `←` | drop the selection, then go back |
| `Space` | tick the box on the selected row |
| `Ctrl + K` | the command palette — every screen and record, by name |
| `/` | jump to the search box on this screen |
| `g` then a key | go straight to a screen (`g s` sales orders, `g p` vendor POs, …) |
| `?` | the full list, on screen |
| `Esc` | close what is on top; from a field, leave the field |
| `Tab` / `Shift+Tab` | every button, tab, card, chip, swatch and field, in order |
| `Enter` / `Space` | press whatever is focused |
| `←` `→` on a tab | along the row of tabs, switching as it goes |
| `↑` `↓` in the sidebar | down the sidebar (`Enter` opens) |
| `Ctrl + Enter` | the primary button of the open dialog: save, create, confirm |

The selected row is marked down the left in the accent colour. `?` shows the
whole list without leaving the screen.

## How it works

### The rule everything else is built around

**A shortcut must never fire while somebody is typing.**

An accountant entering a part number presses `g`, `s`, `/`, space and every
arrow key in the course of ordinary work. If any of those jumped to another
screen, their entry would be gone — and they would never trust the software
again.

So the decision of what a keystroke *means* is a pure function, `kbdResolve`,
which takes the event and a context and returns an action or nothing. It is not
trusted, it is tested: every shortcut is asserted dead in a text field, in a
number field, in a dropdown, in a date box and in anything contenteditable.

Three keys reach through a field, because they have to: `Esc`, `Ctrl+K` and
`Ctrl+Enter`. Nothing else does.

Two more rules fall out of the same principle:

- **The browser keeps its own shortcuts.** `Ctrl+C`, `Ctrl+F`, `Ctrl+R`,
  `Ctrl+A`, `Alt+←` — all untouched. This layer claims `Ctrl+K` and
  `Ctrl+Enter` and nothing else with a modifier on it.
- **A focused control keeps `Enter` and `Space`.** A button already acts on
  them. Without this, one press of `Enter` on a *Create* button would press the
  button *and* open whatever row the cursor was on — two things from one
  keystroke, the second one invisible.

### Everything you can click

Half the controls in this app are a `div` with an `onClick` — the tabs across an
order, the document cards, the colour swatches, the vendor chips, an order
number rendered as text. **A `div` is invisible to `Tab`**, so none of them could
be reached without a mouse however many shortcuts existed.

Rather than edit seventy of them by hand, they are found and fixed at runtime
through the signal the app already uses to mean *you can click this*: the pointer
cursor. Anything carrying one gets `tabindex="0"`, `role="button"` and an
`Enter`/`Space` that presses it.

The pass runs on a `MutationObserver`, batched to one pass per animation frame.
Screens re-render constantly as data syncs and filters change, and a control that
appeared a moment ago has to be reachable too — but doing the work on every
mutation would make typing stutter on a long screen. The observer watches
`childList` only, never attributes, so the attributes it sets cannot re-trigger
it.

> **The trap: `cursor` inherits.** Every `div` inside a clickable row *computes*
> as `pointer`, so `getComputedStyle` would put half the page in the tab order.
> What is read is the element's **own inline style**, which React has already
> resolved — so `cursor: x ? 'pointer' : 'default'` reads as exactly one of them,
> and a disabled chip is correctly left out.

Rows are deliberately **not** in the tab order: a hundred-row list would take a
hundred presses to get past. They have the arrow cursor instead.

A check walks the source and fails if a clickable element is ever written without
a pointer cursor — it would be invisible to this pass, and to the mouse user too,
who would get no hand cursor.

### Tabs and the sidebar

Once focus is on a tab, `←` and `→` move along the tabs rather than meaning what
they mean everywhere else. In the sidebar, `↑` and `↓` move down it.

The two behave differently on purpose:

- **a tab switches as focus lands on it.** It only swaps a panel that is already
  on the page — cheap, reversible, and needing a second key for it would be
  tedious.
- **the sidebar moves without opening.** Navigating leaves the page, and an
  arrow key must never do that on its own. `Enter` opens.

With anything focused, `←` and `→` no longer go back or open a row. Going back in
history because somebody pressed left on a button is the kind of surprise that
loses work.

### The row cursor

Read from the DOM on every keystroke, never cached.

Every clickable row in this app carries an inline `cursor: pointer`, and that is
how the cursor finds them. It means **no screen had to change** to take part —
forty screens written before this existed all work — and a screen written
tomorrow gets keyboard control for free. A row can opt out with `data-kbd-skip`.
Total rows and header rows are not clickable, so they are skipped already.

`Enter` calls `row.click()`, a real click, so the screen's own handler runs. This
layer knows nothing about what any particular row does, and must not.

The cursor is held as an **attribute**, `data-kbd-cursor`, not a class. React
rewrites `className` when a row re-renders and would wipe a class mid-list; it
leaves alone attributes it never set.

When a dialog is open the cursor scopes itself to the dialog, so the list
underneath can never be moved by a keystroke aimed at the dialog.

### The command palette

`Ctrl+K` opens it. It searches every screen the role may open, plus their
records — sales orders, vendor POs, GRNs, customers, vendors, products — by
number, by name, and by customer or vendor name.

Screens come from `opcNavGroups`, **the same list the sidebar renders**. Two
lists would drift, and a palette offering a screen the sidebar hides would be a
way around the role's permissions rather than a convenience. Records are only
offered when their screen is in that list, for the same reason. The check walks
every role and asserts nothing is offered that the sidebar does not show.

`g` then a key is the same idea without the dialog. The table only names screens
that exist, and the handler still asks `canAccess` and `featureBlocks` before
going anywhere — so the table can never widen anybody's access.

### Dialogs

`Modal` gained four things, and all of them are on every dialog in the app at
once:

- **the first field takes focus** when it opens, so typing starts straight away
  — never a checkbox, which `Space` would then toggle instead of scrolling
- **`Tab` stays inside.** Tabbing out of a dialog and into the page behind it is
  how somebody edits the wrong record
- **focus goes back where it came from** when it closes, not to the top of the
  page
- **`Esc` closes the top one, and only the top one**

That last one fixed a bug that was already there. Every dialog used to add its
own `keydown` listener on the window, so one `Esc` closed *all* of them — a
dialog opened from inside another took its parent down with it. They now share
one overlay stack and only the top responds.

## Why it is that way

**Why read rows from the DOM instead of wiring each screen up?** Because there
are forty screens and one of me. A per-screen registration would have meant
forty edits, forty chances to get it wrong, and every new screen silently
missing out. The inline `cursor: pointer` was already there on every clickable
row, and it means "a person can act on this" — exactly the question being asked.

**Why is `←` back rather than a column move?** These are lists of documents, not
spreadsheets. There is no meaningful cell to the left. Going back is what
somebody actually wants after opening the wrong order, and it costs nothing to
reach.

**Why does `←` clear the selection before going back?** So the key has an
undo. Press it once and the highlight goes; press it again and you leave.

**Why `Ctrl+Enter` for the primary button and not plain `Enter`?** Plain `Enter`
in a form submits it, and half these dialogs have a field where `Enter` should
do something else. `Ctrl+Enter` is unambiguous and means the same thing in every
dialog.

**Why does the palette rank the way it does?** What starts with what you typed
first, then what contains it, then letters-in-order. So `PO2026` finds the
purchase order, `abg` finds that customer's orders, and `vpo` finds *Vendor POs*
without matching half the list.

## Where the code is

| Thing | Where |
|---|---|
| `kbdResolve` — what a keystroke means | `frontend/src/keyboard.jsx` |
| `kbdIsTyping`, `kbdIsControl` — the two guards | `frontend/src/keyboard.jsx` |
| `kbdRows`, `kbdMove`, `kbdOpenRow`, `kbdTickRow` — the cursor | `frontend/src/keyboard.jsx` |
| `kbdIsClickable`, `kbdEnhance`, `kbdActivate` — the clickable divs | `frontend/src/keyboard.jsx` |
| `kbdGroupOf`, `kbdGroupMove`, `kbdVisible` — tabs and the sidebar | `frontend/src/keyboard.jsx` |
| `KeyboardLayer` — the one listener | `frontend/src/keyboard.jsx` |
| `CommandPalette`, `ShortcutHelp` | `frontend/src/keyboard.jsx` |
| `kbdCommands`, `kbdFilter` — what the palette offers | `frontend/src/keyboard.jsx` |
| Overlay stack | `frontend/src/keyboard.jsx` (`opcOverlayPush/Pop/Top`) |
| Focus trap, autofocus, focus restore, `Esc` | `Modal` in `frontend/src/utils.jsx` |
| The one nav list | `opcNavGroups` in `frontend/src/shell.jsx` |
| Styles — selected row, focus ring, palette, key caps | `frontend/src/styles.css` |
| Checks | `scripts/uitest/keyboard-check.js` |

## Traps

- **Never widen the guard in `kbdIsTyping`.** A `SELECT` is typing: the arrows
  belong to the dropdown. A checkbox is not: `Space` must still tick it.
- **The cursor must stay an attribute.** Move it to a class and it will vanish
  the next time the row re-renders, which is every time the data syncs.
- **`react-dom` decides at load whether it is in a browser.** In the check, the
  DOM globals are installed *before* it is required. The other way round it
  falls back to an IE-era polyfill and throws on the first focus.
- **jsdom swallows what a listener throws** and reports it to its virtual
  console — no process-level handler sees it. The check traps `jsdomError`, and
  tests that the trap fires, or a crash inside a keystroke would print a stack
  and still report PASS.
- **`cursor` inherits — never read the computed one** when deciding whether
  something is a control. `kbdIsClickable` reads the element's own inline style
  for exactly this reason, and the check asserts a div inside a clickable row is
  not picked up.
- **`offsetParent` is null for everything in a test**, which has no layout, and
  for anything positioned `fixed` in a real browser. `kbdVisible` uses it as a
  fast path and falls back to the computed `display`.
- **A JSX tag cannot be matched with a regex.** `onClick={e => …}` contains a
  `>` that does not end the tag; the source scan walks to the `>` at brace depth
  zero instead. The first version of that scan silently reported ten false
  positives.
- **Writing a new clickable?** Give it `cursor: pointer`. The mouse user needs
  the hand cursor and the keyboard user needs the tab stop, and both come from
  that one declaration. The check enforces it.
- **Adding a screen?** Add it to `opcNavGroups` and both the sidebar and the
  palette pick it up. Adding it to `KBD_GOTO` is optional and never grants
  access on its own.
