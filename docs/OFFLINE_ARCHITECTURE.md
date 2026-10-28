# Arquitetura — Gather Offline

Reescrita do app desktop analisado em `../recover/` (GatherV2.app 0.55.2), com um requisito que o
original não tem: **funcionar 100% offline**, sem nenhum servidor ou CDN externo.

Por que é uma reescrita e não um patch: o app original é uma casca Electron (≈7,9k linhas de TypeScript
recuperadas dos source maps) que apenas carrega o cliente web remoto `https://app.v2.gather.town` dentro
de um `BrowserView`. Todo o produto — mapa, avatares, vídeo, chat — roda em servidores do Gather.
Sem internet, a casca original só sabe mostrar a tela de erro de rede. Para ficar offline, o cliente web
e o backend precisam ser reimplementados. É o que este projeto faz, em escala reduzida e limpa.

## Topologia

```
┌─────────────────────────────── app Electron (cada máquina) ───────────────────────────────┐
│  main process                                                                             │
│   ├── servidor HTTPS+WSS embutido (src/server)  ── serve dist/client e a sala             │
│   │     • TLS self-signed gerado no 1º boot (SAN: localhost, 127.0.0.1, IPs privados)     │
│   │     • estático com SPA fallback + WebSocket em /ws                                     │
│   ├── janela BrowserWindow (sandbox, contextIsolation, sem nodeIntegration)               │
│   │     └── cliente web React (client/src): home, escritório canvas, HUD, chat, mídia     │
│   ├── guarda de rede: aborta e loga qualquer request fora de loopback/IP privado          │
│   ├── tray, atalhos globais, permissões de mídia, display-media handler (system picker)   │
│   └── preload: contextBridge expõe window.gather (DesktopBridge)                          │
└───────────────────────────────────────────────────────────────────────────────────────────┘
        ▲                                     ▲
        │ host: https://127.0.0.1:8787        │ guest: https://<ip-do-host>:8787/?autojoin=1
        │                                     │ (mesmo bundle local; só o estado vem do host)
        └───────────── LAN (sem internet) ────┘
```

- **Host**: sobe o servidor na porta base (8787, com fallback 8788..8791), carrega o cliente local e
  mantém o estado autoritativo da sala em memória: jogadores, posições, chat, relay de sinalização.
- **Guest**: o app também começa na home local; ao entrar num endereço da LAN, a janela navega para o
  host (`?autojoin=1`). O certificado self-signed do host é aceito **apenas** por ser host privado.
- **Mídia**: WebRTC mesh peer-to-peer, sem STUN/TURN externos (`iceServers: []`, host candidates).
  O servidor só retransmite offers/answers/ICE; áudio/vídeo nunca passam pelo servidor.

## Componentes

| Componente | Caminho | Responsabilidade |
|---|---|---|
| Shell Electron | `src/main/**`, `src/preload/**` | ciclo de vida, janela, tray, atalhos, permissões, TLS, offline guard, bridge |
| Servidor de sala | `src/server/**` | HTTPS estático, WSS (`/ws`), room state, validação, rate limit, heartbeat, relay de sinalização |
| Contratos compartilhados | `src/shared/**` | tipos do domínio, protocolo WS, constantes, mapa padrão, contrato do bridge |
| Cliente web | `client/src/**` | home/perfil, canvas do escritório, colisão, câmera, HUD, chat, participantes, mídia |
| Estado/conexão | `client/src/state/store.ts`, `client/src/net/connection.ts` | store com `useSyncExternalStore`, cliente WS com reconexão, throttling de movimento |
| Mídia WebRTC | `client/src/media/**` | mesh por proximidade, perfect negotiation, screen share, dispositivos |

## Protocolo WebSocket (resumo)

Mensagens JSON com discriminante `t` (tipos completos em `src/shared/protocol.ts`):

- **Cliente → servidor**: `join` (protocolo + perfil), `move` (x/y em pixels de mundo + direção + moving),
  `profile`, `media` (flags de mic/câmera/tela), `chat`, `signal` (relay alvo), `ping`.
- **Servidor → cliente**: `welcome` (self, players, mapa, sala), `playerJoined`, `playerLeft`,
  `playerMoved`, `playerUpdated`, `chat`, `signal`, `error`, `pong`.
- O servidor sanitiza perfil/chat, valida números finitos, aplica clamp/colisão (`src/shared/collision.ts`), limita taxa de
  `move`/`chat` e tamanho de payload (`MAX_MESSAGE_BYTES`); o WS é a borda de confiança da LAN.

## Por que é offline de verdade

1. Nenhuma dependência externa em runtime: o bundle do cliente é servido pelo próprio host; fontes e
   desenhos são procedurais (nada de CDN); sem telemetria, updater, Sentry, Amplitude etc.
2. Guarda de rede no processo principal (`webRequest.onBeforeRequest`) aborta requests fora de
   loopback/IP privado e grava tentativas em `offline-guard.log`.
3. A mídia usa apenas host candidates da LAN; não há STUN/TURN configurados.
4. O e2e roda o app com DNS externo bloqueado (`--host-resolver-rules`) e observa zero requests fora
   da rede local.

## Segurança

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; o preload expõe só os métodos do
  `DesktopBridge` (sem ipcRenderer cru).
- Certificado self-signed aceito somente para hostnames loopback/privados (`PRIVATE_HOST_PATTERN`);
  qualquer origem pública usa a validação padrão do Chromium.
- Navegação nova/janelas externas bloqueadas; permissões de mídia restritas a origens privadas.
- O servidor é a borda de confiança: validação de todos os campos, rate limits, `maxPayload`, heartbeat.
- CSP restritiva no cliente (`default-src 'self'`, sem scripts inline/externos).

## Limitações conhecidas (escopo consciente)

- Sem "build mode"/editor de mapa na UI: o mapa é o escritório padrão (`src/shared/defaultMap.ts`).
- Sem lobby/voice-only, mini mode, whiteboard, objetos interativos, integrações (Google Calendar etc.),
  atualização automática e telemetria — funções do original fora do escopo offline.
- Sem pathfinding: clique-para-andar move em linha reta com colisão/deslize.
- Sem descoberta automática de salas na LAN: o endereço é informado (host mostra os `lanUrls`).
- Sem TURN: em redes com isolamento de clientes/AP o peer-to-peer pode falhar (mídia), mas o app e o
  chat continuam funcionando.
- Mesh é adequado para o tamanho de um escritório pequeno (até `MAX_PLAYERS = 16`; custo cresce O(n²)).
- O app é um estudo de engenharia reversa; não é afiliado ao Gather.
