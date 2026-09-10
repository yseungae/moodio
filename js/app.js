import { createTranslator, translations } from "./i18n.js";
import { deleteEntry, getEntry, getEntriesForMonth, getSettings, saveEntry, saveSettings } from "./storage.js";
import { searchMusic } from "./musicService.js";
import { createShareUrl, readShareFromHash } from "./shareService.js";

const app = document.querySelector("#app");
const drawerNav = document.querySelector("#drawerNav");
const menuButton = document.querySelector("#menuButton");
const closeMenuButton = document.querySelector("#closeMenu");
const drawerScrim = document.querySelector("#drawerScrim");
const sideDrawer = document.querySelector("#sideDrawer");
const languageButton = document.querySelector("#languageButton");
const languageMenu = document.querySelector("#languageMenu");
const updateButton = document.querySelector("#updateButton");
const toast = document.querySelector("#toast");
const artworkModal = document.querySelector("#artworkModal");
const modalArtwork = document.querySelector("#modalArtwork");
const audio = document.querySelector("#previewAudio");

const today = localDateKey(new Date());
const now = new Date();
const state = {
  route: "home",
  language: getSettings().language,
  selectedDate: today,
  selectedSong: null,
  note: "",
  archiveYear: now.getFullYear(),
  archiveMonth: now.getMonth() + 1,
  searchResults: [],
  expandedDates: new Set(),
  playingUrl: "",
  editOrigin: null,
  sharedSnapshot: null,
  sharedError: false
};

let t = createTranslator(state.language);
let toastTimer;

init();

async function init() {
  bindGlobalEvents();
  applyStaticTranslations();

  try {
    const shared = await readShareFromHash();
    if (shared) {
      renderSharedPage(shared);
      return;
    }
  } catch {
    renderSharedError();
    return;
  }

  loadEntryForDate(today, false);
  render();
  registerServiceWorker();
}

function bindGlobalEvents() {
  document.addEventListener("click", (event) => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) navigate(routeButton.dataset.route);

    const languageOption = event.target.closest("[data-language]");
    if (languageOption) setLanguage(languageOption.dataset.language);

    if (!event.target.closest(".language-wrap")) closeLanguageMenu();
  });

  languageButton.addEventListener("click", () => {
    const willOpen = languageMenu.hidden;
    languageMenu.hidden = !willOpen;
    languageButton.setAttribute("aria-expanded", String(willOpen));
  });

  menuButton.addEventListener("click", toggleDrawer);
  closeMenuButton.addEventListener("click", closeDrawer);
  drawerScrim.addEventListener("click", closeDrawer);
  updateButton.addEventListener("click", updateApp);
  document.querySelector("#closeArtwork").addEventListener("click", closeArtwork);
  artworkModal.addEventListener("click", (event) => { if (event.target === artworkModal || event.target === modalArtwork) closeArtwork(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeArtwork(); closeLanguageMenu(); closeDrawer(); } });

  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("ended", () => { state.playingUrl = ""; updatePlayerButtons(); updateProgress(); });
  audio.addEventListener("pause", updatePlayerButtons);
  audio.addEventListener("play", updatePlayerButtons);
  window.addEventListener("hashchange", () => location.reload());
}

function render() {
  stopPreview();
  applyStaticTranslations();
  updateNavigation();
  if (state.route === "home") renderHome();
  if (state.route === "archive") renderArchive();
  if (state.route === "settings") renderSettings();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderHome() {
  const existing = getEntry(state.selectedDate);
  app.innerHTML = `
    <section>
      <header class="page-head">
        <p class="eyebrow">${escapeHtml(t("appTagline"))}</p>
        <h1 class="hero-title">${escapeHtml(t("heroTitle"))}</h1>
      </header>
      <div class="date-row">
        <label for="entryDate">${escapeHtml(t("selectDate"))}</label>
        <input id="entryDate" class="date-input" type="date" value="${state.selectedDate}" max="${today}" />
      </div>
      <div class="radio-card">
        <div class="radio-topline"><span>Moodio FM · ${state.selectedDate.slice(5).replace("-", ".")}</span><span class="signal" aria-hidden="true"><i></i><i></i><i></i></span></div>
        ${state.selectedSong ? selectedSongTemplate(state.selectedSong) : searchTemplate()}
      </div>
      ${state.selectedSong ? noteTemplate(Boolean(existing)) : ""}
    </section>`;

  document.querySelector("#entryDate").addEventListener("change", onDateChange);
  bindSearchEvents();
  bindSelectedSongEvents();
}

function searchTemplate() {
  return `
    <form id="searchForm" class="search-box" role="search">
      <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
      <label class="sr-only" for="musicSearch">${escapeHtml(t("searchPlaceholder"))}</label>
      <input id="musicSearch" class="search-input" type="search" autocomplete="off" placeholder="${escapeAttr(t("searchPlaceholder"))}" />
      <button class="search-submit" type="submit" aria-label="${escapeAttr(t("search"))}">↗</button>
    </form>
    <div id="searchResults" class="search-results"></div>`;
}

function selectedSongTemplate(song) {
  const hasPreview = Boolean(song.previewUrl);
  return `
    <div class="selected-song">
      <div class="selected-art-wrap">
        <button class="selected-art open-artwork" type="button" data-artwork="${escapeAttr(song.artworkUrl)}" data-title="${escapeAttr(song.title)}" aria-label="${escapeAttr(t("albumArtwork"))}">
          <img class="selected-art" src="${escapeAttr(song.artworkUrl)}" alt="" />
        </button>
      </div>
      <div>
        <p class="now-label">${escapeHtml(t("nowSelected"))}</p>
        <h2 class="selected-title">${escapeHtml(song.title)}</h2>
        <p class="selected-artist">${escapeHtml(song.artist)}</p>
        ${song.album ? `<p class="selected-album">${escapeHtml(song.album)}</p>` : ""}
        <div class="player-row">
          <button class="play-button" type="button" data-preview="${escapeAttr(song.previewUrl)}" ${hasPreview ? "" : "disabled"} aria-label="${escapeAttr(hasPreview ? t("play") : t("previewUnavailable"))}">▶</button>
          <div class="progress-track" aria-hidden="true"><span class="progress-fill"></span></div>
        </div>
        ${hasPreview ? "" : `<p class="preview-status">${escapeHtml(t("previewUnavailable"))}</p>`}
        <button id="changeSong" class="change-button" type="button">${escapeHtml(t("changeSong"))}</button>
      </div>
    </div>`;
}

function noteTemplate(isExisting) {
  return `
    <div class="note-panel">
      <label class="note-label" for="entryNote">${escapeHtml(t("noteLabel"))}</label>
      <textarea id="entryNote" class="note-input" placeholder="${escapeAttr(t("notePlaceholder"))}">${escapeHtml(state.note)}</textarea>
      <button id="saveEntry" class="primary-button save-button" type="button">${escapeHtml(isExisting ? t("updateEntry") : t("save"))}</button>
      ${isExisting ? `
        <button id="deleteEntryButton" class="delete-entry-button" type="button">${escapeHtml(t("deleteEntry"))}</button>
        <dialog id="deleteEntryDialog" class="confirm-dialog" aria-labelledby="deleteDialogTitle" aria-describedby="deleteDialogDescription">
          <div class="confirm-dialog-copy">
            <h2 id="deleteDialogTitle">${escapeHtml(t("deleteEntryTitle"))}</h2>
            <p id="deleteDialogDescription">${escapeHtml(t("deleteEntryDescription"))}</p>
          </div>
          <div class="confirm-dialog-actions">
            <button id="cancelDeleteEntry" class="dialog-button dialog-cancel" type="button">${escapeHtml(t("cancel"))}</button>
            <button id="confirmDeleteEntry" class="dialog-button dialog-delete" type="button">${escapeHtml(t("delete"))}</button>
          </div>
        </dialog>` : ""}
    </div>`;
}

function bindSearchEvents() {
  const form = document.querySelector("#searchForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = document.querySelector("#musicSearch").value.trim();
    if (!query) return;
    const results = document.querySelector("#searchResults");
    results.innerHTML = `<p class="loading-row">${escapeHtml(t("searching"))}</p>`;
    try {
      state.searchResults = await searchMusic(query, state.language);
      results.innerHTML = state.searchResults.length ? state.searchResults.map(resultTemplate).join("") : `<p class="empty-inline">${escapeHtml(t("noResults"))}</p>`;
      results.querySelectorAll("[data-song-index]").forEach((button) => {
        button.addEventListener("click", () => {
          state.selectedSong = state.searchResults[Number(button.dataset.songIndex)];
          state.note = document.querySelector("#entryNote")?.value ?? state.note;
          renderHome();
        });
      });
    } catch (error) {
      if (error?.code === "SEARCH_CANCELLED") return;
      console.error("[Moodio] Music search failed", error);
      results.innerHTML = `<p class="empty-inline">${escapeHtml(t("searchError"))}</p>`;
    }
  });
}

function resultTemplate(song, index) {
  return `
    <button class="result-item" type="button" data-song-index="${index}">
      <img src="${escapeAttr(song.artworkUrl)}" alt="" loading="lazy" />
      <span class="result-copy"><strong class="result-title">${escapeHtml(song.title)}</strong><span class="result-meta">${escapeHtml(song.artist)}</span>${song.album ? `<span class="result-album">${escapeHtml(song.album)}</span>` : ""}</span>
      <span class="result-arrow" aria-hidden="true">›</span>
    </button>`;
}

function bindSelectedSongEvents() {
  document.querySelector("#changeSong")?.addEventListener("click", () => {
    state.note = document.querySelector("#entryNote")?.value ?? state.note;
    stopPreview();
    state.selectedSong = null;
    renderHome();
  });
  document.querySelector("#saveEntry")?.addEventListener("click", saveCurrentEntry);
  const deleteDialog = document.querySelector("#deleteEntryDialog");
  document.querySelector("#deleteEntryButton")?.addEventListener("click", () => deleteDialog?.showModal());
  document.querySelector("#cancelDeleteEntry")?.addEventListener("click", () => deleteDialog?.close());
  document.querySelector("#confirmDeleteEntry")?.addEventListener("click", deleteCurrentEntry);
  deleteDialog?.addEventListener("click", (event) => { if (event.target === deleteDialog) deleteDialog.close(); });
  document.querySelector(".play-button")?.addEventListener("click", togglePreview);
  document.querySelectorAll(".open-artwork").forEach((button) => button.addEventListener("click", () => openArtwork(button.dataset.artwork, button.dataset.title)));
}

function onDateChange(event) {
  if (event.target.value > today) {
    event.target.value = state.selectedDate;
    showToast(t("futureBlocked"));
    return;
  }
  state.selectedDate = event.target.value;
  state.editOrigin = null;
  loadEntryForDate(state.selectedDate, true);
  renderHome();
}

function loadEntryForDate(date, notify) {
  const entry = getEntry(date);
  state.selectedSong = entry?.song ?? null;
  state.note = entry?.note ?? "";
  if (entry && notify) window.setTimeout(() => showToast(t("existingLoaded")), 50);
}

function saveCurrentEntry() {
  if (state.selectedDate > today) { showToast(t("futureBlocked")); return; }
  if (!state.selectedSong) { showToast(t("chooseSongFirst")); return; }
  const previous = getEntry(state.selectedDate);
  const timestamp = new Date().toISOString();
  state.note = document.querySelector("#entryNote")?.value ?? "";
  saveEntry({
    date: state.selectedDate,
    song: { ...state.selectedSong },
    note: state.note,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp
  });
  showToast(previous ? t("edited") : t("saved"));
  renderHome();
}

function deleteCurrentEntry() {
  const returnMonth = state.editOrigin;
  const wasDeleted = deleteEntry(state.selectedDate);
  document.querySelector("#deleteEntryDialog")?.close();
  stopPreview();
  state.selectedSong = null;
  state.note = "";
  state.searchResults = [];
  state.editOrigin = null;

  if (returnMonth) {
    state.archiveYear = returnMonth.year;
    state.archiveMonth = returnMonth.month;
    state.route = "archive";
  } else {
    state.route = "home";
  }

  render();
  if (wasDeleted) showToast(t("entryDeleted"));
}

function renderArchive() {
  const entries = getEntriesForMonth(state.archiveYear, state.archiveMonth);
  app.innerHTML = `
    <section>
      <header class="page-head"><p class="eyebrow">Moodio archive</p><h1>${escapeHtml(t("monthlyArchive"))}</h1></header>
      <div class="month-head">
        <button id="previousMonth" class="month-button" type="button" aria-label="${escapeAttr(t("previousMonth"))}"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>
        <div class="month-center">
          <h2 class="month-title">${escapeHtml(formatMonth(state.archiveYear, state.archiveMonth))}</h2>
          <button id="shareMonth" class="share-month-button" type="button">${escapeHtml(t("share"))}</button>
        </div>
        <button id="nextMonth" class="month-button" type="button" aria-label="${escapeAttr(t("nextMonth"))}"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button>
      </div>
      <div class="archive-list">${entries.length ? entries.map((entry) => entryTemplate(entry, true)).join("") : `<div class="empty-state">${escapeHtml(t("noEntries"))}</div>`}</div>
    </section>`;

  document.querySelector("#previousMonth").addEventListener("click", () => changeMonth(-1));
  document.querySelector("#nextMonth").addEventListener("click", () => changeMonth(1));
  document.querySelector("#shareMonth").addEventListener("click", () => shareMonth(entries));
  bindEntryCardEvents();
}

function entryTemplate(entry, editable) {
  const expanded = state.expandedDates.has(entry.date);
  const longNote = entry.note.length > 260;
  return `
    <article class="entry-card">
      <button class="entry-art-button open-artwork" type="button" data-artwork="${escapeAttr(entry.song.artworkUrl)}" data-title="${escapeAttr(entry.song.title)}" aria-label="${escapeAttr(t("albumArtwork"))}">
        <img class="entry-art" src="${escapeAttr(entry.song.artworkUrl)}" alt="" loading="lazy" />
      </button>
      <div class="entry-body">
        <p class="entry-date">${escapeHtml(formatDate(entry.date))}</p>
        <h3>${escapeHtml(entry.song.title)}</h3>
        <p class="entry-artist">${escapeHtml(entry.song.artist)}</p>
        ${entry.note ? `<p class="entry-note ${longNote && !expanded ? "clamped" : ""}">${escapeHtml(entry.note)}</p>` : ""}
        <div class="entry-footer">
          ${longNote ? `<button class="text-button" type="button" data-expand="${entry.date}">${escapeHtml(expanded ? t("less") : t("more"))}</button>` : "<span></span>"}
          ${editable ? `<button class="edit-link" type="button" data-edit="${entry.date}">${escapeHtml(t("edit"))}</button>` : `<span class="subtle">${escapeHtml(t("readonly"))}</span>`}
        </div>
      </div>
    </article>`;
}

function bindEntryCardEvents() {
  document.querySelectorAll(".open-artwork").forEach((button) => button.addEventListener("click", () => openArtwork(button.dataset.artwork, button.dataset.title)));
  document.querySelectorAll("[data-expand]").forEach((button) => button.addEventListener("click", () => {
    const date = button.dataset.expand;
    state.expandedDates.has(date) ? state.expandedDates.delete(date) : state.expandedDates.add(date);
    if (state.route === "archive") renderArchive();
  }));
  document.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => {
    state.editOrigin = { year: state.archiveYear, month: state.archiveMonth };
    state.selectedDate = button.dataset.edit;
    loadEntryForDate(state.selectedDate, false);
    navigate("home", { preserveEditOrigin: true });
  }));
}

function changeMonth(offset) {
  const value = new Date(state.archiveYear, state.archiveMonth - 1 + offset, 1);
  state.archiveYear = value.getFullYear();
  state.archiveMonth = value.getMonth() + 1;
  renderArchive();
}

async function shareMonth(entries) {
  if (!entries.length) { showToast(t("shareEmpty")); return; }
  const settings = getSettings();
  const snapshot = {
    version: 1,
    displayName: settings.displayName.trim() || t("defaultName"),
    year: state.archiveYear,
    month: state.archiveMonth,
    entries: entries.map(({ date, song, note }) => ({
      date,
      song: { title: song.title, artist: song.artist, album: song.album, artworkUrl: song.artworkUrl },
      note
    }))
  };

  try {
    const url = await createShareUrl(snapshot);
    const title = `${snapshot.displayName}'s ${englishMonth(snapshot.year, snapshot.month)}`;
    if (navigator.share) await navigator.share({ title, url });
    else { await navigator.clipboard.writeText(url); showToast(t("shareCopied")); }
  } catch (error) {
    if (error?.name === "AbortError") return;
    showToast(error?.message === "SHARE_TOO_LONG" ? t("shareTooLong") : t("shareFailed"));
  }
}

function renderSettings() {
  const settings = getSettings();
  app.innerHTML = `
    <section>
      <header class="page-head"><p class="eyebrow">Moodio preferences</p><h1>${escapeHtml(t("settings"))}</h1></header>
      <div class="settings-card">
        <label class="settings-label" for="displayName">${escapeHtml(t("displayName"))}</label>
        <p class="settings-help">${escapeHtml(t("displayNameHelp"))}</p>
        <input id="displayName" class="text-input" value="${escapeAttr(settings.displayName)}" maxlength="40" placeholder="${escapeAttr(t("displayNamePlaceholder"))}" />
        <button id="saveSettings" class="primary-button" type="button">${escapeHtml(t("saveSettings"))}</button>
      </div>
      <div class="settings-card">
        <p class="settings-label">${escapeHtml(t("languageSetting"))}</p>
        <p class="settings-help">${escapeHtml(t("languageHelp"))}</p>
        <button class="secondary-button" type="button" data-language="ko">한국어</button>
        <button class="secondary-button" type="button" data-language="en">English</button>
      </div>
    </section>`;
  document.querySelector("#saveSettings").addEventListener("click", () => {
    saveSettings({ displayName: document.querySelector("#displayName").value.trim() });
    showToast(t("settingsSaved"));
  });
}

function renderSharedPage(snapshot) {
  state.sharedSnapshot = snapshot;
  state.sharedError = false;
  menuButton.hidden = true;
  closeDrawer();
  updateButton.hidden = true;
  const title = `${snapshot.displayName || t("defaultName")}'s ${englishMonth(snapshot.year, snapshot.month)}`;
  app.innerHTML = `
    <section class="shared-shell">
      <p class="shared-mark">Moodio · ${escapeHtml(t("sharedDiary"))}</p>
      <h1 class="shared-title">${escapeHtml(title)}</h1>
      <p class="shared-subtitle">${escapeHtml(t("sharedSubtitle"))} · ${escapeHtml(t("recordCount", { count: snapshot.entries.length }))}</p>
      <div class="archive-list">${snapshot.entries.length ? snapshot.entries.map((entry) => entryTemplate(entry, false)).join("") : `<div class="empty-state">${escapeHtml(t("noEntries"))}</div>`}</div>
    </section>`;
  bindEntryCardEvents();
}

function renderSharedError() {
  state.sharedSnapshot = null;
  state.sharedError = true;
  menuButton.hidden = true;
  closeDrawer();
  updateButton.hidden = true;
  app.innerHTML = `<section class="shared-error"><h1>Moodio</h1><p class="subtle">${escapeHtml(t("invalidShare"))}</p><a class="primary-button" href="${escapeAttr(location.pathname)}" style="display:inline-flex;align-items:center;text-decoration:none">${escapeHtml(t("backToMoodio"))}</a></section>`;
}

function setLanguage(language) {
  if (!translations[language]) return;
  state.language = language;
  t = createTranslator(language);
  saveSettings({ language });
  document.documentElement.lang = language;
  closeLanguageMenu();
  if (state.sharedSnapshot) {
    applyStaticTranslations();
    renderSharedPage(state.sharedSnapshot);
  } else if (state.sharedError) {
    applyStaticTranslations();
    renderSharedError();
  } else {
    render();
  }
}

function applyStaticTranslations() {
  document.documentElement.lang = state.language;
  document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
  document.querySelectorAll("[data-language]").forEach((element) => element.classList.toggle("active", element.dataset.language === state.language));
}

function navigate(route, { preserveEditOrigin = false } = {}) {
  if (!['home', 'archive', 'settings'].includes(route)) return;
  if (!preserveEditOrigin) state.editOrigin = null;
  if (route === "archive" && state.route !== "archive") {
    const current = new Date();
    state.archiveYear = current.getFullYear();
    state.archiveMonth = current.getMonth() + 1;
  }
  menuButton.hidden = false;
  closeDrawer();
  state.route = route;
  render();
}

function updateNavigation() {
  drawerNav.querySelectorAll("[data-route]").forEach((button) => button.classList.toggle("active", button.dataset.route === state.route));
}

function toggleDrawer() {
  document.body.classList.contains("drawer-open") ? closeDrawer() : openDrawer();
}

function openDrawer() {
  document.body.classList.add("drawer-open");
  menuButton.setAttribute("aria-expanded", "true");
  sideDrawer.inert = false;
  sideDrawer.setAttribute("aria-hidden", "false");
  closeMenuButton.focus();
}

function closeDrawer() {
  if (sideDrawer.contains(document.activeElement) && !menuButton.hidden) menuButton.focus();
  document.body.classList.remove("drawer-open");
  menuButton.setAttribute("aria-expanded", "false");
  sideDrawer.setAttribute("aria-hidden", "true");
  sideDrawer.inert = true;
}

function togglePreview(event) {
  const url = event.currentTarget.dataset.preview;
  if (!url) return;
  if (state.playingUrl === url && !audio.paused) { audio.pause(); return; }
  if (audio.src !== url) { audio.src = url; audio.currentTime = 0; }
  state.playingUrl = url;
  audio.play().catch(() => showToast(t("previewUnavailable")));
}

function stopPreview() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  state.playingUrl = "";
}

function updatePlayerButtons() {
  document.querySelectorAll("[data-preview]").forEach((button) => {
    const playing = button.dataset.preview === state.playingUrl && !audio.paused;
    button.textContent = playing ? "Ⅱ" : "▶";
    button.setAttribute("aria-label", playing ? t("pause") : t("play"));
  });
}

function updateProgress() {
  const percent = Number.isFinite(audio.duration) && audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  document.querySelectorAll(".progress-fill").forEach((bar) => { bar.style.width = `${percent}%`; });
}

function openArtwork(url, title) {
  if (!url) return;
  modalArtwork.src = url;
  modalArtwork.alt = title || "";
  artworkModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeArtwork() {
  artworkModal.hidden = true;
  modalArtwork.removeAttribute("src");
  document.body.style.overflow = "";
}

function closeLanguageMenu() {
  languageMenu.hidden = true;
  languageButton.setAttribute("aria-expanded", "false");
}

async function updateApp() {
  updateButton.classList.add("is-spinning");
  showToast(t("checkingUpdates"), 8000);
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
    }
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("moodio-")).map((name) => caches.delete(name)));
    }
    showToast(t("updated"), 900);
    window.setTimeout(() => location.reload(), 950);
  } catch {
    updateButton.classList.remove("is-spinning");
    showToast(t("updateFailed"));
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try { await navigator.serviceWorker.register("./sw.js", { scope: "./" }); } catch { /* The app still works online. */ }
}

function showToast(message, duration = 2600) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), duration);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonth(year, month) {
  return new Intl.DateTimeFormat(t("dateLocale"), { year: "numeric", month: "long" }).format(new Date(year, month - 1, 1));
}

function englishMonth(year, month) {
  return new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(year, month - 1, 1));
}

function formatDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(t("dateLocale"), { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(year, month - 1, day));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function escapeAttr(value = "") { return escapeHtml(value); }
