// UI와 음악 공급자를 분리합니다. 다른 API를 쓸 때 이 파일의 search 함수만
// 동일한 곡 데이터 형태를 반환하도록 교체하면 됩니다.
const CALLBACK_PREFIX = "moodioMusicCallback";
let requestNumber = 0;

export async function searchMusic(term, language = "ko") {
  const query = term.trim();
  if (!query) return [];

  const primaryCountry = language === "ko" ? "KR" : "US";
  const primaryResults = await requestSearch(query, primaryCountry, language);
  // 일부 해외 곡은 한국 스토어 검색에 나타나지 않습니다. 결과가 없을 때만
  // 미국 카탈로그를 한 번 더 확인해 검색창이 막힌 것처럼 보이지 않게 합니다.
  if (!primaryResults.length && primaryCountry !== "US") {
    return requestSearch(query, "US", language);
  }
  return primaryResults;
}

function requestSearch(query, country, language) {
  return new Promise((resolve, reject) => {
    const callbackName = `${CALLBACK_PREFIX}${Date.now()}${requestNumber++}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => finish(new Error("Search timed out")), 10000);

    function finish(error, data) {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
      if (error) reject(error);
      else resolve(normalizeResults(data?.results ?? []));
    }

    window[callbackName] = (data) => finish(null, data);
    script.onerror = () => finish(new Error("Search request failed"));

    const params = new URLSearchParams({
      term: query,
      media: "music",
      entity: "song",
      limit: "12",
      country,
      lang: language === "ko" ? "ko_kr" : "en_us",
      callback: callbackName
    });
    script.src = `https://itunes.apple.com/search?${params}`;
    document.head.append(script);
  });
}

function normalizeResults(results) {
  return results.map((item) => ({
    id: String(item.trackId),
    title: item.trackName || "Unknown title",
    artist: item.artistName || "Unknown artist",
    album: item.collectionName || "",
    artworkUrl: upgradeArtwork(item.artworkUrl100 || ""),
    previewUrl: item.previewUrl || "",
    externalUrl: item.trackViewUrl || ""
  }));
}

function upgradeArtwork(url) {
  return url.replace(/\/\d+x\d+bb\./, "/600x600bb.");
}
