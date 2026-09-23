// Generates the site's favicon files from the VuePoint brand mark.
//
//   favicon.ico       16, 32, 48 in one file (the URL every browser and crawler
//                     asks for by default)
//   favicon-192.png   192x192, the one Google Search reads
//
// Why these exist at all: the page used to carry its icon as an inline
// `data:image/svg+xml` URI. That renders fine in a browser tab, but Google can
// only use a favicon it can fetch as a real URL, and only in BMP, GIF, ICO, PNG,
// JPEG, PPM or TIFF - SVG is not on that list. So a site whose only icon was an
// SVG data: URI showed the default globe in search results no matter how the tab
// looked. Google also recommends an icon larger than 48x48, hence the 192.
//
// Both files are binary, so this script is their only readable form: edit the
// numbers below and re-run rather than reaching for an image editor.
//
//   node make-favicon.js
var fs = require('fs');
var zlib = require('zlib');

// ------------------------------------------------------------- the brand mark
// Taken from the mark the page shipped as its favicon (a 32-unit viewBox): a
// filled teal disc with a white check struck across it, round caps and joins.
var VIEW = 32;
var DISC = { cx: 16, cy: 16, r: 14 };
var DISC_FILL = [13, 148, 136]; // #0D9488
var CHECK_POINTS = [[9.5, 16.2], [13.7, 20.4], [22.9, 11.0]];
var STROKE_HALF = 2.8 / 2; // half of the 2.8 stroke width, in viewBox units
var CHECK_COLOR = [255, 255, 255];
var SS = 4; // supersamples per axis, for antialiased edges

// Distance from a point to a line segment. Using segment distance (rather than
// polyline distance) is what gives the round caps and the round join for free:
// near an endpoint or a vertex the nearest point is the endpoint itself, so the
// covered region is exactly a disc of the stroke's radius.
function distToSegment(px, py, ax, ay, bx, by) {
  var dx = bx - ax;
  var dy = by - ay;
  var len2 = dx * dx + dy * dy;
  var t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  var qx = ax + t * dx - px;
  var qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

function checkDistance(ux, uy) {
  var d = Infinity;
  for (var i = 0; i < CHECK_POINTS.length - 1; i++) {
    var a = CHECK_POINTS[i];
    var b = CHECK_POINTS[i + 1];
    var s = distToSegment(ux, uy, a[0], a[1], b[0], b[1]);
    if (s < d) d = s;
  }
  return d;
}

// Renders the mark at `size` px as straight (un-premultiplied) RGBA.
//
// Colours are averaged only over the samples that landed inside the disc, and
// alpha is how many of them did. That ordering matters: averaging white/teal
// against the transparent outside instead would drag every edge pixel towards
// black and leave a dark ring around the circle.
function render(size) {
  var out = Buffer.alloc(size * size * 4);
  var scale = VIEW / size;
  var samples = SS * SS;

  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var sr = 0, sg = 0, sb = 0, inside = 0;
      for (var sy = 0; sy < SS; sy++) {
        for (var sx = 0; sx < SS; sx++) {
          var ux = (x + (sx + 0.5) / SS) * scale;
          var uy = (y + (sy + 0.5) / SS) * scale;
          var dx = ux - DISC.cx;
          var dy = uy - DISC.cy;
          if (dx * dx + dy * dy > DISC.r * DISC.r) continue; // outside the disc
          inside++;
          // The check is drawn over the disc, so it wins wherever it covers.
          var c = checkDistance(ux, uy) <= STROKE_HALF ? CHECK_COLOR : DISC_FILL;
          sr += c[0];
          sg += c[1];
          sb += c[2];
        }
      }
      var o = (y * size + x) * 4;
      out[o] = inside ? Math.round(sr / inside) : 0;
      out[o + 1] = inside ? Math.round(sg / inside) : 0;
      out[o + 2] = inside ? Math.round(sb / inside) : 0;
      out[o + 3] = Math.round((inside / samples) * 255);
    }
  }
  return out;
}

// ----------------------------------------------------------------- PNG writer
var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

// A single IDAT holding every scanline, each prefixed with filter type 0.
// Deflate does the compressing, so the file stays small despite the 192px size.
function encodePNG(rgba, size) {
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  var raw = Buffer.alloc(size * (size * 4 + 1));
  for (var y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ----------------------------------------------------------------- ICO writer
// Uncompressed 32-bit BMP entries rather than PNG-in-ICO. PNG entries are
// supported by modern browsers, but BMP is the encoding every ICO parser has
// understood for thirty years, and this file exists specifically for the one
// reader we cannot test against: Googlebot-Image.
function encodeICO(sizes) {
  var images = sizes.map(function (size) {
    var rgba = render(size);
    var header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0); // biSize
    header.writeInt32LE(size, 4); // biWidth
    header.writeInt32LE(size * 2, 8); // biHeight: XOR image + AND mask
    header.writeUInt16LE(1, 12); // biPlanes
    header.writeUInt16LE(32, 14); // biBitCount
    header.writeUInt32LE(0, 16); // biCompression: BI_RGB

    // XOR: BGRA, bottom-up.
    var xor = Buffer.alloc(size * size * 4);
    for (var y = 0; y < size; y++) {
      var src = (size - 1 - y) * size * 4;
      var dst = y * size * 4;
      for (var x = 0; x < size; x++) {
        xor[dst + x * 4] = rgba[src + x * 4 + 2]; // B
        xor[dst + x * 4 + 1] = rgba[src + x * 4 + 1]; // G
        xor[dst + x * 4 + 2] = rgba[src + x * 4]; // R
        xor[dst + x * 4 + 3] = rgba[src + x * 4 + 3]; // A
      }
    }

    // AND mask: 1 bit per pixel, rows padded to 4 bytes, bottom-up. Set only
    // where the pixel is transparent, which is what pre-alpha-channel ICO
    // readers use to find the holes.
    var rowBytes = Math.ceil(size / 32) * 4;
    var and = Buffer.alloc(rowBytes * size);
    for (var my = 0; my < size; my++) {
      var srcRow = (size - 1 - my) * size * 4;
      for (var mx = 0; mx < size; mx++) {
        if (rgba[srcRow + mx * 4 + 3] < 128) and[my * rowBytes + (mx >> 3)] |= 0x80 >> (mx & 7);
      }
    }

    return { size: size, data: Buffer.concat([header, xor, and]) };
  });

  var dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(images.length, 4);

  var offset = 6 + images.length * 16;
  var entries = images.map(function (img) {
    var e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size; // 0 means 256
    e[1] = img.size >= 256 ? 0 : img.size;
    e[2] = 0; // palette size, 0 for true colour
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
    return e;
  });

  return Buffer.concat([dir].concat(entries).concat(images.map(function (i) { return i.data; })));
}

// ----------------------------------------------------------------------- main
var ICO_SIZES = [16, 32, 48];

fs.writeFileSync('favicon.ico', encodeICO(ICO_SIZES));
fs.writeFileSync('favicon-192.png', encodePNG(render(192), 192));

console.log('favicon.ico     : ' + ICO_SIZES.join('/') + ' px, ' + fs.statSync('favicon.ico').size + ' bytes');
console.log('favicon-192.png : 192 px, ' + fs.statSync('favicon-192.png').size + ' bytes');
