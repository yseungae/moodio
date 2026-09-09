const MAX_SHARE_URL_LENGTH = 18000;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function compress(text) {
  const input = new TextEncoder().encode(text);
  if (!("CompressionStream" in window)) return `b.${bytesToBase64Url(input)}`;
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return `g.${bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
}

async function decompress(encoded) {
  const [type, value] = [encoded.slice(0, 1), encoded.slice(2)];
  const bytes = base64UrlToBytes(value);
  if (type === "b") return new TextDecoder().decode(bytes);
  if (type !== "g" || !("DecompressionStream" in window)) throw new Error("Unsupported share data");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

export async function createShareUrl(snapshot) {
  const encoded = await compress(JSON.stringify(snapshot));
  const baseUrl = `${location.origin}${location.pathname}`;
  const url = `${baseUrl}#share=${encoded}`;
  if (url.length > MAX_SHARE_URL_LENGTH) throw new Error("SHARE_TOO_LONG");
  return url;
}

export async function readShareFromHash(hash = location.hash) {
  if (!hash.startsWith("#share=")) return null;
  const encoded = hash.slice(7);
  if (!encoded || encoded.length > MAX_SHARE_URL_LENGTH) throw new Error("INVALID_SHARE");
  const parsed = JSON.parse(await decompress(encoded));
  if (!isValidSnapshot(parsed)) {
    throw new Error("INVALID_SHARE");
  }
  return parsed;
}

function isValidSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.displayName !== "string" || snapshot.displayName.length > 80) return false;
  if (!Number.isInteger(snapshot.year) || snapshot.year < 1900 || snapshot.year > 2200) return false;
  if (!Number.isInteger(snapshot.month) || snapshot.month < 1 || snapshot.month > 12) return false;
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length > 31) return false;

  return snapshot.entries.every((entry) => {
    const song = entry?.song;
    return /^\d{4}-\d{2}-\d{2}$/.test(entry?.date || "")
      && typeof entry.note === "string"
      && entry.note.length <= 100000
      && song
      && [song.title, song.artist, song.album, song.artworkUrl].every((value) => typeof value === "string");
  });
}
