# Moodio

하루에 한 곡을 고르고, 그날 왜 그 노래가 떠올랐는지 기록하는 조용한 음악 일기 PWA입니다.

## 웹앱

**https://yseungae.github.io/moodio/**

## 주요 기능

- 오늘 또는 과거 날짜에 하루 한 곡 기록
- Apple iTunes Search 기반 음악 검색과 30초 미리듣기
- 저장한 곡과 글 수정, 브라우저 `localStorage` 보관
- 월별 기록 목록과 URL 스냅샷 공유
- 한국어/영어 전체 UI 전환
- 앨범아트 확대 보기
- iPhone 홈 화면 설치를 위한 PWA 및 안전한 업데이트 버튼

## 로컬에서 실행하기

Node.js가 설치된 터미널에서 아래 명령을 실행합니다.

```bash
npm start
```

브라우저에서 `http://localhost:4173`을 엽니다. 별도 패키지 설치나 API 키는 필요하지 않습니다.

## 파일 구조

```text
index.html                 앱 화면 뼈대
css/styles.css             전체 디자인과 모바일 레이아웃
js/app.js                  화면과 사용자 동작
js/musicService.js         음악 검색 공급자
js/storage.js              기록과 설정 저장
js/shareService.js         월별 공유 링크 생성/복원
js/i18n.js                 한국어/영어 번역
manifest.webmanifest       PWA 설정
sw.js                      오프라인 캐시와 업데이트
.github/workflows/         GitHub Pages 자동 배포
```

## 데이터와 음악 API

기록과 설정은 이 기기의 브라우저에만 저장됩니다. 브라우저 데이터를 지우면 기록도 삭제될 수 있습니다. 음악 검색은 개발자 토큰이 필요 없는 Apple iTunes Search API를 사용합니다. 추후 MusicKit 등으로 바꿀 때는 `js/musicService.js`를 같은 곡 데이터 구조에 맞춰 교체하면 됩니다.

월 공유는 서버에 올리지 않고 필요한 데이터를 링크 안에 압축해 넣습니다. 아주 긴 기록이 많아 URL 제한을 넘는 경우에는 안전하게 안내 메시지를 표시합니다.

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 GitHub Pages에 자동 배포합니다. 정적 파일 경로는 상대 경로라 저장소 이름이 바뀌어도 Pages의 하위 경로에서 동작합니다.
