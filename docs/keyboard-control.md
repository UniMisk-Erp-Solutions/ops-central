# Keyboard control

**Who:** everyone, on every screen
**Code:** `frontend/src/keyboard.jsx`, `Modal` in `frontend/src/utils.jsx`
**Test:** `scripts/uitest/keyboard-check.js`

---

## What it is

The people who use this software are accountants. They are faster and more
accurate on a keyboard than on a mouse, and they resent being made to reach for
one. Every screen can now be driven without touching it.

**`↑` and `↓` move through the list on the page** — no ceremony, just press
them. **`←` and `→` cross between the sidebar and the page.** Nothing here ever
touches browser history.

| Key | What it does |
|---|---|
| `Tab` / `Shift+Tab` | every button, tab, card, chip, swatch, list and field, in order |
| `Enter` / `Space` | press whatever is focused |
| `n` | the blue button this screen is for — new order, new GRN, create |
| `Ctrl + K` | the command palette — every screen and record, by name |
| `/` | jump to the search box on this screen |
| `g` then a key | go straight to a screen (`g s` sales orders, `g p` vendor POs, …) |
| `?` | the full list, on screen |
| `Esc` | close what is on top; from a field, leave the field |
| `Ctrl + Enter` | save the open dialog from any field, without walking to the end |
| `Enter` in a dialog field | next field — and on the last one, save |

The rows on the page — any row you can **act** on, whether it opens a record or
merely holds a tick box or a quantity to type:

| Key | What it does |
|---|---|
| `↓` `↑` | next row / previous row |
| `PgDn` `PgUp` | ten rows at a time *(once a row is selected)* |
| `Home` `End` | first / last row *(once a row is selected)* |
| `→` or `Enter` | open the row — or, if it opens nothing, step **into** its first field |
| `Space` | tick the box on it |
| `Tab` | onto a particular list — the whole list is one stop |

Across the screen:

| Key | What it does |
|---|---|
| `←` | to the sidebar, from anywhere on the page |
| `→` | out of the sidebar to the page; on the page, opens the selected row |
| `↑` `↓` in the sidebar | down the sidebar (`Enter` opens) |

The tabs on a record — Overview, Line Items + BOM, Procurement, Vendor POs, GRN,
Invoicing, Virtual Godown, Documents, Audit Log:

| Key | What it does |
|---|---|
| `]` `[` | next tab / previous tab, **from anywhere on the page** |
| `1` … `9` | straight to that tab |
| `←` `→` | along them, once one has focus |

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

### What the arrows do, and the two wrong answers before it

This took three goes, and both wrong answers are worth keeping written down.

**First it was global.** `↓` moved a row cursor on whatever table was on screen,
so a page could no longer be *scrolled* with the arrow keys, and `←` went **back
in browser history** from anywhere at all — one stray keypress from losing a
half-filled form.

**Then it was confined to a list you had to `Tab` onto first.** That fixed the
history, and made the arrows do nothing at all: on a screen that *is* a list of
orders, pressing `↓` scrolled the page instead of moving through the orders.
Correct, and useless.

What it does now:

- **`↑` `↓` drive the list on the page.** No ceremony. Moving the selection
  scrolls it into view, so nothing is lost by it — and on a screen with **no**
  list the handler swallows nothing and the page scrolls exactly as before.
- **`←` `→` cross between the sidebar and the page.** `←` goes to the sidebar,
  landing on the screen you are actually on; `→` comes back out, landing on the
  list. Before this, focus that arrowed into the sidebar could only escape by
  tabbing through every remaining link — on a wide screen, most of the app out of
  reach.
- **`Home`, `End`, `PgUp`, `PgDn` stay with the page** until a row is actually
  selected. Until then they mean top and bottom, and people already use them
  that way.
- **Nothing touches browser history.** The check asserts the words are not even
  in the file.

A list is still **one tab stop** when you Tab to it — a hundred-row table would
otherwise take a hundred presses to get past — and then the arrows are scoped to
*that* list. A screen holds several: an order has its vendor POs, its BOQs, its
documents. With nothing focused the arrows walk them in order down the page; Tab
onto one to stay inside it.

### What counts as a row

Most tables in this app are not lists of records at all. They are the bill of
materials, the receive lines, the tax lines, the allocation grid — rows that open
nothing, but that hold the tick boxes and quantities the work actually happens
in.

The first version only counted rows that **open** something, marked by the app's
own inline `cursor: pointer`. That meant `↑` `↓` did nothing on most of the
screens where they help most — the Virtual Godown detail, a GRN, the BOM. Which
is exactly what came back as "up and down aren't working".

A row counts when you can **do** something on it:

- it opens a record — the pointer cursor, as before, **or**
- it holds an enabled control — a tick box, a quantity, a button

A totals row has neither and is skipped: stopping the cursor on *Grand total*
helps nobody. A row whose only control is disabled is skipped too. `data-kbd-skip`
still opts one out by hand.

`→` follows from that. On a row that opens a record it clicks it, as before. On a
row that only holds controls it hands focus to the **first of them** — which is
what somebody working down a receive sheet wants next.

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

A wrapper that already holds a real control is **not** a second tab stop. Tab
landing on a card and then again on the button inside it is noise, and the button
is what somebody is aiming for.

Rows are deliberately **not** in the tab order either — their list is the tab
stop, and the arrows move within it.

A check walks the source and fails if a clickable element is ever written without
a pointer cursor — it would be invisible to this pass, and to the mouse user too,
who would get no hand cursor.

### Tab reaches the page in a few presses, not thirty

Everything was reachable long before it was *usable*. Tab walked all **22**
sidebar links before it got to the page at all, and then all nine tabs on a
record. Reachable but nobody would, which is the same as unreachable.

Groups that belong together are now **one tab stop each** — the sidebar, a strip
of tabs, the role switcher, a list of rows. The one that is *active* holds the
stop, and the arrows move between them once you are there. (A roving tabindex,
the standard shape for a composite widget, and the same shape a list of rows
already had.)

So the order across a screen is roughly: topbar buttons → sidebar → the tabs →
the buttons on the record → its list. Half a dozen presses to anything, instead
of thirty.

`←` out of the sidebar lands on the **first** control on the page in reading
order, not on the list — the buttons above it are where the actions are.

### A dialog owns the screen

While one is open — a `Modal`, or the notifications drawer — it is the only
thing that can be operated. `←` does not cross to the sidebar behind it, `]`
does not switch a tab it is covering, `g` cannot navigate out from under it, and
`/` does not hunt for a search box on the page beneath. Leaving an editing dialog
open over a page that has moved on is how somebody saves an edit onto the wrong
record.

Inside it, everything still works: the arrows drive its own rows, `Enter` opens
one, `Ctrl+Enter` saves, `Esc` closes.

The drawer is the one overlay in the app that is not a `Modal`, so it says all of
this for itself — stack, Escape, focus in, focus back, Tab trapped.

### Filling in a dialog

`Enter` moves to the next field, and on the last one presses the primary button.
Filling a dialog is the slowest thing anybody does in this app, and reaching for
Tab between every field is why; every accounting package this replaces has
worked this way for thirty years.

Only from a single-line input. A textarea keeps `Enter` for its newline, a
select and a button already do something with it, and any field can opt out with
`data-kbd-enter="ignore"`.

`Ctrl+Enter` still saves from anywhere without walking to the end. It is handled
in **one** place — the keyboard layer, not the dialog. If the dialog pressed the
button as well, one `Ctrl+Enter` would submit twice.

### The tabs on a record

An order carries nine tabs and they are the main way around it, so they get keys
of their own: `]` and `[` step along them and `1`–`9` go straight to one, from
anywhere on the page.

The side arrows already moved along them once a tab had focus. That was not
enough — focus arrives there several `Tab` presses in, and coming out of the
sidebar with `→` lands on the list, past them. A key nobody can reach is not a
feature.

Two details that matter:

- **The active tab is read from the page**, not from a counter this layer keeps.
  Somebody may have clicked a different tab with the mouse in between, and a
  counter would then step from the wrong place.
- **Switching a tab drops the row selection.** The panel underneath is about to
  be replaced, so a selected row is pointing at a table that will not be there.

On a screen with no tab strip nothing happens and the keys are left to the page —
a digit is then just a digit.

### Seeing where you are

A single accent-coloured ring is **invisible on a primary button**, which is
accent coloured itself — so the ring is two: a gap in the page colour, then the
accent outside it. That reads on white, on grey, on blue, and on a card. Until
this was fixed the buttons were perfectly focusable and simply looked like they
were not, which is the same thing to the person using them.

### Tabs and the sidebar

Once focus is on a tab, `←` and `→` move along the tabs. In the sidebar, `↑` and
`↓` move down it.

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
| `kbdRowUsable`, `kbdRowOpens` — what counts as a row | `frontend/src/keyboard.jsx` |
| `kbdIsClickable`, `kbdEnhance`, `kbdActivate` — the clickable divs | `frontend/src/keyboard.jsx` |
| `kbdLists`, `kbdIsInList` — a list as one tab stop | `frontend/src/keyboard.jsx` |
| `kbdPaneOf`, `kbdFocusSidebar`, `kbdFocusMain` — crossing the screen | `frontend/src/keyboard.jsx` |
| `kbdTabStrip`, `kbdTabButtons`, `kbdTabTo` — the tabs on a record | `frontend/src/keyboard.jsx` |
| `kbdRoving` — a group of buttons as one tab stop | `frontend/src/keyboard.jsx` |
| Roving stop for the sidebar | `Sidebar` in `frontend/src/shell.jsx` |
| `Enter` walking the fields | `Modal` in `frontend/src/utils.jsx` |
| `kbdGroupOf`, `kbdGroupMove`, `kbdVisible` — tabs and the sidebar | `frontend/src/keyboard.jsx` |
| `KeyboardLayer` — the one listener | `frontend/src/keyboard.jsx` |
| `CommandPalette`, `ShortcutHelp` | `frontend/src/keyboard.jsx` |
| `kbdCommands`, `kbdFilter` — what the palette offers | `frontend/src/keyboard.jsx` |
| Overlay stack | `frontend/src/keyboard.jsx` (`opcOverlayPush/Pop/Top`) |
| Focus trap, autofocus, focus restore, `Esc` | `Modal` in `frontend/src/utils.jsx` |
| The one nav list | `opcNavGroups` in `frontend/src/shell.jsx` |
| Styles — selected row, focus ring, palette, key caps | `frontend/src/styles.css` |
| Checks — the engine | `scripts/uitest/keyboard-check.js` |
| Checks — every real screen | `scripts/uitest/reach-check.js` |

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
- **Never take a key globally that the browser already gives the user.** `Alt+←`
  goes back and `Home`/`End` mean top and bottom. Taking those made a working
  feature feel broken. A key is only free when nothing else wanted it *in that
  context*.
- **Test the engine AND the screens.** Every rule here was right in isolation
  for two rounds while the arrows did nothing on half the app, because no test
  ever pointed the engine at a real screen. `reach-check` renders all 31 with an
  order, POs, a GRN, an invoice and a BOQ in the tenant, and presses Down on
  each. It found two crashes on its first run that had nothing to do with the
  keyboard — see [testing.md](./testing.md).
- **Count the presses, not the possibilities.** Every control was reachable by
  Tab for two rounds of this, and it still felt broken, because reaching the page
  cost thirty presses. A group that belongs together is one stop.
- **A roving group's members are `tabindex="-1"` on purpose.** Exactly one holds
  the tab stop; the rest are -1 so Tab passes the group in one press. Anything
  that walks the group — `kbdGroupMove` — must therefore include -1, or it finds
  a single member, moves it to itself, and the arrows look dead. That is exactly
  what happened to the sidebar the moment it became one tab stop, and the test
  fixture hid it by giving every link `tabindex="0"`, which the real sidebar
  never has.
- **A fixture that is tidier than reality proves nothing.** Write the awkward
  shape the app actually renders.
- **Whatever has focus wins its own keys.** A row being selected somewhere on
  the page must never stop the button under your finger from being pressed. For
  a while `Enter` meant "open the selected row" everywhere, so tabbing to
  *New Sales Order* and pressing `Enter` opened a row instead and the button
  visibly did nothing — the worst thing a key can do.
- **Guard the key, not the branch.** The fix above was first written as a bare
  `if (control) return null` before the arrow handling, which swallowed `Enter`
  before the line that handles it and killed every button on the page. Scope a
  guard to the keys it is about.
- **A guard written for a rule that has since changed becomes a bug.** Left and
   right were blocked on a focused control back when left meant "go back in
   browser history". Left has crossed to the sidebar for a while, and the guard
   survived it — stranding anybody who tabbed into the page, with no arrow back
   to the sidebar. When a key's meaning changes, re-read every guard on it.
- **One owner per key.** `Ctrl+Enter` is the keyboard layer's; if the dialog
  handled it too, a single press would submit twice. The check asserts the
  dialog leaves it alone.
- **A shortcut nobody can reach is not a feature.** The side arrows moved along
  the record tabs from the day they were written, and it did not count, because
  getting focus onto a tab took several presses. Ask how somebody arrives at a
  key, not only what it does once they are there.
- **Read the state from the page, never from a counter here.** The active tab,
  the selected row and the open dialog are all things the user can change with
  the mouse between two keystrokes.
- **A pane you can enter must be a pane you can leave.** `←` into the sidebar
  without `→` back out is a trap, and it will not be obvious in a test that only
  asks whether the key moved focus.
- **A focus ring must be visible on the accent colour too.** A primary button is
  accent coloured, so an accent ring on it is invisible.
- **`cursor` inherits — never read the computed one** when deciding whether
  something is a control. `kbdIsClickable` reads the element's own inline style
  for exactly this reason, and the check asserts a div inside a clickable row is
  not picked up.
- **`offsetParent` is null for everything in a test**, which has no layout, and
  for anything positioned `fixed` in a real browser. `kbdVisible` uses it as a
  fast path and falls back to the computed `display`. The dialog's own field
  walking and focus trap were written with the raw check and had to be moved
  onto the helper — the same trap, caught twice.
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
