# Arquitetura e inventário ghost/legacy — DittoApp

Auditoria read-only (2026-10-28). Escopo: estrutura, fronteiras entre módulos, duplicação de dono,
código morto/legado e arquitetura-alvo **web-first**. Bugs de comportamento ficam nas auditorias de
server/client. Não rodei build, typecheck, testes nem `verify-*` (ver "Não verificado").
Evidência sempre `arquivo:linha`.

## 1. Mapa atual

### 1.1 Tamanho (linhas de arquivos rastreados)

| Área | Linhas | Papel |
|---|---|---|
| `src/shared` | 555 | contratos puros (types, protocol, constants, collision, defaultMap, bridge) |
| `src/server` | 941 | HTTP+WSS, sala autoritativa, validação, TLS (TLS só p/ LAN) |
| `src/online` | 82 | composition root do deploy web (env, ICE, landing, shutdown) |
| `src/main` + `src/preload` | 917 | shell Electron (legado/estudo) |
| `client/src` | 7.908 | React: ts 2.817 + tsx 2.908 + css 2.168 + d.ts 15 |
| `deploy/` | 1.664 | build-online (21) + verify-online/mobile/pwa (1.622) |
| `tests/` | 1.796 | unit 946 + e2e Electron 850 |
| `website/` | 1.105 | landing estática sem build |
| docs `.md` | 2.182 | 11 docs |

`dist/online/server.cjs` = 164 KB; `dist/main/main.cjs` = 976 KB + 1,5 MB de map.
`src` (2.495) = shared 555 + server 941 + online 82 + main 886 + preload 31.

### 1.2 Grafo de módulos (real, por import)

```
ENTRADAS
  web      src/online/main.ts ──► src/server/server.ts ──► room.ts ──► validation.ts
                                                          └──► src/server/collision.ts
                                                                  └──(re-exporta)──► src/shared/collision.ts
  electron src/main/main.ts ──► server-host.ts ──► src/server/server.ts
            src/main/{ipc,tray,security,cert,settings,cli,...}     [legado]
            src/preload/preload.ts ──► src/main/ipcChannels.ts     [legado]
  cliente  client/index.html ──vite──► client/src/main.tsx ──► App.tsx
              ├── session: state/store.ts, net/connection.ts, desktop.ts, home/
              ├── features: office/ (canvas, scene, avatar, draw), media/, chat/, soundboard/,
              │             mobile/, audio/
              └── ui: components/, styles/
  contratos src/shared/{types,protocol,constants,collision,bridge,defaultMap}
```

Camadas hoje: `shared ← server|main|online|client`; `client` importa `@shared` (34 imports) e
**zero** imports de `src/server`/`src/main`; `shared` só importa `./types` (`src/shared/bridge.ts:5`,
`collision.ts:1`, `defaultMap.ts:1`, `protocol.ts:1`). Layering de base está respeitado.

Vazamentos pontuais:
- `src/preload/preload.ts:8` importa `../main/ipcChannels` — preload→main (fronteira invertida).
- `src/server/server.ts:10` importa `type` de `./tls`; `tls.ts:5` depende de `selfsigned`. Como é
  `import type`, `selfsigned`/TLS **não** entram no bundle web (grep `selfsigned` e `electron` em
  `dist/online/server.cjs` = 0), mas o servidor web carrega uma opção de TLS que o deploy não usa.
- `src/shared/constants.ts:30` (`PRIVATE_HOST_PATTERN`) é conceito LAN/Electron consumido pelo
  bundle web (`client/src/home/HomeScreen.tsx:32`).

O client **já é organizado por feature** (`office/`, `media/`, `chat/`, `soundboard/`, `mobile/`,
`audio/`); o grab-bag é `components/` e a separação `state/`+`net/`+`desktop.ts`.

### 1.3 Fluxos e donos

- **WS**: mesma origem `${ws|wss}://host/ws` (`client/src/net/connection.ts:81-83`; `/ws` em
  `src/shared/constants.ts:12`), `join`/`welcome`/`move`/`chat`/`signal`/`soundboard`
  (`src/shared/protocol.ts:5-51`); estado e rate limits em `src/server/room.ts:100-239`.
- **Mídia**: relay de sinalização em `src/server/room.ts:226-231`; P2P no cliente
  (perfect negotiation `client/src/media/useMedia.ts:325-464`; initiator/polite em
  `client/src/media/proximity.ts:17-20`); ICE vem de `GET /client-config.json`
  (`useMedia.ts:202-210`, servido em `src/server/server.ts:161-164`).
- **Estático/TLS**: `dist/client` com SPA fallback (`server.ts:73-123`); landing `/` + `/site/*`
  (`server.ts:170-187`); TLS self-signed só no caminho Electron (`src/main/server-host.ts:37-38` +
  `src/server/tls.ts:76-97`).
- **Config**: env no root web (`src/online/main.ts:42-58`); flags no root Electron
  (`src/main/cli.ts:18-30`).
- **Build**: client Vite (`client/vite.config.ts:1-17`), main/preload esbuild
  (`scripts/build-main.mjs:10-14`), servidor web esbuild (`deploy/build-online.mjs:10-11`).
  Docker roda `npm run build` (client **+ main Electron**) e `build-online` (`Dockerfile:13`),
  copia `dist/` inteiro + `website/` (`Dockerfile:19-20`) e roda `dist/online/server.cjs`
  (`Dockerfile:24`). CI idem: `npm run build && npm run build:online`
  (`.github/workflows/ci.yml:45-46`) e `npm ci` com `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (`ci.yml:19`).

## 2. Drift e duplicação de dono

| # | Duplicação | Dono A | Dono B | Evidência |
|---|---|---|---|---|
| 1 | Dois composition roots | web `src/online/main.ts:42-58` | Electron `src/main/server-host.ts:31-44` | ambos chamam `startRoomServer`; defaults divergem: `"Escritório online"` (`online/main.ts:47`), `"Escritório offline"` (`server.ts:135`, `room.ts:75`) |
| 2 | Dois servidores estáticos no mesmo arquivo | client+SPA `server.ts:73-123` | landing `server.ts:139-153` | `readFile`/MIME/writeHead/cache-control duplicados (`:74-80` vs `:139-148`); checagem de traversal em `:98-102` e `:182-183` |
| 3 | Modo "online" dentro do servidor genérico | `server.ts:26-30,157-187` | `src/online/main.ts:48-58` | rotas `/`, `/site/*`, `/join` e `online` flag no core; `WEBSITE_DIR` só em `online/main.ts:46` e não documentado (`docs/ONLINE_DEPLOY.md:39-46`) |
| 4 | Validação de porta 2× | `online/main.ts:43-44` | `server.ts:127-129` | mesma regra 0..65535 |
| 5 | Validação de endereço LAN 2× | `client/src/home/HomeScreen.tsx:21-39` | `src/main/address.ts:16-47` | mesma regra `https` + `PRIVATE_HOST_PATTERN` + porta; client não pode importar `main` → deveria morar em `shared` |
| 6 | Schema de perfil 3 donos | `src/server/validation.ts:38-71` | `src/main/settings.ts:69-87` e `client/src/components/palette.ts:18-27`/`desktop.ts:19-43` | `HairStyle 0..3` literal em `validation.ts:39` e `settings.ts:78-80`; `STATUSES` em `validation.ts:14`, `settings.ts:14`, `palette.ts:27` |
| 7 | `PROTOCOL_VERSION` 2× | `src/shared/protocol.ts:3` (vivo) | `src/shared/constants.ts:3` (0 importadores) | risco de drift de protocolo |
| 8 | Caminho de colisão 2× | `src/shared/collision.ts` | `src/server/collision.ts:4-11` (re-export) | `room.ts:16` e `tests/unit/server.test.ts:12` importam o wrapper |
| 9 | "É Electron?" 3× | `client/src/desktop.ts:9-11` | `pwa.ts:4`, `InstallPrompt.tsx:8` | três detecções independentes de `window.gather` |
| 10 | Rotas/link hardcoded em 6 lugares | `server.ts:157,161,165-169` | `TopBar.tsx:31`, `HomeScreen.tsx:126`, `pwa.ts:13`, `useMedia.ts:204`, `client/public/sw.js:9-10`, `website/index.html:46,61,287,305-306` | não existe módulo de rotas compartilhado |
| 11 | Rate limit de chat 2× | servidor `room.ts:210-224`+`validation.ts:144-155` | cliente `ChatPanel.tsx:43-52` | mesmas constantes aplicadas em dois pontos |
| 12 | Proximidade do soundboard 2× | servidor manda p/ todos `room.ts:179-187` | cliente filtra por distância `soundboard.ts:272-278` | comentário/docs dizem "nearby" (`constants.ts:33`, `soundboard.ts:2`), servidor não filtra → banda O(n) por clip |
| 13 | Labels de conexão 2× | `TopBar.tsx:9-15` | `ConnectionOverlay.tsx:25-29` | "Reconectando…" duplicado |
| 14 | Link `/join` montado 2× | `TopBar.tsx:31` | `HomeScreen.tsx:126` | mesma expressão `${origin}/join` |

### 2.1 Docs vs código (drift)

- `README.md:5,17` diz web é o produto principal; `docs/ONLINE_DEPLOY.md:3-5` ainda diz "o modo
  online é aditivo" e o offline é o app. `docs/OFFLINE_ARCHITECTURE.md:12-38` descreve topologia
  Electron como principal; `:36-37` afirma "sem STUN/TURN externos (`iceServers: []`)" — o modo web
  usa STUN/TURN (`src/online/main.ts:15-17`, `useMedia.ts:202-210`); `:63` "nenhuma dependência
  externa em runtime" não vale para a mídia web.
- `docs/CONTRACTS.md:7` "100% offline"; `:31-33` "não edite estes arquivos" (regra de time que não
  existe); `:35-45` tabela de donos por agente; `:53-57` protocolo **sem** `soundboard` (existe em
  `protocol.ts:14-25`); `:90-98` `StartRoomServerOptions` sem `iceServers/online/websiteDir`
  (real em `server.ts:18-30`); `:128-150` `MediaApi` sem `localStream`, `mediaHealth`,
  `connectionStats` (real em `useMedia.ts:27-51`).
- `docs/ONLINE_DEPLOY.md:14` diz que `/join` redireciona para `/?autojoin=1`; o código redireciona
  para `/room?autojoin=1` (`server.ts:166`) — o próprio doc se contradiz em `:48`.
- Números de teste velhos: `docs/BUILD_AND_RUN.md:95` e `docs/VERIFICATION.md:90,211` dizem
  "30 testes"; são **34** (26 `server.test.ts` + 4 collision + 4 proximity). `VERIFICATION.md:6`
  diz online "11/11" e `:12` "32/32"; `:204` "unit 33/33".
- `docs/PWA_NOTES.md:48-50` diz "integração pendente: chamar `registerPwa()` no boot"; já está
  integrado (`client/src/main.tsx:6,63`).
- `docs/CI.md:16` e `ci.yml:52-58` mantêm passos condicionais "se o arquivo existir"; os arquivos
  existem → o condicional é morto.

## 3. Inventário ghost/legacy (quantificado)

### 3.1 Pegada Electron (inalcançável do build web)

| Item | Linhas | Evidência |
|---|---|---|
| `src/main/**` + `src/preload/**` | 917 | não entram em `deploy/build-online.mjs:10` (entry = `src/online/main.ts`); grep `electron` no bundle = 0 |
| `src/server/tls.ts` (só LAN) | 98 | `import type` em `server.ts:10`; `selfsigned` ausente do bundle web |
| `scripts/build-main.mjs` + `electron-builder.yml` | 50 | build/empacotamento Electron |
| `tests/e2e/run-e2e.mjs` | 850 | e2e Electron; não roda no CI (`docs/CI.md:23-29`) |
| **Total** | **1.915** | ≈12,5% das ~15,2k linhas de código rastreado; **40,7% de `src`** (1.015/2.495) |
| Dependências | — | `electron` 44.4.3 + `electron-builder` (`package.json:29-30`); 40 dos 368 pacotes do lock (10,9%) são cadeia Electron; `selfsigned` (`package.json:35`) só serve `tls.ts` |
| Scripts npm | — | 5 de 12 são Electron: `start`, `dev`, `dist`, `test:e2e`, `build:main` (`package.json:10-23`); `"main"` aponta `dist/main/main.cjs` (`package.json:9`) |
| Artefatos locais | — | `release/` 432 MB e `node_modules/electron` 308 MB (gitignored); `.DS_Store` na raiz |

Web-only “novo”: `src/online` 82 + `website/` 1.105 + `deploy/` 1.664 + `client/public` 112
(sw 75 + manifest 37) + pwa/mobile do cliente (~320). O cliente é o mesmo bundle para os dois modos.

### 3.2 Código morto / exportado sem consumo

- `AuthMode` (`src/shared/protocol.ts:53`): 0 usos no repo; duplica `UserStatus`.
- `PROTOCOL_VERSION` em `src/shared/constants.ts:3`: 0 importadores (o vivo é `protocol.ts:3`).
- `MAX_EFFECT_DURATION_MS = MAX_SOUNDBOARD_MS` (`client/src/soundboard/soundboard.ts:343`): 0 usos.
- Superfície morta do bridge: `showNotification`/`quit` (`src/shared/bridge.ts:46,48`;
  `src/preload/preload.ts:26,28`; handlers em `src/main/ipc.ts:54-70`) — o cliente nunca chama
  (só `setBadge` é usado, `OfficeScreen.tsx:166`).
- `fingerprint256` (`src/server/tls.ts:12,84,97`): calculado e nunca consumido em runtime
  (`server-host.ts:37-38` não propaga); `fingerprint()` (`tls.ts:20`) só aparece nos testes.
- **29 exports sem nenhum importador externo** (grep em `src`, `client/src`, `tests`, `deploy`,
  `scripts`). Só 3 são definições mortas (acima); os outros são API interna vazando como export:
  `installOfflineGuard` `security.ts:34`, `lanIpv4Addresses` `server-host.ts:19`,
  `parseLanAddress` `HomeScreen.tsx:21`, `CONNECTION_LABEL` `TopBar.tsx:9`, `encodeWav`
  `soundboard.ts:155`, `profileFromSettings`/`setState` `store.ts:34,75`,
  `MediaHealth`/`MediaConnectionStats` `useMedia.ts:11-25`, `AvatarDraw` `avatar.ts:15`,
  `ViewRect` `scene.ts:11`, `MoveIntent`/`SoundboardChunk` `validation.ts:84,157`,
  `RoomOptions`/`StartRoomServerOptions` `room.ts:38`/`server.ts:18`, `ObjectKind` `types.ts:32`,
  `CliOptions` `cli.ts:4`, entre outros tipos usados só na própria assinatura.
- Arquivo órfão: `client/src/media/media.css.d.ts` (2 linhas, desde o 1º commit `f9b42a7`). Não há
  `declare module "*.css"` no repo; teste isolado com TS 5.9.3 + `moduleResolution: Bundler` aceitou
  import side-effect de `.css` sem declaração → **provável resíduo**, confirmar com typecheck.
- Sem dep totalmente não usada provável. `selfsigned` e o trio Electron são “legado por decisão”,
  não ghost acidental. `playwright-core` é usado pelos 4 harnesses.

### 3.3 Lacunas de teste/estrutura

- Unit (34) cobrem `shared/collision`, `media/proximity` e `src/server` (946 linhas); **zero** para
  `client/src/state/store.ts` (132), `net/connection.ts` (278, reconexão/queueMove),
  `soundboard.ts` (343), `desktop.ts` (96) e `src/online/main.ts` (82, parsing de env).
- 3 verify Playwright reimplementam o mesmo harness: `freePort` (`verify-online.mjs:41`,
  `verify-mobile.mjs:48`, `verify-pwa.mjs:35`), `waitFor` (`:53`/`:60`/`:47`), `pass/fail/warn`
  (`:37-39`/`:39-46`/`:31-33`); o e2e soma `run-e2e.mjs:84,126`. ≈250 linhas duplicadas.
- `tests/e2e` (850 linhas) é gate local de um app que não é mais o produto.

## 4. Arquitetura-alvo e migração

### 4.1 Layout alvo (mínimo, sem framework novo)

```
src/
  shared/     tipos+puro: types, protocol, constants, collision, defaultMap,
              profile.ts (schema do perfil), lanAddress.ts, routes.ts (WS_PATH, /healthz, /join, /room, /client-config)
  server/     HTTP+WSS + sala: server.ts, room.ts, validation.ts (findSpawn junto de room/validation)
  online/     composition root do deploy web: env, ICE, landing, TLS-proxy, shutdown
client/src/
  main.tsx App.tsx pwa.ts          (bootstrap)
  session/    store, net/connection, desktop-bridge, home/
  office/ media/ chat/ soundboard/ mobile/ audio/     (features, como já estão)
  ui/         components, icons, palette + styles/
tests/
  unit/       shared + server + partes puras do cliente
  harness/    freePort, waitFor, pass/fail, spawn de servidor (Playwright) — usado por deploy/verify-*
deploy/       build-online.mjs + verify-online/pwa/mobile.mjs
website/      landing estática (sem build)
legacy/electron/  main/, preload/, build-main.mjs, electron-builder.yml, tests/e2e, docs Electron
```

Regras: (a) `shared` só depende de si; (b) `online/` é o único que lê env do deploy e o único que
conhece “landing/`/join`”; (c) `client` importa só `@shared` + seu próprio código; (d) nada de
Electron fora de `legacy/electron/`. Manter o padrão atual “tudo devDependency + bundle”
(sem `node_modules` em runtime) — `Dockerfile:15-24` já depende disso.

### 4.2 Manter / simplificar / deletar

- **Manter**: `shared`↔`server`↔`client` (é bom), feature folders do cliente, verificação Playwright
  como gate, landing sem build, estado em memória (1 sala, 6 pessoas).
- **Simplificar**: `server.ts` (dois estáticos → um), `useMedia` 910 linhas (extrair `media/engine.ts`
  + `media/health.ts` puros), harness de verificação (1 módulo compartilhado).
- **Deletar**: `src/main`/`src/preload` do produto (mover p/ legacy), `AuthMode`, `PROTOCOL_VERSION`
  duplicado, `MAX_EFFECT_DURATION_MS`, métodos `showNotification`/`quit` do bridge, `media.css.d.ts`.
- **Não fazer agora**: monorepo/workspaces, framework novo, refactor de CSS global (1.962 linhas) ou
  multi-room — nada disso remove duplicação atual.

### 4.3 Migração ordenada (cada passo ≤1 dia)

| # | Passo | Esf. | Risco | Sai/entra |
|---|---|---|---|---|
| 1 | Higiene de ghost code: apagar `AuthMode`, `PROTOCOL_VERSION` de `constants.ts`, `MAX_EFFECT_DURATION_MS`, `showNotification`/`quit`, `fingerprint256` não usado; desexportar os 26 exports internos; testar remoção de `media.css.d.ts` | 0,5 d | baixo | −~40 linhas, 1 arquivo |
| 2 | Contratos com dono único: `shared/routes.ts`, `shared/profile.ts` (`HAIR_STYLES`, `STATUSES`, validação), `shared/lanAddress.ts`; client/HomeScreen e `src/main/address.ts` passam a usar; `TILE_SIZE` só em `constants` | 0,5–1 d | baixo | remove 3 validações duplicadas e 6 literais de rota |
| 3 | Servidor: um `serveStatic(root, {fallback})`; mover rotas `/`, `/site/*`, `/join`, defaults de sala e leitura de `WEBSITE_DIR/CLIENT_DIR` para `src/online/`; `server.ts` fica HTTP+WSS+sala+config | 0,5–1 d | médio-baixo (coberto por `server.test.ts`) | −~60 linhas em `server.ts` |
| 4 | Cliente: `components/`→`ui/`; `state`+`net`+`desktop`+`home`→`session/`; detecção Electron só em `desktop.ts` (usada por `pwa.ts`/`InstallPrompt`) | 0,5–1 d | baixo (imports mecânicos) | 3→1 detecção, nomes coerentes |
| 5 | Quarentena Electron: mover `src/main`, `src/preload`, `scripts/build-main.mjs`, `electron-builder.yml`, `tests/e2e`, `src/server/tls.ts` (se TLS ficar LAN-only) e docs Electron p/ `legacy/electron/` com `package.json` próprio; `npm run build` = client+online; `npm ci`/CI/Docker sem electron/builder/selfsigned | 1 d | **médio-alto** (build/empacotamento) | −917 linhas de produto, −40 pacotes, −308 MB locais |
| 6 | Deploy/CI web-only: Dockerfile builda `build:client && build:online`, copia só `dist/client`+`dist/online`+`website`; sourcemap off no build de produção (`client/vite.config.ts:15` gera `.map` servido em `server.ts:48`); remover condicionais mortos do CI; avaliar manter `verify-pwa`/`verify-mobile` como passos fixos | 0,5 d | médio-baixo | imagem menor, sem fonte pública |
| 7 | Testes: `tests/harness/` compartilhado pelos 3 verify; unit para `src/online` (env/ICE) e sessão do cliente (reconnect com fake timers); mover teste de TLS (`server.test.ts:630-647`) p/ legacy | 1 d | médio-baixo | −~250 linhas duplicadas, +cobertura web |
| 8 | (Opcional) `useMedia` → `media/engine.ts` (WebRTC/signaling, sem React) + `useMedia.ts` (binding); `media/health.ts` com as contas de stats/speaking | 1 d | médio-alto (910 linhas sutis) | testável sem browser; só depois dos passos 1-7 |

Gates a cada passo: `npm run typecheck`, `npm test`, `npm run build:client && npm run build:online`,
`node deploy/verify-online.mjs` (+ pwa/mobile quando o passo os tocar). O e2e Electron deixa de ser
gate do produto no passo 5; até lá, é gate legado.

### 4.4 Se só der para fazer 3 movimentos

1. **Quarentena Electron + build web-only (passos 5+6)**: maior ganho estrutural — tira ~1.915
   linhas e 40 pacotes do produto, e o Docker/CI passam a instalar só o que a web usa.
2. **Dono único de contratos e composição (passos 2+3)**: elimina as duplicações que vão divergir
   (perfil, endereço LAN, rotas, estáticos, defaults de sala) sem tocar em UI.
3. **Higiene ghost + docs (passo 1 + §2.1)**: apaga o que ninguém usa e corrige contratos/docs
   (MediaApi, `StartRoomServerOptions`, redirect `/join`, contagem de testes) — custo ~1 dia, risco
   quase zero, e evita que os próximos passos se apoiem em contrato falso.

## 5. Não verificado

- Não executei `npm run typecheck`, `npm test`, `npm run build`, `build:online`, `verify-*` nem
  `test:e2e`; contagens de teste, bundles e build são inferidos de arquivos/fontes (verificação é
  de outro dono). O `dist/` foi lido como artefato, mas mudou durante a auditoria.
- Não li integralmente: `client/src/styles/global.css` (1.962), `client/src/media/media.css` (206),
  `client/src/office/scene.ts` (120/567), `client/src/office/avatar.ts` (60/202),
  `client/src/soundboard/SoundboardPanel.tsx` (80/447 + greps), corpos de
  `deploy/verify-*.mjs` e `tests/e2e/run-e2e.mjs` (só cabeçalhos/duplicatas e greps), corpos de
  `tests/unit/*`, `docs/REVERSE_ENGINEERING.md` (653), `docs/QOL_AND_JUICE.md` (181), partes de
  `docs/BUILD_AND_RUN.md` (110/222), `docs/ROADMAP.md` (120/250), `website/styles.css` (794),
  `release/**` (binário) e histórico de commits além de `git log --oneline -12`.
- "Export sem importador" é grep textual (não AST/tsc): imports dinâmicos/JSX não seriam vistos;
  conferi manualmente os candidatos listados. Não provei dependência não usada além das citadas.
- Não medi custo real de build/CI/Docker (tempos, tamanho de imagem) — só tamanho de artefatos.
- Não avaliei performance/segurança de comportamento (fica com server/client audits): store global
  re-renderizando a árvore (`store.ts:81`), CSP ampla (`client/index.html:9`), entre outros.
