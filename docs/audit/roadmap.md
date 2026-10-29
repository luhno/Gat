# Roadmap web-first — DittoApp (proposta)

Status: proposta de produto, 2026-10-28. Base: leitura de `docs/ROADMAP.md`, `docs/QOL_AND_JUICE.md`, `docs/ONLINE_DEPLOY.md`, `docs/CI.md`, `docs/VERIFICATION.md`, `README.md` e do código citado, cruzada com `docs/audit/verification.md` (suíte reexecutada: 127 checagens verdes) e `docs/audit/architecture.md`. **Nenhum teste foi executado por mim** (read-only). Direção do dono: produto **100% web**; mobile/desktop em *keep-alive* (seção 3).

## 1. Onde o produto está hoje

### 1.1 O que realmente existe (verificado no código)

- **Sala única por deploy, até 6 pessoas**: `MAX_PLAYERS = 6` (`src/shared/constants.ts:8`), barrado no join com `room_full` (`src/server/room.ts:122-124`); servidor HTTP/WSS standalone (`src/server/server.ts`, `src/online/main.ts`) com `/` (landing), `/room`, `/join` (302 → `/room?autojoin=1`), `/healthz` e `/client-config.json` (`server.ts:157-187`).
- **Entrada por link + home web**: `/join` vira convidado único (`client/src/App.tsx:36-52`); home sem ferramentas de LAN no navegador (`client/src/home/HomeScreen.tsx:124-137`) e landing estática sem JS em `website/`. Perfil (nome/avatar/status) persiste via `localStorage` (`client/src/desktop.ts:20-77`).
- **Escritório jogável**: mapa/collision compartilhados (`src/shared/defaultMap.ts`, `src/server/collision.ts`), avatar com idle/blink e anel de fala (`client/src/office/`), joystick mobile (`client/src/mobile/`).
- **Chat de texto** com rate limit nas duas pontas (`src/server/room.ts:210-224`, `client/src/chat/ChatPanel.tsx:43-58`; histórico em memória de 200: `client/src/state/store.ts:113-117`).
- **Voz/vídeo por proximidade** (mesh WebRTC, STUN vindo de `/client-config.json`: `client/src/media/useMedia.ts:201-212,274-275`; raios 4,5/5,5 tiles em `src/shared/constants.ts:20-22`), HUD de mídia e "quem está falando", **tela** (`useMedia.ts:536`), **soundboard** com corte ≤10 s e relay (`client/src/soundboard/`, `src/server/room.ts:179-187`) e sons de UI.
- **Reconexão e retomada**: 10 tentativas com backoff+jitter (`client/src/net/connection.ts:19,176-198`); grace de 30 s com token de sessão (`src/server/room.ts:44,107-118,245-258`); **diagnóstico de conexão** via `getStats` (rota host/srflx/relay, RTT, jitter, perda) em `useMedia.ts:639-712` e `SettingsPanel.tsx:219-255`.
- **PWA instalável** (manifest + SW de shell: `client/public/sw.js`, `client/src/pwa.ts`) e mobile/touch (joystick, bottom sheets, safe-area; `docs/MOBILE_NOTES.md`). **Deploy**: `Dockerfile` multi-stage (roda como root — sem `USER`), `render.yaml` free e CI em `.github/workflows/ci.yml`.
- **Verificação registrada**: online 32/32, PWA 17/17, mobile 27/27, unit 34/34, e2e Electron 17/17 (local/manual) — `docs/VERIFICATION.md:191-211`; ressalvas em `:213-238` (sem hardware real, sem duas máquinas, sem TURN). Suíte reexecutada em 28/10 com **127 checagens verdes** e fonte reprodutível em `docs/audit/verification.md`.

### 1.2 Lacunas reais que impedem ser produto web confiável

- **Deploy público não existe**: T1.1 "pendente do usuário" (`docs/ROADMAP.md:243-244,249-250`); `PUBLIC_URL` só aparece em log (`src/online/main.ts:35-40,60-66`). Sem URL real nada de produção é validável e o cold start do Render (`docs/ONLINE_DEPLOY.md:95-108`) nunca foi exercitado.
- **Sem observabilidade**: só `console.log` de boot (`src/online/main.ts:61-66`); `/healthz` sempre `"ok"` fixo (`server.ts:157-159`); erros de WS/mensagem inválida engolidos (`server.ts:247,305-311`). Não se sabe quantas pessoas entraram, quantas salas lotaram, quantos erros de WS — e "sem telemetria" (`README.md:16`) deixa log local como único instrumento.
- **Abuso sem limites**: o teto de 6 só vale no `join`; não há teto de sockets antes do join, limite por IP, nem checagem de `Origin` no upgrade (`server.ts:249-263,265-318`); o soundboard é retransmitido para a sala toda (`room.ts:179-187`) e só o cliente filtra por distância (`client/src/soundboard/soundboard.ts:262-273`); rate limits são por conexão (2 sockets = 2× cota).
- **Credencial de TURN vira pública**: TURN só por `ICE_SERVERS` estático (`src/online/main.ts:15-33`) e `/client-config.json` é servido a qualquer visitante (`server.ts:133-137`); o doc mostra `username`/`credential` fixos (`docs/ONLINE_DEPLOY.md:64-69`). O endpoint efêmero NET-6 não existe (`ROADMAP.md:155`).
- **Cabeçalhos/cache/compressão**: nenhuma resposta tem CSP/HSTS/Referrer-Policy/frame-ancestors — só `nosniff` e `no-store` em tudo (`server.ts:63-70,115-120,142-148`); a CSP existe só como `<meta>` no app (`client/index.html:7-11`) e a landing (`website/index.html`) não tem; até `/assets/<hash>` imutável é `no-store` e o servidor não comprime (proxy pode comprimir; não medido). O **sourcemap do cliente é público** (`GET /assets/index-*.js.map` → 200, 1,4 MB) e o fallback SPA responde 200 HTML para asset inexistente (medido em `docs/audit/verification.md`). Bundle: 321 KB de JS bruto (`dist/client/assets/index-xzGyADtO.js`, medido em 28/10); o SW mascara visitas recorrentes, mas primeira visita e clientes sem SW pagam.
- **Estado 100% efêmero**: sala/chat em memória (`docs/ONLINE_DEPLOY.md:13-19`); restart/sleep do Render zera tudo; "mesmo jogador após restart do processo" não é garantido nem testado; sem snapshot.
- **Sem moderação/papel de host**: não há mensagem de moderação no protocolo (`src/shared/protocol.ts:5-25`), `RoomSummary` só tem id/nome (`src/shared/types.ts:95-98`) e a regra é "quem tem o link entra" (`docs/ONLINE_DEPLOY.md:132-138`). Um convidado abusivo só pode ser ignorado ou esperar sair.
- **Mídia não é "de reunião"**: resolução fixa 640×360@24 (`useMedia.ts:466-480`), sem teste de microfone (WC-6), sem hot-plug (WC-3), sem áudio da tela (`getDisplayMedia({video:true,audio:false})`, `useMedia.ts:536`), sem PTT/deafen/volume por pessoa (QoL-1/2), sem bitrate adaptativo (NET-7; não existe `setParameters` no código), sem unlock de áudio mobile. Escolha de dispositivo **não persiste no web**: `persistDeviceSettings` retorna cedo sem bridge desktop (`client/src/desktop.ts:88-91`).
- **Dia a dia raso**: links no chat não são clicáveis, sem @menção/reação/mão/"digitando" (`client/src/chat/ChatPanel.tsx:75-90`; J1.4/J2.2-J2.4 pendentes, `docs/QOL_AND_JUICE.md:46-91`); quem entra depois não vê histórico (servidor não guarda chat); mapa sem zoom/pan/minimapa (QoL-5).
- **Repo e docs divergem**: o workflow de CI está **não versionado** (`git ls-files .github` vazio; `git status` mostra `?? .github/`; confirmado em `docs/audit/verification.md`), então o badge do README (`README.md:3`) aponta para workflow que não roda; screenshots locais não commitadas; `Dockerfile` roda como root. Sem teste de carga/soak para validar mesh O(n²) e 6 jogadores (`docs/OFFLINE_ARCHITECTURE.md:88-91`).

### 1.3 O que os docs prometem e o código ainda não entrega

| Prometido (`ROADMAP.md`/`QOL_AND_JUICE.md`) | Estado no código |
|---|---|
| T1.9 mídia na internet + TURN + unlock mobile (`ROADMAP.md:100`) | **Parcial**: diagnóstico/prévia ok; endpoint TURN, áudio de tela e unlock mobile ausentes |
| NET-6 TURN / NET-7 adaptativo / NET-8 cold start (`:155-157`) | **Ausentes** (sem `/turn-credentials`, sem `setParameters`, sem estado "acordando") |
| WC-2..WC-8 (presets, hot-plug, teste câmera/mic, erros acionáveis) (`:164-170`) | **Ausentes** (só WC-1 prévia) |
| SS-1..SS-7 (`:176-182`) | **Ausentes**; UI mostra só o primeiro sharer (`client/src/office/OfficeScreen.tsx:182-184`) |
| QoL-1..5, QoL-7..9 (PTT/volume/menções/mapa/preferências) (`:188-196`) | **Ausentes**; entregues QoL-6/10/11 |
| J1.4/J1.5 e Sprints 2-4 de juice (`QOL_AND_JUICE.md:56-57,81-116`) | **Pendentes** |
| Multi-room, i18n, licença, TURN próprio (`ROADMAP.md:126-133`) | **Ausentes** (decisão em aberto) |
| CI no GitHub Actions (`ROADMAP.md:102,245-247`) | **Só local**: workflow não versionado |

## 2. Roadmap proposto (3 horizontes, web-first)

Premissas: 1 dev em tempo parcial; **nada de telemetria de terceiros**; mobile/desktop sem feature nova; gates atuais não podem quebrar (`typecheck`, `npm test`, `test:e2e` local, `verify-online`, `verify-pwa`, `verify-mobile`). Esforço em dias de 1 dev, comparável a itens já estimados no `ROADMAP.md` (NET-4/T1.3 = 1-2 d, QoL-10 = 2,5 d).

### H0 — "Web confiável" (1-2 semanas, ~8 d de dev) — P0

- **H0.1 Deploy público validado — 0,5 d (dono).**
  *Por quê:* destrava tudo; sem URL não há produto.
  *Escopo:* criar serviço Render pelo Blueprint (`render.yaml`) ou VM Oracle e informar URL.
  *Aceite:* `/join` entra, `/healthz` 200, 2 pessoas em redes diferentes com chat+mídia.
  *Dep:* conta do dono. *Risco:* Render free dorme (H0.5).
- **H0.2 Observabilidade por log + `/healthz` útil — 1,5 d.**
  *Por quê:* sem números não se decide multi-room/limites; analytics é proibido por privacidade.
  *Escopo:* linhas JSON para `join`/`leave`/`room_full`/erro WS/close (id de sessão, não IP) e `/healthz` com `{ok, players, uptime, version}`.
  *Aceite:* sessão de 7 conexões gera 6 joins + 1 `room_full`; `/healthz` mostra `players`; logs contam a sessão inteira.
  *Dep:* H0.1. *Risco:* retenção curta no free; nada de dado pessoal.
- **H0.3 Abuso e capacidade antes do join — 2 d.**
  *Por quê:* hoje dá para abrir sockets sem limite, lotar os 6 lugares ou inundar o soundboard (1.2).
  *Escopo:* teto de sockets (ex.: 24), token bucket por IP no upgrade (X-Forwarded-For), allowlist de `Origin` por env (default mesmo host), `MAX_PLAYERS` por env; filtrar soundboard por distância no servidor (ele já tem posições).
  *Aceite:* 25º socket e `Origin` estranho recusados (teste unitário); 7º join segue `room_full`; som de quem está longe não chega.
  *Dep:* H0.1 (validar XFF no proxy). *Risco:* proxy precisa repassar XFF; não cobre DDoS de volume.
- **H0.4 Cabeçalhos, cache e compressão — 1 d.**
  *Por quê:* segurança básica de página pública e primeira visita mais leve (1.2).
  *Escopo:* headers de resposta (CSP com `frame-ancestors 'none'`, Referrer-Policy, HSTS conforme plataforma), `immutable` para `/assets/*`, no-store só em html/config/health; não servir `.map` em produção; 404 correto para asset inexistente; compressão gzip/brotli ou confirmar no proxy.
  *Aceite:* `curl -I` mostra headers em `/` e `/room`; asset hash com `max-age=31536000, immutable`; `.map` → 404; landing também com CSP.
  *Dep:* H0.1 p/ medir o proxy. *Risco:* CSP pode quebrar estilo inline — rodar `verify-online`.
- **H0.5 Cold start e queda do servidor — 1 d.**
  *Por quê:* Render dorme ~15 min e acorda em 30-60 s (`ONLINE_DEPLOY.md:95-108`); hoje a primeira conexão pode falhar antes do welcome e só então inicia retry (`client/src/net/connection.ts:112-118,176-198`); NET-8 pendente.
  *Escopo:* estado "acordando a sala" com timeout maior + retry extra; rejoin limpo após restart do processo.
  *Aceite:* abrir sala dormindo → aviso e entrada sem reload; matar/religar servidor com 2 pessoas → voltam sozinhas, chat segue.
  *Dep:* H0.1. *Risco:* validar exige produção; teste local simula proxy.
- **H0.6 TURN sem credencial pública — 1-1,5 d.**
  *Por quê:* TURN estático no `/client-config.json` é credencial aberta; sem relay a mídia falha em NAT restritivo (1.2).
  *Escopo:* `GET /turn-credentials` HMAC (coturn REST) opcional por env + fallback `ICE_SERVERS`; doc do provider.
  *Aceite:* com TURN forçado, Configurações mostram "Relay (TURN)"; credencial expira e renova; sem credencial estática exposta.
  *Dep:* decisão do provider (4.3). *Risco:* free tier de TURN tem limite de banda.
- **H0.7 CI versionado e gate de produção — 0,5 d.**
  *Por quê:* o workflow não está no remoto (1.2), então PWA/mobile/online só rodam em quem lembra.
  *Escopo:* commitar `.github/workflows/ci.yml`; job manual `workflow_dispatch` rodando `verify-online` na URL pública.
  *Aceite:* run verde na `main` com os 3 verifies; badge resolvendo.
  *Dep:* H0.1. *Risco:* e2e Electron continua local/manual.

### H1 — "Web útil no dia a dia" (2-4 semanas, ~10-14 d) — P1

- **H1.1 Host/moderação v1 — 2,5-3 d.**
  *Por quê:* sala pública sem ninguém no controle (1.2).
  *Escopo:* primeiro jogador = host (sem transferência na v1); host pede mute, expulsa por sessão e tranca a sala; mensagens novas no protocolo + testes.
  *Aceite:* com 3 pessoas, host expulsa 1 → some e não volta na mesma sessão; sala trancada → visitante vê mensagem clara; host sair não derruba a sala.
  *Dep:* H0.3. *Risco:* sem login, expulso pode voltar com outro link — aceitável na v1.
- **H1.2 Mídia de reunião — 3-4 d.**
  *Por quê:* reunião real precisa de qualidade, teste de dispositivo e controles de áudio (1.2).
  *Escopo em duas entregas:* (a) presets 360p/720p persistidos + teste de mic com nível + hot-plug de câmera + erros acionáveis (2 d); (b) PTT/deafen + volume por pessoa + áudio da tela (2 d); bitrate adaptativo só se os stats mostrarem necessidade.
  *Aceite:* trocar preset sem reload; despluggar webcam não derruba a sala e volta no default com aviso; nível do mic antes de entrar; volume por pessoa na sessão; som da aba chega ao par (Chrome/desktop).
  *Dep:* H0.6 p/ relay, H0.2 p/ medir. *Risco:* iOS não tem `getDisplayMedia` (mensagem clara); volume por pessoa exige `AudioContext` por peer.
- **H1.3 Persistência e retomada de contexto — 1-1,5 d.**
  *Por quê:* refresh zera chat, quem entra depois não vê o que foi dito, dispositivo não persiste no web (1.2).
  *Escopo:* servidor guarda as últimas ~50 mensagens e as inclui no `welcome` (some no restart); cliente guarda histórico local, nome/avatar e dispositivo/preset em localStorage.
  *Aceite:* F5 mantém histórico e preferências; nova aba restaura; recém-chegado vê as últimas mensagens; nada de banco.
  *Dep:* nenhuma. *Risco:* mensagem antiga confundir — rotular "histórico" e oferecer limpar.
- **H1.4 Presença e chat do dia a dia — 2-3 d.**
  *Por quê:* docs prometem e não existe; links/menções são básicos (1.2).
  *Escopo:* toast de entrada/saída, "digitando…", mão levantada, emotes 1-4, autolink e @menção segura (só http/https, `rel="noopener noreferrer nofollow"`).
  *Aceite:* entrar/sair perceptível; mão/emote nas duas pontas em <1 s; link vira âncora; menção destaca; cooldown limita spam.
  *Dep:* H1.1 (rate limit base). *Risco:* spam sem moderação — cooldowns desde o início.
- **H1.5 Mapa navegável — 1-2 d (P2).**
  *Por quê:* QoL-5 pendente; útil se o mapa crescer.
  *Escopo:* zoom/pan (roda e pinça) + "onde estou"; minimapa só se sobrar tempo.
  *Aceite:* zoom sem perder o avatar de vista; atalho volta ao centro.
  *Dep:* nenhuma. *Risco:* conflito com clique-no-chão no touch — rodar `verify-mobile`.
- **H1.6 Multi-room por código — 3-5 d (condicionado à decisão 4.1).**
  *Por quê:* separar grupos sem subir outro deploy (só se o uso real pedir).
  *Escopo:* registro de salas + `/r/<code>` + limite por sala.
  *Aceite:* dois códigos = duas salas isoladas de 6 no mesmo deploy; `/join` continua na sala padrão.
  *Dep:* H0.2/H0.3. *Risco:* aumenta estado, limites e superfície; adia o resto.

### H2 — "Ferramentas web diferenciadas" (só com demanda observada)

Todas pequenas e sem dependência nova; entram só com H1 estável e uso real (dados de H0.2) mostrando necessidade.

- **H2.1 Timer compartilhado — 0,5-1 d.**
  *Por quê:* escritório virtual favorece foco/pomodoro; é a ferramenta colaborativa mais barata (estado pequeno via WS, sem arquivos).
  *Escopo:* qualquer pessoa inicia/pausa; todos veem o contador na topbar.
  *Aceite:* contador igual nas duas pontas (±1 s), sobrevive a reconexão.
  *Dep:* H0.3. *Risco:* baixo.
- **H2.2 Enquete rápida — 1 d.**
  *Por quê:* decisão rápida sem sair da sala.
  *Escopo:* pergunta + opções no painel; voto contado no servidor, 1 por jogador; resultado ao vivo.
  *Aceite:* N votos corretos, encerra e mostra o vencedor.
  *Dep:* H0.3. *Risco:* baixo (texto validado como o chat).
- **H2.3 Quadro de recados/notas da sala — 1 d.**
  *Por quê:* complementa o chat com o que fica visível (agenda do dia, links).
  *Escopo:* um texto por sala, texto puro (sem HTML), editável pelo host, last-write-wins, em memória.
  *Aceite:* todos veem a edição em <1 s; conteúdo sanitizado; some no restart.
  *Dep:* H1.1. *Risco:* concorrência — não fazer editor multi-usuário nesta versão.
- **H2.4 Whiteboard de verdade — 3-5 d (só depois de H2.1-H2.3 provarem demanda).**
  *Por quê:* hoje existe só o objeto decorativo (`src/shared/types.ts:22`, `client/src/office/scene.ts:324`).
  *Riscos:* serialização, limpar/moderar, touch, performance de canvas. **Recomendação: não fazer agora.**
- **O que NÃO construir:** contas/login/billing; app nativo/app store; editor de mapa; gravação de reunião; música compartilhada via YouTube/Spotify (licenciamento + request externo, quebra "sem requests externos/telemetria"); upload de imagens/arquivos no chat (storage + moderação + custo); fundo virtual (CPU); gamificação/streaks; integrações de calendário; push de PWA; whiteboard completo; features de Electron; i18n além de EN (e só com usuários fora do pt-BR).

### Próximos 14 dias (ordem de execução, ~12 d)

1. **Dono (0,5 d):** criar o deploy Render e informar a URL; validar `/join` + `/healthz` + 2 navegadores.
2. **H0.2 (1,5 d):** logs JSON + `/healthz` com estado.
3. **H0.3 (2 d):** tetos de socket, limite por IP, Origin, soundboard filtrado no servidor.
4. **H0.4 (1 d):** headers de segurança, cache imutável de assets, compressão.
5. **H0.5 (1 d):** cold start com aviso + recuperação após restart.
6. **H0.7 (0,5 d):** commitar o CI e ver o run verde.
7. **H0.6 (1-1,5 d):** `/turn-credentials` + provider decidido.
8. **H1.1 (2,5-3 d):** host/moderação v1 (expulsar, mute-pedido, trancar).
9. **H1.3 (0,5-1 d):** histórico local + preferências web + últimas mensagens no welcome.
10. **Verificação (1 d):** `typecheck`, `npm test`, `test:e2e` local, `verify-online/pwa/mobile`, smoke em 2 redes; atualizar `docs/VERIFICATION.md` com os novos checks.

Se estourar: corta o item 8 (H1.1) para a semana seguinte — H0 é o gate para "mandar o link".

## 3. Mobile e desktop: deprioritização explícita

**Não investir (congelado):** app nativo iOS/Android, app store, contas mobile; features mobile-only (câmera traseira/`facingMode` WC-4, screen share no iOS, PTT no touch, push, install prompt A/B); PWA além do atual (push, background sync, edição offline, splash, A/B); **Electron** — qualquer recurso novo (mini mode, auto-launch, notificações nativas, deep link `ditto://`, updater), assinatura/notarização, DMG/releases, tray; otimização de layout mobile além de correção de regressão; testes em aparelhos reais além do smoke; i18n/tema mobile.

**Keep-alive (não quebrar, não polir):**

- Gates seguem obrigatórios: `verify-pwa` 17/17, `verify-mobile` 27/27, sem overflow em 320 px, safe-area; e `npm run test:e2e` (Electron) 17/17 como gate **local** quando tocar código compartilhado.
- Mudança em canvas/avatar/chat/painéis/layout exige `verify-mobile` + `verify-pwa` e smoke em 1 iPhone + 1 Android quando mexer em touch. Custo esperado ~0,5 d por release que toque UI.
- Bug mobile só se impedir entrar/andar/chat/mic no Chrome Android/Safari iOS atuais; nada de polish. Electron: manter compilando (`npm run build`, `typecheck`) e o fluxo LAN funcionando; nenhum release novo; DMG existente é arquivo de estudo.
- Não remover PWA/mobile/Electron do repo agora (funcionam e custam pouco); revisar arquivamento em ~6 meses.

## 4. Decisões abertas (com recomendação)

1. **Multi-room vs. 1 sala por deploy:** recomendo **1 sala** até H0.2 + uso real por 2-4 semanas; se precisar de dois grupos antes, **dois deploys** do mesmo código com `ROOM_NAME` diferente (quase zero esforço). Multi-room custa 3-5 d e adiciona estado/limites/roteamento — decidir com dados de pico/`room_full`.
2. **Auth/moderação:** recomendo **sem login**; host = primeiro a entrar, sem transferência na v1; lock opcional por env; expulsão por sessão. Contas/papéis persistentes só com uso externo real.
3. **TURN/provider:** recomendo **TURN gerenciado com free tier** (Cloudflare Calls TURN, ou Metered para teste) + `/turn-credentials` HMAC; coturn self-host só se optar por VM always-on (Oracle). Sem TURN, documentar e mostrar o diagnóstico (já existe).
4. **Hospedagem/domínio:** recomendo **Render Free agora**; decidir sempre-ligado (Oracle Always Free + coturn, ou Render pago) depois de H0 mostrar uso; domínio próprio é 0,5 d + custo anual e não bloqueia.
5. **Observabilidade:** recomendo **logs estruturados no Render + `/healthz` JSON**; nada de analytics de terceiros (`README.md:16`). Uptime monitor externo opcional: ping evita o sleep mas consome as horas free — recomendação: aceitar cold start (H0.5) e reavaliar.
6. **Limites:** recomendo **manter 6 jogadores** (mesh O(n²), `docs/OFFLINE_ARCHITECTURE.md:88-91`), mas configurável por env; soundboard filtrado no servidor; revisar com métricas de `room_full`.
7. **Persistência:** recomendo **localStorage no cliente** + últimas 50 mensagens em memória no servidor; **sem banco** enquanto for 1 sala efêmera. Persistência durável só com always-on/multi-room.

## 5. Não verificado:

- Deploy público, cold start do Render e headers/compressão do proxy: não há URL pública validada (T1.1 pendente) e não rodei deploy/`verify-online` (análise read-only).
- TURN/NAT reais, áudio/vídeo com hardware real e Safari iOS/Chrome Android físicos: testes usam devices fake e viewport/touch emulados (`deploy/verify-mobile.mjs`); mesma limitação em `docs/VERIFICATION.md:213-238`.
- PWA em iOS real (install/push/offline) e comportamento atrás de proxies corporativos.
- Carga/abuso em produção (6 peers mesh, memória, rate limits sob flood): sem teste de carga/soak.
- Custo/quota reais de TURN, Render e Oracle.
- Os `docs/audit/server.md` e `docs/audit/client.md` ainda não existiam ao escrever; usei `docs/audit/verification.md` e `docs/audit/architecture.md` como corroboração. Achados de comportamento que os colegas reportarem depois podem mudar esforço/prioridade dos itens H0/H1.
- Não executei `npm test`/`verify-*`/e2e (regra read-only da tarefa); contagens citadas vêm de `docs/VERIFICATION.md`, `docs/ROADMAP.md` e da rodada registrada em `docs/audit/verification.md`.
