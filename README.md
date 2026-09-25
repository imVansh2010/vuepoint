# VuePoint

A bookmarklet that calculates hypothetical grades on StudentVUE. Click it on a
class gradebook and a panel opens over the page: add an assignment, tweak a
category, or change a score, and the overall grade updates as you type.
Everything runs locally in your tab. Nothing is saved, and nothing is sent
anywhere.

## Using it

1. Open <https://vuepoint.vercel.app/> in a browser on a laptop or desktop.
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

The big number also carries a letter, and every cut-off sits on a half point:
92.5% is an A, 89.5% an A-, and so on down the scale. That is deliberate — a
grade rounds to the nearest whole percent before it takes a letter, so a 92.5
belongs with the 93s, not below them.

Schools run different StudentVUE versions, so VuePoint assumes nothing about the
markup. It scans tables, ARIA grids and row groups inside every frame it can
read, scores each candidate on how much it looks like a gradebook, and parses
the winner. Category weights come from the
"Grade Calculation Summary" table when it exists; otherwise from the totals row.

**Why it reads the screen rather than the gradebook's own data.** Synergy holds
the same assignment list VuePoint reads, so a probe was run on a live class to
see whether reading that list would be more exact than reading the page. On this
district's portal it would not. The computed grade object is never built at all -
`AssignmentsGridWhatIfCalcObject` is absent, because Synergy withholds its what-if
calculator from classes on an "interpretation scale" - and what is left is the
assignment grid, whose rows carry the same display strings the page already
shows (`"10 out of 10.0000"`, `"11.0000 Points Possible"`). Reading them would be
swapping one string-parsing job for another, on a less-proven path, so the page
stays the source.

**One hard limit that follows from it.** The grid is configured
`paging: {enabled: true, pageSize: 100}`, so StudentVUE renders 100 assignment
rows per page. A class with more than 100 assignments in a grading period would
be read from its first page only, and the total would come out short - a scheme
VuePoint cannot detect from the page, and cannot correct, because it makes no
network request and so cannot ask for page 2. No class here is within an order of
magnitude of that, and the panel would have to guess at a pager's wording to warn
about it, so it is recorded here rather than half-guarded in code.

## Tech stack

No frameworks, no dependencies, no server: the whole thing is plain JavaScript,
HTML and CSS.

- **Bookmarklet**: vanilla JavaScript in one file. The panel is built with DOM
  APIs rather than a framework so the entire thing can minify down to a URL a
  browser runs from a bookmark.
- **Build**: plain Node, no packages to install. The only external tool is
  terser, fetched by `npx` on the first run to minify `bookmarklet.js`.
- **Hosting**: a static `index.html` on Vercel. Nothing runs server-side.
- **Tests**: a local Node harness (`mktest.js`, not in this repo) run against
  both the source and the shipped build.

## Files

Edit these:

- `bookmarklet.js`: the whole bookmarklet. Page parsing, grade maths, panel UI.
- `index.template.html`: the landing page, with a placeholder where the
  bookmarklet URL is injected.
- `build.js`: the build script. Plain Node, no dependencies.
- `make-favicon.js`: draws the brand mark into the three icon files. Edit the
  numbers at the top rather than an image editor, then re-run it.

Generated, do not edit:

- `index.html`: the built page with the bookmarklet embedded. This is the file
  you host; what is live at <https://vuepoint.vercel.app/> is this file.
- `bookmarklet.min.js`, `bookmarklet.raw.txt`: intermediates from the same build.
- `favicon.ico`, `favicon-192.png`, `apple-touch-icon.png`: the site's icons,
  from `node make-favicon.js`. They are committed because they are what search
  engines and browsers fetch.

## Build

Node is the only requirement. There is no `package.json` and nothing to install
(the minifier is fetched by `npx` on the first run).

```bash
node build.js
```

Run that after editing `bookmarklet.js` or `index.template.html`. It refuses to
run at all while the version differs between `VPVER`, the `vuepoint-version`
meta tag and the footer badge (three hand-edited places that must move
together), then minifies, escapes the URL and refuses to write `index.html`
unless the bookmarklet URL decodes back to code that still parses. That check
exists because a `javascript:` URL is percent-decoded before the browser runs
it, which is how a dead bookmarklet once shipped. Deploying is then just the
rebuilt `index.html`, which is what Vercel serves.

## Shipping an update

A bookmarklet cannot update itself. Its URL is copied into the bookmarks bar at
install time and no page is allowed to rewrite a bookmark, so an installed copy
stays on the version it was installed at, and the user has to drag the button
across again.

What the landing page can do is notice that this is needed. When the button is
dragged - or its link copied - the version the page ships is written to
`localStorage`. The next visit compares that record with the version the page is
now serving, and if they differ the install card says so: *"VuePoint v1.1 is
out. The copy in your Bookmarks Bar is v1.0. Drag the button above onto the bar
again and replace the old bookmark to update it."* Dragging it again clears the
notice.

It is local only: no cookie, no request, nothing sent. The record is per
browser, so a bookmark installed in one browser cannot be seen from another and
simply gets no notice, and a visitor who never returns to the site cannot be
warned at all.

Bump the version in all three places when shipping a release, then
`node build.js`:

- `bookmarklet.js`: `VPVER` at the top of the file. It is the only version
  string in there - it stamps `data-vuepoint-version` on the panel and prints
  the version in the panel footer.
- `index.template.html`: the `<meta name="vuepoint-version">` the notice reads.
- `index.template.html`: the badge in the footer.

The panel footer also carries the version and a link back to the site, for
anyone whose copy is misbehaving: they open the site in a new tab and drag the
button across again. A bookmarklet that runs on a foreign page cannot reach
anything of ours by itself, so a click that opens the site is the only route
left that does not turn every open into a network request.

## The whole schedule

The page you land on when you click Grade Book - before opening a class - lists
every class with the mark StudentVUE is showing for it. That is the only page in
the portal that holds more than one class at once, so it is the one place an
overview of the whole schedule can come from, and VuePoint reads it as exactly
that: period, course and mark, one line per class.

It deliberately reads no weights, no grade and no class name from that page,
because no single class is open there to attribute any of them to. Read as a
gradebook it went badly wrong once: the category weights of all eight classes
were merged into one set (picking up a `NaN` key from a stray cell), a 100% page
grade was invented out of the class rows, and the panel announced "nothing is
posted for this class yet" while no class was open at all.

A class list is only acted on when it holds at least two classes, and its
markers - `data-guid` groups carrying a `.course-title` and a `span.mark` - do
not appear anywhere on a class gradebook, so the two pages can never be confused
for each other. Open a class, let it load, then click the bookmark again to run
what-ifs on it.

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

## Search and structured data

The `<title>` and `meta description` in `index.template.html` are written for a
search result, not for the page: the title leads with the brand and then the
phrase people actually type ("StudentVUE grade calculator"), and the description
opens with "StudentVUE hypothetical grade calculator", names both things the
tool does, and closes on the trust facts. It is 149 characters, inside the ~155 a
result shows before Google truncates.

Nothing in the title, the description or the structured data says the grade
"updates". It reads as a claim that the real grade changed, which is the one
thing VuePoint never does, so both say what the grade *would be* instead, and the
schema names that distinction outright.

The canonical link names `https://vuepoint.vercel.app/` as the one URL for this
site, so Vercel's per-deployment hostnames do not compete with it.

The favicon is real files rather than an inline SVG for one reason: the icon in
a search result has to be a real file that Google can crawl, in BMP, GIF, ICO,
PNG, JPEG, PPM or TIFF. SVG is not on that list, and a `data:` URI has no URL to
fetch, so the SVG icon that looked right in a browser tab left Google showing the
default globe. `favicon.ico` covers the path browsers request by default and
`favicon-192.png` is the one Google reads, since it asks for something larger
than 48x48. `apple-touch-icon.png` is what iOS shows when the page is saved to a
home screen: a full-bleed 180px tile, because iOS renders transparent corners
black. All are generated by `node make-favicon.js`, and all live at fixed URLs
because Google warns that a favicon URL which moves may be ignored.

The same head carries the Google Search Console verification tag. Google offers
an HTML file at the site root as an alternative; the meta tag was kept instead,
because it lives in the file that is already the source of truth and leaves no
stray file to lose on a host that serves this repo's root directly. Google
re-checks it periodically, so deleting the tag un-verifies the property.

The structured data is a two-node `@graph`: a `WebSite` and the
`SoftwareApplication` describing the tool as a free educational web app. It makes
no claims we cannot support - no `aggregateRating`, no `review`, no screenshot,
no `softwareVersion`. Two of those are deliberate and should stay that way: an
invented rating is a structured-data guidelines violation rather than a
shortcut, and a `softwareVersion` would add a fourth place to bump on every
release, where a stale version claim is worse than no claim.

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

The Grade Book landing page gets its own generator, because none of the
`mktest.js` fixtures cover it:

```bash
node make-classlist-fixture.js                      # against the readable source
node make-classlist-fixture.js bookmarklet.min.js -min
```

It asserts the eight classes it must read, that the panel names the page rather
than a class, and - the part that regressed before - that no gradebook section
and no scraped weights or grade appear alongside them. Like the harness it needs
its capture, `test-gradebook-classlist.html`, and skips itself without it.

The ungraded row gets its own generator, because a probe of a live class showed
the same column written two different ways:

```bash
node make-ungraded-points-fixture.js                      # against the readable source
node make-ungraded-points-fixture.js bookmarklet.min.js -min
```

Every other fixture describes the Points cell of an assignment with no score yet
as `10.00/10.0000` - earned over possible. On the portal it can also read
`11.0000 Points Possible`: possible points with a label, no earned side, no
slash. One column, two shapes, and only one of them was ever covered. An
ungraded row has to come through both alike - present in the list, score box
empty, possible points kept, and the grade unmoved. The generator rewrites only
the rows that have no score, refuses to run if that leaves the graded row
damaged, and exits non-zero if the capture no longer matches, so it can never
pass by accident. Needs `test-gradebook-devexpress-ungraded.html`.

`node mk-runner.js` then collects every `test-run*.html` into `test-all.html` as
iframes, which is the quickest way to read the whole suite in one go.

## License

None chosen yet. Until one is added, all rights are reserved.
