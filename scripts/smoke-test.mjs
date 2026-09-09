import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const debuggerPort = process.env.CHROME_DEBUG_PORT || "9222";
const appUrl = process.env.MOODIO_BASE_URL || "http://127.0.0.1:4173/";
const targets = await fetch(`http://127.0.0.1:${debuggerPort}/json`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("Chrome page target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let commandId = 0;
const waiting = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !waiting.has(message.id)) return;
  const { resolve: finish, reject } = waiting.get(message.id);
  waiting.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : finish(message.result);
});

function send(method, params = {}) {
  const id = ++commandId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((finish, reject) => waiting.set(id, { resolve: finish, reject }));
}

const delay = (milliseconds) => new Promise((finish) => setTimeout(finish, milliseconds));
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
};
const navigate = async (url) => { await send("Page.navigate", { url }); await delay(1200); };

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await navigate(appUrl);

const checks = [];
function check(name, passed, details = "") {
  checks.push({ name, passed: Boolean(passed), details });
}

await evaluate("localStorage.clear(); location.reload(); true");
await delay(900);
const layout = await evaluate(`({
  title: document.querySelector('h1')?.textContent,
  width: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  maxDate: document.querySelector('#entryDate')?.max,
  wordmarkCenter: document.querySelector('.wordmark').getBoundingClientRect().left + document.querySelector('.wordmark').getBoundingClientRect().width / 2,
  radioHeight: document.querySelector('.radio-card').getBoundingClientRect().height,
  bottomNavRemoved: !document.querySelector('.bottom-nav'),
  drawerRight: document.querySelector('#sideDrawer').getBoundingClientRect().right,
  drawerOpen: document.body.classList.contains('drawer-open')
})`);
check("Korean home renders", layout.title === "오늘은 어떤 노래가 떠올랐나요?", layout.title);
check("Korean tagline is exact", await evaluate("document.querySelector('.eyebrow')?.textContent") === "하루 한 곡");
check("No horizontal overflow at 390px", layout.scrollWidth <= layout.width, `${layout.scrollWidth}/${layout.width}`);
check("Date maximum is set", /^\d{4}-\d{2}-\d{2}$/.test(layout.maxDate), layout.maxDate);
check("Wordmark stays precisely centered", Math.abs(layout.wordmarkCenter - layout.width / 2) < 1, `${layout.wordmarkCenter}/${layout.width / 2}`);
check("Empty radio search card is compact", layout.radioHeight < 125, `${layout.radioHeight}px`);
check("Bottom navigation is removed", layout.bottomNavRemoved);
check("Side drawer starts fully closed", !layout.drawerOpen && layout.drawerRight <= 0, JSON.stringify({ drawerRight: layout.drawerRight, drawerOpen: layout.drawerOpen }));

const inputBorders = await evaluate(`(async () => {
  const search = document.querySelector('.search-input');
  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
  const declaredWidth = (selector) => {
    const style = rules.find((rule) => rule.selectorText === selector)?.style;
    return parseFloat(style?.borderTopWidth || style?.border?.split(' ')[0]);
  };
  const searchBaseColor = getComputedStyle(search).borderTopColor;
  search.focus();
  await new Promise((resolve) => setTimeout(resolve, 220));
  return {
    searchWidth: declaredWidth('.search-input'),
    noteWidth: declaredWidth('.note-input'),
    dateWidth: declaredWidth('.date-input'),
    radioWidth: declaredWidth('.radio-card'),
    entryWidth: declaredWidth('.entry-card'),
    searchBaseColor,
    searchFocusColor: getComputedStyle(search).borderTopColor,
    entryInteractiveBorder: rules.find((rule) => rule.selectorText === '.entry-card:hover, .entry-card:focus-within')?.style.borderColor
  };
})()`);
check("Primary input and card borders use the requested subtle thickness", inputBorders.searchWidth === 1.5 && inputBorders.noteWidth === 1.5 && inputBorders.dateWidth === 1.25 && inputBorders.radioWidth === 1.25 && inputBorders.entryWidth === 1.25, JSON.stringify(inputBorders));
check("Focused search border becomes clearer", inputBorders.searchBaseColor !== inputBorders.searchFocusColor, JSON.stringify(inputBorders));
check("Journal cards define a clearer interactive border", inputBorders.entryInteractiveBorder === "var(--line-strong)", JSON.stringify(inputBorders));

const drawerOpened = await evaluate(`(() => {
  document.querySelector('#menuButton').click();
  return document.body.classList.contains('drawer-open') && document.querySelector('#sideDrawer').getAttribute('aria-hidden') === 'false';
})()`);
await delay(250);
const drawerScreenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve("drawer-mobile.png"), Buffer.from(drawerScreenshot.data, "base64"));
const drawerClosed = await evaluate(`(() => {
  document.querySelector('#drawerScrim').click();
  return !document.body.classList.contains('drawer-open');
})()`);
const drawer = { opened: drawerOpened, closed: drawerClosed };
check("Side drawer opens and closes", drawer.opened && drawer.closed, JSON.stringify(drawer));

const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve("home-mobile.png"), Buffer.from(screenshot.data, "base64"));

const future = await evaluate(`(() => {
  const input = document.querySelector('#entryDate');
  const before = input.value;
  input.value = '2999-01-01';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { before, after: input.value, toast: document.querySelector('#toast').textContent };
})()`);
check("Future date is blocked", future.after === future.before && future.toast.includes("미래"), JSON.stringify(future));

const sampleSong = {
  id: "smoke-song",
  title: "About You",
  artist: "The 1975",
  album: "Being Funny in a Foreign Language",
  artworkUrl: "./assets/icon-512.png",
  previewUrl: "",
  externalUrl: ""
};
const previousMonthSong = { ...sampleSong, id: "previous-month-song", title: "August Song" };
await evaluate(`(() => {
  const date = document.querySelector('#entryDate').value;
  const entry = { date, song: ${JSON.stringify(sampleSong)}, note: 'A quiet note that survives refresh.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const previousMonthDate = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 2, 15);
  const previousDate = [previousMonthDate.getFullYear(), String(previousMonthDate.getMonth() + 1).padStart(2, '0'), '15'].join('-');
  const previousEntry = { date: previousDate, song: ${JSON.stringify(previousMonthSong)}, note: 'A different month.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  localStorage.setItem('moodio.entries.v1', JSON.stringify({ [date]: entry, [previousDate]: previousEntry }));
  localStorage.setItem('moodio.settings.v1', JSON.stringify({ language: 'en', displayName: 'Seungae' }));
  location.reload();
})()`);
await delay(900);
const persisted = await evaluate(`({
  title: document.querySelector('.selected-title')?.textContent,
  note: document.querySelector('#entryNote')?.value,
  previewDisabled: document.querySelector('.play-button')?.disabled,
  previewMessage: document.querySelector('.preview-status')?.textContent,
  englishHero: document.querySelector('h1')?.textContent
})`);
check("Entry survives reload", persisted.title === "About You" && persisted.note.includes("survives"), JSON.stringify(persisted));
check("Language switches globally", persisted.englishHero === "What song came to mind today?", persisted.englishHero);
check("English tagline is exact", await evaluate("document.querySelector('.eyebrow')?.textContent") === "One song a day");
check("Missing preview is handled", persisted.previewDisabled && persisted.previewMessage === "Preview unavailable.", persisted.previewMessage);

const noteFocus = await evaluate(`(async () => {
  const note = document.querySelector('.note-input');
  const baseColor = getComputedStyle(note).borderTopColor;
  note.focus();
  await new Promise((resolve) => setTimeout(resolve, 220));
  return { baseColor, focusColor: getComputedStyle(note).borderTopColor };
})()`);
check("Focused journal textarea becomes clearer", noteFocus.baseColor !== noteFocus.focusColor, JSON.stringify(noteFocus));

const modal = await evaluate(`(() => {
  document.querySelector('.open-artwork').click();
  const opened = !document.querySelector('#artworkModal').hidden;
  document.querySelector('#closeArtwork').click();
  return { opened, closed: document.querySelector('#artworkModal').hidden };
})()`);
check("Artwork modal opens and closes", modal.opened && modal.closed, JSON.stringify(modal));

await evaluate("document.querySelector('[data-route=archive]').click(); true");
await delay(300);
const archive = await evaluate(`({ cards: document.querySelectorAll('.entry-card').length, editButtons: document.querySelectorAll('[data-edit]').length })`);
check("Monthly archive lists saved entry", archive.cards === 1 && archive.editButtons === 1, JSON.stringify(archive));
const archiveScreenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve("archive-mobile.png"), Buffer.from(archiveScreenshot.data, "base64"));

const monthFilter = await evaluate(`(async () => {
  document.querySelector('#previousMonth').click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const previousTitles = [...document.querySelectorAll('.entry-card h3')].map((element) => element.textContent);
  document.querySelector('#nextMonth').click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const currentTitles = [...document.querySelectorAll('.entry-card h3')].map((element) => element.textContent);
  return { previousTitles, currentTitles };
})()`);
check("Month navigation filters entries", monthFilter.previousTitles.length === 1 && monthFilter.previousTitles[0] === "August Song" && monthFilter.currentTitles.length === 1 && monthFilter.currentTitles[0] === "About You", JSON.stringify(monthFilter));

const emptyMonth = await evaluate(`(async () => {
  document.querySelector('#nextMonth').click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const message = document.querySelector('.empty-state')?.textContent;
  document.querySelector('#previousMonth').click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return message;
})()`);
check("Empty month message is exact", emptyMonth === "No songs recorded this month yet.", emptyMonth);

const monthlyShare = await evaluate(`(async () => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ url }) => { window.__moodioShareUrl = url; } });
  document.querySelector('#shareMonth').click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const module = await import('./js/shareService.js');
  const snapshot = await module.readShareFromHash(new URL(window.__moodioShareUrl).hash);
  return { month: snapshot.month, titles: snapshot.entries.map((entry) => entry.song.title) };
})()`);
check("Share button includes only the visible month", monthlyShare.month === 9 && monthlyShare.titles.length === 1 && monthlyShare.titles[0] === "About You", JSON.stringify(monthlyShare));

const shareUrl = await evaluate(`(async () => {
  const module = await import('./js/shareService.js');
  return module.createShareUrl({ version: 1, displayName: 'Seungae', year: 2026, month: 9, entries: [{ date: '2026-09-09', song: ${JSON.stringify(sampleSong)}, note: 'Shared note' }] });
})()`);
await navigate(shareUrl);
const shared = await evaluate(`({
  title: document.querySelector('.shared-title')?.textContent,
  cards: document.querySelectorAll('.entry-card').length,
  editButtons: document.querySelectorAll('[data-edit]').length,
  navHidden: document.querySelector('#menuButton').hidden
})`);
check("Share link opens read-only", shared.title === "Seungae's September" && shared.cards === 1 && shared.editButtons === 0 && shared.navHidden, JSON.stringify(shared));

const translatedShare = await evaluate(`(() => {
  document.querySelector('[data-language=ko]').click();
  return {
    title: document.querySelector('.shared-title')?.textContent,
    sharedLabel: document.querySelector('.shared-mark')?.textContent,
    editButtons: document.querySelectorAll('[data-edit]').length,
    navHidden: document.querySelector('#menuButton').hidden
  };
})()`);
check("Language change preserves read-only share page", translatedShare.title === "Seungae's September" && translatedShare.sharedLabel.includes("공유된 음악 일기") && translatedShare.editButtons === 0 && translatedShare.navHidden, JSON.stringify(translatedShare));

await navigate(appUrl);
await delay(500);
const pwa = await evaluate(`(async () => {
  const manifest = document.querySelector('link[rel=manifest]')?.getAttribute('href');
  const favicon = document.querySelector('link[rel=icon]')?.getAttribute('href');
  const appleIcon = document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href');
  const data = await fetch(manifest).then((response) => response.json());
  const iconResponses = await Promise.all([...data.icons.map((icon) => icon.src), appleIcon].map((source) => fetch(source).then((response) => response.ok)));
  const serviceWorker = await fetch('./sw.js').then((response) => response.text());
  return { manifest, favicon, appleIcon, iconResponses, cacheV7: serviceWorker.includes('moodio-shell-v7'), registration: Boolean(await navigator.serviceWorker.getRegistration()) };
})()`);
check("PWA manifest, icons, and current app cache load", pwa.manifest === "./manifest.webmanifest?v=5" && pwa.favicon.endsWith("?v=5") && pwa.appleIcon.includes("icon-180.png?v=5") && pwa.iconResponses.every(Boolean) && pwa.cacheV7 && pwa.registration, JSON.stringify(pwa));

// The public Apple endpoint can occasionally be unavailable; report it separately.
const search = await evaluate(`(async () => {
  document.querySelector('#changeSong')?.click();
  const input = document.querySelector('#musicSearch');
  input.value = 'About You';
  document.querySelector('#searchForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 5000));
  return { results: document.querySelectorAll('.result-item').length, message: document.querySelector('#searchResults')?.textContent.trim() };
})()`);
check("Live music search returns results", search.results > 0, search.message || `${search.results} results`);

if (search.results > 0) {
  const saveFlow = await evaluate(`(() => {
    document.querySelector('.result-item').click();
    const previewAvailable = !document.querySelector('.play-button').disabled;
    const note = document.querySelector('#entryNote');
    note.value = 'Saved through the Moodio interface.';
    document.querySelector('#saveEntry').click();
    const first = JSON.parse(localStorage.getItem('moodio.entries.v1'));
    const updatedNote = document.querySelector('#entryNote');
    updatedNote.value = 'Edited through the Moodio interface.';
    document.querySelector('#saveEntry').click();
    const second = JSON.parse(localStorage.getItem('moodio.entries.v1'));
    const date = document.querySelector('#entryDate').value;
    return { firstNote: first[date].note, secondNote: second[date].note, count: Object.keys(second).length, previewAvailable };
  })()`);
  check("Selected search result exposes Preview", saveFlow.previewAvailable, JSON.stringify(saveFlow));
  check("Save and edit keep one song per day", saveFlow.firstNote.startsWith("Saved") && saveFlow.secondNote.startsWith("Edited") && saveFlow.count === 2, JSON.stringify(saveFlow));
}

await send("Network.enable");
await send("Emulation.setUserAgentOverride", {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  platform: "iPhone"
});
await navigate(appUrl);
const iosSearch = await evaluate(`(async () => {
  document.querySelector('#changeSong')?.click();
  performance.clearResourceTimings();
  const input = document.querySelector('#musicSearch');
  input.value = 'the 1975';
  document.querySelector('#searchForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const results = document.querySelectorAll('.result-item').length;
  const usedMobileProvider = performance.getEntriesByType('resource').some((entry) => entry.name.startsWith('https://api.deezer.com/search'));
  document.querySelector('.result-item')?.click();
  return {
    results,
    usedMobileProvider,
    previewAvailable: !document.querySelector('.play-button')?.disabled,
    callbacksRemaining: Object.keys(window).filter((key) => key.startsWith('moodioMusicCallback')).length,
    scriptsRemaining: document.querySelectorAll('script[src*="itunes.apple.com/search"], script[src*="api.deezer.com/search"]').length
  };
})()`);
check("iPhone Safari path uses stable HTTPS JSONP search", iosSearch.results > 0 && iosSearch.usedMobileProvider, JSON.stringify(iosSearch));
check("iPhone search keeps Preview and cleans JSONP resources", iosSearch.previewAvailable && iosSearch.callbacksRemaining === 0 && iosSearch.scriptsRemaining === 0, JSON.stringify(iosSearch));

const rapidSearch = await evaluate(`(async () => {
  document.querySelector('#changeSong')?.click();
  const input = document.querySelector('#musicSearch');
  input.value = 'radiohead';
  document.querySelector('#searchForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  input.value = 'about you';
  document.querySelector('#searchForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 5000));
  return {
    firstTitle: document.querySelector('.result-title')?.textContent || '',
    callbacksRemaining: Object.keys(window).filter((key) => key.startsWith('moodioMusicCallback')).length,
    scriptsRemaining: document.querySelectorAll('script[src*="api.deezer.com/search"]').length
  };
})()`);
check("Rapid searches keep only the latest JSONP request", rapidSearch.firstTitle.toLowerCase().includes("about") && rapidSearch.callbacksRemaining === 0 && rapidSearch.scriptsRemaining === 0, JSON.stringify(rapidSearch));

const archiveDelete = await evaluate(`(async () => {
  document.querySelector('[data-language=en]').click();
  const settingsBefore = localStorage.getItem('moodio.settings.v1');
  document.querySelector('[data-route=archive]').click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const monthBefore = document.querySelector('.month-title')?.textContent;
  const editButton = document.querySelector('[data-edit]');
  const deletedDate = editButton?.dataset.edit;
  editButton?.click();
  const deleteLabel = document.querySelector('#deleteEntryButton')?.textContent;
  document.querySelector('#deleteEntryButton')?.click();
  const dialog = document.querySelector('#deleteEntryDialog');
  const dialogCopy = {
    open: dialog?.open,
    title: document.querySelector('#deleteDialogTitle')?.textContent,
    description: document.querySelector('#deleteDialogDescription')?.textContent,
    cancel: document.querySelector('#cancelDeleteEntry')?.textContent,
    confirm: document.querySelector('#confirmDeleteEntry')?.textContent
  };
  document.querySelector('#cancelDeleteEntry')?.click();
  const survivedCancel = Boolean(JSON.parse(localStorage.getItem('moodio.entries.v1'))[deletedDate]);
  document.querySelector('#deleteEntryButton')?.click();
  document.querySelector('#confirmDeleteEntry')?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const entries = JSON.parse(localStorage.getItem('moodio.entries.v1'));
  window.__moodioShareUrl = null;
  document.querySelector('#shareMonth')?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    deletedDate,
    deleteLabel,
    dialogCopy,
    survivedCancel,
    monthBefore,
    monthAfter: document.querySelector('.month-title')?.textContent,
    returnedToArchive: Boolean(document.querySelector('.archive-list')),
    currentMonthCards: document.querySelectorAll('.entry-card').length,
    emptyMessage: document.querySelector('.empty-state')?.textContent,
    deleted: !entries[deletedDate],
    otherDates: Object.keys(entries),
    settingsPreserved: localStorage.getItem('moodio.settings.v1') === settingsBefore,
    previewStopped: document.querySelector('#previewAudio')?.paused && !document.querySelector('#previewAudio')?.getAttribute('src'),
    newShareWasNotCreated: !window.__moodioShareUrl,
    shareEmptyMessage: document.querySelector('#toast')?.textContent
  };
})()`);
check("Delete dialog uses the English confirmation copy and supports cancel", archiveDelete.deleteLabel === "Delete entry" && archiveDelete.dialogCopy.open && archiveDelete.dialogCopy.title === "Delete this entry?" && archiveDelete.dialogCopy.description === "This can’t be undone." && archiveDelete.dialogCopy.cancel === "Cancel" && archiveDelete.dialogCopy.confirm === "Delete" && archiveDelete.survivedCancel, JSON.stringify(archiveDelete));
check("Archive deletion returns to the same month without reload", archiveDelete.returnedToArchive && archiveDelete.monthAfter === archiveDelete.monthBefore && archiveDelete.currentMonthCards === 0 && archiveDelete.emptyMessage === "No songs recorded this month yet.", JSON.stringify(archiveDelete));
check("Archive deletion removes only the selected date and preserves settings", archiveDelete.deleted && archiveDelete.otherDates.length === 1 && archiveDelete.settingsPreserved && archiveDelete.previewStopped, JSON.stringify(archiveDelete));
check("Deleted entry is excluded from future monthly shares", archiveDelete.newShareWasNotCreated && archiveDelete.shareEmptyMessage === "There are no entries to share.", JSON.stringify(archiveDelete));

await evaluate(`(() => {
  const entries = JSON.parse(localStorage.getItem('moodio.entries.v1'));
  entries[${JSON.stringify(archiveDelete.deletedDate)}] = {
    date: ${JSON.stringify(archiveDelete.deletedDate)},
    song: ${JSON.stringify(sampleSong)},
    note: 'Delete from home.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem('moodio.entries.v1', JSON.stringify(entries));
  const settings = JSON.parse(localStorage.getItem('moodio.settings.v1'));
  settings.language = 'ko';
  localStorage.setItem('moodio.settings.v1', JSON.stringify(settings));
  return true;
})()`);
await navigate(appUrl);
const homeDelete = await evaluate(`(async () => {
  const dateBefore = document.querySelector('#entryDate')?.value;
  const entriesBefore = JSON.parse(localStorage.getItem('moodio.entries.v1'));
  const settingsBefore = localStorage.getItem('moodio.settings.v1');
  const label = document.querySelector('#deleteEntryButton')?.textContent;
  document.querySelector('#deleteEntryButton')?.click();
  const copy = {
    title: document.querySelector('#deleteDialogTitle')?.textContent,
    description: document.querySelector('#deleteDialogDescription')?.textContent,
    cancel: document.querySelector('#cancelDeleteEntry')?.textContent,
    confirm: document.querySelector('#confirmDeleteEntry')?.textContent
  };
  document.querySelector('#confirmDeleteEntry')?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const entriesAfter = JSON.parse(localStorage.getItem('moodio.entries.v1'));
  return {
    dateBefore,
    dateAfter: document.querySelector('#entryDate')?.value,
    label,
    copy,
    homeSearchVisible: Boolean(document.querySelector('#musicSearch')),
    selectedDateDeleted: !entriesAfter[dateBefore],
    otherDatePreserved: Object.keys(entriesAfter).length === Object.keys(entriesBefore).length - 1,
    settingsPreserved: localStorage.getItem('moodio.settings.v1') === settingsBefore
  };
})()`);
check("Delete dialog changes immediately with the Korean language", homeDelete.label === "기록 삭제" && homeDelete.copy.title === "이 기록을 삭제할까요?" && homeDelete.copy.description === "삭제한 기록은 복구할 수 없어요." && homeDelete.copy.cancel === "취소" && homeDelete.copy.confirm === "삭제", JSON.stringify(homeDelete));
check("Home deletion keeps the date and returns to the empty search state", homeDelete.dateAfter === homeDelete.dateBefore && homeDelete.homeSearchVisible && homeDelete.selectedDateDeleted, JSON.stringify(homeDelete));
check("Home deletion preserves other records and all settings", homeDelete.otherDatePreserved && homeDelete.settingsPreserved, JSON.stringify(homeDelete));

const report = { passed: checks.filter((item) => item.passed).length, total: checks.length, checks };
await writeFile(resolve("smoke-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
socket.close();
if (report.passed !== report.total) process.exitCode = 1;
