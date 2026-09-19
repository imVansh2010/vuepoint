# VuePoint

A bookmarklet that turns a StudentVUE gradebook into a what-if calculator. Click
it on a gradebook page and a small panel opens over the portal: edit any score,
add hypothetical assignments, and watch the overall grade update as you type.
Nothing is saved and nothing leaves the tab.

## Using it

1. Open `index.html` (or the hosted copy) in a browser on a laptop, desktop or
   Chromebook.
2. Drag the VuePoint button onto the bookmarks bar. `Ctrl + Shift + B` shows the bar.
3. Open a class gradebook in StudentVUE and click the VuePoint bookmark.

It runs from a bookmarks bar, so phones and tablets cannot use it.

## How the grade is worked out

Two totals are always computed, and both appear in the panel header:

- **Total points**: total earned divided by total possible.
- **Weighted**: each category's own percentage, averaged by the category weights.

The toggle picks which one drives the big number. On load VuePoint compares both
against the grade StudentVUE is showing and defaults to whichever matches. A
category with a 0 or blank weight is left out of the weighted total.

Reading the page is deliberately defensive, because schools run different
StudentVUE versions. VuePoint scans tables, ARIA grids and row groups inside
every frame it is allowed to read, scores each candidate on how much it looks
like a gradebook, and parses the winner. Category weights come from the
"Grade Calculation Summary" table when it exists; otherwise from the totals row.

## Files

Edit these:

- `bookmarklet.js`: the whole bookmarklet. Page parsing, grade maths, panel UI.
- `index.template.html`: the landing page, with a placeholder where the
  bookmarklet URL is injected.
- `build.js`: the build script. Plain Node, no dependencies.

Generated, do not edit:

- `index.html`: the built page with the bookmarklet embedded. This is the file
  you host.
- `bookmarklet.min.js`, `bookmarklet.raw.txt`: intermediates from the same build.

## Build

Node is the only requirement. There is no `package.json` and nothing to install
(the minifier is fetched by `npx` on the first run).

```bash
node build.js
```

Run that after editing `bookmarklet.js` or `index.template.html`. It minifies,
escapes the URL and refuses to write `index.html` unless the bookmarklet URL
decodes back to code that still parses. That check exists because a
`javascript:` URL is percent-decoded before the browser runs it, which is how a
dead bookmarklet once shipped.

## Off StudentVUE

The panel only reads StudentVUE. Opened anywhere else it shows the short route
back to a gradebook (sign in, Grade Book, pick a class, click the bookmark
again) rather than an empty gradebook or a set of controls that cannot do
anything on that page. It decides which of the two to show from signals the
portal writes itself: its hostname, its page title, its globals, its element ids
and its script names.

The portal also names an advisory class in its focus payload before any class has
been picked, and always has one in its class list. That name is never used, since
the class it belongs to is not the one on screen: with no class open the panel
says "No class selected", and a class with nothing posted yet still shows the
class the portal named.

## Test

There is a local test harness covering the parse paths, run against both the
readable source and the built file:

```bash
node mktest.js                           # against the readable source
node mktest.js bookmarklet.min.js -min   # against the shipped build
```

It is not in this repo. Its strongest fixtures are rebuilt from a saved copy of a
real gradebook page, so they carry a student id, a district portal domain, a
teacher name and real scores. Each run writes `test-run*.html`; open one in a
browser and it prints its assertions, ending in `ALL CHECKS PASSED` or a list of
failures.

## License

None chosen yet. Until one is added, all rights are reserved.
