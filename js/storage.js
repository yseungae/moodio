const ENTRY_KEY = "moodio.entries.v1";
const SETTINGS_KEY = "moodio.settings.v1";

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

export function getEntries() {
  return readJson(ENTRY_KEY, {});
}

export function getEntry(date) {
  return getEntries()[date] ?? null;
}

export function saveEntry(entry) {
  const entries = getEntries();
  entries[entry.date] = entry;
  localStorage.setItem(ENTRY_KEY, JSON.stringify(entries));
  return entry;
}

export function deleteEntry(date) {
  const entries = getEntries();
  if (!Object.prototype.hasOwnProperty.call(entries, date)) return false;
  delete entries[date];
  localStorage.setItem(ENTRY_KEY, JSON.stringify(entries));
  return true;
}

export function getEntriesForMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  return Object.values(getEntries())
    .filter((entry) => entry?.date?.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getSettings() {
  return { language: "ko", displayName: "", ...readJson(SETTINGS_KEY, {}) };
}

export function saveSettings(settings) {
  const next = { ...getSettings(), ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
