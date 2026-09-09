export const translations = {
  ko: {
    language: "언어", update: "업데이트", openMenu: "메뉴 열기", closeMenu: "메뉴 닫기", home: "홈", archive: "지난 기록", settings: "설정",
    appTagline: "하루 한 곡, 마음 한 조각", heroTitle: "오늘은 어떤 노래가 떠올랐나요?", selectDate: "기록할 날짜",
    searchPlaceholder: "노래, 아티스트 검색", search: "검색", radioHint: "마음에 머문 곡을 찾아보세요. Apple의 음악 검색 결과를 사용합니다.",
    searching: "노래를 찾고 있어요...", noResults: "검색 결과가 없어요. 다른 단어로 검색해보세요.", searchError: "음악을 불러오지 못했어요. 네트워크를 확인해 주세요.",
    nowSelected: "오늘의 주파수", changeSong: "다시 검색 · 곡 변경", preview: "미리듣기", play: "재생", pause: "일시정지",
    previewUnavailable: "미리듣기를 제공하지 않는 곡이에요", noteLabel: "오늘의 기록", notePlaceholder: "이 노래가 오늘 떠오른 이유를 자유롭게 남겨보세요.",
    save: "저장", updateEntry: "기록 수정", saved: "기록을 저장했어요.", edited: "기록을 수정했어요.", chooseSongFirst: "먼저 노래를 선택해 주세요.",
    futureBlocked: "미래 날짜에는 기록할 수 없어요.", existingLoaded: "이 날짜의 기록을 불러왔어요.",
    monthlyArchive: "월별 음악 일기", previousMonth: "이전 달", nextMonth: "다음 달", share: "공유하기", noEntries: "이 달에는 아직 기록이 없어요.",
    edit: "수정", more: "더보기", less: "접기", sharedDiary: "공유된 음악 일기", sharedSubtitle: "한 달의 노래와 그날의 마음", shareEmpty: "공유할 기록이 없어요.",
    shareCopied: "공유 링크를 복사했어요.", shareFailed: "공유 링크를 만들지 못했어요.", shareTooLong: "기록이 길어 링크로 공유할 수 없어요. 글을 조금 줄인 뒤 다시 시도해 주세요.",
    invalidShare: "공유 링크가 올바르지 않거나 손상되었어요.", backToMoodio: "Moodio로 돌아가기",
    displayName: "표시 이름", displayNameHelp: "월별 공유 페이지 제목에 사용돼요.", displayNamePlaceholder: "이름을 입력하세요", settingsSaved: "설정을 저장했어요.",
    languageSetting: "언어", languageHelp: "앱의 모든 화면에 적용됩니다.", saveSettings: "설정 저장", defaultName: "나의",
    checkingUpdates: "새 버전을 확인하고 있어요...", updated: "Moodio가 업데이트되었어요.", updateFailed: "업데이트를 확인하지 못했어요.",
    openInApple: "Apple Music에서 보기", recordCount: "{count}개의 기록", readonly: "읽기 전용", albumArtwork: "앨범아트 크게 보기",
    dateLocale: "ko-KR"
  },
  en: {
    language: "Language", update: "Update", openMenu: "Open menu", closeMenu: "Close menu", home: "Home", archive: "Journal", settings: "Settings",
    appTagline: "One song, one piece of today", heroTitle: "What song came to mind today?", selectDate: "Journal date",
    searchPlaceholder: "Search songs or artists", search: "Search", radioHint: "Find the song that stayed with you. Results are provided by Apple’s music search.",
    searching: "Searching for songs...", noResults: "No results. Try a different search.", searchError: "Could not load music. Check your connection.",
    nowSelected: "TODAY'S FREQUENCY", changeSong: "Search again · Change song", preview: "Preview", play: "Play", pause: "Pause",
    previewUnavailable: "Preview unavailable", noteLabel: "Today's note", notePlaceholder: "Write whatever this song meant to you today.",
    save: "Save", updateEntry: "Update entry", saved: "Your entry was saved.", edited: "Your entry was updated.", chooseSongFirst: "Choose a song first.",
    futureBlocked: "You can’t write an entry for a future date.", existingLoaded: "Your entry for this date is ready to edit.",
    monthlyArchive: "Monthly music journal", previousMonth: "Previous month", nextMonth: "Next month", share: "Share month", noEntries: "No entries for this month yet.",
    edit: "Edit", more: "Read more", less: "Show less", sharedDiary: "Shared music journal", sharedSubtitle: "A month of songs and the moments behind them", shareEmpty: "There are no entries to share.",
    shareCopied: "Share link copied.", shareFailed: "Could not create a share link.", shareTooLong: "This journal is too long to share as a link. Shorten the notes and try again.",
    invalidShare: "This share link is invalid or damaged.", backToMoodio: "Back to Moodio",
    displayName: "Display name", displayNameHelp: "Used in the title of your monthly share page.", displayNamePlaceholder: "Enter your name", settingsSaved: "Settings saved.",
    languageSetting: "Language", languageHelp: "Applied across every screen in the app.", saveSettings: "Save settings", defaultName: "My",
    checkingUpdates: "Checking for updates...", updated: "Moodio is up to date.", updateFailed: "Could not check for updates.",
    openInApple: "Open in Apple Music", recordCount: "{count} entries", readonly: "Read only", albumArtwork: "Enlarge album artwork",
    dateLocale: "en-US"
  }
};

export function createTranslator(language) {
  return (key, variables = {}) => {
    let value = translations[language]?.[key] ?? translations.ko[key] ?? key;
    Object.entries(variables).forEach(([name, replacement]) => {
      value = value.replaceAll(`{${name}}`, String(replacement));
    });
    return value;
  };
}
