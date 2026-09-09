// UI와 음악 공급자를 분리합니다. 모든 공급자는 아래 공통 곡 형태를 반환합니다.
const ITUNES_ENDPOINT = "https://itunes.apple.com/search";
const DEEZER_ENDPOINT = "https://api.deezer.com/search";
const CALLBACK_PREFIX = "moodioMusicCallback";
const REQUEST_TIMEOUT = 9000;

let requestNumber = 0;
let activeSearch = null;

export class MusicSearchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MusicSearchError";
    this.code = code;
    this.details = details;
  }
}

export async function searchMusic(term) {
  const query = term.trim();
  if (!query) return [];

  activeSearch?.cancel();
  const request = createRequestContext();
  activeSearch = request;

  // iOS Safari/PWA는 itunes.apple.com을 musics:// 주소로 리디렉션하므로
  // 브라우저에서 안정적으로 JSONP를 반환하는 공급자를 바로 사용합니다.
  const providers = isIOSWebKit()
    ? [{ name: "deezer", search: searchDeezer }]
    : [
        { name: "itunes", search: searchItunes },
        { name: "deezer", search: searchDeezer }
      ];

  let receivedValidResponse = false;
  const failures = [];

  try {
    for (const provider of providers) {
      if (request.cancelled) throw cancelledError();
      try {
        const songs = await provider.search(query, request);
        receivedValidResponse = true;
        if (songs.length) return songs;
      } catch (error) {
        if (error?.code === "SEARCH_CANCELLED") throw error;
        failures.push({ provider: provider.name, code: error?.code, message: error?.message, details: error?.details });
        console.warn("[Moodio music search] provider failed; trying fallback", failures[failures.length - 1]);
      }
    }

    if (receivedValidResponse) return [];
    throw new MusicSearchError("ALL_PROVIDERS_FAILED", "Every music search provider failed", { query, failures });
  } finally {
    if (activeSearch === request) activeSearch = null;
  }
}

function createRequestContext() {
  return {
    cancelled: false,
    cancelCurrent: null,
    cancel() {
      this.cancelled = true;
      this.cancelCurrent?.();
    }
  };
}

function cancelledError() {
  return new MusicSearchError("SEARCH_CANCELLED", "A newer search replaced this request");
}

function isIOSWebKit() {
  const userAgent = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

async function searchItunes(query, request) {
  const payload = await requestJsonp({
    provider: "itunes",
    request,
    buildUrl: (callbackName) => `${ITUNES_ENDPOINT}?term=${encodeURIComponent(query)}&country=US&media=music&entity=song&limit=20&callback=${encodeURIComponent(callbackName)}`
  });

  if (!Array.isArray(payload?.results)) throw responseError("itunes", payload);
  return payload.results.map(normalizeItunesSong);
}

async function searchDeezer(query, request) {
  const payload = await requestJsonp({
    provider: "deezer",
    request,
    buildUrl: (callbackName) => `${DEEZER_ENDPOINT}?q=${encodeURIComponent(query)}&limit=20&output=jsonp&callback=${encodeURIComponent(callbackName)}`
  });

  if (payload?.error || !Array.isArray(payload?.data)) throw responseError("deezer", payload);
  return payload.data.map(normalizeDeezerSong);
}

function requestJsonp({ provider, request, buildUrl }) {
  return new Promise((resolve, reject) => {
    const callbackName = `${CALLBACK_PREFIX}${Date.now()}${requestNumber++}`;
    const script = document.createElement("script");
    const endpoint = buildUrl(callbackName);
    const startedAt = performance.now();
    let settled = false;
    let timeout;

    const cancel = () => finish(cancelledError());
    request.cancelCurrent = cancel;

    function finish(error, payload) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
      if (request.cancelCurrent === cancel) request.cancelCurrent = null;
      error ? reject(error) : resolve(payload);
    }

    window[callbackName] = (payload) => {
      console.debug("[Moodio music search] JSONP response", {
        provider,
        endpoint,
        elapsedMs: Math.round(performance.now() - startedAt),
        resultCount: payload?.resultCount ?? payload?.data?.length ?? 0,
        responseError: payload?.error ?? payload?.errorMessage ?? null
      });
      if (payload?.error || payload?.errorMessage) {
        const error = responseError(provider, payload);
        console.error("[Moodio music search] API response error", error.details);
        finish(error);
      } else {
        finish(null, payload);
      }
    };

    script.onerror = (event) => {
      const resourceEntries = performance.getEntriesByName(endpoint);
      const resource = resourceEntries[resourceEntries.length - 1];
      const error = new MusicSearchError("SCRIPT_LOAD_FAILED", `${provider} JSONP script failed to load`, {
        provider,
        endpoint,
        eventType: event.type,
        httpStatus: resource?.responseStatus ?? null,
        transferSize: resource?.transferSize ?? null,
        elapsedMs: Math.round(performance.now() - startedAt),
        note: "Cross-origin script errors do not expose an HTTP status or response body to browser JavaScript."
      });
      console.error("[Moodio music search] script load error", error.details);
      finish(error);
    };

    timeout = window.setTimeout(() => {
      const error = new MusicSearchError("SEARCH_TIMEOUT", `${provider} search timed out`, {
        provider,
        endpoint,
        timeoutMs: REQUEST_TIMEOUT
      });
      console.error("[Moodio music search] timeout", error.details);
      finish(error);
    }, REQUEST_TIMEOUT);

    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = endpoint;
    console.debug("[Moodio music search] JSONP request", { provider, endpoint });
    document.head.append(script);
  });
}

function responseError(provider, payload) {
  return new MusicSearchError("INVALID_API_RESPONSE", `${provider} returned an invalid response`, {
    provider,
    response: payload
  });
}

function normalizeItunesSong(item) {
  return {
    id: String(item.trackId),
    title: item.trackName || "Unknown title",
    artist: item.artistName || "Unknown artist",
    album: item.collectionName || "",
    artworkUrl: upgradeArtwork(secureUrl(item.artworkUrl100 || "")),
    previewUrl: secureUrl(item.previewUrl || ""),
    externalUrl: secureUrl(item.trackViewUrl || "")
  };
}

function normalizeDeezerSong(item) {
  return {
    id: `deezer-${item.id}`,
    title: item.title || item.title_short || "Unknown title",
    artist: item.artist?.name || "Unknown artist",
    album: item.album?.title || "",
    artworkUrl: secureUrl(item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || ""),
    previewUrl: secureUrl(item.preview || ""),
    externalUrl: secureUrl(item.link || "")
  };
}

function upgradeArtwork(url) {
  return url.replace(/\/\d+x\d+bb\./, "/600x600bb.");
}

function secureUrl(url) {
  return String(url).replace(/^http:\/\//i, "https://");
}
