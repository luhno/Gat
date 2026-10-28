# Contratos — DittoApp

Leia este arquivo inteiro antes de escrever código. Ele congela as interfaces entre os times.

## O que está sendo construído

Reescrita limpa do app desktop do Gather (analisado em `../recover/`), mas **100% offline**:

- **Shell Electron** (`src/main`, `src/preload`): janela, tray, atalhos globais, permissões, screen-share picker,
  guarda de rede (bloqueia qualquer host externo), servidor HTTPS+WSS embutido.
- **Servidor de sala** (`src/server`): HTTPS serve o cliente web compilado (`dist/client`) e WSS em `/ws`
  transporta presença/movimento/chat/sinalização WebRTC. Estado autoritativo em memória, uma sala por host.
- **Cliente web** (`client/src`): home (perfil/avatar), escritório em canvas (mapa, colisão, avatar, câmera),
  chat, participantes, toolbar, mídia por proximidade (WebRTC mesh).

Topologia: o host abre `https://127.0.0.1:<porta>`; convidados usam o próprio app apontando para
`https://<ip-lan>:<porta>` do host. Cada app serve seu próprio bundle; o servidor do host só serve o estado.
Certificado self-signed é gerado no primeiro boot e aceito apenas para hosts privados/loopback.

**Nenhum domínio externo. Nenhuma dependência de CDN. Nenhum telemetria/updater.**

## Comandos

```bash
npm run build        # vite build (cliente) + esbuild (main/preload)
npm run typecheck    # tsc --noEmit (todos os TS)
npm test             # compila tests/unit/*.test.ts e roda node --test
npm start            # roda o app (precisa de build antes)
```

Dependências já instaladas. **Não adicione dependências. Não edite** `package.json`, `tsconfig.json`,
`scripts/`, `client/vite.config.ts`, `client/index.html`, `src/shared/{types,protocol,constants,bridge}.ts`.
Precisou de mudança nesses arquivos? Peça ao Lead (`send_message` target `lead`).

## Mapa de propriedade (escopos de escrita)

| Área | Dono | Pode escrever |
|---|---|---|
| Shell + preload | shell-dev | `src/main/**`, `src/preload/**` |
| Servidor LAN | server-dev | `src/server/**`, `tests/unit/server.test.ts` |
| Cliente UI/mapa | client-dev | `client/src/App.tsx`, `client/src/home/**`, `client/src/office/**`, `client/src/chat/**`, `client/src/components/**`, `client/src/styles/**`, `src/shared/defaultMap.ts` |
| Mídia WebRTC | media-dev | `client/src/media/**`, `tests/unit/proximity.test.ts` |
| Estado/conexão/bootstrap | Lead | `client/src/state/**`, `client/src/net/**`, `client/src/desktop.ts`, `client/src/main.tsx`, `client/src/types/**` |
| Docs RE | analyst | `docs/REVERSE_ENGINEERING.md` |
| Integração/docs/verificação | Lead + verifier | o resto |

## Unidades e colisão (DECISÃO FINAL)

- `PlayerState.x/y` estão em **pixels de mundo** (não tiles): `tile * TILE_SIZE` (32).
- A posição é o **centro da caixa dos pés 20x14 px** (`PLAYER_HALF_WIDTH=10`, `PLAYER_HALF_HEIGHT=7`).
- Spawn: `tileCenter(spawn.x, spawn.y)` = `spawn*32 + 16`, com anel de posições livres se ocupado.
- Movimento com sliding por eixo. Cliente e servidor DEVEM usar `src/shared/collision.ts`
  (`isBlocked`, `resolveMovement`, `clampToMap`, `tileCenter`) — não reimplemente colisão localmente.
- Renderização: `screen = (world - camera) * zoom`; distância de proximidade em tiles =
  `hypot(dx_px, dy_px) / map.tileSize`.
- Velocidade de caminhada: ~3.6 tiles/s = ~115 px/s no cliente.
- O mapa pode mudar de tamanho; sempre derivar de `map.width`, `map.height`, `map.tileSize` e `map.spawn`.

## Interfaces congeladas

### 1. Protocolo (já implementado em `src/shared/protocol.ts`)

- Cliente envia `join` (com `protocol: PROTOCOL_VERSION`, `profile` e `session?` — token da sessão
  anterior para retomar após queda) assim que o WS abre.
- Servidor responde `welcome` (você, lista de players, mapa, room, **`session`**) ou `error`.
- `leave` explícito remove o jogador na hora; fechar o socket sem `leave` mantém o slot por 30 s
  (`detach`) para retomada com o mesmo id/posição.
- `move` chega no máximo a cada `MOVE_SEND_INTERVAL_MS`; servidor recalcula posição válida (clamp + colisão).
- `signal` é relay ponto-a-ponto entre players da mesma sala; `to` inexistente ⇒ ignorar silenciosamente.
- `profile`/`media` viram `playerUpdated` para todos (inclusive o autor deve ver o próprio patch).
- `chat` vira `{ t: "chat", message }` para todos.
- `ping`/`pong` para latência.
- **Validar tudo no servidor** (tipos, tamanhos, números finitos, limites do mapa, rate limits de `constants.ts`).

### 2. Bridge do preload (`src/shared/bridge.ts`)

O preload expõe `window.gather: DesktopBridge` via `contextBridge.exposeInMainWorld("gather", ...)`.
Canais IPC sugeridos: `gather:getConnectionInfo`, `gather:joinLanRoom`, `gather:leaveRoom`,
`gather:getSettings`, `gather:setSettings`, `gather:showNotification`, `gather:setBadge`, `gather:quit`.
Eventos main→renderer: `gather:toggleAudio`, `gather:toggleVideo` (o preload registra e devolve unsubscribe).

### 3. Servidor (`src/server`)

```ts
// src/server/tls.ts
export interface TlsMaterial { key: string; cert: string; fingerprint256: string }
export function getOrCreateTlsMaterial(hostnames: string[], storageDir: string): Promise<TlsMaterial>

// src/server/server.ts
export interface StartRoomServerOptions {
  port: number
  clientDir: string       // caminho absoluto para dist/client
  tls: TlsMaterial
  roomName?: string       // default: "Escritório offline"
}
export interface RoomServer { port: number; url: string; close(): Promise<void> }
export function startRoomServer(options: StartRoomServerOptions): Promise<RoomServer>
```

Comportamento: tenta `port`, depois `port+1..port+PORT_ATTEMPTS`; falha com erro claro se todos ocupados.
Serve arquivos de `clientDir` (SPA fallback para `index.html`, sem path traversal, `no-store`).
WSS em `WS_PATH`; `maxPayload = MAX_MESSAGE_BYTES`; heartbeat para derrubar conexões mortas.
Encerramento gracioso em `close()`.

### 4. Cliente: estado e conexão (Lead — não editar)

`client/src/state/store.ts`:
- `useStore(): ClientState` (re-renderiza a árvore; canvas deve ler `getState()` no rAF).
- `getState()`, `actions.*` (setConnection, setPlayers, updatePlayer, pushChat, setUi, setProfile...).
- `ClientState` tem `connection`, `error`, `selfId`, `room`, `map`, `players: Record<id, PlayerState>`,
  `chats`, `unreadChats`, `latencyMs`, `desktop`, `settings`, `profile`, `ui`.

`client/src/net/connection.ts`:
- `connection.connect(profile): Promise<void>` (idempotente; abre WS same-origin, faz join, resolve no welcome).
- `connection.disconnect()`, `queueMove(x, y, dir, moving)`, `sendChat(text)`,
  `updateProfile(patch)`, `sendMedia(patch)`, `sendSignal(to, data)`.
- `connection.onSignal(cb)`, `connection.onConnected(cb)`, `connection.onClosed(cb)` — retornam unsubscribe.
- Reconexão automática com backoff; `onConnected` deve resetar peers de mídia.

`client/src/desktop.ts`:
- `desktop` (bridge ou null), `bootstrapDesktop()`, `persistProfile(profile)`, `persistDeviceSettings(patch)`,
  `joinLanRoom(address): Promise<{ ok, error? }>`.

### 5. Mídia (media-dev implementa exatamente isto)

```ts
// client/src/media/useMedia.ts
export interface MediaApi {
  audioEnabled: boolean
  videoEnabled: boolean
  screenSharing: boolean
  mediaError: string | null          // erro de permissão/dispositivo, não bloqueia o app
  remoteStreams: Map<string, MediaStream>   // id do player -> stream recebido (1 vídeo + áudio)
  remoteScreenSharing: Set<string>          // players cujo vídeo atual é a tela
  devices: { audioInputs: MediaDeviceInfo[]; videoInputs: MediaDeviceInfo[]; audioOutputs: MediaDeviceInfo[] }
  selected: { audioInputId: string | null; videoInputId: string | null; audioOutputId: string | null }
  toggleAudio(): void
  toggleCamera(): void
  startScreenShare(): Promise<void>
  stopScreenShare(): void
  selectAudioInput(id: string): Promise<void>
  selectVideoInput(id: string): Promise<void>
  selectAudioOutput(id: string): Promise<void>
}
export function useMedia(options: {
  selfId: string | null
  map: OfficeMap | null
  players: Record<string, PlayerState>
}): MediaApi
```

Componentes (media-dev):
```ts
// client/src/media/VideoTile.tsx
export function VideoTile(props: { stream: MediaStream; label: string; muted?: boolean; className?: string }): JSX.Element
// client/src/media/ScreenSharePanel.tsx
export function ScreenSharePanel(props: { stream: MediaStream; label: string; onClose(): void }): JSX.Element
```

Regras: proximidade com histerese (`PROXIMITY_ENTER_TILES`/`PROXIMITY_EXIT_TILES`); quem inicia é
`selfId < peerId`; renegociação "perfect negotiation" (politeness = `selfId > peerId`); screen share troca
o track de vídeo via `sender.replaceTrack` e força conexão com todos os players enquanto durar; áudio remoto
toca em `<audio>` oculto com `setSinkId`; nunca quebrar se não houver câmera/mic (fake devices nos testes);
atualizar flags com `connection.sendMedia(...)`.

### 6. App/rotas (client-dev)

`client/src/App.tsx` monta:
- `bootstrapDesktop()` no boot;
- se `?autojoin=1` e bridge → aplicar settings e `connection.connect(profile)` direto;
- sem conexão → `<HomeScreen/>`; conectado → `<OfficeScreen/>`.
Home: perfil (nome, cor da camiseta, tom de pele, cabelo, status), "Abrir meu escritório" (host) e
"Entrar em sala da LAN" (endereço, usa `joinLanRoom`). Host mostra `desktop.lanUrls` para compartilhar.
Office: canvas em tela cheia com mapa/avatares + HUD; chat/participantes/configurações em painéis;
`VideoTile` posicionado junto ao avatar correspondente; `ScreenSharePanel` quando alguém compartilha tela.

## Regras de ouro

1. Offline: nenhum `fetch`/`import` para domínio externo, nenhuma fonte/imagem remota.
2. TypeScript estrito, sem `any` solto; rode `npm run typecheck` antes de reportar.
3. Escreva apenas no seu escopo. Precisa alterar arquivo de outro? Peça ao Lead.
4. Comentários só para o "porquê" que o código não mostra. UI em pt-BR.
5. Acessibilidade: botões com `aria-label`, navegação por teclado nos painéis.
6. Validação é obrigatória nas bordas de confiança (servidor LAN é borda).
7. Ao concluir: `send_message` para `lead` com `task id`, arquivos criados, como verificou
   (comando + resultado). Se travar >10 min em algo, peça ajuda em vez de inventar.
