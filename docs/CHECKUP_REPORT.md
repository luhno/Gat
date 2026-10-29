# Checkup do DittoApp — relatório de melhoria (foco web)

Status: **diagnóstico concluído em 2026-10-28**. Nenhum código de produção foi alterado; este relatório
é o resultado do checkup e o plano de correção. Evidências brutas em [`docs/audit/`](audit/).

Escopo: **produto web** (cliente React + servidor Node HTTP/WSS de sala única). Electron e camada
mobile entram só como "não quebrar" — ver "Depriorização" no fim. Baseline medido: **127 checagens
automatizadas verdes** (34 unit, 32 online, 17 PWA, 27 mobile, 17 e2e Electron), `typecheck` limpo,
build sem warnings, `npm audit` 0 vulnerabilidades — detalhes em [verification.md](audit/verification.md).

Método: 5 frentes em paralelo — servidor/infra, cliente, arquitetura/ghost code, verificação empírica
e roadmap — mais revisão e deduplicação do Lead. Achados "medidos" foram confirmados rodando o próprio
`dist/online/server.cjs` (sondas HTTP/WS reais) ou o Chrome (sonda de Web Audio); o resto é leitura de
código com `arquivo:linha`. **O que não foi testado está listado no fim.**

---

## 1. Veredito

**A base é boa e o produto funciona — mas ainda não está pronto para receber um link público.**

- A suíte verde é real, porém cobre o caminho feliz. Os defeitos graves estão justamente no que ela não
  testa: abuso, navegadores reais, reconexão com mídia, tela, autoplay, foco de teclado.
- O servidor tem **3 problemas Must medidos** (qualquer pessoa com o link derruba a sala, sequestra as
  6 vagas ou faz o navegador de terceiros entrar via outro site).
- O cliente tem **6 problemas Must**: jogador fantasma, F5 travado em sala cheia, mídia que "mente"
  (UI diz ligado sem track), áudio em dobro, link `/join` que pode abrir mudo e o anel "quem está
  falando" que nunca acende (confirmado por sonda no Chrome).
- ~**4 dias** de trabalho nos P0 mudam o produto de "demo que funciona" para "link que dá para mandar".
  Os P1 (~2–3 semanas) são o que o torna bom no dia a dia. P2 é limpeza contínua.

Se for corrigir só uma coisa hoje: **feche o abuso do servidor (P0-1/2/3)**. Se for corrigir só uma
coisa no cliente: **mídia (P0-8)**. Foi ali que o produto mais "mente" para o usuário.

## 1.1 Status de execução do P0 (2026-10-28)

Os 12 P0 foram implementados e verificados nesta rodada. Gates: `npm run typecheck`; `npm test`
**49/49** (34 antigos + 15 novos de abuso/regressão); build + build:online; `verify-online`
**32/32**; `verify-pwa` **17/17**; `verify-mobile` **27/27**; e2e Electron **17/17**. Sondas HTTP/WS
no bundle real: headers de segurança, asset/`.map` → 404, `Origin: evil` → 403, `/client-config.json`
com TURN efêmero. Teste de navegador de aceitação: duplo Enter = **1 WebSocket/1 jogador**;
`room_full` terminal em **~120 ms** com a mensagem do servidor; F5 em sala cheia volta para a sala.
Arquivos: `src/server/server.ts`, `src/server/room.ts`, `src/online/main.ts`, novo `src/online/ice.ts`,
`src/shared/constants.ts`, `client/src/net/connection.ts`, `client/src/media/useMedia.ts`,
`client/src/office/OfficeCanvas.tsx`, `tests/unit/server-abuse.test.ts` (+4 casos em `server.test.ts`),
`.github/workflows/ci.yml`, `Dockerfile` (runtime non-root) e docs de deploy/render.

**Revisão independente (feita por outro agente depois da primeira rodada) e correções aplicadas:**

- **Bypass de proximidade (P0-4):** `screenSharing` é auto-declarado; um cliente longe podia declarar
  `true` e receber `signal`, e o cliente da vítima criava peer com mic/câmera. Corrigido no cliente:
  offer de peer longe só é aceita se ele for sharer; `createPeer` grava `sendNear` e **só envia
  mic/câmera para peers próximos** (tela continua broadcast; iniciador que não envia usa `recvonly`).
  Resíduo conhecido: o servidor ainda confia no flag para relay (a vítima não envia mídia, mas pode
  receber uma "tela" falsa de um peer longe) — endurecer no servidor exigiria provar a tela, fora do P0.
- **Anti-teleporte por velocidade (P0-4):** o cap de 240 px por mensagem permitia ~9.600 px/s. Trocado
  por orçamento de movimento que reabastece a 3× a velocidade de caminhada (115 px/s), com o cap como
  teto de burst — 1 teste novo cobre.
- **Autoplay (P0-8.3):** listeners de gesto não são mais removidos no 1º toque; só quando há áudio
  remoto realmente tocando.
- **Mesh no screen share:** assistir um sharer não abre mais P2P com terceiros longe; só o próprio
  sharer conecta com todos.
- **`X-Forwarded-For`:** usa a última entrada (a do proxy), não a primeira forjável; 1 teste novo.
- **Host/DNS rebinding:** HTTP agora valida `Host` quando há allowlist (`/healthz` isento); 1 teste novo.
- **`CLIENT_DIR` inválido** falha no boot em vez de subir "saudável" com 404; 1 teste novo.
- **Rate limits** de `profile`/`media` subiram (20 e 30/5 s) para não descartar toggles legítimos;
  fechamentos de abuso têm fallback `terminate()` para cliente que ignora o close.

**Trade-off conhecido do F5:** o `leave` no `pagehide` libera a vaga na hora, então um reload normal
volta como **jogador novo** (mesmo nome/perfil, posição reinicia). O token em `sessionStorage` retoma o
mesmo id/posição quando o `leave` final não chega (queda/crash). Se "mesmo id no F5" virar requisito,
remover o leave do unload e depender do grace de 30 s — o evict de vaga desconectada já cobre o
`room_full`.

Permanecem fora do P0 (P1/P2): performance do canvas/store, screen share/mídia de reunião,
acessibilidade/foco, PWA cold start, observabilidade, quarentena Electron e limpeza de ghost code.

---

## 2. O que está bom (não mexer)

- **Camadas corretas**: `client → @shared`, `online/main → server → shared`; zero import
  cliente→servidor ou servidor→cliente. Colisão e mapa são compartilhados de verdade
  (`src/shared/collision.ts`), servidor revalida posição e sanitiza todo payload
  (`src/server/validation.ts`).
- **Servidor pequeno e legível** (941 linhas), sessão com retomada por `randomUUID`, heartbeat,
  `maxPayload`, encerramento gracioso e heartbeat — o esqueleto está certo; faltam limites e borda.
- **Verificação acima da média**: Playwright com Chrome real, fake media, mídia remota e reconexão;
  e2e Electron; screenshots; docs de verificação reproduzíveis.
- **Privacidade coerente**: sem telemetria, sem assets externos, sem persistência de chat, servidor não
  loga IP. Manter.
- **Build e deploy simples**: bundle único (322 KB / 101 KB gzip), servidor standalone de 160 KB,
  Docker multi-stage, Render Blueprint. Não inventar monorepo/framework.

---

## 3. P0 — Must fix (antes de divulgar o link) · ~3–4 dias

| # | Tema | Onde | Esforço |
|---|---|---|---|
| P0-1 | Abuso: sem teto de sockets/IP/join e sem limite p/ `signal`/`profile`/`media`; soundboard broadcast | `src/server/room.ts:179-231`, `server.ts:246-318` | 1 d |
| P0-2 | WSS aceita qualquer `Origin` (CSWH/DNS rebinding) | `src/server/server.ts:249-263` | 1 h |
| P0-3 | Sourcemap público (1,4 MB) + asset inexistente responde HTML 200 | `client/vite.config.ts:15`, `server.ts:104-113` | 1 h |
| P0-4 | Proximidade não imposta: teleporte e `signal` para qualquer distância | `src/server/room.ts:188-195,226-231` | 3 h |
| P0-5 | Vaga-fantasma 30–90 s + erro fatal (`room_full`) vira 10 reconexões com mensagem errada | `src/server/room.ts:122-124,245-258`; `client/src/net/connection.ts:167-198` | 3 h |
| P0-6 | `connect()` sem guarda: duplo Enter abre 2 sockets e cria jogador fantasma | `client/src/net/connection.ts:76,112-118` | 1 h |
| P0-7 | Token de sessão só em memória: F5 em sala cheia bloqueia o próprio usuário ~30 s | `client/src/net/connection.ts:36,87-89` | 1 h |
| P0-8 | Mídia mentirosa: permissão negada é terminal e UI diz "ligado"; áudio duplicado; `/join` pode abrir mudo | `client/src/media/useMedia.ts`, `OfficeCanvas.tsx:396-399` | 4–6 h |
| P0-9 | Anel "quem está falando" nunca acende (analyser em stream vazio, confirmado no Chrome) | `client/src/media/useMedia.ts:314-323` | 1–2 h |
| P0-10 | Sem headers de segurança (clickjacking, landing sem CSP, sem Referrer-Policy) | `src/server/server.ts:63-71,115-120,142-147` | 1 h |
| P0-11 | TURN com credencial estática exposta + `ICE_SERVERS` inválido derruba a mídia sem aviso | `src/server/server.ts:133-137`; `src/online/main.ts:19-33` | 3 h |
| P0-12 | CI não versionado (`.github/` untracked), sem testes de abuso, Docker nunca buildado | repo/CI | 4 h |

### P0-1 — Qualquer pessoa derruba a sala (DoS trivial)

**Cenário medido:** uma conexão enviou 300 `signal` de ~12 KB em 721 ms → **3,5 MB** entregues a uma
vítima; 400 `profile` em 806 ms → 400 broadcasts; 40 sockets abertos sem `join` foram aceitos; 1 clipe
de soundboard (64 chunks) foi relayado para **todos**, inclusive quem estava longe. Os limites existentes
(`move` 40/s, `chat` 8/5 s, soundboard 200/2 s) são **por conexão** e zeram com `leave`+novo `join`
(medido: 32 chats em 848 ms contra limite de 8/5 s). Numa instância free, um cliente derruba a sala
inteira (~25 MB/s de egress e CPU de JSON).
**Correção mínima:** um token bucket por conexão/IP **antes do `JSON.parse`** (~100 frames/s e 64 KB/s
de relay), teto global de sockets com timeout de 10 s para quem não faz `join`, `server.maxConnections`,
e relay de `soundboard` só para quem está dentro de `PROXIMITY_EXIT_TILES` (o servidor já tem as
posições). ~40 linhas + testes.
**Decisão pendente:** limite por IP atrás do Render exige confiar em `X-Forwarded-For` — introduzir
`TRUST_PROXY=1` e só contar IP quando ligado.

### P0-2 — Cross-Site WebSocket Hijacking

**Medido:** handshake com `Origin: https://evil.example` foi aceito, recebeu `welcome` e entrou na sala.
WebSocket não tem CORS: qualquer página pode fazer o navegador de cada visitante entrar na sala, ler o
chat, ocupar as 6 vagas e disparar sinalização. **Correção:** no `upgrade`, exigir
`origin.host === req.headers.host` (ou allowlist `PUBLIC_URL`); ausência de `Origin` (scripts/testes) é
permitida. ~10 linhas + 2 testes.

### P0-3 — Código-fonte público e fallback que envenena cache

**Medido:** `GET /assets/index-*.js.map` → `200 application/json`, **1.411.933 B** (build com
`sourcemap: true` + handler estático serve `.map`). E `GET /assets/nope.js` → **200 `text/html`**, porque
qualquer miss cai no `index.html` — isso, combinado com o service worker cache-first de `/assets/*`, pode
gravar HTML na URL do JS e quebrar o app naquele dispositivo até limpar o cache.
**Correção:** desligar sourcemap no build de produção (ou bloquear `.map` no servidor) e só usar o
fallback SPA para navegação/rotas sem extensão; asset com extensão → 404. ~10 linhas + teste.

### P0-4 — Proximidade e velocidade não são impostas pelo servidor

**Medido:** um cliente saltou de 688 px para 1300 px (19 tiles) numa única mensagem — o servidor valida
parede, mas não distância por passo. E `signal` é relayado para qualquer jogador a qualquer distância;
no cliente, **qualquer `offer` cria peer** (`useMedia.ts:422-432`), que responde ICE (expõe IP) e envia
câmera/mic se estiverem ligados. Ou seja: "só conecta perto" é honra do cliente, não contrato.
**Correção:** `MAX_STEP` de ~240 px por `move` (ignorar salto) e no relay de `signal` comparar distância,
exceto quando um dos dois está com `screenSharing`. ~15 linhas + testes. Isso vira o modelo de
**host/moderação** da Fase H1.

### P0-5 — Sala cheia e reconexão: vaga-fantasma + mensagem errada

Fechar aba/reload não manda `leave`; o servidor mantém a vaga por 30 s e o heartbeat pode levar até 60 s
para detectar queda → **até ~90 s** de vaga fantasma. Medido: 5 conectados + 1 que fechou a aba = o 7º
recebe `room_full`. Pior: `room_full`/`protocol_mismatch` não são tratados como terminais — o cliente
descarta o texto específico, entra em "Reconectando…", tenta 10 vezes por ~70 s e termina com
"Conexão perdida, verifique sua internet". **Correção:** no join cheio, despejar a entrada desconectada
mais antiga; guardar a mensagem de `error` e parar a reconexão em erro fatal; mandar `leave` no
`pagehide` (`sendBeacon` não serve p/ WS; mensagem final + grace curto). ~2–3 h.

### P0-6 — `connect()` sem guarda: jogador fantasma

**Cenário:** Enter duas vezes rápido no campo Nome; a segunda chamada vê o socket em `CONNECTING` (não
`OPEN`), cria outro e sobrescreve `this.socket`. O servidor cria **dois jogadores**; o socket órfão ocupa
uma das 6 vagas e, ao fechar, chama `stopTimers()` sem checar identidade — derruba os timers do socket bom
e dispara reconexão em cascata. **Correção:** guardar a promise em voo (`if readyState !== CLOSED return
pending`) e no `onclose` só agir se `this.socket === socket`. ~15 linhas.

### P0-7 — Token de sessão só em memória

Em sala cheia, dar F5 cria jogador **novo** com o slot antigo ainda em grace → `room_full` na própria
sala por ~30 s. **Correção:** guardar o token em `sessionStorage` e reenviar no primeiro `join` após
reload (limpar no `disconnect()`). ~10 linhas. Também reduz o problema do P0-5.

### P0-8 — Mídia mente para o usuário

Três bugs independentes com o mesmo efeito "a reunião não funciona e o app não explica":
1. **Permissão negada é terminal** (`useMedia.ts:466-494,590-610`): não há nova tentativa, nem
   `devicechange`; a toolbar e os peers continuam dizendo mic/câmera ligados sem track, e o aviso de erro
   nunca some. Se a pessoa liberar a permissão depois ou plugar headset/webcam, nada acontece até recarregar.
   **Fix:** tentar `acquireTrack` de novo ao ligar, assinar `devicechange`, limpar `mediaError` no sucesso
   e só anunciar `audioEnabled/videoEnabled` após ter/tentar o track. (M)
2. **Áudio em dobro** (`OfficeCanvas.tsx:396-399` + `VideoTile.tsx:51`): o `<video>` do avatar não é
   `muted` e o mesmo stream também toca no `<audio>` oculto → volume errado e `setSinkId` vale só em um.
   **Fix:** uma prop (`muted`). (S)
3. **`/join` pode abrir mudo** (`App.tsx:36-52`, `useMedia.ts:307-313`): `audioEl.play()` é chamado uma
   vez com stream vazio e o erro é engolido; sem retry em gesto nem botão "ativar som". Depende do
   navegador (Safari/iOS é o caso clássico) — **testar manualmente em Safari iOS**. **Fix:** unlock no
   primeiro gesto + aviso "Toque para ouvir" se `play()` rejeitar. (S)

### P0-9 — O anel "quem está falando" nunca acende

`createPeer()` cria `createMediaStreamSource(session.stream)` quando o stream remoto ainda está **vazio**.
Sonda no Chrome (feita neste checkup): `createMediaStreamSource(MediaStream vazio)` lança
`InvalidStateError`; o `catch` engole e `session.analyser` fica `null` para sempre → RMS sempre 0,
`dataset.speaking` vazio, nenhum avatar ganha anel. O item J1.6 do `QOL_AND_JUICE.md` está marcado como
entregue — não está. **Correção:** criar o analyser dentro de `pc.ontrack` quando chegar track de áudio
(`new MediaStream([track])`) e desconectar no `closePeer`. ~20 linhas.

### P0-10 — Nenhum header de segurança

Medido em `/room`, `/`, `/site/*` e `/client-config.json`: só `content-type`, `cache-control: no-store`
e `nosniff`. Sem `X-Frame-Options`/CSP header (`frame-ancestors` não funciona em `<meta>`), sem
`Referrer-Policy` (vaza `?name=`), sem `Permissions-Policy`. Qualquer site pode embutir `/room` num iframe
e sobrepor o botão de câmera/mic/tela. **Fix:** `SECURITY_HEADERS` nos 3 `writeHead` +
`content-security-policy: frame-ancestors 'none'` também na landing. ~15 linhas.

### P0-11 — TURN/ICE: credencial pública e config que quebra mídia

Se `ICE_SERVERS` for configurado no formato documentado (`username`/`credential` estáticos), o
`/client-config.json` entrega a credencial TURN em texto puro para qualquer visitante — relay do dono
usável por terceiros. E `ICE_SERVERS` não é validado: medido `[{"urls":123}]` servido igual, com log
"configurado"; `RTCPeerConnection` lança e voz/vídeo param para todos com `/healthz` verde.
**Fix:** validar cada entrada (`stun:`/`turn:` string ou array) e cair no default com erro explícito;
gerar credencial efêmera estilo coturn REST (`HMAC-SHA1` com `TURN_SECRET`, ~20 linhas) quando houver
secret; **decisão pendente**: existe `TURN_SECRET`/coturn ou é relay público compartilhado? Se for
público, documentar o risco e não tratar como segredo.

### P0-12 — Processo: CI não versionado e regressões invisíveis

`.github/workflows/ci.yml` existe no working tree mas **não está no git** (`git ls-files .github` = 0) —
o badge do README aponta para um workflow que não roda. Os 34 testes passam **com todos os achados acima
presentes**; não há teste de `Origin`/headers/cap/conexão/flood, e o CI nunca roda `docker build`.
**Fix:** commitar o workflow, adicionar 6–8 testes de abuso (upgrade com Origin estranho, cap de sockets,
timeout de join, flood de signal, asset 404, headers) e um passo de `docker build` (ou smoke do
`dist/online/server.cjs`). ~4 h.

---

## 4. P1 — Should fix (2–3 semanas, depois do P0)

| # | Achado | Onde | Fix mínimo | Esforço |
|---|---|---|---|---|
| P1-1 | Assets com hash em `no-store` e sem gzip (322 KB vs 101 KB) | `server.ts:115-120` | `immutable` p/ `/assets/*`, gzip p/ texto | 1 h |
| P1-2 | Chat/soundboard somem em silêncio na reconexão (e o app diz "enviado") | `connection.ts:214-238` | `sendChat` retorna `false`, manter texto + aviso | 2 h |
| P1-3 | Cada `move` re-renderiza App+Office+Canvas (~66 updates/s com 6 pessoas; número analítico) | `state/store.ts:75-112` | assinatura seletiva do slice `players` | 1 d |
| P1-4 | Canvas redesenha 459 tiles e recria gradiente por frame | `OfficeCanvas.tsx:350-357`, `scene.ts:546-567` | piso pré-renderizado em offscreen + vinheta cacheada | 1 d |
| P1-5 | Screen share sem `contentHint`/bitrate: até 5 encodes, ~5–12 Mbps de upload (analítico) | `useMedia.ts:533-554` | cap 720p/15 fps + `setParameters` por peer | 1 d |
| P1-6 | iOS sem `getDisplayMedia` com erro genérico; 2º sharer invisível | `useMedia.ts:533`, `OfficeScreen.tsx:182` | feature-detect + lista/contador de sharers | 1 d |
| P1-7 | Foco de painéis/overlays não é gerenciado; `S` abre soundboard **e** anda para baixo | `OfficeScreen.tsx:119-142,215-248` | foco inicial + restore + `inert`; remapear `S` | 1 d |
| P1-8 | Dispositivo escolhido não persiste na web; sem `devicechange` | `desktop.ts:88-91`, `useMedia.ts:122-129` | persistir ids em `localStorage` + hot-plug | 1 d |
| P1-9 | PWA: navegação sem timeout = tela branca no cold start; cache nunca versionado e pode gravar HTML como JS | `client/public/sw.js:8,38-62` | timeout 3,5 s → shell; cache por build; filtrar content-type | 0,5 d |
| P1-10 | Sem observabilidade: só log de boot, `/healthz` fixo "ok", erros engolidos | `server.ts:157-159,282,309-311` | logs JSON de join/leave/room_full/erro + `/healthz` com players/uptime | 1 d |
| P1-11 | Nome duplicado e caracteres invisíveis/bidi permitidos (impersonação) | `validation.ts:12,27-33` | estender controle + sufixar nome repetido | 1 h |
| P1-12 | Docker roda como root; `CLIENT_DIR` errado sobe "saudável" e app 404; fallback de porta mascara porta ocupada no PaaS | `Dockerfile`, `online/main.ts:45-48` | `USER node`, checar `index.html` no boot, falhar rápido quando `online` | 2 h |
| P1-13 | HUD diz "câmera pausada" no share, mas a câmera continua capturando | `useMedia.ts:670-704`, `MediaHealthHud.tsx:20-28` | `enabled=false` enquanto compartilha (ou corrigir o texto) | 1 h |
| P1-14 | Zero unit para `connection.ts`/`store.ts`/`soundboard.ts`/`online/main.ts`; 3 harness duplicate ~250 linhas | `tests/unit`, `deploy/*.mjs` | extrair `tests/harness`, unit de reconnect com fake timers | 1–2 d |

---

## 5. P2 — Limpeza, ghost code e organização (contínuo)

### 5.1 Ghost/dead code — ~40 linhas + 1 arquivo (remover com segurança)

- `AuthMode` (`src/shared/protocol.ts:53`): 0 usos, duplica `UserStatus`.
- `PROTOCOL_VERSION` em `src/shared/constants.ts:3`: 0 importadores (o vivo é `protocol.ts:3`) — risco de
  drift de protocolo.
- `MAX_EFFECT_DURATION_MS` (`client/src/soundboard/soundboard.ts:343`): 0 usos.
- `showNotification`/`quit` do bridge (`src/shared/bridge.ts:46,48`, preload e handlers IPC): o cliente
  web nunca chama (só `setBadge`).
- `fingerprint256`/`fingerprint()` do TLS: calculado e não consumido no runtime web (TLS é da borda).
- 29 exports sem importador externo (API interna vazando como `export`): desexportar os de uso só interno.
- `client/src/media/media.css.d.ts`: **confirmado descartável neste checkup** — `tsc --noEmit` passa sem
  ele. Deletar.
- MIME mortos (`.wasm`, `.woff`, `.ttf`, `.mjs`…) e superfície `Room` sem uso de produção: opcional.

### 5.2 Duplicações que vão divergir (dono único)

| Duplicação | Donos hoje | Dono único proposto |
|---|---|---|
| Validação de endereço LAN | `client/src/home/HomeScreen.tsx:21-39` × `src/main/address.ts` | `src/shared/lanAddress.ts` |
| Schema de perfil (hair 0..3, statuses) | `server/validation.ts`, `main/settings.ts`, `client/palette.ts`/`desktop.ts` | `src/shared/profile.ts` |
| Rotas (`/ws`, `/join`, `/room`, `/healthz`, `/client-config.json`) | 6 lugares (server, TopBar, Home, pwa, useMedia, sw.js, website) | `src/shared/routes.ts` |
| Dois composition roots com defaults diferentes | `src/online/main.ts` × `src/main/server-host.ts` | `online/` é dono do deploy; `server.ts` genérico |
| Dois servidores estáticos no mesmo arquivo | `server.ts:73-123` × `:139-153` | um `serveStatic(root, {fallback, cache})` |
| Detecção "é Electron?" 3× | `desktop.ts:9-11`, `pwa.ts:4`, `InstallPrompt.tsx:8` | só `desktop.ts` |
| Rate limit de chat no cliente e no servidor | `ChatPanel.tsx:43-52` × `room.ts:210-224` | servidor é autoridade; cliente só UX |

### 5.3 Docs desatualizados (corrigir junto)

- `docs/CONTRACTS.md`: protocolo sem `soundboard`; `StartRoomServerOptions` sem `iceServers/online/websiteDir`;
  `MediaApi` sem `localStream`/`mediaHealth`/`connectionStats`; "não edite estes arquivos" de um time que não existe.
- `docs/OFFLINE_ARCHITECTURE.md`: descreve Electron como principal; diz "sem STUN/TURN externos" e
  "nenhuma dependência externa em runtime" — a mídia web usa STUN/TURN.
- `docs/ONLINE_DEPLOY.md:14`: diz redirect `/?autojoin=1`; o código manda `/room?autojoin=1`.
- Contagens velhas: docs dizem 30 testes (são 34) e online `11/11` (é 32/32); README do workspace diz
  "31 checks".
- `docs/PWA_NOTES.md`: diz "integração pendente", mas `registerPwa()` já está no boot.
- CI/README: workflow untracked (P0-12).

### 5.4 Quarentena do Electron (a maior simplificação estrutural)

`src/main` + `src/preload` (917 linhas), `src/server/tls.ts` (98, só LAN), build/empacotamento (50) e
`tests/e2e` (850) = **1.915 linhas (~12,5% do código; ~40% de `src`)** fora do produto web; 40/368
pacotes do lock e 5/12 scripts npm são Electron. Mover para `legacy/electron/` com `package.json` próprio
e fazer o build web-only tira isso do Docker/CI, corta ~308 MB locais e elimina o caminho de build que
mais quebra sem ninguém usar. Detalhes e passos em [ARCHITECTURE.md](ARCHITECTURE.md).

### 5.5 Bugs menores (baratos, listados para não perder)

- Chat rola para o fim mesmo se o usuário está lendo histórico (`ChatPanel.tsx:31-34`) — 1 linha.
- `?name=` é ignorado se a pessoa já tem perfil salvo (`App.tsx:42-46`).
- `HEAD /healthz` cai no fallback SPA; `/join` responde 302 sem `no-store`; `og:image` da landing é
  relativo (crawlers pedem URL absoluta).
- `SettingsPanel` agenda `setSaved(false)` sem cleanup; aviso de mídia duplicado (HUD + painel).
- `validatePing` aceita `at` futuro (só bagunça a latência exibida).
- Sem lint/formatter no repo; tsconfig sem `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`; scripts `.mjs` e `sw.js` fora do `tsc`.

---

## 6. Arquitetura organizada do código

O código **já tem a espinha certa** (shared ↔ server ↔ client, cliente por feature). O que falta é
**fronteira explícita** entre produto web e legado, um dono por contrato e um composition root do
servidor. Proposta completa, com grafo de dependências, layout-alvo e migração em 8 passos ≤1 dia:
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md). Resumo:

```
src/        shared/ (contratos puros) · server/ (HTTP+WSS+sala) · online/ (único dono de env/deploy)
client/src/ session/ (store, net, desktop-bridge, home) · office/ media/ chat/ soundboard/ · ui/ styles/
tests/      unit/ · harness/ (Playwright compartilhado) · e2e/ (legado)
legacy/electron/  main, preload, build-main, electron-builder, e2e, docs Electron
```

**Se só der para fazer 3 movimentos:** (1) quarentena Electron + build web-only; (2) dono único de
rotas/perfil/endereço LAN e um só static handler; (3) higiene de ghost code + corrigir docs/contratos
(a lista está pronta na seção 5). Nada de monorepo, framework novo ou refactor de CSS.

---

## 7. Roadmap web-first

Plano de produto em 3 horizontes, com critérios de aceite, esforço e "próximos 14 dias":
[`docs/ROADMAP_WEB.md`](ROADMAP_WEB.md). Resumo:

- **H0 "web confiável" (~1–2 semanas):** fechar os P0 acima + deploy público validado + observabilidade
  + headers/cache + cold start + CI versionado. É o gate para mandar o link.
- **H1 "web útil no dia a dia" (2–4 semanas):** host/moderação v1 (kick, mute-pedido, trancar), mídia de
  reunião (presets, teste de mic, hot-plug, PTT/deafen, volume por pessoa, áudio da tela), persistência de
  contexto, presença/chat (digitando, mão, emotes, links/@menções), mapa navegável.
- **H2 "ferramentas web diferenciadas" (só com demanda medida):** timer compartilhado, enquete, quadro de
  recados. Whiteboard completo: **não agora**. "Não construir": contas/billing, apps nativos, gravação,
  upload no chat, música via YouTube/Spotify, Electron novo.
- **Mobile/desktop:** congelados como *keep-alive* — gates continuam verdes (`verify-pwa` 17/17,
  `verify-mobile` 27/27, e2e Electron local 17/17), mas sem feature nova nem polish.

---

## 8. Ordem de execução sugerida

**Onda 1 (dias 1–4) — P0.** Servidor primeiro (é o que protege todos): P0-1/2/3 → P0-4/5 → P0-10/11/12;
cliente em paralelo: P0-6/7 → P0-8/9. Gate: `npm run typecheck`, `npm test` (+6–8 testes novos),
`verify-online`, `verify-pwa`, `verify-mobile`, e2e local 17/17.

**Onda 2 (semanas 2–3) — P1.** Performance (P1-3/4), mídia (P1-5/6/8/13), acessibilidade (P1-7),
PWA/cold start (P1-9), observabilidade (P1-10), identidade (P1-11), CI/Docker (P1-12), testes (P1-14).
Gate: os mesmos + screenshots e `docs/VERIFICATION.md` atualizados com os checks novos.

**Onda 3 (contínuo) — P2.** Ghost code + docs (1 dia, risco quase zero), contratos com dono único,
quarentena Electron; depois decidir multi-room com dados reais (H1.6 do roadmap).

**Decisões abertas (donas):** (a) limite por IP atrás do Render — confiar em `X-Forwarded-For`?
(recomendo `TRUST_PROXY=1`); (b) TURN tem `TURN_SECRET`/coturn ou é relay público compartilhado?;
(c) sourcemap off em produção (recomendo) ou mapas só para observabilidade; (d) mobile "keep-alive"
confirmado (recomendo) vs investir em touch.

---

## 9. Não verificado (honestidade do checkup)

- **Deploy real**: Docker não está instalado nesta máquina; Render/TLS de borda/healthcheck do container/
  cold start/limites do proxy não foram exercitados. Headers do proxy podem reduzir parte do P0-10.
- **Rede real**: NAT/TURN, duas máquinas, câmera/mic reais e qualidade de áudio/vídeo não testados
  (mídia fake + loopback). Screen share no navegador web não tem teste automatizado.
- **Navegadores**: só Chrome 156 (Safari/Firefox/celular real não). O P0-8.3 (autoplay) e `setSinkId`
  dependem do navegador — exigem teste manual em Safari iOS.
- **Carga**: floods foram loopback local, não k6/soak; números de CPU/egress são estimativas.
- **Perf do cliente**: C7/C8/C10 são análise de código + constantes, não perfil de FPS/CPU/banda.
- **CI**: workflow não versionado e não rodou no GitHub; `npm ci` limpo não refeito.
- **Acessibilidade**: análise de fluxo de foco, sem leitor de tela real; cobertura da suíte é de landing
  e controles touch, não dos painéis.
- **Electron/LAN**: só o e2e existente; não é mais o produto.

---

## 10. Evidências (anexos)

| Arquivo | Conteúdo |
|---|---|
| [`docs/audit/server.md`](audit/server.md) | 19 achados do servidor/infra, com probes HTTP/WS reais (400 mensagens, 41 sockets, Origin, headers, cache) |
| [`docs/audit/client.md`](audit/client.md) | 20 achados do cliente (6 Must), fluxos de reconexão/WebRTC/canvas/PWA/acessibilidade |
| [`docs/audit/architecture.md`](audit/architecture.md) | grafo de módulos, drift/duplicação, inventário ghost/legacy quantificado, alvo + 8 passos |
| [`docs/audit/verification.md`](audit/verification.md) | rodada completa: comandos, contagens, tempos, tamanhos de bundle, cobertura da automação, riscos |
| [`docs/audit/roadmap.md`](audit/roadmap.md) | proposta de roadmap web-first detalhada, decisões e depriorização |

Cada anexo termina com "Não verificado" próprio. O consolidado acima deduplica e prioriza; em caso de
divergência, o anexo com a medição (números) vence o anexo analítico.
