# Auditoria — servidor web e infra online (DittoApp)

Auditoria **somente leitura** de `src/server/**`, `src/online/main.ts` e deploy (Docker/Render/CI).
Data: 2026-10-28. Baseline já verde: `npm run typecheck` ok, `npm test` 34/34. Nada foi alterado.

Achados foram confirmados rodando o próprio bundle (`dist/online/server.cjs`, porta efêmera, loopback)
com sondas de WebSocket/HTTP, além de leitura do código. Onde digo "medido", é o número que a sonda
devolveu nesta máquina.

---

## O que este servidor faz:

- Um processo Node HTTP serve **estático** de `dist/client` (cliente web compilado) com fallback SPA
  (qualquer rota desconhecida → `index.html`) e, se `website/` existir, a **landing** em `/` e
  `/site/*` (`src/server/server.ts:73-194`).
- Rotas: `GET /healthz` (texto "ok"), `GET /client-config.json` (`online`, `roomName`, `iceServers`),
  `GET /join` → 302 `/room?autojoin=1`, `/` (landing quando configurada), `/room` e assets
  (`src/server/server.ts:155-194`).
- **WSS em `/ws`** (`src/server/server.ts:246-318`): **uma sala em memória** por deploy, até 6
  jogadores. Valida `join` (protocolo, perfil, sessão), `move` (colisão compartilhada com o cliente),
  `chat`, `profile`, `media`, `signal` (relay WebRTC P2P), `soundboard` (chunks base64), `ping`.
  Limita `move`/`chat`/`soundboard` por conexão, mantém vaga por 30 s para retomada de sessão
  (`src/server/room.ts`), faz heartbeat de 30 s e encerra no SIGTERM.
- **Não** guarda chat, arquivos ou mídia; não tem login. Reiniciar o processo = sala zerada.
- Áudio/vídeo são P2P: o servidor só troca SDP/ICE e flags; não carrega mídia
  (`docs/ONLINE_DEPLOY.md:1-21`).

**Carga assumida:** 1 sala pública de até 6 pessoas, link aberto na internet, TLS na borda
(Render/Caddy), **clientes não confiáveis** (qualquer script com o link), churn de reconexão
(reload/queda curta), 1 instância free do Render (pouca CPU/RAM, dorme após ~15 min, cold start de
30–60 s — `docs/ONLINE_DEPLOY.md:76-108`). O servidor é single-thread: um cliente abusando de
CPU/banda para a sala inteira.

---

## Resumo dos achados

**19 achados:** 3 Must fix, 10 Should fix, 6 Nice to have. **5 itens menores** ficaram de fora
(listados no fim). Estimativa total: **~30 h de dev (~4 dias)** para Must + Should; Nice ~4 h.
Todos os números "medidos" abaixo são de sonda local contra o bundle real.

| # | Grupo | Achado | Onde |
|---|---|---|---|
| 1 | Must | Sem orçamento de mensagens/bytes; soundboard relayado para todos | `src/server/room.ts:179-231` |
| 2 | Must | Sem cap de conexões, sem timeout de join, sem limite por IP | `src/server/server.ts:246-318` |
| 3 | Must | WSS aceita qualquer Origin/Host (CSWH + DNS rebinding) | `src/server/server.ts:249-263` |
| 4 | Should | Movimento sem limite de passo (teleporte) | `src/server/room.ts:188-195` |
| 5 | Should | Nenhum header de segurança (clickjacking; landing sem CSP) | `src/server/server.ts:63-71` |
| 6 | Should | `signal` sem filtro de proximidade (IP/câmera para longe) | `src/server/room.ts:226-231` |
| 7 | Should | Rate limit por conexão reseta com leave + novo join | `src/server/room.ts:137-146` |
| 8 | Should | Aba fechada ocupa vaga até ~90 s → `room_full` falso | `src/server/room.ts:122-124` |
| 9 | Should | Asset inexistente vira 200 HTML e o SW cacheia como JS | `src/server/server.ts:104-113` |
| 10 | Should | Credenciais TURN estáticas entregues a qualquer visitante | `src/server/server.ts:133-137` |
| 11 | Should | `ICE_SERVERS` sem validação quebra voz/vídeo sem aviso | `src/online/main.ts:19-33` |
| 12 | Should | Assets hashed com `no-store` e sem compressão | `src/server/server.ts:115-120` |
| 13 | Should | Testes/CI não cobrem abuso e não buildam a imagem Docker | `tests/unit/server.test.ts` |
| 14 | Nice | Sem logs de acesso/erro/abuso (falhas silenciosas) | `src/server/server.ts:282,309-311` |
| 15 | Nice | Nome duplicado e caracteres invisíveis/bidi permitidos | `src/server/validation.ts:12,27-33` |
| 16 | Nice | Token de sessão é bearer reutilizável por 30 s | `src/server/room.ts:107-118` |
| 17 | Nice | Código morto/indireções no servidor | `src/server/room.ts:48-60,267` |
| 18 | Nice | Imagem Docker roda como root; sourcemaps públicos (1,4 MB) | `Dockerfile:15-24`, `client/vite.config.ts:15` |
| 19 | Nice | `CLIENT_DIR` errado não falha no boot (healthz verde, app 404) | `src/online/main.ts:45-48` |

---

## Must fix

### 1. Sem orçamento de mensagens/bytes: `signal`, `profile`, `media` sem limite e `soundboard` relayado para a sala inteira
**Onde:** `src/server/room.ts:196-231` (profile/media/signal), `src/server/room.ts:179-187`
(soundboard → todos), `src/server/server.ts:283-311` (dispatch sem limite global),
`src/shared/constants.ts:25-28,39-40`.
**O que acontece:** só `move` (40/s), `chat` (8/5 s) e `soundboard` (200 chunks/2 s) têm rate limit.
`profile` e `media` são broadcast para todos (5 envios por mensagem = 5× egress) e `signal` (SDP de até
12 KB) é relayado para o alvo — todos **sem limite nenhum**. `soundboard` vai para **todos** os
jogadores, inclusive longe (o cliente descarta longe em `client/src/soundboard/soundboard.ts:272-278`,
então a banda já é gasta). Medido: 400 `profile` em 806 ms → o outro cliente recebeu **400**
`playerUpdated` (no mesmo teste, 40 `chat` → só **8** entregues); 300 `signal` de ~12 KB → o alvo
recebeu **3,5 MB em 721 ms**; 1 clip de soundboard (64 chunks) → peer **longe** recebeu **0,67 MB**
em base64. Frames com JSON inválido também não gastam orçamento nenhum (parseados e descartados).
**Correção mínima:** um token bucket único por conexão/IP aplicado no `ws.on("message")` **antes** do
`JSON.parse` (ex.: 100 frames/s e 64 KB/s de relay por cliente; 6 clientes = teto previsível) +
relayar `soundboard` só para jogadores dentro de `PROXIMITY_EXIT_TILES` (o servidor tem as posições).
~30-40 linhas em `room.ts`/`server.ts` + testes. Baixar `SOUNDBOARD_RATE_MAX` para caber no orçamento.
**Esforço:** 3-4 h.
**Risco se ignorar:** 1 pessoa com o link derruba a sala para os 6 (CPU de JSON + ~25 MB/s de egress
estimado: 5 peers × 5 MB/s) e pode estourar banda/cota do Render; é a forma mais barata de DoS.

### 2. Sem limite de conexões, sem limite por IP e socket que nunca faz `join` fica aberto para sempre
**Onde:** `src/server/server.ts:246` (`WebSocketServer` sem cap), `src/server/server.ts:249-263`
(upgrade sem cap), `src/server/server.ts:265-318` (nenhum timer de join), `src/server/server.ts:199-201`
(`http.createServer` sem `maxConnections`), `src/server/room.ts:122-124` (cap da sala só depois do join).
**O que acontece:** qualquer número de conexões WS é aceito; quem conecta e não manda `join` fica
conectado indefinidamente (o heartbeat manda ping e o navegador responde pong sozinho). Medido: **40 sockets** abertos sem `join` (mais 1 já na sala), todos aceitos. Não há limite por IP em lugar nenhum: um único IP pode
ocupar as **6 vagas** (sem login) e negar a sala para todos — e o mesmo IP pode manter milhares de
sockets abertos. Atrás do Render o IP do socket é o da borda, então limite por IP exige confiar em
`X-Forwarded-For` (decisão a tomar).
**Correção mínima:** `server.maxConnections = 128`; no `upgrade`, se `wss.clients.size >= 64` →
resposta 503 e destroy; timer de 10 s por conexão: sem `join` → `close(1008)`; contadores por IP
(2 sockets, 3 jogadores) usando o IP do proxy somente quando a variável de ambiente disser que há
proxy (ex.: `TRUST_PROXY=1`). ~40 linhas.
**Esforço:** 3-4 h.
**Risco se ignorar:** DoS trivial da instância free (OOM/fd) e sequestro das 6 vagas por um bot —
a sala fica indisponível sem nenhum esforço.

### 3. Upgrade WSS aceita qualquer `Origin`/`Host` (Cross-Site WebSocket Hijacking + DNS rebinding)
**Onde:** `src/server/server.ts:249-263` (upgrade não olha headers); rotas HTTP também não validam
`Host` (`src/server/server.ts:155-194`).
**O que acontece:** o handshake WS ignora `Origin`. Medido: conectei com
`Origin: https://evil.example` e o servidor aceitou, deu `welcome` e o jogador entrou na sala. Como
WebSocket não tem CORS, **qualquer site** pode fazer o navegador de cada visitante entrar na sala
pública às escondidas: ocupar as 6 vagas, ler chat/estado da sala, spammar e disparar sinalização.
Variante DNS rebinding: domínio do atacante resolve para o IP do deploy, a página fica "same-origin" e
consegue ler respostas HTTP (`/client-config.json`, HTML).
**Correção mínima:** no `upgrade`, se houver `Origin`, parsear e exigir `origin.host === req.headers.host`
(ou allowlist `PUBLIC_URL`); sem `Origin` é permitido (clientes não-browser e testes). ~10 linhas
+ 2 testes. Opcional: mesma checagem nas rotas HTTP.
**Esforço:** 1 h.
**Risco se ignorar:** bot/qualquer página sequestra as vagas da sala e exfiltra o chat usando os
navegadores dos visitantes, sem precisar de infraestrutura própria.

---

## Should fix

### 4. Movimento sem limite de passo: o cliente teleporta (o servidor só valida parede)
**Onde:** `src/server/room.ts:188-195`, `src/server/validation.ts:89-96`,
`src/shared/collision.ts:58-62`.
**O que acontece:** o servidor recalcula colisão, mas aceita **qualquer coordenada alvo** (sem
máximo de distância por mensagem). Medido: saltos de **688 → 1300 px** (612 px ≈ 19 tiles) em uma
mensagem, espaçadas 80 ms. Um script atravessa o mapa instantaneamente, "aparece" ao lado de qualquer
conversa (proximidade dispara áudio/vídeo automaticamente e troca de IP via ICE) e some.
`CONTRACTS.md:68` diz que o servidor recalcula a posição — correto para paredes, mas não para
velocidade, então a autoridade sobre movimento é parcial.
**Correção mínima:** no handler de `move`, se `hypot(target - posição_atual) > MAX_STEP` (ex.: 240 px,
cobre lag/batch legítimo), **ignorar** o movimento (ou cravar na posição atual) — ~5 linhas + teste.
**Esforço:** 1 h.
**Risco se ignorar:** modelo de proximidade (privacidade de conversa) burlado por qualquer script;
griefing e "teleporte" para cima de grupo.

### 5. Nenhum header de segurança nas respostas (clickjacking; landing sem CSP)
**Onde:** `src/server/server.ts:63-71` (`send`), `:115-120` (estático), `:142-147` (`serveFile`),
`:165-168` (`/join`); `website/index.html:1-17`; `client/index.html:7-10`.
**O que acontece:** medido em `/room`, `/`, `/site/styles.css` e `/client-config.json`: só
`content-type`, `cache-control: no-store`, `x-content-type-options: nosniff` (+ headers do Node).
O app se protege com CSP via `<meta>` (`client/index.html:8-10`) — mas `frame-ancestors` **não existe
em meta**, e a **landing não tem CSP nenhuma**. Ninguém envia `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy` nem HSTS. Qualquer site pode embutir `/room` em iframe e sobrepor botões
(clickjacking de camera/mic/compartilhar tela/"sair"), e URLs com `?name=Ana` vazam em `Referer`.
**Correção mínima:** um `const SECURITY_HEADERS` espalhado nos 3 `writeHead`: `x-frame-options: DENY`,
`content-security-policy: frame-ancestors 'none'` (e a mesma política do meta no HTML, inclusive para
a landing), `referrer-policy: no-referrer`,
`permissions-policy: camera=(self), microphone=(self), display-capture=(self)`. HSTS depende do proxy
(documentar/checar). ~15 linhas.
**Esforço:** 1 h.
**Risco se ignorar:** clickjacking para ligar câmera/microfone ou compartilhar tela; vazamento de
nome/URL em referrer; landing sem defesa de injeção.

### 6. `signal` sem filtro de proximidade no servidor (IP e mídia para quem está longe)
**Onde:** `src/server/room.ts:226-231`; cliente em `client/src/media/useMedia.ts:422-432`.
**O que acontece:** `signal` é relayado para qualquer jogador, a qualquer distância. No cliente,
**qualquer `offer` recebido cria um peer** (`handleSignal` → `createPeer(from)`) sem checar distância:
um jogador malicioso longe manda offer para a vítima, ela responde/gatheriza ICE (vaza IP público) e,
se câmera/mic estiverem ligados, envia mídia para o atacante — quebrando a promessa de "só conecta
perto". O servidor conhece as posições dos dois, então dava para impor isso.
**Correção mínima:** no relay de `signal`, calcular a distância em tiles entre `entry.state` e o alvo;
descartar se `> PROXIMITY_EXIT_TILES` e nenhum dos dois estiver com `screenSharing` (screen share
conecta todos de propósito). ~10 linhas + teste. Alternativa mais barata (dono do cliente): uma
checagem de distância em `handleSignal`.
**Esforço:** 1-2 h.
**Risco se ignorar:** IP e câmera/mic expostos para qualquer "colega" distante/eavesdropper; contrato
de proximidade do produto não vale para clientes modificados.

### 7. Rate limit é por conexão e reseta com `leave` + novo `join`
**Onde:** `src/server/room.ts:137-146` (limiters dentro do `Entry`), `:189-190` (move), `:210-212`
(chat), `:179-181` (soundboard); contrato em `docs/CONTRACTS.md:66-73`.
**O que acontece:** os contadores vivem na entrada do jogador; `leave` remove a entrada na hora
(`room.ts:175-177,241-243`) e um novo join cria limiters zerados. Medido: **32 mensagens de chat
entregues em 848 ms** (limite nominal: 8/5 s) alternando 4 conexões curtas (8 chats + `leave` +
fechar). O mesmo vale para `move` (40/s por conexão) e para o teto de soundboard. Basta não estar com
a sala cheia; com 6 pessoas o atacante recicla a própria vaga.
**Correção mínima:** mover os contadores para fora do `Entry`: um `Map` por sala chaveado pelo token
de sessão (sobrevive ao rejoin) ou por IP; alternativamente um orçamento único da sala. ~30-40 linhas
+ testes.
**Esforço:** 2 h.
**Risco se ignorar:** todo anti-spam existente é contornável com reconexão; chat flood e movimento
contínuo continuam possíveis mesmo com os limites atuais.

### 8. Aba fechada/quedra ocupa vaga por até ~90 s: o 7º com o link recebe `room_full`
**Onde:** `src/server/room.ts:122-124` (checagem de sala cheia conta desconectados),
`:245-258` (`detach` + grace 30 s), `src/server/server.ts:38,320-334` (heartbeat 30 s → detecta morte
em até 60 s).
**O que acontece:** medido: 5 jogadores conectados + 1 que fechou a aba (socket fechou, sem `leave`) →
o 7º que abre o link recebe **`room_full`**. O cliente só manda `leave` em desconexão explícita
(`client/src/net/connection.ts:262-275`); fechar aba/reload não manda — e o token de sessão só existe em
memória (`connection.ts:36`), então um **reload** vira jogador novo e a própria vaga-fantasma bloqueia
por até 30 s (o cliente tenta de novo sozinho no backoff). Pior caso geral: rede caiu sem detecção
(até 60 s de heartbeat) + 30 s de grace = **~90 s** de vaga fantasma. Numa sala de 6 isso aparece com
frequência.
**Correção mínima:** no `join`, se a sala estiver cheia, despejar a entrada desconectada mais antiga
se existir (em vez de recusar) e avisar via `playerLeft`; cliente pode ainda mandar `leave` no
`pagehide` (dono do cliente, `sendBeacon`/mensagem final). ~15 linhas + teste.
**Esforço:** 1 h (servidor) / 1-2 h com a parte do cliente.
**Risco se ignorar:** "sala cheia" falso por até 90 s logo depois de um reload/queda, expulsando quem
chegou pelo link.

### 9. Asset inexistente cai no fallback SPA (200 HTML) e o service worker cacheia HTML como JS
**Onde:** `src/server/server.ts:104-113` (qualquer miss → `index.html`), `:115-120`;
`client/public/sw.js:55-62` (`asset()` cacheia qualquer `response.ok`), `:66-70`.
**O que acontece:** medido: `GET /assets/nao-existe.js` → **200 `text/html`** (index). Se uma aba
antiga/SW com shell velho pedir um chunk que sumiu (deploy novo), recebe HTML com `nosniff` → módulo
bloqueado; o SW grava esse HTML **na URL do JS** (`cache.put` com `ok`) e a aba fica quebrada até
limpar cache. Também esconde 404 reais de monitoração/asset errado.
**Correção mínima:** só cair no `index.html` quando o request aceita HTML (navegação/rotas sem
extensão); para `/assets/*` ou caminho com extensão de asset conhecida responder **404**. ~8 linhas.
**Esforço:** 30-60 min + teste.
**Risco se ignorar:** app quebrado para parte dos usuários depois de deploy (cache envenenado) e
404s invisíveis.

### 10. Credenciais TURN estáticas entregues a qualquer visitante em `/client-config.json`
**Onde:** `src/server/server.ts:133-137,161-163`; `src/online/main.ts:19-33`;
`docs/ONLINE_DEPLOY.md:59-74` (jeito documentado de configurar TURN).
**O que acontece:** no formato documentado
`ICE_SERVERS='[{"urls":"turn:...","username":"u","credential":"p"}]'`, o servidor devolve
`username`/`credential` em texto puro para **qualquer** requisição (não há login). Quem abrir o link
copia as credenciais e usa o relay (banda do dono) de qualquer lugar, indefinidamente. As opções
gratuitas recomendadas na doc (ex.: Metered Open Relay) têm credenciais compartilhadas e justamente
por isso são abusáveis.
**Correção mínima:** credencial efêmera estilo coturn REST: `username = "<expiração>:<id>"`,
`credential = base64(HMAC-SHA1(TURN_SECRET, username))` gerada por request quando `TURN_SECRET`
existir (`node:crypto`, sem dep nova, ~20 linhas); senão documentar "TURN público compartilhado = credencial
pública". 
**Esforço:** 1-2 h.
**Risco se ignorar:** relay usado/abusado por terceiros (banda e custo); revogar credencial derruba a
mídia do deploy inteiro.

### 11. `ICE_SERVERS` não é validado: config errada quebra voz/vídeo sem aviso
**Onde:** `src/online/main.ts:19-33` (`parsed as IceServerConfig[]`, sem checagem de forma);
`client/src/media/useMedia.ts:201-210,275` (`new RTCPeerConnection({ iceServers })`).
**O que acontece:** medido: com `ICE_SERVERS='[{"urls":123},{"urls":"turn:so-tem-isto"}]'` o servidor
subiu, logou **"ice: ICE_SERVERS configurado"** e `/client-config.json` devolveu
`[{"urls":123},...]` igual. `RTCPeerConnection` lança em `urls` inválido → `createPeer` estoura no hook
de mídia → voz/vídeo (e possivelmente a tela) param de funcionar para todos, com health check verde e
log otimista. JSON que não é array (ex.: um objeto) cai no split por vírgula e vira URLs lixo,
silenciosamente.
**Correção mínima:** validar cada entrada: `urls` string ou array não-vazio de strings
`stun:`/`turn(s):`; em caso inválido, logar erro explícito e cair no `DEFAULT_ICE` (ou falhar no boot).
~20 linhas + teste.
**Esforço:** 30-60 min.
**Risco se ignorar:** deploy público com mídia quebrada depois de um typo no painel de env, sem
diagnóstico.

### 12. Assets com hash servidos com `no-store` e sem compressão
**Onde:** `src/server/server.ts:115-120,142-147` (`cache-control: no-store` em tudo),
`:41-61` (MIME), `:63-71`.
**O que acontece:** medido: `/assets/index-*.js` = **321.870 B** com `cache-control: no-store` e **sem
`content-encoding`** (101.242 B se gzip: 3,2×); CSS 28.095 B → 6.609 B gzip; `office.jpg` da landing
(164 KB) também `no-store`. Todo primeiro acesso (e todo reload sem service worker: janela anônima,
primeira visita, landing) paga ~350 KB em vez de ~110 KB. O SW cacheia `/assets/*` depois do primeiro
load, então o custo é principalmente de aquisição/retenção de usuário e banda do Render.
**Correção mínima:** `/assets/*` (nome com hash) → `cache-control: public, max-age=31536000, immutable`;
`/site/*` → `max-age=300`; HTML/`sw.js`/`client-config.json` seguem `no-store`; gzip para MIME de
texto quando `Accept-Encoding` incluir gzip (usar `zlib`; ou confirmar que o proxy comprime).
~20 linhas.
**Esforço:** 1 h.
**Risco se ignorar:** primeiro load ~3× mais lento no celular/3G e egress desnecessário na instância
free.

### 13. Testes/CI: caminhos de abuso sem teste e Dockerfile nunca é buildado
**Onde:** `tests/unit/server.test.ts` (819 linhas: validação/room/WS felizes e inválidos),
`.github/workflows/ci.yml:42-58`, `docs/ONLINE_DEPLOY.md:155` ("Dockerfile não foi testado
localmente").
**O que acontece:** os 34 testes passam **com todos os achados acima presentes**. Não há teste para:
`Origin`/`Host`, headers de segurança, cap de conexões/timeout de join, flood de
`signal`/`profile`/`media`, resets por rejoin, fallback de asset para 404, `/join`,
`/client-config.json` e `website/` (esses dois só no e2e de `deploy/verify-online.mjs`). O CI também
não roda `docker build`, então quebra de imagem (COPY/npm ci/build) só aparece no deploy.
**Correção mínima:** 6-8 testes no `server.test.ts` para os caminhos de abuso + um passo
`docker build -t dittoapp .` (ou smoke `node deploy/build-online.mjs && node dist/online/server.cjs`)
no CI. ~4 h.
**Esforço:** 3-4 h (dev) + ~10 min de CI.
**Risco se ignorar:** os fixes de Must/Should regridem sem ninguém notar; deploy quebrado descoberto
pelos usuários.

---

## Nice to have

### 14. Sem logs de acesso/erro/abuso: falhas todas silenciosas
**Onde:** `src/server/server.ts:282` (erro de WS → `undefined`), `:288-290` (JSON inválido →
`return`), `:309-311` (catch geral), `:188-193` (500 sem log), `:320-334` (heartbeat derruba sem log);
`src/online/main.ts:61-66` (só log de boot).
**O que acontece:** em deploy público não há **nenhum** sinal de: joins recusados (sala cheia,
protocolo), origens que seriam bloqueadas, rate limits acionados, conexões derrubadas por
heartbeat/buffer, requests com 500. Quando a sala "para", não dá para saber se foi abuso, queda de
rede ou bug. (Não logar IP é bom para privacidade — manter assim.)
**Correção mínima:** logar eventos contados (1 linha/min): conexões abertas/fechadas, joins por
resultado, mensagens descartadas por rate limit, terminations; sem IP completo (hash/truncado se
precisar). ~20 linhas.
**Esforço:** 1-2 h.
**Risco se ignorar:** incidente em produção sem diagnóstico; abuso passa despercebido.

### 15. Nome duplicado e caracteres invisíveis/bidi permitidos
**Onde:** `src/server/validation.ts:12` (`CONTROL_CHARS` só cobre C0 + DEL), `:27-33` (`cleanName`),
`:99-104` (`validateChat`); `src/server/room.ts:120-156` (sem checagem de nome único);
`client/src/App.tsx:45` (convidado aleatório `Convidado NNNN` pode colidir).
**O que acontece:** o servidor aceita dois jogadores com o mesmo nome (imitação no chat/participantes)
e aceita `\u202e` (override bidi) e `\u200b` (zero-width) em nome e chat — dá para escrever um nome que
aparece invertido/igual a outro. Cliente modifica só a própria tela; o servidor não normaliza.
**Correção mínima:** estender `CONTROL_CHARS` com `\u200b-\u200f\u202a-\u202e\u2066-\u2069` e, no
join/patch de perfil, sufixar nome já usado por outro jogador conectado. ~15 linhas + teste.
**Esforço:** 1 h.
**Risco se ignorar:** impersonação/confusão de identidade no chat (sala pequena, mas é o único "login").

### 16. Token de sessão é bearer reutilizável; quem lê, assume o jogador por 30 s
**Onde:** `src/server/room.ts:107-118` (resume por token), `:143` (`session: createId()`).
**O que acontece:** o token é `randomUUID` (122 bits, imprevisível — ok), mas não rotaciona e não é
ligado à conexão. Medido: uma segunda conexão com o token de um jogador desconectado recebeu
`welcome` com o **mesmo id** dele. Vazamento realista é baixo (token só trafega no WSS; exigiria XSS,
extensão ou devtools), mas é um bearer puro.
**Correção mínima:** rotacionar `session` a cada resume bem-sucedido e devolver o novo no `welcome`;
opcionalmente recusar resume de IP muito diferente (cuidado com 4G). ~10 linhas + teste.
**Esforço:** 30 min.
**Risco se ignorar:** se o token vazar, o atacante herda a identidade/posição por até 30 s
(impacto limitado, sem histórico).

### 17. Código morto/indireções no servidor
**Onde:** `src/server/room.ts:48-60,267` — `Room` expõe `id`, `name`, `map`, `leave` e `size`; só
`join/handle/detach/close` são usados por `server.ts` (`id/name/map` são lidos dentro do próprio
`room.ts`; `leave`/`size` só em teste). `src/server/server.ts:41-61` — vários MIME (`.mjs`, `.wasm`,
`.woff`, `.ttf`, `.map`, `.txt`) não são gerados pelo build do cliente.
**O que acontece:** não é duplicação de colisão: `src/server/collision.ts` é **fina re-export** de
`src/shared/collision.ts` + `findSpawn`, o que é correto (cliente e servidor usam a mesma matemática).
O resto é superfície de API sem uso em produção.
**Correção mínima:** reduzir a interface `Room` ao que `server.ts` usa (ou manter: é inofensivo) e
remover MIME mortos. 15-30 min.
**Esforço:** 30 min.
**Risco se ignorar:** nenhum funcional; custo de leitura/manutenção.

### 18. Imagem Docker roda como root; sourcemaps do cliente vão para produção (1,4 MB)
**Onde:** `Dockerfile:15-24` (sem `USER`; o runtime roda como root), `client/vite.config.ts:15`
(`sourcemap: true`); medido `GET /assets/index-*.js.map` → 200 `application/json`, **1.411.933 B**.
**O que acontece:** processo servindo entrada não confiável como root dentro do container (violação de
privilégio mínimo) e o servidor público entrega o mapa-fonte completo do cliente (custo de banda e
superfície de leitura para atacante; o repo é público, então o segredo é baixo).
**Correção mínima:** `USER node` + `chown` do `/app` no Dockerfile; gerar o cliente online sem
sourcemap (ou apagar `dist/client/assets/*.map` no `deploy/build-online.mjs`/Dockerfile). ~10 linhas.
**Esforço:** 30 min.
**Risco se ignorar:** baixo; padrão de hardening e 1,4 MB de banda/disco.

### 19. `CLIENT_DIR` errado não falha no boot: healthz verde, app 404
**Onde:** `src/online/main.ts:45-48` (só valida `website/`; `clientDir` livre),
`src/server/server.ts:130` (`path.resolve` sem checar existência), `:104-113` (miss → 404).
**O que acontece:** se `CLIENT_DIR` apontar para caminho errado (env/COPY errado), o servidor sobe,
`/healthz` responde 200 e o Render marca o deploy como saudável — mas `/room` responde 404 para todos.
**Correção mínima:** checar `fs.existsSync(path.join(clientDir, "index.html"))` e falhar com mensagem
clara no boot (15 min).
**Esforço:** 15 min.
**Risco se ignorar:** deploy "verde" servindo app quebrado; diagnóstico demorado.

---

## Checado e OK (para não gastar tempo de novo)

- **Path traversal:** sondas HTTP cruas (sem normalização do cliente) — `/..%2f..%2fpackage.json` →
  403; `/site/../package.json`, `/site/%2e%2e/...`, `/site//etc/passwd`, `/site/%2fetc%2fpasswd` →
  404; `%00` → 400. O `path.resolve` + checagem de prefixo está correto
  (`src/server/server.ts:87-102,174-186`).
- **Tamanho de mensagem:** `maxPayload` 16 KB derruba a conexão (teste `server.test.ts:799-809`;
  probe fechou 1009). Chunk de soundboard cabe (8 KB raw → ~10,9 KB base64 + JSON).
- **Heartbeat e limpeza:** `alive` WeakMap + ping/terminate, `unref()` nos timers de grace; `close()`
  limpa timers, termina sockets, fecha WSS e HTTP (`server.ts:320-351`).
- **Validação de payloads:** perfil, cor (hex), cabelo, status, move finito, SDP/ICE com tamanhos,
  chat com limite e trim, soundboard com regex base64/total/index — bem cobertos em
  `validation.ts` + `server.test.ts:175-283`.
- **Sessão:** token imprevisível (`randomUUID`), resume só para jogador desconectado (não rouba vaga de
  conectado), sala cheia recusada (medido: 6 entram, 7º `room_full`).
- **ES/PII:** o servidor não guarda chat, não persiste nada e não loga IP — ótimo por privacidade
  (o problema é a falta de log operacional, item 14).
- **Rotas/estático:** MIME correto, `nosniff`, `/join` 302 com `location: /room?autojoin=1`,
  `/client-config.json` com JSON válido, landing + `/site/*` servidos, sem CORS (same-origin apenas).
- **TLS do modo offline/LAN** (`src/server/tls.ts`) tem SAN/regeneração testada
  (`server.test.ts:627-648`) — fora do deploy web atual (TLS é da borda).
- **Dependências:** `ws` 8.22.0 e `selfsigned` 5.5.0 instalados; sem `npm audit` rodado (ver não
  verificado).

## Itens menores deixados de fora (5)

1. `HEAD /healthz` não casa na rota (só GET) e cai no fallback SPA → 200 `text/html`
   (`server.ts:157-160`). Monitores que só olham status não quebram.
2. `/join` responde 302 **sem** `cache-control` (os outros endpoints têm `no-store`)
   (`server.ts:165-168`).
3. Fallback de porta +1..+4 (`server.ts:218-241`) em modo web mascara `PORT` ocupada; num PaaS a porta
   errada derruba o roteamento do proxy — deveria falhar rápido quando `online`.
4. `og:image` da landing é caminho relativo (`/site/office.jpg`, `website/index.html:20`) — crawlers de
   rede social normalmente exigem URL absoluta.
5. `validatePing` aceita qualquer número finito e o `pong` ecoa (`room.ts:232-237`); sem impacto no
   servidor, só bagunça o medidor de latência do cliente.

---

## Não verificado:

- **Docker build:** Docker não está instalado nesta máquina (só li o Dockerfile/`.dockerignore`);
  não validei a imagem, `HEALTHCHECK`, usuário nem tamanho final.
- **Produção real atrás de proxy (Render/Caddy/Cloudflare):** não testei HSTS, gzip/brotli, limites de
  conexão da borda, cold start nem se algum header de segurança já é adicionado pelo proxy. Todos os
  headers observados são do Node direto.
- **Carga real:** os números de flood são loopback local, sem latência/TLS/rede; não rodei k6/artillery
  nem teste de milhares de conexões simultâneas (só ~40 conexões idle).
- **Cliente:** li apenas `client/src/net/connection.ts`, trechos de `client/src/media/useMedia.ts`,
  `client/src/soundboard/soundboard.ts`, `client/public/sw.js` e `client/index.html`. XSS/renderização
  de chat, clickjacking real e fluxo de mídia são do dono da auditoria do cliente.
- **Modo Electron/LAN:** não li `src/main/**` além de `server-host.ts`, nem rodei e2e; o foco aqui foi
  o deploy web.
- **Scripts de verificação:** li `deploy/verify-online.mjs` por partes (grep dos checks) e não inteiro;
  `verify-pwa.mjs`/`verify-mobile.mjs` só por grep.
- **npm audit/CVEs:** não rodei (deps fixas, sem instalar nada).
- **Várias instâncias:** não teste; o design é 1 sala por processo, então escalar horizontalmente
  criaria salas separadas (decisão de produto, não bug).
