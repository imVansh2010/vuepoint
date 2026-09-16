// Builds every shipped artifact from bookmarklet.js:
//
//   bookmarklet.min.js    terser-minified, pure ASCII
//   bookmarklet.raw.txt   the javascript: URL you can paste into a bookmark
//   index.html            the landing page, with that URL on the drag button
//
// Two hard-won rules live here:
//
// 1. A javascript: URL is PERCENT-DECODED before the browser runs it. So any
//    raw "%" followed by two hex digits becomes a control character and the
//    whole script dies with a SyntaxError - silently, nothing on screen. Our
//    modulo code (`n % 10 === 0`) hit exactly that. Every "%" is therefore
//    escaped as %25 so it round-trips, and the final URL is asserted to contain
//    no unescaped "%".
//
// 2. The URL is forced to pure ASCII first. Non-ASCII characters would be
//    re-encoded on the way in, and the decoded result would not be the code we
//    tested. Every non-ASCII character in the bookmarklet lives inside a string
//    literal, so its \uXXXX escape is exactly equivalent.
//
// Run with: node build.js
var fs = require('fs');
var child = require('child_process');

var BACKSLASH = String.fromCharCode(92);

function fail(msg) {
  console.error('build failed: ' + msg);
  process.exit(1);
}

// ---------------------------------------------------------------- 1. minify
console.log('minifying bookmarklet.js ...');
// One shell string (not an args array) so this works the same in cmd.exe,
// PowerShell and bash, and so Node does not warn about unescaped args.
var t = child.spawnSync(
  'npx --yes terser bookmarklet.js --compress --mangle -o bookmarklet.min.js',
  { stdio: 'inherit', shell: true }
);
if (t.status !== 0) fail('terser exited with code ' + t.status);

// ------------------------------------------------- 2. force the build to ASCII
function toAscii(s) {
  return s.replace(/[^\x20-\x7E]/g, function (ch) {
    return BACKSLASH + 'u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
  });
}

var min = fs.readFileSync('bookmarklet.min.js', 'utf8').trim();
var ascii = toAscii(min);
if (ascii !== min) {
  fs.writeFileSync('bookmarklet.min.js', ascii + '\n');
  console.log('escaped ' + (min.length - ascii.length ? 'non-ASCII characters' : '') + ' in bookmarklet.min.js to pure ASCII');
}
if (/[^\x20-\x7E]/.test(ascii)) fail('bookmarklet.min.js is still not ASCII');

var js = ascii.indexOf('javascript:') === 0 ? ascii.slice('javascript:'.length) : ascii;

// A minified build that does not parse can never be debugged from the browser,
// so refuse to emit anything at all.
try {
  new Function(js);
} catch (e) {
  fail('bookmarklet.min.js is not valid JavaScript - ' + e.message);
}

// ---------------------------------------------------------------- 3. the URL
var url = 'javascript:' + js.replace(/%/g, '%25');

if (/[^\x20-\x7E]/.test(url)) fail('URL is not ASCII');
var badPercent = url.match(/%(?!25)/g);
if (badPercent) fail(badPercent.length + ' unescaped percent sign(s) would be decoded by the browser');

// Prove the URL round-trips: decode it exactly as the browser will before it
// executes, and check the result is still the code we tested.
var decoded = decodeURIComponent(url.slice('javascript:'.length));
if (decoded !== js) fail('decoding the URL did not reproduce the bookmarklet');
try {
  new Function(decoded);
} catch (e) {
  fail('the decoded bookmarklet is not valid JavaScript - ' + e.message);
}
console.log('decoded URL is byte-identical to bookmarklet.min.js and parses');

// ------------------------------------------------------------ 4. landing page
var attr = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
var tpl = fs.readFileSync('index.template.html', 'utf8');

var anchor = '<a id="vuepoint-bookmarklet" class="drag-btn" href="#"';
if (tpl.indexOf(anchor) === -1) fail('bookmarklet anchor not found in index.template.html');

// Function replacer, NOT a string: the bookmarklet contains "$&" and a string
// replacement would expand it to the matched text, corrupting the URL.
var out = tpl.replace(anchor, function () {
  return '<a id="vuepoint-bookmarklet" class="drag-btn" href="' + attr + '"';
});

if (out.indexOf('href="' + attr) === -1) fail('bookmarklet URL was not injected intact');
if (out.indexOf('__BOOKMARKLET__') !== -1) fail('an unreplaced template placeholder is still in index.html');

var inPage = out.slice(out.indexOf('href="' + attr) + 6, out.indexOf('href="' + attr) + 6 + attr.length);
if (inPage !== attr) fail('the URL in index.html does not match bookmarklet.raw.txt');

fs.writeFileSync('index.html', out);
fs.writeFileSync('bookmarklet.raw.txt', url + '\n');

console.log('bookmarklet.raw.txt : ' + url.length + ' chars, ASCII, every % escaped');
console.log('index.html          : ' + out.length + ' bytes');
