import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const debuggerPort = process.env.CHROME_DEBUG_PORT || "9222";
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
await navigate("http://127.0.0.1:4173/");

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
  bottomNavRemoved: !document.querySelector('.bottom-nav')
})`);
check("Korean home renders", layout.title === "오늘은 어떤 노래가 떠올랐나요?", layout.title);
check("No horizontal overflow at 390px", layout.scrollWidth <= layout.width, `${layout.scrollWidth}/${layout.width}`);
check("Date maximum is set", /^\d{4}-\d{2}-\d{2}$/.test(layout.maxDate), layout.maxDate);
check("Wordmark stays precisely centered", Math.abs(layout.wordmarkCenter - layout.width / 2) < 1, `${layout.wordmarkCenter}/${layout.width / 2}`);
check("Empty radio search card is compact", layout.radioHeight < 125, `${layout.radioHeight}px`);
check("Bottom navigation is removed", layout.bottomNavRemoved);

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
await evaluate(`(() => {
  const date = document.querySelector('#entryDate').value;
  const entry = { date, song: ${JSON.stringify(sampleSong)}, note: 'A quiet note that survives refresh.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  localStorage.setItem('moodio.entries.v1', JSON.stringify({ [date]: entry }));
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
check("Missing preview is handled", persisted.previewDisabled && persisted.previewMessage === "Preview unavailable", persisted.previewMessage);

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

await navigate("http://127.0.0.1:4173/");
await delay(500);
const pwa = await evaluate(`(async () => ({ manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href'), registration: Boolean(await navigator.serviceWorker.getRegistration()) }))()`);
check("PWA manifest and service worker load", pwa.manifest === "./manifest.webmanifest" && pwa.registration, JSON.stringify(pwa));

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
    const note = document.querySelector('#entryNote');
    note.value = 'Saved through the Moodio interface.';
    document.querySelector('#saveEntry').click();
    const first = JSON.parse(localStorage.getItem('moodio.entries.v1'));
    const updatedNote = document.querySelector('#entryNote');
    updatedNote.value = 'Edited through the Moodio interface.';
    document.querySelector('#saveEntry').click();
    const second = JSON.parse(localStorage.getItem('moodio.entries.v1'));
    const date = document.querySelector('#entryDate').value;
    return { firstNote: first[date].note, secondNote: second[date].note, count: Object.keys(second).length };
  })()`);
  check("Save and edit keep one song per day", saveFlow.firstNote.startsWith("Saved") && saveFlow.secondNote.startsWith("Edited") && saveFlow.count === 1, JSON.stringify(saveFlow));
}

const report = { passed: checks.filter((item) => item.passed).length, total: checks.length, checks };
await writeFile(resolve("smoke-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
socket.close();
if (report.passed !== report.total) process.exitCode = 1;
