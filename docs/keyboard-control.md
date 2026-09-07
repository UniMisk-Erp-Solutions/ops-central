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
| `Tab` / `Shift+Tab` | move between fields — inside a dialog, stays inside it |
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
- **Adding a screen?** Add it to `opcNavGroups` and both the sidebar and the
  palette pick it up. Adding it to `KBD_GOTO` is optional and never grants
  access on its own.
