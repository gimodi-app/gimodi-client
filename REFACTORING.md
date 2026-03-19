# Client Refactoring Plan: Large File Splitting

## Overview

The client codebase has several oversized files that mix multiple concerns. This plan splits them into focused, single-responsibility modules while adding JSDoc documentation to all functions.

**Guiding principles:**
- Each new file should have one clear responsibility
- Exported APIs stay the same (re-export from original file if needed for compatibility)
- JSDoc on all functions and classes (per project code style)
- No inline comments — code should be self-documenting through clear naming

## File Size Analysis (lines)

| File | Lines | Priority |
|------|-------|----------|
| `views/server.js` | 6726 | P0 |
| `views/chat.js` | 3844 | P0 |
| `app.js` | 2065 | P1 |
| `views/voice.js` | 1792 | P1 |
| `views/emoji-picker.js` | 1520 | P2 |
| `main/index.js` | 1368 | P2 |
| `services/dm.js` | 1158 | P2 |
| `views/sidebar.js` | 1089 | P2 |

---

## Phase 1: `views/server.js` (6726 → ~8 files)

The biggest file. It mixes channel tree rendering, event handlers, admin dialogs, file browser, analytics, and more.

### Split Plan

- [ ] **`views/server-events.js`** (~300 lines)
  - Event handler functions: `onForceJoined`, `onClientJoined`, `onClientLeft`, `onAdminChanged`, `onRoleColorChanged`, `onPermissionsChanged`, `onClientMoved`, `onChannelUserJoined`, `onChannelUserLeft`, `onChannelCreated`, `onChannelDeleted`, `onChannelUpdated`, `onWebcamStarted/Stopped`, `onPeerScreenStarted/Stopped`, `onPeerMuteStateChanged`, `onLocalMuteChanged`, `onLocalDeafenChanged`, `onVoiceGranted/Revoked/Requested/Cancelled`, `onTalkingChanged`

- [ ] **`views/server-channels.js`** (~500 lines)
  - Channel tree rendering: `renderChannelTree`, `renderGroup`, `renderPlaceholder`, `renderChannel`
  - Channel drag-and-drop: `siblingIndex`, `moveChannel`
  - Channel CRUD modals: `showCreateChannelModal`, `showEditChannelModal`, `showDeleteChannelConfirm`, `showMoveChannelModal`
  - Channel context menus: `showChannelContextMenu`, `showGroupContextMenu`
  - Channel UI: `initCreateDropdown`, `onCreateChannelClick`, `showCreateDropdown`, `askChannelPassword`, `onChannelAccessError`, `onChannelUnreadChanged`

- [ ] **`views/server-admin-users.js`** (~500 lines)
  - User management panel: `renderUsersPanel`, `initUsersTableResize`
  - User detail/context: `showUserDetailModal`, `showAdminUserContextMenu`
  - Nickname management: `showManageNicknamesModal`
  - Role assignment: `showSetRoleMenuByUserId`
  - Ban by user ID: `showBanByUserIdModal`
  - List users: `showListUsersModal`

- [ ] **`views/server-admin-roles.js`** (~700 lines)
  - Roles panel: `renderRolesPanel`, `_initRolesLogic`
  - Roles modal: `showManageRolesModal`

- [ ] **`views/server-admin-settings.js`** (~550 lines)
  - Server settings panel: `renderSettingsPanel`
  - Settings modal: `showServerSettingsModal`
  - Server icon crop modal: `showIconCropModal`
  - Config helpers: `flattenConfig`, `unflattenConfig`

- [ ] **`views/server-admin-misc.js`** (~400 lines)
  - Tokens panel: `renderTokensPanel`, `showManageTokensModal`
  - Bans panel: `renderBansPanel`, `showManageBansModal`
  - Redeem token: `showRedeemTokenModal`
  - Audit log panel: `renderAuditLogPanel`, `showAuditLogModal`

- [ ] **`views/server-analytics.js`** (~400 lines)
  - Analytics panel: `renderAnalyticsPanel`
  - Chart rendering: `renderBarChart`, `renderAreaChart`
  - Helpers: `formatBytes`, `formatUptime`

- [ ] **`views/server-file-browser.js`** (~300 lines)
  - File browser modal: `showFileBrowserModal`
  - Helpers: `formatFileSize`, `getFileBrowserHttpBaseUrl`, `getFileIcon`

- [ ] **`views/server.js`** (remaining ~1500 lines)
  - Main init/cleanup, state management, `switchChannel`, `showBanModal`, `showEditGroupModal`, `showUnifiedAdminDialog`, utility functions, exports

---

## Phase 2: `views/chat.js` (3844 → ~5 files)

### Split Plan

- [ ] **`views/chat-mentions.js`** (~250 lines)
  - Mention autocomplete: `onChatInputForMentions`, `showMentionAutocomplete`, `hideMentionAutocomplete`, `navigateMentionAutocomplete`, `selectMention`, `onChannelMentionClick`
  - Channel autocomplete: `showChannelAutocomplete`, `selectChannelMention`
  - Emoji shortcode autocomplete: `showEmojiShortcodeAutocomplete`, `selectEmojiShortcode`
  - Helper: `isInsideCodeBlock`, `resolveStructuredMentions`

- [ ] **`views/chat-tabs.js`** (~350 lines)
  - Tab management: `switchToTab`, `renderTabs`, `showTabContextMenu`, `addTabDragListeners`, `switchToChannelTab`, `onNavigateChannel`, `updateInputForTab`

- [ ] **`views/chat-input.js`** (~300 lines)
  - Input handling: `sendMessage`, `autoResizeInput`, `onChatInputForCharCount`, `updateCharCount`, `onChatInputForTyping`, `onTypingEvent`, `renderTypingIndicator`, `clearTypingState`
  - File attachment: `onAttachClick`, `onFileChange`, `onDragOver`, `onDragLeave`, `onDrop`, `onPaste`, `offerSendAsFile`
  - Emoji button: `onEmojiClick`

- [ ] **`views/chat-messages.js`** (~400 lines)
  - Message editing: `enterEditMode`, `onMessageEdited`
  - Reply functionality: `startReplyTo`, `cancelReply`, `renderReplyPreview`
  - Pinned messages: `onMessagePinned`, `onMessageUnpinned`, `renderPinnedMessages`
  - Scroll/pagination: `scrollToBottom`, `onChatScroll`, `updatePaginationFromMessages`, `loadOlderMessages`, `loadOlderChannelMessages`, `loadOlderChannelViewMessages`
  - Lightbox: `openLightbox`
  - Context menus: `showLinkContextMenu`, `showImageContextMenu`
  - Message navigation: `highlightMessage`, `scrollToMessage`

- [ ] **`views/chat-notifications.js`** (~120 lines)
  - Notification bell: `updateNotificationBell`, `renderNotificationDropdown`, `openNotificationDropdown`, `closeNotificationDropdown`, `toggleNotificationDropdown`

- [ ] **`views/chat.js`** (remaining ~1500 lines)
  - Main init/cleanup, state, history loading, exports, `onKeydown`, `onNickContextMenu`, `onChannelUpdatedForReadRoles`, `showReadRestrictionBanner`, `appendSystemMessage`, unread tracking

---

## Phase 3: `app.js` (2065 → ~3 files)

### Split Plan

- [ ] **`views/settings-modal.js`** (~600 lines)
  - Settings modal: `openSettings`, `closeSettings`, `switchSettingsTab`, `renderThemeGrid`
  - Device selectors: `populateDeviceSelectors`
  - Mic loopback: `startMicLoopback`, `stopMicLoopback`
  - Camera preview: `startCameraPreview`, `stopCameraPreview`
  - Test tone: `stopTestTone`
  - Identity settings: `loadSettingsIdentities`

- [ ] **`services/settings.js`** (~80 lines)
  - Settings persistence: `loadSettings`, `saveSettings`
  - App settings object export

- [ ] **`app.js`** (remaining ~1300 lines)
  - Entry point, view switching, multi-server, reconnect, menus, mic level meter, sidebar resize, event wiring

---

## Phase 4: `views/voice.js` (1792 → ~3 files)

### Split Plan

- [ ] **`views/voice-consumers.js`** (~300 lines)
  - Consumer management: `onNewConsumer`, `cleanupAudioEntry`, `onConsumerRemoved`, `onConsumerClosed`, `onSpeakerChanged`
  - User volume: `onUserVolumeChanged`

- [ ] **`views/voice-webcam.js`** (~200 lines)
  - Webcam handling: `handleWebcamClick`, `onLocalWebcamStarted`, `onPeerWebcamStopped`, `onLocalWebcamStopped`
  - Self-preview: `initSelfPreviewDrag`, `updateSelfPreviewVisibility`, `repositionSelfPreviewForFullscreen`

- [ ] **`views/voice.js`** (remaining ~1200 lines)
  - Init/cleanup, mute/deafen, PTT, voice controls UI, media grid

---

## Phase 5: Remaining P2 files

### `views/emoji-picker.js` (1520 lines)
- [ ] **`views/emoji-data.js`** (~1250 lines) - Static emoji category data and shortcode map
- [ ] **`views/emoji-picker.js`** (remaining ~270 lines) - Picker UI logic

### `main/index.js` (1368 lines)
- [ ] **`main/updater.js`** (~200 lines) - `checkForUpdates` and related logic
- [ ] **`main/menu.js`** (~150 lines) - `buildMenu`, `rebuildTrayMenu`
- [ ] **`main/protocol.js`** (~50 lines) - `parseProtocolUrl`, `handleProtocolUrl`
- [ ] **`main/ipc-handlers.js`** (~400 lines) - All `ipcMain.handle`/`ipcMain.on` registrations
- [ ] **`main/index.js`** (remaining ~500 lines) - Window creation, app lifecycle

### `services/dm.js` (1158 lines)
- [ ] **`services/dm-storage.js`** (~150 lines) - localStorage helpers: `loadMessages`, `saveMessages`, `loadConversations`, `saveConversations`, `loadPurgeLog`, `savePurgeLog`, `loadReactions`, `saveReactions`
- [ ] **`services/dm.js`** (remaining ~1000 lines) - DmService class

### `views/sidebar.js` (1089 lines)
- Acceptable size after other refactors. Skip unless it grows further.

---

## Progress Tracking

### Phase 1: server.js (6726 → 3018 lines + 7 extracted modules)
- [x] Extract `views/server-events.js` (586 lines)
- [x] Extract `views/server-admin-users.js` (927 lines)
- [x] Extract `views/server-admin-roles.js` (788 lines)
- [x] Extract `views/server-admin-settings.js` (621 lines)
- [x] Extract `views/server-admin-misc.js` (673 lines)
- [x] Extract `views/server-analytics.js` (408 lines)
- [x] Extract `views/server-file-browser.js` (392 lines)
- [x] Add JSDoc to all extracted functions
- [x] Verify build passes (`npm run build`)
- Note: `views/server-channels.js` deferred — channel rendering is tightly coupled to server.js state

### Phase 2: chat.js — modules prepared, integration pending
- [x] Extract `views/chat-mentions.js` (410 lines) — factory module created
- [x] Extract `views/chat-tabs.js` (528 lines) — factory module created
- [x] Extract `views/chat-input.js` (486 lines) — factory module created
- [x] Extract `views/chat-messages.js` (733 lines) — factory module created
- [x] Extract `views/chat-notifications.js` (167 lines) — factory module created
- [ ] Integrate factory modules into chat.js (replace inline functions with imports)
- [ ] Verify build passes

### Phase 3: app.js — modules prepared, integration pending
- [x] Extract `views/settings-modal.js` (830 lines) — factory module created
- [ ] Integrate into app.js
- [ ] Verify build passes

### Phase 4: voice.js — modules prepared, integration pending
- [x] Extract `views/voice-consumers.js` (272 lines) — factory module created
- [x] Extract `views/voice-webcam.js` (238 lines) — factory module created
- [ ] Integrate into voice.js
- [ ] Verify build passes

### Phase 5: Remaining
- [x] Extract `views/emoji-data.js` (1249 lines) — integrated, build passes
- [x] Extract `main/updater.js` (309 lines) — module created
- [x] Extract `services/dm-storage.js` (102 lines) — module created
- [ ] Integrate `main/updater.js` into main/index.js
- [ ] Integrate `services/dm-storage.js` into services/dm.js
- [ ] Skipped: `main/menu.js`, `main/protocol.js`, `main/ipc-handlers.js` (too tightly coupled to module state)
- [ ] Final full build + smoke test

### Completed integrations (build verified)
- server.js: 6726 → 3020 lines (7 extracted modules, build passes)
- emoji-picker.js: 1520 → 278 lines (emoji-data.js extracted, build passes)
