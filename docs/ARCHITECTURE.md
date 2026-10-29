# Arquitetura do DittoApp (produto web)

Status: **proposta organizada**, 2026-10-28. Diagnóstico completo em [`docs/CHECKUP_REPORT.md`](CHECKUP_REPORT.md)
e inventário bruto em [`docs/audit/architecture.md`](audit/architecture.md). O doc antigo
[`OFFLINE_ARCHITECTURE.md`](OFFLINE_ARCHITECTURE.md) descreve o modo Electron/LAN (legado).

Regra deste documento: **o produto é a web**. Tudo que só existe para o Electron é legado; mobile é
*keep-alive*. Nada aqui exige framework novo, banco ou monorepo.

## 1. O que o sistema é hoje

```
Navegador (cliente React)                         Internet
  ┌────────────────────────────┐        HTTPS (TLS na borda)
  │ /            landing        │◄────── (Render/Docker: dist/online/server.cjs)
  │ /room        app (React)    │        ┌──────────────────────────────────────┐
  │ /join  302→/room?autojoin=1 │        │ Node single-thread (src/server)      │
  │ /ws          WSS ◄──────────┼───────►│  · static dist/client + SPA fallback │
  │ /client-config.json ◄───────┼────────│  · serving / e /site (website/)      │
  │ /healthz ◄──────────────────┼────────│  · sala em memória (até 6, 1 por      │
  └────────────────────────────┘        │    processo): join/move/chat/signal/  │
        │  ▲                             │    soundboard/profile/media/ping      │
        │  │ WebRTC P2P (malha, STUN/TURN)│  · validação + rate limit + heartbeat│
        ▼  │                             └──────────────────────────────────────┘
   outros navegadores  ◄── SDP/ICE relay (nunca mídia) ──┘
```

- **Estado 100% efêmero**: sala, jogadores e chat vivem em memória; reiniciar o processo = sala zerada.
  Áudio/vídeo nunca passam pelo servidor (P2P); mídia é por proximidade (4,5/5,5 tiles) e tela força
  conexão com todos.
- **TLS**: na web é da borda (proxy); o TLS self-signed do `src/server/tls.ts` só serve o modo LAN do
  Electron.
- **Build**: cliente Vite → `dist/client`; servidor web esbuild → `dist/online/server.cjs` (bundle único,
  sem `node_modules` em runtime); Docker copia `dist/` + `website/`. Electron: Vite client + esbuild
  main/preload + electron-builder (legado).

### Componentes atuais

| Área | Linhas | Papel | Situação |
|---|---:|---|---|
| `src/shared` | 555 | contratos puros: types, protocol, constants, collision, defaultMap, bridge | **manter** (fonte da verdade cliente↔servidor) |
| `src/server` | 941 | HTTP+WSS, sala autoritativa, validação, TLS (LAN) | **manter**; extrair rotas/landing p/ `online/` |
| `src/online` | 82 | composition root do deploy web (env, ICE, landing, shutdown) | **manter**; vira o único dono de env/rotas |
| `client/src` | 7.908 | React: sessão, escritório, mídia, chat, soundboard, PWA, mobile | **manter**; reorganizar `session/`+`ui/` |
| `deploy/` | 1.664 | build-online + 3 harnesses Playwright | **manter**; deduplicar harness (~250 linhas) |
| `website/` | 1.105 | landing estática sem build | **manter** |
| `src/main`+`src/preload` | 917 | shell Electron | **quarentena** em `legacy/electron/` |
| `src/server/tls.ts` | 98 | certificado self-signed LAN | **quarentena** (só LAN) |
| `scripts/build-main.mjs`+`electron-builder.yml` | 50 | build/empacotamento Electron | **quarentena** |
| `tests/e2e` | 850 | e2e Electron | **quarentena** (gate manual legado) |

### Regras de dependência (hoje respeitadas; manter)

1. `src/shared` não importa **nada** fora de si (hoje só `./types`).
2. `src/server` importa `shared`; **nunca** `client` nem `main`.
3. `src/online` importa `server`/`shared`; é o **único** que lê `process.env` do deploy e o único que
   conhece landing/`/join`/`/site`.
4. `client` importa `@shared` e seu próprio código; **nunca** `src/server`/`src/main`.
5. `src/main`/`src/preload` são folha (legado) e não podem ser importados pelo produto web.

### Fluxos que mandam no desenho

- **Entrada**: `GET /join` → 302 `/room?autojoin=1` → React monta → `connect()` abre `wss://host/ws` →
  `join{protocol, profile, session?}` → `welcome{you, players, map, room, session, serverTime}`.
- **Movimento**: cliente prediz, envia `move` a cada 60 ms no máximo; servidor revalida com
  `src/shared/collision.ts` e broadcast `playerMoved`; cliente renderiza no `rAF` lendo `getState()`.
- **Chat**: `chat` → valida trim/limite/rate no servidor → broadcast; histórico só na memória do cliente
  (200 mensagens). Não persiste (decisão).
- **Mídia**: `signal` (offer/answer/ICE) é relay ponto-a-ponto pelo servidor; ICE vem de
  `/client-config.json`; malha com iniciador = menor id; troca de track por `replaceTrack`.
- **Soundboard**: cliente corta o MP3 (≤10 s), manda chunks base64 (≤8 KB) e o servidor relayaria para a
  sala; **o filtro de distância hoje é só no cliente** — corrigir no servidor (P0-1/P0-4 do checkup).

## 2. O que está errado na estrutura (resumo)

| Problema | Evidência |
|---|---|
| Dois composition roots com defaults divergentes | `src/online/main.ts:42-58` × `src/main/server-host.ts:31-44` ("Escritório online" × "offline") |
| Rotas de deploy vazando para o servidor genérico | `/`, `/site/*`, `/join`, flag `online` em `src/server/server.ts:26-30,157-187` |
| Dois servidores estáticos no mesmo arquivo | `createStaticHandler` (`server.ts:73-123`) × `serveFile` (`:139-153`) |
| Duplicação de validação | endereço LAN (`HomeScreen.tsx:21-39` × `src/main/address.ts`), schema de perfil (3 donos), rotas hardcoded em 6 lugares |
| `PROTOCOL_VERSION` duplicado | `shared/constants.ts:3` (morto) × `shared/protocol.ts:3` (vivo) |
| Pegada Electron no produto | 1.915 linhas, 40/368 pacotes do lock, 5/12 scripts npm, ~308 MB locais |
| Build/deploy acoplado ao legado | `npm run build` compila Electron; Docker copia `dist/` inteiro e sourcemaps |
| Contratos mentindo | `CONTRACTS.md`/`OFFLINE_ARCHITECTURE.md` desatualizados (ver checkup §5.3) |

## 3. Arquitetura-alvo (mínima e web-first)

```
gather-offline/
├─ src/
│  ├─ shared/        tipos + regras puras (uma dona por contrato)
│  │   ├─ types.ts, protocol.ts, constants.ts, collision.ts, defaultMap.ts
│  │   ├─ profile.ts      ← schema do perfil (hair/status/cores) usado por server+client+settings
│  │   ├─ routes.ts       ← WS_PATH, /healthz, /join, /room, /client-config.json, /site/
│  │   └─ lanAddress.ts   ← parse/validação de endereço LAN (hoje duplicado)
│  ├─ server/        transporte + sala (sem saber que existe "landing")
│  │   ├─ server.ts       ← HTTP/WSS + um serveStatic(root,{fallback,cache}) + headers de segurança
│  │   ├─ room.ts, validation.ts, collision.ts (re-export + findSpawn)
│  │   └─ tls.ts          → legacy/electron/ (só LAN)
│  └─ online/        composition root do deploy web
│      ├─ main.ts         ← env, ICE/TURN, shutdown, bind
│      └─ web-routes.ts   ← /, /site/*, /join, /client-config.json, defaults de sala
├─ client/src/
│  ├─ main.tsx, App.tsx, pwa.ts
│  ├─ session/       ← store, net/connection, desktop-bridge, home/
│  ├─ office/ media/ chat/ soundboard/ mobile/ audio/   (features, como já estão)
│  ├─ ui/            ← components/, icons, palette + styles/
│  └─ media/engine.ts (opcional: WebRTC sem React; separar de useMedia)
├─ tests/
│  ├─ unit/          ← shared + server + partes puras do cliente (connection/store com fake timers)
│  ├─ harness/       ← freePort/waitFor/pass-fail/servidor — usado pelos verify-*
│  └─ e2e/           → legacy/electron/
├─ deploy/           ← build-online.mjs + verify-online/pwa/mobile.mjs
├─ website/          ← landing estática
└─ legacy/electron/  ← src/main, src/preload, build-main.mjs, electron-builder.yml, tests/e2e, docs Electron
```

### Onde colocar código novo (regra de bolso)

| Vou adicionar… | Vai para | Não vai para |
|---|---|---|
| mensagem nova do protocolo | `src/shared/protocol.ts` + validação em `src/server/validation.ts` + rate limit no `room.ts` | handler solto no `server.ts` |
| rota/endpoint do deploy | `src/online/web-routes.ts` (via `server.ts` genérico) | `server.ts` ganhando `if online` |
| campo/constante de perfil | `src/shared/profile.ts` + `server/validation.ts` | cada UI/validação com sua cópia |
| painel/UI do escritório | `client/src/office/` ou `components/` (→ `ui/`) com foco/teclado | inline em `OfficeScreen.tsx` |
| lógica de mídia/WebRTC | `client/src/media/` (ideal: `engine.ts` puro + hook) | `OfficeCanvas`/`OfficeScreen` |
| feature mobile/touch | `client/src/mobile/` — congelado: só correção de regressão | espalhar `isTouch` pelo app |
| recurso Electron | `legacy/electron/` — congelado | `src/main` no build web |
| teste de regra pura | `tests/unit/` (node:test) | harness Playwright |
| teste de fluxo real | `deploy/verify-*.mjs` (harness compartilhado) | script novo com `freePort` copiado |

### Anti-metas explícitas

Nada de monorepo/workspaces, framework novo, banco de dados, refactor de CSS global, multi-room agora,
editor de mapa, contas/login ou telemetria. O ganho está em **remover** caminhos e duplicação, não em
adicionar.

## 4. Migração (8 passos ≤1 dia cada)

Gates a cada passo: `npm run typecheck`, `npm test`, `npm run build:client && npm run build:online`,
`node deploy/verify-online.mjs` (+ `verify-pwa`/`verify-mobile` quando tocar UI; e2e Electron só enquanto
o legado existir).

| # | Passo | Esf. | Risco | Resultado |
|---|---|---|---|---|
| 1 | **Higiene de ghost code**: apagar `AuthMode`, `PROTOCOL_VERSION` de `constants.ts`, `MAX_EFFECT_DURATION_MS`, `showNotification`/`quit`, `media.css.d.ts` (confirmado descartável); desexportar API interna | 0,5 d | baixo | −~40 linhas, 1 arquivo |
| 2 | **Dono único de contratos**: `shared/routes.ts`, `shared/profile.ts`, `shared/lanAddress.ts`; server/client/Home passam a importar | 0,5–1 d | baixo | remove 3 validações duplicadas + 6 literais de rota |
| 3 | **Servidor**: um `serveStatic(root,{fallback,cache})`; mover `/`, `/site/*`, `/join`, defaults de sala e `WEBSITE_DIR` p/ `src/online/` | 0,5–1 d | médio-baixo (coberto por `server.test.ts`) | `server.ts` só HTTP/WSS/sala/config |
| 4 | **Cliente**: `components/`→`ui/`; `state`+`net`+`desktop`+`home`→`session/`; detecção Electron só em `desktop.ts` | 0,5–1 d | baixo (imports mecânicos) | nomes coerentes, 1 detecção |
| 5 | **Quarentena Electron**: mover `src/main`, `src/preload`, `scripts/build-main.mjs`, `electron-builder.yml`, `tests/e2e`, `tls.ts` e docs Electron para `legacy/electron/` com `package.json` próprio; `npm run build` = client+online; CI/Docker sem electron/builder/selfsigned | 1 d | **médio-alto** (build/empacotamento) | −917 linhas do produto, −40 pacotes |
| 6 | **Docker/CI web-only**: imagem instala/builda só web; copia `dist/client`+`dist/online`+`website`; sourcemap off em produção; `USER node`; commitar `.github/` e remover condicionais mortos | 0,5 d | médio-baixo | imagem menor, sem fonte pública, CI real |
| 7 | **Testes**: `tests/harness/` compartilhado pelos 3 verify; unit de `src/online` (env/ICE) e de `connection`/`store` (fake timers); teste de TLS vai p/ legacy | 1 d | médio-baixo | −~250 linhas duplicadas, +cobertura web |
| 8 | **(Opcional) Mídia testável**: extrair `media/engine.ts` (WebRTC/sinalização sem React) + `media/health.ts` (stats/speaking) | 1 d | médio-alto (910 linhas sutis) | testável sem browser; só depois de 1–7 |

### Se só der para fazer 3 movimentos

1. **Quarentena Electron + build web-only (5+6)** — maior ganho estrutural, tira o legado do caminho
   crítico de build/deploy.
2. **Dono único de contratos e composição (2+3)** — mata as duplicações que vão divergir (perfil,
   endereço LAN, rotas, estáticos, defaults de sala) sem tocar em UI.
3. **Higiene de ghost code + docs (1 + checkup §5.3)** — ~1 dia, risco quase zero, e impede que os
   próximos passos se apoiem em contrato falso.

## 5. Decisões de arquitetura (vigentes)

- **1 sala por deploy** (até 6, mesh O(n²)); multi-room só com dados reais — dois deploys resolvem dois
  grupos antes disso.
- **Sem banco/persistência durável**: estado em memória; perfil/preferências em `localStorage`;
  histórico de chat no cliente. Reinício = sala nova (documentado).
- **Sem telemetria**: observabilidade por log local + `/healthz` útil (P1-10 do checkup).
- **TLS na borda na web**; certificado self-signed só no modo LAN legado.
- **Cliente por feature, sem state manager externo**: `useSyncExternalStore` + slices seletivos quando
  o re-render por `move` for corrigido (P1-3).
- **Legado congelado**: Electron e mobile não recebem feature nova; precisam continuar compilando e
  passando os gates atuais.

## 6. Não verificado

- Não executei a migração; os passos acima são proposta. Builds Docker/CI reais não foram rodados
  (Docker ausente na máquina) — ver "Não verificado" de [`CHECKUP_REPORT.md`](CHECKUP_REPORT.md) §9.
- O layout-alvo assume que `legacy/electron/` pode ter `package.json` próprio e que Render/CI passam a
  instalar só as deps web; o impacto real em tempo de CI/imagem não foi medido.
- A extração de `media/engine.ts` (passo 8) não foi validada; é o passo de maior risco e o mais adiável.
