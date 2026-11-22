(function (internal) {
  'use strict';

  var decoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;

  function text(bytes) {
    if (decoder) return decoder.decode(bytes);
    var result = '';
    for (var i = 0; i < bytes.length; i += 1) result += String.fromCharCode(bytes[i]);
    return result;
  }

  function safePath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    var normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalized.charAt(0) === '/' || /(^|\/)\.\.(\/|$)/.test(normalized)) return null;
    return normalized;
  }

  function findEocd(view) {
    var length = view.byteLength;
    var minimum = Math.max(0, length - 65557);
    for (var offset = length - 22; offset >= minimum; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    throw new Error('Not a valid ZIP archive');
  }

  function readEntries(buffer) {
    var view = new DataView(buffer);
    var eocd = findEocd(view);
    var count = view.getUint16(eocd + 10, true);
    var offset = view.getUint32(eocd + 16, true);
    var bytes = new Uint8Array(buffer);
    var entries = Object.create(null);

    for (var i = 0; i < count; i += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error('ZIP central directory is corrupt');
      }
      var method = view.getUint16(offset + 10, true);
      var compressedSize = view.getUint32(offset + 20, true);
      var uncompressedSize = view.getUint32(offset + 24, true);
      var nameLength = view.getUint16(offset + 28, true);
      var extraLength = view.getUint16(offset + 30, true);
      var commentLength = view.getUint16(offset + 32, true);
      var localOffset = view.getUint32(offset + 42, true);
      var name = text(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');
      entries[name] = {
        method: method,
        compressedSize: compressedSize,
        uncompressedSize: uncompressedSize,
        localOffset: localOffset
      };
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return { view: view, bytes: bytes, entries: entries };
  }

  function adler32(bytes) {
    var a = 1;
    var b = 0;
    for (var i = 0; i < bytes.length; i += 1) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This Medal build cannot decompress ZIP files');
    }

    var stream;
    try {
      stream = new DecompressionStream('deflate-raw');
    } catch (error) {
      var checksum = adler32(bytes);
      var wrapped = new Uint8Array(bytes.length + 6);
      wrapped[0] = 0x78;
      wrapped[1] = 0x9c;
      wrapped.set(bytes, 2);
      wrapped[bytes.length + 2] = (checksum >>> 24) & 0xff;
      wrapped[bytes.length + 3] = (checksum >>> 16) & 0xff;
      wrapped[bytes.length + 4] = (checksum >>> 8) & 0xff;
      wrapped[bytes.length + 5] = checksum & 0xff;
      stream = new DecompressionStream('deflate');
      bytes = wrapped;
    }

    var body = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(body).arrayBuffer());
  }

  async function readEntry(archive, name) {
    var entry = archive.entries[name];
    if (!entry) throw new Error('Missing file in ZIP: ' + name);

    var view = archive.view;
    if (view.getUint32(entry.localOffset, true) !== 0x04034b50) {
      throw new Error('ZIP local header is corrupt');
    }
    var nameLength = view.getUint16(entry.localOffset + 26, true);
    var extraLength = view.getUint16(entry.localOffset + 28, true);
    var start = entry.localOffset + 30 + nameLength + extraLength;
    var data = archive.bytes.subarray(start, start + entry.compressedSize);

    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRaw(data);
    throw new Error('Unsupported ZIP compression method: ' + entry.method);
  }

  function findEntryName(archive, wanted) {
    if (archive.entries[wanted]) return wanted;
    var lower = wanted.toLowerCase();
    var names = Object.keys(archive.entries);
    for (var i = 0; i < names.length; i += 1) {
      if (names[i].toLowerCase() === lower) return names[i];
    }
    return null;
  }

  internal.zip = {
    text: text,
    safePath: safePath,
    readEntries: readEntries,
    readEntry: readEntry,
    findEntryName: findEntryName
  };
})(window.__NodalInternal);
