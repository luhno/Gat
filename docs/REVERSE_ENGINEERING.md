# Dossiê de engenharia reversa — GatherV2.app 0.55.2

> Nota (2026-10-28): o dossiê abaixo é sobre o app **original** do Gather. A reimplementação
> descrita como `gather-offline/` passou a se chamar **DittoApp** (o diretório local do projeto
> continua `gather-offline/`).


Estudo independente do app desktop oficial do Gather (macOS, Electron 44.4.3, versão 0.55.2,
bundle `com.gather.GatherV2`), usado como base para a reescrita offline em `gather-offline/`.
Não é afiliado ao Gather Presence, Inc.

**Marcadores usados no texto:** **[visto]** = há evidência citada no artefato indicado;
**[inferido]** = conclusão razoável a partir das evidências, sem confirmação direta;
**não encontrado** = procurou-se e não há evidência no material analisado.

## 0. Método e artefatos

| Artefato | O que é | Uso aqui |
|---|---|---|
| `recover/recovered-src/` | 83 arquivos TS/TSX do app + 55 das libs internas (`gather-common`, `gather-electron-interop`, `gather-env-config`, `gather-opentelemetry`, `gather-client-common`, `gather-i18n`, `gather-common-including-video`) extraídos de `sourcesContent` dos source maps embutidos | fonte primária do processo principal, preloads e shared libs |
| `recover/app-asar/` | `app.asar` extraído (build/ + node_modules/ + package.json) | bundles compilados, HTMLs locais, deps, config de build |
| `recover/web-client/main.f4747b178f695fe5.js` (+ `signin.html`) | bundle público do cliente web `app.v2.gather.town`, baixado em 2026-10-28 | análise estática (§8) |
| `~/Library/Logs/GatherV2/main.log` | 1471 linhas de execução real (2026-10-28 16:58–17:01) | confirmação de runtime (boot, OAuth, SFU, Statsig) |
| `~/Library/Application Support/GatherV2/` | `config.json`, `flags.json`, `startup-config.json`, IndexedDB/Local Storage/Network Persistent State | estado persistido, hosts contatados, Firebase/Statsig |
| `~/Applications/GatherV2.app` | bundle assinado/notarizado (671 MB) | Info.plist, app-update.yml, app.asar.unpacked, framework |

Os source maps são **embutidos no asar** ao lado de cada bundle
(`recover/app-asar/build/js/{entry,background,trayWindow,screenShareModal,networkError}.js.map`),
e todos os 7 maps analisados têm `sourcesContent` completo (`nulls=0`). Foi esse vetor que permitiu
recuperar o TypeScript original. A extração pode ser reproduzida por
`recover/extract_sourcemaps.py`.

**Limite importante do que foi recuperado:** alguns módulos do processo principal e de UI local
**não aparecem** em nenhum `sources` de nenhum map, embora o código compilado esteja em
`build/js/entry.js`. São eles: `src/main/{tray,updater,osMenu,dock,app-installation,contentTracing,send-logs,animate}.ts`,
`src/main/windows/tray-window.ts`, `src/shared/constants/{analytics,toolbar}.ts`,
`src/renderer/components/NetworkError.tsx` e os módulos de mini-mode. Sobre esses, o dossiê cita
o **bundle compilado** (strings/símbolos) e marca como visto; o que não pôde ser lido no fonte
aparece como "não encontrado".

---

## 1. Sumário executivo

**[visto]** O GatherV2 é uma **casca Electron para um cliente web remoto**. O processo principal
sobe janelas locais mínimas (título, toolbar, tray, modal de screen share, tela de erro de rede) e a
parte central da UI é um `BrowserView` que carrega `https://app.v2.gather.town/app`:

- o app desktop tem 0.55.2, Electron 44.4.3, `CFBundleIdentifier com.gather.GatherV2` e exige macOS ≥ 13
  (`GatherV2.app/Contents/Info.plist`);
- o asar tem 76.104.791 bytes (≈76 MB), com 5 bundles de renderer, 2 preloads, 9 locales e 245 pacotes
  em `node_modules` (`recover/app-asar/`; `package.json:2-8`);
- tela principal = `BrowserWindow` local + `BrowserView` remoto (`recover/recovered-src/src/main/views/app-view.ts:149-184`);
- 112 canais IPC consumidos pelos preloads (`appViewPreload.ts` + `sharedInterop.ts`) expostos ao
  conteúdo remoto e às janelas locais (§3);
- identidade, mapa, avatares, voz/vídeo, chat e todo o estado de produto vivem **no servidor**; o
  shell só integra SO, mídia, permissões e telemetria.

**[visto]** O desktop não tem modo offline: a navegação inicial é `GATHER_BASE_APP_URL`
(`.../app`) e, se a rede falhar, o único fallback é uma `BrowserView` local de erro
(`app-view.ts:88-112`, `:194-224`; `views/networkError.ts`). Nada do produto é cacheado no app.

**[inferido]** Para funcionar offline é preciso reimplementar (a) o cliente web inteiro e (b) o
servidor de espaço/realtime — o que `gather-offline/` faz com cliente React + canvas, servidor
HTTPS/WSS embutido e WebRTC mesh, sem telemetria/updater.

Números da recuperação: ~7.050 linhas TS/TSX só em `entry/main/preloads` (`wc -l` do diretório),
sendo `entry.ts` 280, `main/ipc.ts` 889, `preload/appViewPreload.ts` 687,
`main/windows/app-window.ts` 544, `main/windows/accessoryWindow.ts` 698, `main/views/app-view.ts` 536.

---

## 2. Arquitetura do original

### 2.1 Boot do processo principal

**[visto]** `recover/recovered-src/src/entry.ts`:

1. imports que configuram o resto do app antes de tudo (`entry.ts:1-5`);
2. `undici` global com proxy do ambiente e timeouts derivados do polling de 5 min
   (`entry.ts:66-76`; valor em `__parent/gather-client-common/src/clientStatusUtils.ts:7`);
3. single-instance lock; se falhar, `app.quit()` imediato (`entry.ts:78-84`);
4. `startErrorReporter()` (Sentry + crash checker) e `setupProcessGoneDetection()`
   (`entry.ts:86-87`; `main/error-reporting.ts:47-50`);
5. storage `electron-store` (`entry.ts:89`; `main/storage-store.ts:104-108`);
6. desabilita aceleração de hardware por setting e aplica switches do Chromium
   (`wm-window-animations-disabled`, `disable-renderer-backgrounding`,
   `disable-background-timer-throttling`) (`entry.ts:91-103`);
7. atalhos globais registrados no foco da janela (`CommandOrControl+Shift+A/V/M`, `Command+H`)
   (`entry.ts:105-143`; `shared/constants/shortcuts.ts`);
8. `app.on("ready")` na ordem: protocolo `gather-desktop://`, locales, desktopId, analytics, IPC,
   display, tray, `Activity` (idle/app ativo), tray window, **app window**, devtools, crash/update
   checks, dock, network/power/login-item/osMenu, `contextMenu`, `setupDefaultSession`
   (`entry.ts:164-247`);
9. handlers de `second-instance`, `open-url` e `setAsDefaultProtocolClient("gather2")`
   (`entry.ts:256-279`).

### 2.2 Janelas e views

**[visto]** O modelo é: janelas locais carregando HTML do asar via protocolo próprio
`gather-desktop://` (proteção a path traversal em `main/desktopRendererProtocol.ts:19-38`,
`:84-86`) + um `BrowserView` com o site remoto. Tabela:

| Janela/HTML | Papel | Evidência |
|---|---|---|
| `appWindow` → `background.html` | shell da janela principal, título oculto, toolbar nativa; carrega o app view | `main/windows/app-window.ts:70-122` |
| `BrowserView` remoto → `https://app.v2.gather.town/app` | **produto inteiro**; preload `appViewPreload.js`; `sandbox:false`, `nodeIntegrationInWorker:true` | `main/views/app-view.ts:149-184` |
| `tray-window.html` (286×235) | menu da bandeja quando a flag `DesktopTrayV2` está off | `build/js/entry.js` (string "Creating tray window"); flag em `flags.json` |
| `screen-share-modal.html` (410×60, sem frame) | barra "você está compartilhando" | `main/windows/screen-share-modal-window.ts:25-118` |
| `networkError.html` | erro de carregamento do app remoto | `main/views/networkError.ts:18-57` |
| `accessoryWindow` (dinâmicas) | popups OAuth, PiP/mini, tray/content do webapp; opções validadas por whitelist | `main/windows/accessoryWindow.ts:57-190`, `:218-292` |
| `screenShareBorder.html`, `ScreenAnnotationToolbar` | funcionalidades legadas desativadas no código atual | `main/views/app-view.ts:479-482`; `app-window.ts:183`; `ipc.ts:443-449` |
| `MiniModeWindow` | legado; código de mini-mode antigo sempre retorna `false` | `app-window.ts:470-480`; `ProcessNames` em `__parent/gather-electron-interop/src/desktopCpuMemoryMetrics.ts` |

**[visto]** A barra de título é desenhada pelo shell: `APP_WINDOW_SET_TOOLBAR_STATUS` /
`APP_WINDOW_TOOLBAR_SHOW|HIDE` ajustam a altura do app view e os semáforos do macOS
(`main/ipc.ts:737-762`; `main/windows/app-window.ts:527-544`; `views/app-view.ts:114-147`).

**[visto]** Fechar a janela no macOS **esconde** o app (não fecha); no Windows/Linux abre prompt de
saída (`app-window.ts:148-161`; `showQuitPrompt` em `quitManager.ts:12-22`). Há ainda workarounds de
`Command+H`/`did-become-active` porque janelas `visibleOnAllWorkspaces` bagunçam o comportamento
nativo (`entry.ts:117-160`).

### 2.3 Tray / dock / menu

**[visto — bundle compilado]** `tray` (fonte não recuperada) aparece em `build/js/entry.js` como
menu `Menu.buildFromTemplate` com itens "about", "check-for-updates", "Go", "toggle-audio",
"toggle-video", "do-not-disturb", "quit" e logs `Clicked tray: ...`. O clique no ícone faz:
se `featureFlags.DesktopTrayV2` → envia `TRAY_CLICK` com `bounds` para o renderer (o webapp desenha o
menu); senão abre `tray-window.html`. Ícones em
`build/src/images/tray_icon/{tray_macosTemplate.png,tray_windows.ico}`.
O dock do macOS também é alimentado por estado (`updateDock` chamado nos handlers `IN_USER_HOME`,
`IN_GAME_CANVAS`, `LEAVE_SPACE_FROM_TRAY` — `main/ipc.ts:181-223`, `:486-497`).

### 2.4 Mini mode / PiP

**[visto]** O mini-mode "antigo" do shell está morto: `canEnterMiniModeForScreenShare()` e
`canEnterMiniMode()` retornam `false` com comentário "v2: This is old mini-mode" (`app-window.ts:470-480`;
TODO DTOP-366). Permanecem no preload `supportsPictureInPictureMinimode`, `supportsMiniModeAnimation`,
`prepareMiniModeAnimation()` e `finishAnimationToMiniMode()` (`preload/appViewPreload.ts:96-102`, `:213`,
`:581-602`), mas os handlers `PREPARE_MINI_MODE_ANIMATION` / `FINISH_ANIMATION_TO_MINI_MODE`
**não estão no fonte recuperado** (não encontrado).

**[visto]** O mini-mode atual (PiP) é feito pelo **cliente web** usando janelas `accessoryWindow`
transparentes/always-on-top: o log mostra `[OSDraggableOverlayWindow]`, `pip-window`,
`pip-window-4` e `tray-1` (`~/Library/Logs/GatherV2/main.log`, 17:01:37); o `signin.html` do
cliente web tem comentário explícito de que não pode pintar fundo por causa da janela transparente
do mini mode (`recover/web-client/signin.html`).

### 2.5 Deep link `gather2://`

**[visto]** Protocolo definido em `shared/constants/protocol.ts:3-6` (`gather2` em prod;
`gather2dev` em local/test), fix-up do formato inválido `gather://https://...` e extração de
`spaceId` por regex em `app-window.ts:260-288`. Fluxos:
- `gather2://oauth2/?authCode=...` → `OAUTH_SIGN_IN_RESPONSE` para o app view, sem navegar
  (`app-window.ts:290-299`);
- deep link de espaço só é aceito se `checkIfGatherAppUrl` (lista de origens permitidas), vira
  `setLaunchUrlOverride`/`navigateToSpaceUrl`; mesmo espaço → `NAVIGATE_WITHIN_SPACE`,
  espaço diferente → `loadURL` (`app-window.ts:290-322`, `:412-459`);
- URLs de branch `https://<branch>.app.v2.dev.gather.town` são aceitas por sufixo de hostname
  (`main/urls.ts:10-22`);
- Windows recebe o link via `argv` (`second-instance` em `entry.ts:256-269`; `app-view.ts:78-86`).

### 2.6 Quit, crash, auto-restart e updater

- **[visto]** Quit: `before-quit` salva bounds/`lastRunningVersion` e marca `unexpectedQuit=false`
  (`quitManager.ts:65-84`); `directQuit` instala update pendente antes de `app.quit()`
  (`quitManager.ts:25-35`).
- **[visto]** Crash checker lê crash dumps do Chromium antes do Sentry limpar e cruza com
  `unexpectedQuit` (`crash-checker.ts:25-65`); se detectado, envia "Desktop Crash Detected" + logs
  (`crash-checker.ts:54-62`).
- **[visto]** Auto-restart: entre 2h–6h da manhã, app aberto > 8 dias ou PPM > 250 MB (ou update
  pendente), e sem call/screenshare/foco → `forceRestart()` (`autoRestart.ts:10-91`).
- **[visto]** Updater: `autoUpdater` do `electron-updater` com provider **custom** de Gather —
  feed URL `https://api.v2.gather.town`, path `/api/v2/releases/desktop/<platform>/<versão>/<channel>`,
  downloads em `https://downloads.gather.town/desktop-v2/...` (`main/GatherUpdateProvider.ts:30-63`;
  `build/js/entry.js` traz `setFeedURL({provider:"custom",url:"https://api.v2.gather.town",...})`);
  checagem a cada `CLIENT_REFRESH_SERVER_POLLING_INTERVAL_MS` = 5 min
  (`clientStatusUtils.ts:7`); `autoDownload=false` (baixa sob demanda), canal `latest`/`beta`
  conforme `DesktopPreviewReleases` (`app-state.ts:32-38`); `update-downloaded` → evento
  `ON_DESKTOP_UPDATE` + prompt com `UPDATE_NOW`/`DISMISS_UPDATE_PROMPT`
  (`ipc.ts:523-535`; `preload/appViewPreload.ts:409-424`). No macOS o `quitAndInstall` apenas
  encerra e deixa o Squirrel.Mac aplicar (`build/js/entry.js`: "quitting directly because we're on Mac";
  `Squirrel.framework` presente em `GatherV2.app/Contents/Frameworks/`).
- **[visto]** `app-update.yml` do bundle aponta `owner: gathertown`,
  `repo: gather-town-v2-desktop-releases`, `provider: github`, `releaseType: draft`,
  `updaterCacheDirName: gather-electron-updater` — é o fallback/empacotamento; em runtime o provider
  custom acima tem precedência. Pós-instalação há checagem de sucesso (`expectedUpdate`/`failedUpdate`),
  reset de permissões TCC do macOS via `tccutil reset All com.gather.GatherV2` até 5 tentativas
  (`macUtils.ts:15-32`; `MAX_MAC_SYSTEM_PERMISSION_RESET_FAIL_COUNT` em `clientStatusUtils.ts:20`),
  e prompt para mover o app de `/Volumes/Gather` para Aplicativos (`build/js/entry.js`).

---

## 3. Superfície IPC e modelo de segurança

### 3.1 Dois bridges distintos

**[visto]**
- `window._electron_interop` — `contextBridge` do preload do **app view** (conteúdo remoto).
  112 canais usados; implementação dos métodos em `preload/appViewPreload.ts` (687 linhas) e tipo
  público (com versionamento de compatibilidade) em
  `__parent/gather-electron-interop/src/OptionalInterop.ts:194-729`.
- `window._gatherInterop` — preload das **janelas locais** (background/tray/screen-share-modal/
  accessory): `preload/sharedPreload.ts:1-9` + `renderer/interop/sharedInterop.ts:11-133`, com
  `electron-redux/preload` para sincronizar o store Redux entre processos (`sharedPreload.ts:3`).

**[visto]** Todo handler `ipcMain.handle` é instrumentado por monkey-patch que mede duração e reporta
em `GET_IPC_METRICS` (`src/metrics/instrumentIpcMain.ts:9-90`; `ipc.ts:689`).

### 3.2 Canais por área (main ↔ preload ↔ renderer)

Handlers principais em `src/main/ipc.ts` (salvo indicação); eventos enviados ao renderer aparecem como "→".

| Área | Canais |
|---|---|
| OAuth/auth | `OPEN_OAUTH_SIGN_IN_PAGE`, `OPEN_G_CAL_OAUTH_SIGN_IN_PAGE`, `START_OAUTH_SIGN_IN_FLOW` (`ipc.ts:96-104`); → `OAUTH_SIGN_IN_RESPONSE`, `ON_OAUTH_SIGN_IN` |
| Estado compartilhado | `UPDATE_SHARED_STATE` (persiste `flags.json`/`startup-config.json`), `GET_SHARED_STATE_VALUE` (`ipc.ts:106-132`); → `ON_DESKTOP_ANALYTIC_EVENT`, `ON_LOG_SPACE_EVENT` |
| Janela principal | `MINIMIZE_WINDOW`, `MAXIMIZE_WINDOW`, `CLOSE_WINDOW`, `ACTIVATE`, `SHOW_APP_WINDOW`, `APP_WINDOW_TOOLBAR_SHOW/HIDE/SET`, `SET_MAIN_WINDOW_FOCUSABLE`, `ENSURE_MAIN_WINDOW_FOCUSED` (`ipc.ts:134-179`, `:480-484`, `:737-762`, `:866-868`); → `USER_CLOSE`, `ON_APP_WINDOW_FULLSCREEN_STATE_CHANGE`, `ON_APP_WINDOW_HIDDEN_BY_USER`, `APP_WINDOW_DESKTOP_TOOLBAR_STATUS_CHANGE` |
| Accessory/mini | `CLOSE_ACCESSORY_WINDOW`, `RESIZE_ACCESSORY_WINDOW`, `SYNC_ACCESSORY_WINDOW_OPTIONS` (`ipc.ts:158-234`, `:839-843`); → `ACCESSORY_WINDOW_EVENT`, `ACCESSORY_WINDOW_BOUNDS_EVENT` |
| Tray | `CLOSE_TRAY_WINDOW`, `LEAVE_SPACE_FROM_TRAY` (`ipc.ts:486-497`); → `TRAY_CLICK`, `TRAY_BOUNDS` (emitido pelo módulo não recuperado) |
| Display | `GET_DISPLAY_ID_MOUSE_ON`, `GET_APP_WINDOW_DISPLAY_ID`, `FORCE_DISPLAY_UPDATE` (`ipc.ts:236-239`, `:832`, `:860-864`); → `DISPLAY_UPDATE_EVENT` (`display.ts:79-84`) |
| Mídia/permissões | `DESKTOP_CAPTURER_GET_SOURCES`, `GET_SCREEN_REC_PERMISSION_STATUS`, `GET_MICROPHONE_CAMERA_PERMISSION_STATUS`, `REQUEST_MICROPHONE_ACCESS`, `REQUEST_CAMERA_ACCESS`, `REQUEST_SCREEN_REC_PERMISSION`, `RESET_PERMISSIONS`, `CAN_SHARE_DESKTOP_AUDIO`, `TOGGLE_LOOPBACK_SCREEN_AUDIO`, `SHOULD_USE_SYSTEM_PICKER_FOR_DESKTOP_SCREENSHARE`, `TOGGLE_ACTIVE_WINDOWS` (`ipc.ts:252-272`, `:393-399`, `:537-655`, `:834-837`) |
| Screen share | `START_SCREEN_SHARE`, `STOP_SCREEN_SHARE`, `SHOW/HIDE_SCREEN_SHARE_MODAL`, `SEND_SCREENSHARE_NAME`, `UPDATE_SCREENSHARE_MODAL_SIZE` (`ipc.ts:424-478`, `:568-590`); → `ON_STOP_SCREEN_SHARE`, `ON_DESKTOP_ACTION(StopScreenSharing)`, `PUSH_WINDOWS_BEHIND_SCREENSHARE` (handler não encontrado) |
| Atualizações/restart | `UPDATE_NOW`, `DISMISS_UPDATE_PROMPT`, `RESTART_APP`, `SEND_RELOAD_APP` (`ipc.ts:517-535`, `:870-873`); → `ON_DESKTOP_UPDATE` |
| Settings/locale | `GET_ALL_DESKTOP_SETTINGS`, `UPDATE_DESKTOP_SETTING`, `APP_GET_SELECTED_LANGUAGE`, `GET_LOCALE_MESSAGES` (`ipc.ts:280-367`, `:510-515`); → `ON_DESKTOP_SETTING_UPDATED` |
| Notificações/badge | `SHOW_NOTIFICATION`, `SET_APP_BADGE`, `SET_APP_BADGE_DATA` (`ipc.ts:374-422`); → `ON_NOTIFICATION_ACTION` (`notificationManager.ts:37-90`) |
| Métricas/diagnóstico | `GET_CPU_USAGE`, `GET_HEALTH_METRICS`, `GET_MAIN_PROCESS_MEMORY_METRICS`, `GET_IPC_METRICS`, `GET_GPU_DEVICE_INFO`, `GET_PROCESS_NAMES`, `GET_WINDOW_INFO_BY_ID`, `MOVE_ALL_WINDOWS_BEHIND_WINDOW`, `CHECK_NATIVE_UTILS_LOADED`, `SHOW/HIDE_CURSOR`, `REQUEST_CONTENT_TRACE`, `REQUEST_LIGHT_TRACE`, `SEND_DESKTOP_LOGS`, `SEND_LOGS`, `GET_SYSTEM_IDLE_TIME`, `GET_SYSTEM_ACTIVE_APP` (`ipc.ts:241-278`, `:499-503`, `:547-566`, `:657-730`, `:776-830`; `Activity.ts:55-58`) |
| Energia/foco/rede | → `ON_SUSPEND`, `ON_RESUME`, `ON_SCREEN_LOCK_CHANGE` (`power-monitor.ts:14-52`); `IS_ANY_GATHER_WINDOW_FOCUSED`, `REQUEST_ANY_GATHER_WINDOW_FOCUS_CHANGE` → `ANY_GATHER_WINDOW_FOCUS_CHANGE` (`window-manager.ts:18-109`; `ipc.ts:846-855`); `NETWORK_CONNECTED`, `NETWORK_DISCONNECTED` (`network-monitor.ts:7-17`) |
| Downloads/outros | `RECORDING_DOWNLOAD` (`ipc.ts:732-735`), `QUIT` (`ipc.ts:247-250`), `IN_USER_HOME`, `IN_GAME_CANVAS`, `AUDIO_UPDATED`, `VIDEO_UPDATED`, `IN_OFFICE_UPDATED` (`ipc.ts:181-223`), `GET_COMMAND_LINE_FLAG_INFO` (`ipc.ts:274-278`), `OPEN_IN_APP_SETTINGS` (`ipc.ts:505-508`) |

**[visto]** Canais de teste (`__testOnly`) só existem com `isTest`/`GATHER_TESTING`
(`ipc.ts:875-889`; `preload/appViewPreload.ts:639-681`).

### 3.3 Modelo de segurança

**[visto]**
- **A fronteira de confiança é a origem remota.** O app view expõe recursos poderosos ao site:
  `desktopCapturer`, `shell.openExternal`, `downloadURL`, lista de processos (`ps-list`), reset de
  TCC, content tracing, notificações — tudo via `_electron_interop`
  (`preload/appViewPreload.ts`; `ipc.ts`).
- **Lista de origens permitidas** para navegação/deep link: `ALLOWED_GATHER_APP_URLS` /
  `ALLOWED_GATHER_DOMAINS` (`main/constants/routes.ts:12-24`), com validação em
  `checkIfGatherAppUrl` (`urls.ts:4-24`). Dentro do espaço, navegação para domínio não-Gather é
  bloqueada (`app-view.ts:255-266`).
- **Popups** só são permitidos para `accounts.google.com`, `login.microsoftonline.com`,
  `app.eraser.io` (whiteboard), `about:blank`/`about:blank#blocked`; o resto abre no navegador
  padrão ou é negado (`app-view.ts:52-60`, `:276-322`). `chrome://` só com debug flag
  `--gather-chrome-urls` (`app-view.ts:297-307`).
- **Isolamento:** o app view usa `preload` com `sandbox:false` e `nodeIntegrationInWorker:true`
  (`app-view.ts:155-161`) — decisão explícita para viabilizar o preload; `contextIsolation` fica no
  default do Electron (true) e `nodeIntegration` default (false). As janelas locais usam o outro
  preload (`sharedPreload.js`) e recebem `electron-redux/preload`.
- **Protocolo local** `gather-desktop://` com `standard/secure/supportFetchAPI/corsEnabled` e
  resolução de assets que rejeita `..`/path traversal (`desktopRendererProtocol.ts:19-54`). O
  comentário indica FUSE `grantFileProtocolExtraPrivileges=false` (`desktopRendererProtocol.ts:9-12`).
- **Accessory windows** só aplicam chaves de `webPreferences`/opções em whitelist
  (`accessoryWindow.ts:218-292`).
- **Handlers não validam argumentos além do essencial:** por exemplo `OPEN_OAUTH_SIGN_IN_PAGE`
  abre URL externa arbitrária passada pelo renderer (`ipc.ts:96-104`), `RECORDING_DOWNLOAD` baixa
  URL arbitrária (`ipc.ts:732-735`), `UPDATE_SHARED_STATE` aceita estado arbitrário do webapp
  (`ipc.ts:106-127`). Coerente com "renderer remoto = confiável", mas é uma superfície grande.
- **Não encontrado** no fonte recuperado: `session.setPermissionRequestHandler`/`setPermissionCheckHandler`
  no app original — as permissões de câmera/mic dependem do comportamento default do Chromium +
  TCC do macOS; o único handler de sessão é o de `getDisplayMedia`
  (`session.ts:8-72`).

---

## 4. Mídia, dispositivos e screen share

### 4.1 Câmera e microfone

**[visto]** O webapp chama `getUserMedia` normalmente no `BrowserView`; o shell é responsável por
permissões do macOS: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`,
`NSAudioCaptureUsageDescription` em `GatherV2.app/Contents/Info.plist` (textos "So that others can
see you"/"hear you"). O renderer consulta/solicita status via
`getMicrophoneCameraPermissionStatus()` / `requestMicrophoneAccess()` / `requestCameraAccess()`
(`appViewPreload.ts:459-469`), que usam `systemPreferences.getMediaAccessStatus/askForMediaAccess`
(`ipc.ts:602-631`). `RESET_PERMISSIONS` roda `tccutil` (`ipc.ts:393-399`; `macUtils.ts:15-32`).
**[visto]** O processamento de áudio é do cliente web (Krisp), não do shell — ver §8.
**[visto]** O shell ainda mantém tela acordada com base no estado de conversa/mídia
(`power-save-blocker.ts`, chamado de `app-state.ts:40-55`).

### 4.2 Screen share (duas gerações convivendo)

**[visto]** O webapp chama `getDisplayMedia`. O main process responde de duas formas
(`session.ts:8-55`):

1. **Picker próprio do Gather** (default; `useSystemPicker = nativePickerDisabled === false`):
   - o webapp pede as fontes com thumbnails via `DESKTOP_CAPTURER_GET_SOURCES`
     (`desktopCapturer.getSources`, `ipc.ts:252-272`, usado por `getDesktopCapturerSourcesV2`
     `appViewPreload.ts:152-167`);
   - o webapp escolhe e envia `SEND_SCREENSHARE_NAME(name,id,displayId)` → estado
     `screenshareId` (`ipc.ts:568-583`);
   - `setDisplayMediaRequestHandler` acha a fonte por id e chama
     `callback({video: source, audio: request.audioRequested ? "loopback" : undefined})`
     (`session.ts:28-52`);
   - erros de `getSources` só viram Sentry quando vêm do modal de screenshare
     (`ipc.ts:255-269`).
2. **System picker nativo**: em macOS ≥ 15 (`nativePicker.ts:8-11`;
   `hasNativePicker`), `useSystemPicker: true` faz o SO escolher a fonte
   (`session.ts:53`); o webapp checa com `SHOULD_USE_SYSTEM_PICKER_FOR_DESKTOP_SCREENSHARE`
   (`ipc.ts:834-837`; `appViewPreload.ts:575-577`).
   `nativePickerDisabled` é setting persistido (`GET_ALL_DESKTOP_SETTINGS`, `ipc.ts:294-296`).
3. **Áudio de sistema (loopback):** `CAN_SHARE_DESKTOP_AUDIO` retorna true no Windows ou macOS
   ≥ 0.13.2 (`ipc.ts:537-545`); a flag `MacLoopbackAudioForScreenshare` é sempre habilitada no
   Chromium (`cliFlags.ts:50-55`). Há um segundo handler dedicado
   (`setupLoopbackAudioSession`, `session.ts:57-72`) acionado por `TOGGLE_LOOPBACK_SCREEN_AUDIO`
   para capturar só loopback + frame.
4. **[visto]** `START_SCREEN_SHARE` sai de fullscreen, marca `isScreensharing`; enquanto compartilha,
   abre-se a janela-modal local no rodapé, `alwaysOnTop "pop-up-menu"`,
   `visibleOnAllWorkspaces`, `setContentProtection(true)` para ela não aparecer na própria captura
   (`ipc.ts:424-441`; `screen-share-modal-window.ts:25-118`, `:60-73`). Fechar a janela ou
   `Cmd+Opt+H` dispara `StopScreenSharing` no webapp (`screen-share-modal-window.ts:102-127`).
   A borda verde / janela de anotação (`screenShareBorder`, `ScreenAnnotationToolbar`) existe no
   bundle mas está desativada por bugs (`ipc.ts:446-449`, `:469-471`).

### 4.3 Addon nativo (features de SO que Chromium não dá)

**[visto]** `gather-native-desktop-utils` fica **fora** do asar
(`GatherV2.app/Contents/Resources/app.asar.unpacked/node_modules/gather-native-desktop-utils/`),
binário universal `build/Release/gatherNativeUtils.node` (+ fontes `mac/gatherNativeUtils.mm` e
`win/gatherNativeUtils.cpp`). Funções (`index.js`): `GetWindowInfoById`, `MoveWindowBelowWindowById`,
`HideCursor`, `ShowCursor`, `MoveAllWindowsBelowTargetWindow`, `GetActiveWindowProcessId`,
`GetWindowsByProcessId`, `GetBrowserActiveUrl`. Usos: anotação sobre janela compartilhada
(mover janelas atrás do alvo), cursor customizado, e `GET_SYSTEM_ACTIVE_APP`
(`Activity.ts:55-58`; `windowInfo.ts:7-130`) — base do gate `desktop_active_app`.
O addon é carregado com try/catch porque antivírus às vezes remove o arquivo
(`shared/nativeUtils.ts`; comentário).

### 4.4 O que o cliente web espera do desktop

**[visto]** Detecta desktop por `window._electron_interop` (`isElectron`); todos os métodos são
opcionais (versionamento em `OptionalInterop.ts:178-194`). Exemplos observados no bundle público:
`onScreenLockChange`, `toggleActiveWindows`, `toggleLoopbackScreenAudio`, `getDisplayMedia` com
`useNativePicker`, `updateSharedAppState`, `sendUserIsScreenSharingV2`, `onAccessoryWindowEvent`,
`setDesktopToolbarStatus`, `getAllDesktopSettings`, `onDesktopUpdate`.

---

## 5. Rede e identidade

### 5.1 Hosts

**[visto]** Fontes: constantes do código, bundle web público, `Network Persistent State` e
`Cookies` do profile.

| Host | Para quê | Evidência |
|---|---|---|
| `app.v2.gather.town` | cliente web carregado no BrowserView | `shared/constants/routes.ts:6`; log `Loading start URL` |
| `app.v2.staging.gather.town`, `http://localhost:8080` | staging/dev | `routes.ts:4`, `:1-2` |
| `api.v2.gather.town` (+ staging) | API do webapp e feed de updates custom | `routes.ts:7`; `GatherUpdateProvider.ts:30-50`; bundle web |
| `crystal.gather.town/2/httpapi` | proxy de eventos Amplitude (desktop) | `analytics.ts:30` |
| `downloads.gather.town` | downloads de update (`/desktop-v2/...`) | `GatherUpdateProvider.ts:30`, `:58` |
| `router.v2.gather.town`, `game-router.v2.gather.town`, `sfu-v2.<region>.prod.aws.gather.town` | WebSocket do espaço, roteamento e SFU de mídia | bundle web; log `[SpaceClient] WS connection opened`, `wss://sfu-v2...` |
| `sprite.v2.gather.town`, `cdn.gather.town`, `static.gather.town` | assets (sprites, fontes, imagens) | `web-client/signin.html` preconnects; bundle |
| `identitytoolkit.googleapis.com`, `accounts.google.com` | login Firebase + Google Identity Services | Network Persistent State; `signin.html` (`gsi/client`) |
| `challenges.cloudflare.com` | captcha/Turnstile no login | Network Persistent State; log |
| `o1432292.ingest.us.sentry.io` | Sentry (main e renderer) | `error-reporting.ts:53`; `appViewPreload.ts:60`; Network Persistent State |
| `featureassets.org`, `api.statsigcdn.com`, `statsigapi.net` | Statsig (feature flags do webapp) | bundle web; log (`[Statsig] checkGate` ×180) |
| `sourcemaps.us-east-1-a.prod.aws.gather.town` | source maps privados do bundle web | ver §8 |
| `bam.nr-data.net` (+ `crystal.staging` em staging/dev) | New Relic Browser (beacon) | `renderer/window/observability.background.ts:7-45` |

### 5.2 Fluxo OAuth

**[visto]** Dois fluxos, ambos terminando em deep link:

1. **Moderno**: webapp chama `startOAuthSignInFlow(url, listener)` → main `shell.openExternal(url)`
   (`appViewPreload.ts:31-40`; `ipc.ts:102-104`). O URL de autorização precisa carregar
   `electronProtocol` no `state`; `openOAuthSignInPage` injeta
   `state.electronProtocol = "gather2://"` antes de abrir o navegador (`oAuthSignIn.ts:5-13`).
   O provedor redireciona para `gather2://oauth2/?authCode=...`, o app recebe em `open-url` e
   devolve `OAUTH_SIGN_IN_RESPONSE` ao app view (`app-window.ts:290-299`). Log real (authCode
   omitido): `Open URL handler called. URL: gather2://oauth2/?authCode=<REDACTED>`
   (`~/Library/Logs/GatherV2/main.log`, 16:58:42.747).
2. **Legado/deprecated**: `openOAuthSignInPage`/`onOAuthSignIn` por `ON_OAUTH_SIGN_IN`
   (`OptionalInterop.ts:195-207`).
3. Google Calendar: `OPEN_G_CAL_OAUTH_SIGN_IN_PAGE` só abre externo (`ipc.ts:98-100`).

**[visto]** Nada no desktop guarda token: quem mantém access/refresh token é o webapp, via Firebase
Auth dentro do `BrowserView` (cookies/IndexedDB/DIPS do profile). **[inferido]** O app espera que o
login aconteça uma vez no navegador do sistema e o `authCode` volte por deep link para trocar por
credenciais no webapp.

### 5.3 Sessão/credenciais no perfil

**[visto]** Sem expor valores: `IndexedDB/https_app.v2.gather.town_0.indexeddb.leveldb/` contém as
bases `firebaseLocalStorageDb` e `gatherLogDB`; a chave `firebase:authUser:<API_KEY>:<...>` está
presente em `Local Storage/leveldb`. `Cookies` tem `.gather.town`, `router.v2.gather.town` e
`game-router.v2.gather.town`. `Local Storage` guarda `spaceId`, `spaceUserId`, `userAccountId`,
`AMP_unsent_*` etc. (apenas nomes de chave foram lidos; valores/tokens omitidos de propósito).

**[visto]** O bundle público do webapp embute a config pública do Firebase (`initializeApp` com
`apiKey`, `appId`, `authDomain`...), usa `getAuth` (e `getStorage`); o projeto é `gather-town`
(dev: `gather-town-dev`). A chave do Firebase é pública por natureza, mas é omitida neste doc.

### 5.4 Feature flags e startup config

**[visto]** O webapp (Statsig) envia o mapa de flags ao desktop via `UPDATE_SHARED_STATE`; o main
persiste em `flags.json` e `startup-config.json` (`ipc.ts:106-127`; `startupFeatureFlags.ts:34-84`)
porque precisa delas **antes** de `app.ready` para aplicar switches do Chromium (`cliFlags.ts:120-183`):
`ScreenCaptureKitMac` (macOS 13/14), `AllowWgcWindowCapturer/ScreenCapturer` (Windows),
`MediaFoundationVideoCapture` desabilitado, `DesktopCliEnableDebugSwitches` (aceita
`--inspect`, `--enable-logging`, `--remote-debugging-port`...), e o pós-AGC do Krisp via
`startup-config.json` (6 valores; `desktopSharedAppState.ts:8-30`).
`flags.json` real tem ~110 chaves (ex.: `DesktopTrayV2: true`, `desktop_active_app: true`,
`DesktopDetailedDiagnosticLogs: true`, `DesktopPreviewReleases: false`).
**[visto]** `version`, `commit hash/timestamp` e `env` chegam do webapp no mesmo estado
(`SharedAppState`, `desktopSharedAppState.ts:80-83`; usado em `analytics.ts:45-57`).

### 5.5 Settings persistidos (`config.json` — `electron-store`)

**[visto]** `recover/recovered-src/src/main/storage-store.ts:5-54` enumera: `desktopId` (nanoid
gerado no 1º boot, vira tag do Sentry — `desktop-id.ts:9-22`), `lastVisitedUrl`, janela principal
(x/y/w/h), `minimumWindow` legado, `autoUpdates`, `openAtLogin`, `chatNotifications`,
`eventNotifications`, `autoDnd`, `rejoinReminders`, `selectedLanguage` (`en-US` na máquina
analisada), `nativePickerDisabled`, `hardwareAccelerationDisabled`, `reactDevToolsEnabled`,
`hoursAppOpened`, `unexpectedQuit`, `forceRestarted`, `lastRunningVersion`, `expectedUpdate`,
flags de migração de permissões macOS. `config.json` real confirma o subconjunto ativo
(desktopId mascarado).

---

## 6. Observabilidade

**[visto]** Quatro pilares, além de logs:

1. **Sentry** (`@sentry/electron`) no main e no preload do app view, com o mesmo DSN público;
   `desktopId` como tag e `userId` quando autenticado (`error-reporting.ts:52-53`, `:154-160`;
   `desktop-id.ts:19`; `appViewPreload.ts:56-63`). Envia **anexos**: `main.log`/`main.old.log`,
   lista de processos, GPU info e `electron_debug.log` (até 10 MB) quando o usuário pede logs ou
   após crash (`error-reporting.ts:54-137`). ANR de renderer só é ativado pela flag
   `DesktopANRDetectionRenderer` (`appViewPreload.ts:56-63`). Debug IDs e release id estão no
   bundle (`build/js/entry.js`, `SENTRY_RELEASE`).
2. **Amplitude** do main: `analytics.ts:22-37` inicializa o SDK Node via o bridge
   `gather-opentelemetry` com `serverUrl: https://crystal.gather.town/2/httpapi` e chave de projeto
   **embutida no bundle** (valor omitido). `sendAnalyticsEvent` anexa hardware, estado da janela,
   feature flags (`gates`/`variantGates`), cli flags, `desktopId`, versão etc.
   (`analytics.ts:39-133`); em paralelo manda o mesmo evento para a janela de background
   (`ON_DESKTOP_ANALYTIC_EVENT`), que o repassa ao New Relic.
3. **New Relic Browser** na janela de background (`observability.background.ts:7-60`): beacon host
   por ambiente (`bam.nr-data.net` em prod), `licenseKey`/`applicationID`/`accountID` hardcoded
   (valores omitidos), `distributedTracingAllowedOrigins` para as APIs. Em local/test o agente é
   no-op para não emitir RUM. `entryBackground.tsx:10-14` liga o forwarding.
4. **OpenTelemetry** (`gather-opentelemetry`) com dual-write NR/OTel e gates por ambiente
   (`bridge/impl/gates.ts`: OTel só em local/staging/dev; escrita NR/Amplitude desligada em
   local/test). Há instrumentação de tracing custom (`internal/tracing/*`), exportador OTLP
   (`internal/exporters/otlpExporter.ts`), sanitização de URL/headers HTTP para não vazar dados
   (`gather-common-including-video/src/axiosTelemetry.ts`).
5. **Métricas internas**: `GET_CPU_USAGE`/`GET_HEALTH_METRICS`/`GET_MAIN_PROCESS_MEMORY_METRICS`/
   `GET_IPC_METRICS` (`app-metrics.ts:54-116`; `IpcMetricsCollector`); o webapp coleta e envia.
   Content tracing para diagnóstico (`REQUEST_CONTENT_TRACE`, `ipc.ts:547-566`).
6. **Log**: `electron-log` em `~/Library/Logs/GatherV2/main.log` (1471 linhas nas ~3 min de
   execução analisadas), com escopos `(main)`, `(webapp)` (console do renderer via
   `windowLogger`), `(accessoryWindow)`, `(Activity)` e `(🏄‍♂️ Updater)`, além de `(webapp)` verbose.

**[visto]** Implicações offline/privacidade: sem internet, o original falha o carregamento do app
view e tenta enviar Sentry/Amplitude/NR repetidamente; o Sentry ainda grava relatórios em
`Application Support/GatherV2/sentry/`. Nenhum desses backends tem valor de produto offline.

---

## 7. Build e empacotamento

**[visto]**
- **Bundler:** rspack 1.7.8 (`recover/recovered-src/webpack/runtime/rspack_version`:
  `__webpack_require__.rv = () => ("1.7.8")`; `rspack_unique_id`). `package.json` tem
  `@rspack/cli`/`@rspack/core` como peer deps e targets `nx` (`package.json:24-77`).
- **Bundles** (`recover/app-asar/build/js/`): `entry.js` (2.471.506 B, main process),
  `background.js` (1.303.378 B, janela shell/React), `trayWindow.js` (286.329 B),
  `screenShareModal.js` (261.466 B), `networkError.js` (294.997 B) + `preload/appViewPreload.js`
  (110.977 B) e `preload/sharedPreload.js` (5.512 B). HTMLs: `background`, `tray-window`,
  `screen-share-modal`, `networkError`, `screenShareBorder`.
- **Source maps embutidos:** um `.js.map` por bundle, **dentro do asar**, com `sourcesContent`
  completo (ex.: `entry.js.map` = 8.944.159 B, 1517 sources, 0 nulos). É o vetor de recuperação:
  código TypeScript original quase integral + fontes do `electron-updater`, `@sentry/electron`,
  `electron-store`, `electron-log`, `undici`, `builder-util-runtime` etc.
- **Dependências:** `package.json:9-20` declara `gather-native-desktop-utils`, `ps-list`, `undici`,
  `framer-motion`, `@floating-ui/react`, `classnames`, `color`, `@react-spring/web`,
  `react-draggable`; `react`/`react-dom` são peer. A maior parte das libs é **bundlada** no
  `entry.js` (confirmado pelos maps); `ps-list` e o addon nativo ficam externos.
- **`node_modules` no asar:** 245 pacotes/64 MB — inclui tooling de build (`webpack`,
  `webpack-dev-server`, `express`, `sockjs`, `terser`...), sugerindo que o empacotamento levou
  `node_modules` do app sem poda. **[inferido]** bloat de empacotamento; os assets de runtime já
  estão nos bundles.
- **Nativo:** `app.asar.unpacked/node_modules/gather-native-desktop-utils` (fora do asar, como
  exigido para `.node`) + `fsevents`.
- **Integridade e assinatura:** Info.plist tem `ElectronAsarIntegrity` SHA256 de
  `Resources/app.asar`; não há `ElectronAsarIntegrity.json` separado. `codesign -dv`: Developer ID
  Application "Gather Presence, Inc. (W28UKP642P)", hardened runtime, **notarização com ticket
  stapled**, Mach-O universal x86_64+arm64, `LSMinimumSystemVersion 13.0`.
- **Updater no pacote:** `Squirrel.framework` e `ReactiveObjC.framework` em `Contents/Frameworks/`;
  `Resources/app-update.yml` com provider github (fallback) e `updaterCacheDirName`. Runtime usa
  provider custom apontando para `api.v2.gather.town` (§2.6).
- **i18n:** 9 locales no asar (`de, en-US, es, fr, hi-IN, ja-JP, pt-BR, source, th`), selecionável
  por setting; o desktop carrega mensagens por IPC (`GET_LOCALE_MESSAGES`; `setupDesktopLocales`).
- **Aparencia/segurança do bundle:** `LSApplicationCategoryType video`, `NSAppTransportSecurity`
  com `NSAllowsArbitraryLoads=true` e exceções para `127.0.0.1`/`localhost` (necessário para dev),
  `com.apple.security.*` não estão no Info.plist (hardened runtime + notarização fazem o resto).
  FUSEs do Electron não foram inspecionados (fora do escopo do asar).

---

## 8. Cliente web público (`app.v2.gather.town`)

### 8.1 Artefato

**[visto]** `recover/web-client/main.f4747b178f695fe5.js` = 5.459.710 B, hash de build
`edf006d4f7857c9cd46b185dda1f08a61b223f60` (injetado no topo como
`__faroGitHash_v2-gather-browser` / `__faroBundleId_v2-gather-browser`), carregado por
`signin.html` com CSS `/main.55cf7344aeb57e5c.css`. O `signin.html` mostra que o mesmo bundle é
usado no browser, no desktop (Electron) e como add-in do Microsoft Office (bloco `#ms-office-addin`),
e faz `preconnect` para `www.googleapis.com`, `api.v2.gather.town`, `sprite.v2.gather.town`,
`cdn.gather.town` e `static.gather.town`.

### 8.2 Bibliotecas identificadas por análise estática

**[visto]** (strings/prefixos de código no bundle minificado):

| Lib/tecnologia | Evidência |
|---|---|
| `mediasoup-client` | `"mediasoup-client"` em logger do bundle; SDP com `username:"mediasoup-client"` |
| `socket.io` client | mensagem de migração v2→v3; path default `/socket.io` |
| Firebase (`@firebase/app`, `getAuth`, `getStorage`) | `initializeApp`, `getAuth`, tabela de libs `@firebase/*` |
| Statsig | `StatsigFeatName`, `checkGate`, hosts `api.statsigcdn.com`/`featureassets.org` |
| Grafana Faro / OpenTelemetry | marcadores `__faroGitHash__`, `opentelemetry.js.api.*` |
| New Relic Browser | `gosNREUMOriginals`, `X-NewRelic-App-Data`, header de trace |
| Amplitude | `AMP_unsent`, `api2.amplitude.com/2/httpapi`, `api.eu.amplitude.com` |
| Phaser | engine do mapa/canvas (`LoadPhaserTask` no log; string `phaser`) |
| MobX | store do jogo (`mobx` em logs/UI state) |
| Rive | animações (`.riv`, `rive` no bundle) |
| ProseMirror | editor rich-text (docs/notas) |
| React Router, Radix UI, Emotion, framer-motion | strings de docs/roots correspondentes |
| Google Identity Services + reCAPTCHA/Turnstile | `accounts.google.com/gsi/client`, `recaptcha/enterprise.js`, `challenges.cloudflare.com` |
| LiveKit | citado em hooks de gravação/telemetria (`LivekitWebhook`, `/hooks/livekit/recording/...`) — **[inferido]** não é o transporte de mídia do dia a dia, que é o SFU próprio |

### 8.3 Endpoints e serviços observados no bundle

**[visto]** hosts: `api.v2.gather.town` (e staging), `crystal.gather.town/2/httpapi`,
`api2.amplitude.com`, `api.statsigcdn.com`/`featureassets.org`/`statsigapi.net`,
`api.eu.amplitude.com`, `www.googleapis.com`, `accounts.google.com`, `identitytoolkit.googleapis.com`
(via SDK), `challenges.cloudflare.com`, `cdn.gather.town`, `sprite.v2.gather.town`,
`static.gather.town`, `calendar.google.com`, `docs.google.com`, `prosemirror.net`, `radix-ui.com`
(docs em comentários). WebSockets: `wss://router.v2.gather.town` (prod) e
`ws://<localDevHost>:1443` (local) — `switchEnv` no bundle; o SFU entrega a URL por sessão
(`wss://sfu-v2.<region>.prod.aws.gather.town:443/<id>`).

**[visto]** No log real: `[SpaceClient] WS connection opened`;
`[RemoteParticipantManager][onSFUWebSocketConnectionStateChanged] Connected {"serverURL":"wss://sfu-v2...}`;
`[GatherPeerManager][produceLocalTracks] wss://sfu-v2...`; `[Protocol] Decoding message ... FullStateChunk`;
`[SFUClientManager] queueing state sync to router`. Ou seja: **websocket próprio para estado do
espaço + SFU próprio (mediasoup-client) para mídia**, não LiveKit/mediasoup-server público.

### 8.4 Features (inventário a partir de logs/strings)

**[visto]** Boot do cliente por tarefas: `LoadAtlasManagerTask`, `LoadGameClientTask`,
`LoadPhaserTask`, `LoadSpaceDataTask`, `LoadLocalAVServicesTask`,
`LoadInSpaceAVCommunicationServicesTask`, `LoadOpenTelemetryTask`, `LoadConnectToSpaceTask`,
`LoadEnterSpaceUserTask`, `LoadSubscribedDataTask`, `LoadPostAtlasManagerAppServicesTask`
(`~/Library/Logs/GatherV2/main.log`, 16:58:45+). Logs citam: mapa/Phaser, avatares/atlas,
áudio/vídeo WebRTC, SFU, Krisp nativo (`KrispNativePlusPlus`, modelo `krisp-nc-o-pro-v1.kef`),
background effects (`[LMM]`), AdaptiveStreams, layout de vídeo, state chunks, onboarding,
`Statsig`, `AuthenticationService`, `LocalStorageMigrationService`, `DesktopAppActivityRepo`
(desktop_active_app), `OSDraggableOverlayWindow` (PiP/tray), `PeerStrategyManager`,
`GatherPeerManager`, `SpaceClient`, `SFUClientManager`, `Protocol`.

**[visto]** Strings de features no bundle: `recording`, `transcript`, `meeting`, `calendar`,
`avatar`, `wearable`, `announcement`, `office`, `follow`, integrações (hooks GitHub/Stripe/LiveKit,
`hooks/grapevine`, `meetingSummary`), `recaptcha`, Google Calendar/Docs. **Não encontrado** no
bundle: `whiteboard`/`eraser` (aparece apenas no desktop como popup permitido `app.eraser.io`) —
o editor fica em iframe externo.

### 8.5 Por que não é recuperável por completo

**[visto]** O bundle termina com
`//# sourceMappingURL=https://sourcemaps.us-east-1-a.prod.aws.gather.town/v2/gather-browser/edf006d4f/main.f4747b178f695fe5.js.map`.
Tentativa de acesso em 2026-10-28: **timeout de conexão** (host não responde na rede analisada —
é infraestrutura privada/restrita). Além disso:

- o bundle é **minificado** e sem `sourcesContent` local, então a análise é por strings/símbolos;
- os **workers** têm mapas próprios (`image-bitmap-data-url-worker-*.js.map`) e o código é dividido
  em chunks não enumerados por um único arquivo;
- o backend (`api.v2`, router, SFU, Statsig, Firebase) é server-side e inacessível por definição.

**[inferido]** Por isso o `gather-offline/` parte das *funções e contratos* observados (IPC,
protocolo, features, topologia), não do código do cliente web.

---

## 9. Original → clone offline

### 9.1 Mapa de correspondência

| Função do original (evidência) | No clone offline | Observação |
|---|---|---|
| Janela principal `BrowserWindow` + `BrowserView` (§2.2) | `src/main/main.ts:140-209` + cliente servido em `https://127.0.0.1:<porta>` | uma janela, cliente local |
| Preload do app view com 112 canais (§3) | `src/preload/preload.ts:18-31` (10 métodos) | bridge mínimo, sem `ipcRenderer` cru |
| Shell/Toolbar/native picker/accessory/tray windows | `src/main/tray.ts`, `shortcuts.ts`, `main.ts:121-133`, `security.ts:52-89` | tray + atalhos + display-media handler |
| `ALLOWED_GATHER_APP_URLS` + deep link `gather2://` | `security.ts:91-101` (navegação só para loopback/IP privado) | o clone não tem deep link (não precisa de OAuth) |
| `setDisplayMediaRequestHandler` + picker/system picker (§4.2) | `security.ts:64-87` + `client/src/media/useMedia.ts` (getDisplayMedia) | system picker + loopback só Windows |
| `desktopCapturer` + modal "compartilhando" | `client/src/media/ScreenSharePanel.tsx`, `useMedia.ts:378` (getDisplayMedia) | sem janela flutuante separada |
| WebRTC via SFU próprio + socket próprio (§8.3) | `src/server/{server,room}.ts` (WSS JSON) + `client/src/net/connection.ts` + media mesh (`useMedia.ts`: RTCPeerConnection, perfect negotiation, host candidates) | sem SFU; mesh P2P por proximidade |
| Estado do produto no servidor web (§1) | `src/server/room.ts`, `src/shared/{types,protocol}.ts`, `client/src/state/store.ts` | estado autoritativo em memória no host |
| Telemetria Sentry/Amplitude/NR/OTel/Faro (§6) | **removida** (`OFFLINE_ARCHITECTURE.md`, "Por que é offline de verdade") | nenhum beacon |
| Updater (`electron-updater`, Squirrel, `app-update.yml`) (§2.6, §7) | **removido** | `npm run dist` gera .app local não assinado |
| Feature flags Statsig + `flags.json` (§5.4) | **removido** (`cli.ts` só tem flags de dev) | sem experimentos |
| Onboarding/Google Calendar/Firebase/OAuth (§5.2-5.3) | **removido** (identidade local: nome/avatar escolhidos) | login não existe offline |
| Native addon (`gatherNativeDesktopUtils`) (§4.3) | **removido** | sem anotações/cursor custom/PiP nativo |
| Mini mode/PiP/tray V2 (§2.4) | PiP nativo **não reimplementado**; tray próprio simples | janela accessory fica de fora |
| Locale i18n / `GET_LOCALE_MESSAGES` | UI em pt-BR fixa (`client/src/**`) | sem framework de i18n |
| Guarda de rede (inexistente no original) | `src/main/security.ts:28-50` (`webRequest.onBeforeRequest` bloqueia e loga) | requisito de produto do clone |

### 9.2 O que ficou de fora e riscos

- **Ficaram de fora** (documentado em `gather-offline/docs/OFFLINE_ARCHITECTURE.md`): build mode,
  mini mode/PiP nativo, lobby/voice-only de calls, whiteboard (Eraser), integrações Google
  Calendar/Docs, add-in Office, anotações sobre janela compartilhada, updater, telemetria,
  experimentos, login/OAuth/Firebase, i18n, screen-share border/annotation toolbar, sistema de
  "espaços" remoto e gravações/transcrições.
- **Riscos/limitações do clone:** o protocolo WSS é caseiro (não o protocolo binário do Gather —
  `Protocol` chunks observados no log); mídia é mesh (escala ~pequena; SFU do original escala
  melhor); multi-sala é "um host por sala"; sem TURN, mídia exige mesma LAN; segurança do servidor
  é a borda de confiança (`validation.ts`), mas a superfície do preload exposto ao cliente é
  mínima e presa ao contrato congelado (`src/shared/bridge.ts`).
- **Fidelidade:** o clone reproduz o *modelo* (shell Electron + cliente web local + realtime), não
  o produto completo; funcionalidades de produto do Gather foram redesenhadas em escala reduzida
  (mapa em canvas, chat, presença, voz/vídeo por proximidade).

---

## 10. Limitações da análise

1. **Código-fonte parcial:** ~10 módulos não recuperáveis dos maps (§0): tray, tray-window,
   updater, osMenu, dock, app-installation, contentTracing, send-logs, animate, constantes
   analytics/toolbar, NetworkError. Para eles, as evidências são o bundle compilado e os call
   sites; detalhes internos (ex.: algoritmos do updater, itens exatos do menu de app) ficam em
   "não encontrado".
2. **Cliente web só estático:** minificado e com source map privado inacessível (§8.5). Não é
   possível afirmar comportamento interno com precisão — apenas hosts, libs, strings e o que os
   logs de runtime mostram.
3. **Logs de uma única execução curta** (~3 min, macOS ARM, 2 displays): fluxos não exercitados
   (screenshare real, update real, notificações, deep link de espaço) foram lidos no código, não
   observados em execução.
4. **Canais órfãos:** `PREPARE_MINI_MODE_ANIMATION`, `FINISH_ANIMATION_TO_MINI_MODE`, `TRAY_BOUNDS`,
   `PUSH_WINDOWS_BEHIND_SCREENSHARE`, `ON_STOP_SCREEN_SHARE` são usados pelos preloads mas o
   handler/emissor está em módulo não recuperado — não foi possível confirmar semântica exata.
5. **Credenciais:** tokens, authCodes, chaves de Firebase/Amplitude/New Relic e `desktopId` foram
   omitidos de propósito; o doc cita apenas onde estão e o formato.
6. **FUSEs do Electron, entitlements detalhados, assinatura do addon nativo e conteúdo de
   `Electron Framework.framework`** não foram auditados (escopo era o app/asar).
7. **Multiplayer/WebRTC do original:** o transporte exato (SFU próprio + protocolo binário) foi
   identificado, mas o protocolo de fio não foi decodificado (sem captura de tráfego).
