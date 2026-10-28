# DittoApp — Roadmap de melhorias e QoL

Status: **aprovado com defaults** (2026-10-28) · Direção escolhida: **online público (link único)**.
Escopo do documento: rebrand + fases de entrega com critérios de aceite observáveis. Nada aqui é
executado antes do "aprovado" — o primeiro passo (M0) é mecânico e reversível, mas só começa depois
da revisão deste plano.

O projeto muda de nome de **Gather Offline** para **DittoApp** (nova marca, mesma base técnica:
Electron offline/LAN + servidor web de sala única). Referências ao app original do Gather em
`REVERSE_ENGINEERING.md` continuam sendo sobre o original — não são rebrandizadas.

## Objetivo e sucesso (30–60 dias)

Qualquer pessoa recebe um link HTTPS, abre no desktop **ou no celular**, entra na sala em menos de
15 s sem instalar nada, e participa de chat e (quando a rede permite) voz/vídeo. O deploy é fixo,
observável e barato; a privacidade continua "sem telemetria".

Critérios de sucesso observáveis:

- link público abre a sala e o **preview do link** (WhatsApp/Discord/Telegram) mostra nome e descrição;
- entrada pelo celular funciona (Safari iOS e Chrome Android) — andar, chat, mídia, sem scroll acidental;
- nome/avatar do visitante **persistem** ao recarregar e em nova aba do mesmo navegador;
- duas pessoas conversam por vídeo atrás de NAT comum (STUN) e há caminho documentado/verificável para TURN;
- queda de rede momentânea mostra "reconectando" e volta sozinha;
- `/healthz` público responde, deploy tem passo a passo de 5 minutos e cold start documentado;
- rebrand aplicado em janela, tray, título/DMG, docs, screenshots e deploy (repo/Docker/Render).

## Não-objetivos (agora)

Contas/login, múltiplas salas por deploy, editor de mapa, DMs/whiteboard/integrações, gravação,
moderação avançada (ban/roles), app nativo mobile, analytics/telemetria. Nada disso entra na Fase 1.

## Abordagens consideradas

| Abordagem | O que é | Esforço | Trade-off |
|---|---|---|---|
| **A. Link-first (1 sala por deploy)** — **recomendada** | Melhorar o online atual: deploy fixo, onboarding, PWA, mobile, reconexão, TURN, meta/OG, capacidade. Sem refactor de servidor. | 1–2 semanas | Cada deploy = 1 sala (6 pessoas). Simples e entrega valor rápido; multi-room fica para depois. |
| B. Multi-room por código | Servidor com registro de salas, URL `/r/<código>`, criação/gestão de salas. | +2–4 semanas | Um deploy serve vários grupos, mas adia todo o polish de entrada/mobile que decide se as pessoas ficam. |
| C. Plataforma pública | Landing, contas, gestão de salas, moderação, billing/analytics. | meses | Fora do tamanho do projeto; só depois de validar A. |

Recomendação: **A agora**, B na Fase 2 se o uso real pedir (é natural depois de ver gente entrando).
O produto já está funcional; o gargalo é a experiência de entrada e a estabilidade percebida.

## Baseline e arquivos-âncora

- Offline/LAN: `docs/OFFLINE_ARCHITECTURE.md`, `docs/CONTRACTS.md`, `tests/e2e/run-e2e.mjs` (gate 17/17).
- Online: `docs/ONLINE_DEPLOY.md`, `src/online/main.ts`, `src/server/server.ts`, `deploy/verify-online.mjs`.
- Cliente: `client/src/App.tsx`, `client/src/home/HomeScreen.tsx`, `client/src/media/useMedia.ts`,
  `client/src/state/store.ts`, `client/src/desktop.ts`, `client/index.html`.
- Deploy: `Dockerfile`, `render.yaml`, GitHub `luhno/Gat` (main = `e06e364`).

## Como será verificado (TDD Route: auto)

- **strict** para comportamento de contrato do servidor (rotas `/healthz`, `/client-config.json`,
  `/join`, persistência de perfil no cliente com teste unitário): teste primeiro, depois implementação.
- **light** para UI/PWA/mobile: typecheck + `node deploy/verify-online.mjs` (2 contextos Chrome reais) +
  Playwright com emulação de viewport/dispositivo + checklist manual em celular para o que emulação não cobre.
- Regressão obrigatória a cada entrega: `npm run typecheck`, `npm test`, `npm run test:e2e` (offline
  17/17 — não pode quebrar), `node deploy/verify-online.mjs` (online), screenshots regenerados.
- Nada de telemetria: verificação é local/observável, sem serviço terceiro de analytics.

## M0 — Rebrand DittoApp (mecânico) — ✅ concluído em 2026-10-28

Objetivo: mesmo produto, marca nova, deploy e artefatos coerentes. Sem mudança de comportamento.

| # | Tarefa | Arquivos | Aceite |
|---|---|---|---|
| M0.1 | Nome npm/produto/versão e lockfile | `package.json`, `package-lock.json` (`npm install --package-lock-only`) | `npm ls` ok; `productName: "DittoApp"`, `name: "dittoapp"` |
| M0.2 | Empacotamento macOS | `electron-builder.yml` | `appId: com.dittoapp.app`; build gera **`DittoApp.app`** e `DittoApp-1.0.0-arm64.dmg` |
| M0.3 | Nome visível no app/UI | `src/shared/constants.ts` (`APP_DISPLAY_NAME`), `client/src/App.tsx`, `client/src/home/HomeScreen.tsx`, `client/src/components/SettingsPanel.tsx`, `client/index.html` (title/meta) | nenhuma string "Gather Offline" na UI; janela/tray/DMG "DittoApp" |
| M0.4 | Docs e README | `README.md`, `docs/BUILD_AND_RUN.md`, `docs/VERIFICATION.md`, `docs/ONLINE_DEPLOY.md`, `docs/CONTRACTS.md`, `docs/OFFLINE_ARCHITECTURE.md` | projeto chamado DittoApp; `REVERSE_ENGINEERING.md` mantém "Gather" como objeto original |
| M0.5 | Deploy/Blueprint | `render.yaml` | serviço `dittoapp` (se ainda não existir serviço Render criado; se existir, manter o atual e renomear só o blueprint) |
| M0.6 | Rebuild e evidências | build, unit, e2e (regenera `docs/screenshots/`), `verify-online`, DMG | e2e 17/17; online 8/8; screenshots com marca nova; DMG abre e conecta |
| M0.7 | Publicar | commit + push em `luhno/Gat` | `main` remota atualizada; Render redeploya automaticamente se conectado |

Executado: nome npm/produto/appId, UI/título/tray, docs, `render.yaml`, Dockerfile, rebuild
(typecheck 30/30 unit, e2e offline 17/17, online 8/8), screenshots novos, DMG `DittoApp-1.0.0-arm64.dmg`
verificado e push na `main`. Pendências cosméticas ficam na Fase 3 (ícone/logo, env vars
`GATHER_OFFLINE_*` → `DITTOAPP_*` com compat, renomear pasta/repo se desejado).

Riscos/trade-offs: o userData muda de pasta → perfil/certificado locais são recriados (aceitável
pré-release; documentado); se já existir serviço Render com o nome antigo, o ideal é renomear o
serviço no painel ou recriar pelo Blueprint.

## Fase 1 — Online público "link-first" (1–2 semanas) · em andamento

Objetivo: transformar o online funcional em algo que dá para mandar para qualquer pessoa.

| # | Entrega | O que muda (mínimo) | Aceite observável | Esforço |
|---|---|---|---|---|
| ✅ T1.0 | Landing pública | site estático em `website/` servido em `/` (app em `/room`), com OG, a11y e contraste verificados | `verify-online` 29/29 | 1 d |
| T1.1 | Deploy fixo | Render Free (Blueprint `render.yaml`), health check `/healthz`, doc "deploy em 5 min"; uptime/monitor opcional documentado | URL pública estável; `/healthz` 200; `/join` abre a sala; cold start explicado | 0,5 d (usuário cria conta) |
| ✅ T1.2 | Link preview + favicon | meta `description`, Open Graph/Twitter no `index.html`; favicon e `theme-color` | colar o link no WhatsApp/Discord mostra DittoApp + descrição; favicon correto | 0,5 d |
| ✅ T1.3 | Nome/avatar persistidos no navegador | `localStorage` para perfil quando não há bridge desktop; restaurar no boot; opção de limpar | recarregar e abrir nova aba mantém nome/avatar; anônimo vira `Convidado NNNN` | 1 d |
| ✅ T1.4 | Home web clara | esconder seção LAN no navegador, CTA "Entrar na sala", campo nome, contador de pessoas, link copiável | usuário novo entra em 2 cliques sem instruções; sem textos de "host" enganosos | 1 d |
| T1.5 | Compartilhar | botão copiar link + `navigator.share` (mobile); QR fica para a Fase 2 | copiar/share funcionam em desktop e mobile | 0,5 d |
| T1.6 | PWA instalável | `manifest.webmanifest` + ícones + service worker cache do shell + página de fallback sem rede | "adicionar à tela inicial" no Android/iOS; reabrir offline mostra shell com aviso; WS continua funcionando quando online | 1–1,5 d |
| T1.7 | Mobile/touch | canvas responsivo (viewport dinâmico), joystick/mobile controls, safe-area, esconder dicas de teclado, chat usável no celular | Safari iOS + Chrome Android: andar, abrir chat, mídia; sem overflow/zoom acidental | 2–3 d |
| ✅ T1.8 | Reconexão visível | overlay “Reconectando… (tentativa n/10)”, retry manual, volta automática sem sair da tela (retomada de sessão preserva o jogador) | queda → overlay com tentativa → volta sozinho sem recarregar | 1 d |
| T1.9 | Mídia na internet | `ICE_SERVERS` documentado + indicador de qualidade/estado; teste de câmera/mic nas configurações; unlock de áudio no mobile (gesto) | mídia conecta atrás de NAT comum; sem TURN, mensagem clara; áudio toca no celular após toque | 1–2 d |
| ✅ T1.10 | Capacidade | `MAX_PLAYERS = 6`; contador e mensagem de sala cheia | o 7º jogador recebe `room_full` amigável (verificado no `verify-online`) | 0,5 d |
| T1.11 | CI mínimo | GitHub Actions: typecheck + unit + build + `verify-online` (Chromium headless no runner) | push/PR roda verde; badge no README | 1 d |
| T1.12 | Domínio próprio (opcional) | Render custom domain + DNS (ex.: `app.dittoapp.dev`) | HTTPS válido; links antigos redirecionam | 0,5 d + compra do domínio (usuário) |

Ordem recomendada dentro da Fase 1: **T1.1 → T1.2 → T1.3 → T1.4 → T1.6 → T1.7 → T1.8/9/10 → T1.5 → T1.11/12**.
(Mobile e PWA antes do resto do polish: são o que mais muda a percepção de "está online".)

## Fase 2 — QoL de uso diário (2–4 semanas)

Priorizada por uso, sem adicionar novos donos/contratos grandes. Itens entram por feedback real.

- **Mídia**: mute/deafen com atalhos (`M` já alterna mic; adicionar `D`/botão), push-to-talk, medidor
  de nível do microfone, volume por pessoa, indicador de quem fala, persistir dispositivo escolhido
  no navegador, câmera traseira no celular.
- **Chat**: @menções com destaque + notificação, reações/emotes rápidos, "levantar mão", histórico
  da sessão visível ao entrar (já existe em memória), links clicáveis com aviso.
- **Mapa**: zoom/pan (roda/gesto), minimapa, "seguir pessoa", "onde estou", preview de câmera do
  avatar remoto, paredes/colisão já ok.
- **Desktop (Electron)** → *legado/estudo, fora das próximas entregas* (mini mode, auto-launch,
  notificações nativas, deep link `ditto://`): fica no backlog sem prioridade.
- **Acessibilidade**: navegação completa por teclado, foco em painéis, contraste, `prefers-reduced-motion`,
  anúncios de leitor de tela para chat/entrada/saída.
- **i18n**: inglês (pt-BR continua default).
- **Multi-room** (decisão da Fase 1): salas por código `/r/<code>`, host/roles, convite por sala.

## Fase 3 — Polimento e escala (contínuo)

Branding final (logo/landing), domínio e HTTPS próprios, releases automáticas + changelog, licença do
repo definida, coturn/TURN próprio, limites/quotas e fila, revisão de segurança, multi-room maduro e
metas de acessibilidade (WCAG AA). ~~Build macOS assinado/notarizado~~ — não faz parte do produto web;
o empacotamento Electron fica arquivado como legado de estudo.

## Plano técnico — mídia, conectividade e QoL (detalhado)

Baseline hoje: câmera/mic por `getUserMedia` (640×360@24, device selection via replaceTrack),
tela por `getDisplayMedia` (Electron usa o handler do shell; web usa o picker do navegador), malha
WebRTC peer-a-peer com STUN (sem TURN), reconexão WS com 5 tentativas, sem diagnóstico de conexão na
UI, sem prévia local, sem áudio de tela, sem pausa de compartilhamento e sem controles de bitrate.
O modo offline/LAN continua gate de regressão (e2e 17/17); tudo abaixo é web-first.

Ordem recomendada: **NET → WC → SS → QoL** (conectividade e diagnóstico primeiro, porque é o que
faz os outros módulos parecerem bons ou ruins na internet).

### NET — conectividade online

| # | Entrega | Mudança mínima | Arquivos | Aceite | Esf. |
|---|---|---|---|---|---|
| ✅ NET-1 | ICE padrão robusto | 2 STUN (Google + Cloudflare) por padrão; `ICE_SERVERS` continua sobrescrevendo | `src/online/main.ts` | `/client-config.json` com ≥ 2 URLs de STUN | 0,25 d |
| ✅ NET-2 | Recuperação de ICE | `bundlePolicy: max-bundle`, `iceCandidatePoolSize`, `restartIce()` após blip de rede e queda limpa com recreação pelo watchdog | `client/src/media/useMedia.ts` | blip de rede < 10 s volta sem recrear a sessão; sessão que não volta é recriada | 0,5 d |
| ✅ NET-3 | Reconexão WS resiliente | 10 tentativas com backoff + jitter, mensagem genérica de internet | `client/src/net/connection.ts` | tirar/voltar rede do navegador reconecta sozinho (check e2e online) | 0,25 d |
| ✅ NET-4 | Retomada de sessão | `join` com token de sessão; servidor mantém o jogador por 30 s (`detach`/grace) em vez de `playerLeft` imediato; `welcome` devolve `session`; `leave` explícito remove na hora | `src/server/room.ts`, `src/shared/protocol.ts`, `src/server/server.ts`, `client/src/net/connection.ts` | queda curta volta como o mesmo jogador/id, sem respawn; testes unitários do grace + check WS no `verify-online` | 1–2 d |
| ✅ NET-5 | Diagnóstico de conexão na UI | `getStats`: tipo de par ICE (host/srflx/relay), RTT, jitter, perda; seção “Conexão” em Configurações + “copiar diagnóstico” | `client/src/media/useMedia.ts`, `client/src/components/SettingsPanel.tsx` | tela mostra direto/relay e RTT; sem expor dados sensíveis | 1 d |
| NET-6 | TURN de produção | endpoint `/turn-credentials` (coturn REST/HMAC) opcional por env + doc; fallback `ICE_SERVERS` | `src/server/server.ts`, `src/online/main.ts`, `docs/ONLINE_DEPLOY.md` | par relay aparece no diagnóstico com credencial expirada corretamente | 1 d |
| NET-7 | Qualidade adaptativa | se relay/RTT alto: baixar resolução/FPS e bitrate via `sender.setParameters`; reduzir vídeo remoto sob perda alta | `client/src/media/useMedia.ts` | gravação de stats mostra queda de bitrate ao limitar rede | 1–2 d |
| NET-8 | Cold start / primeira carga | primeira conexão com timeout maior e estado “acordando a sala” no overlay; retry automático extra | `client/src/net/connection.ts`, `client/src/components/ConnectionOverlay.tsx` | abrir a sala no Render após dormir funciona sem reload manual | 0,5 d |

### WC — webcam

| # | Entrega | Mudança mínima | Aceite | Esf. |
|---|---|---|---|---|
| ✅ WC-1 | Prévia local espelhada | prévia da própria câmera em **Configurações** (espelhada, sem áudio); tile no HUD fica para a sequência | ligar/desligar a câmera reflete na prévia | 0,5 d |
| WC-2 | Presets de qualidade | 360p@24 (padrão) e 720p@30; persistir no navegador/desktop | trocar preset sem recarregar; bitrate/CPU menores no 360p | 0,5 d |
| WC-3 | Hot-plug de câmera | `devicechange`: dispositivo sumiu → aviso + fallback para o padrão; plugado → aparece na lista | despluggar webcam não quebra a sala | 0,5 d |
| WC-4 | Câmera no celular | `facingMode` + botão front/back quando houver 2 câmeras | trocar front/back no celular | 0,5 d |
| WC-5 | Troca de câmera sem renegociação | validar `replaceTrack` (já existe) com 2 dispositivos e teste | trocar device não derruba peers | 0,25 d |
| WC-6 | Teste de câmera/mic | seção em Configurações: preview + medidor de nível do mic + botão testar | ver nível e imagem sem entrar na sala | 1 d |
| WC-7 | Erros acionáveis | permissão negada/device ocupado: mensagem com próxima ação + “tentar de novo” | erro não bloqueia chat/sala; dá para recuperar sem reload | 0,5 d |
| WC-8 | Câmera desligada | avatar/foto no lugar do vídeo remoto; remoto vê o avatar atualizado | par desligar câmera mostra avatar nos dois lados | 0,25 d |

### SS — compartilhamento de tela

| # | Entrega | Mudança mínima | Aceite | Esf. |
|---|---|---|---|---|
| SS-1 | Áudio do sistema/aba | `getDisplayMedia({ video, audio })`; track de áudio separado no sender; volume próprio na UI | som da tela chega no guest (Chrome/desktop); mic continua separado | 1–1,5 d |
| SS-2 | Qualidade e `contentHint` | presets 720p/1080p + `contentHint` (`detail` p/ texto, `motion` p/ vídeo) + bitrate via `setParameters` | texto legível; movimento sem travar; preset aplica na hora | 0,5–1 d |
| SS-3 | Pausar/retomar | pausa via `replaceTrack(null)` ou track encerrada sem derrubar sessão; indicador “tela pausada” | pausar mantém o peer e o painel; retomar volta a tela | 0,5 d |
| SS-4 | Múltiplos sharers | hoje só o primeiro aparece; adicionar seletor/carrossel de telas compartilhadas | 2 pessoas compartilhando aparecem na UI | 1 d |
| SS-5 | Picker/limitações | cancelar picker = silencioso (já ok); erro por SO/navegador com mensagem; iOS não suporta → mensagem clara | nenhum caminho silencioso sem feedback | 0,5 d |
| SS-6 | Estado da câmera | compartilhar com câmera off e restaurar câmera ao parar (já restaura); testar | parar tela devolve a câmera ao par | 0,25 d |
| SS-7 | Painel do viewer | expandir/fullscreen, ajuste de aspecto, fechar persistente por sharer | tela grande legível sem sair da sala | 0,5 d |

### QoL — prioridades

| # | Entrega | Aceite | Esf. |
|---|---|---|---|
| QoL-1 | Mute/deafen + push-to-talk | atalhos globais; ícones de estado; PTT configurável | 0,5–1 d |
| QoL-2 | Volume por pessoa + quem fala | sliders por participante; anel de fala no avatar | 1 d |
| QoL-3 | Menções e notificações | `@nome` destacado, badge, notificação nativa do navegador (com permissão) | 1 d |
| QoL-4 | Mobile/touch (T1.7) | joystick + ações + safe-area; chat em tela cheia | 1–2 d |
| QoL-5 | Navegação no mapa | zoom/pan, minimapa, “onde estou”, seguir pessoa | 1–2 d |
| ✅ QoL-6 | Compartilhar em 1 clique | link `/join` copiável na topbar do escritório (web/guest); share sheet nativo fica para o mobile | 0,25 d |
| QoL-7 | Ajuda e atalhos | overlay “?” com atalhos, foco em painéis, Esc consistente | 0,5 d |
| QoL-8 | Preferências web | status, preset de câmera e dispositivo escolhidos persistidos no navegador | 0,5 d |
| QoL-9 | Estados e erros | reconexão visível (T1.8), sala cheia, sem rede, picker cancelado | 0,5 d |
| ✅ QoL-11 | Feedback de captura | HUD com prévia local espelhada + status: câmera ao vivo / sem imagem / pausada no share / desligada e tela ao vivo / sem captura / sem quadros / ninguém na sala (track, peers e `framesSent` do `getStats`) | 1 d |
| ✅ QoL-10 | Efeitos sonoros (soundboard) | painel com até 20 efeitos; **diálogo de envio** com prévia/waveform, **corte para até 10 s**, nome, emoji e volume por som; toca localmente e transmite via WS para quem está perto; biblioteca em IndexedDB | 2,5 d |

### Critérios de aceite globais para qualquer entrega deste bloco

- `npm run typecheck`, `npm test`, `npm run test:e2e` (offline 17/17) e
  `node deploy/verify-online.mjs` (29/29 + novos checks) verdes.
- Nenhum request externo novo na página; TURN/STUN só via `/client-config.json`.
- Stats de mídia medidos (`getStats`), não estimados; documentar o número antes/depois nas tarefas
  de bitrate/qualidade.
- Mobile: testar em Chrome Android e Safari iOS reais; degradar com mensagem quando o navegador não
  suporta (ex.: `getDisplayMedia` no iOS).
- Acessibilidade dos novos controles: nome acessível, foco visível, alvo ≥ 24 px (44 px no touch).

### Primeiro sprint sugerido (5–7 dias)

NET-3 refinamento + NET-5 (diagnóstico) + NET-4 (retomada) → WC-1/WC-2/WC-6/WC-7 →
SS-1/SS-2/SS-3 → QoL-1/QoL-6, fechando com uma rodada de stats e uma de reconexão real.

Protótipo já entregue nesta rodada: **NET-1, NET-2 e NET-3** (ver commits e `verify-online`).

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Render free dorme (~15 min) → cold start 30–60 s ao abrir o link | aviso na home, keep-alive via monitor (trade-off de horas free) ou Oracle Always Free quando doer |
| NAT restritivo quebra mídia | STUN padrão + doc de TURN grátis + indicador/estado claro na UI |
| Escopo mobile inflar e atrasar o link | T1.7 com meta "funciona bem, não perfeito"; sem app nativo; validar em 2 celulares reais |
| Sem login → link público, qualquer pessoa entra (máx. 6) | manter rate limits, contador de capacidade, sem dados sensíveis; avaliar lock/moderação na Fase 2 |
| Rebrand quebra userData/deploy | M0 isolado, verificável e reversível; commit próprio e primeiro |
| CI macOS/Electron caro/lento | CI mínimo (typecheck/unit/build/online headless); e2e Electron continua local/manual |

## Decisões abertas (recomendações)

1. **Multi-room**: manter 1 sala por deploy na Fase 1 e decidir na Fase 2 — **recomendado**.
2. **Domínio**: usar `*.onrender.com` agora; domínio próprio (ex.: `dittoapp.dev`) na Fase 3 — **recomendado**.
3. **Render**: criar o serviço agora, depois do M0, para já testar com marca nova — **recomendado**.
4. **Rebrand defaults**: `DittoApp` (produto), `dittoapp` (npm), `com.dittoapp.app` (appId), userData
   reset aceito, repo `luhno/Gat` mantém o nome por enquanto — confirmar ou corrigir.
5. **Licença do repo**: manter `UNLICENSED` por enquanto; abrir (MIT?) na Fase 3 — **recomendado**.

## Progresso e próximo passo

- M0 (rebrand), **T1.0 (landing pública)**, **NET-4 (retomada de sessão)**, **T1.8 (reconexão visível)**
  e **QoL-6 (link copiável)**; T1.2/T1.3/T1.4 (link preview/favicon, perfil persistido
  no navegador, home web) **concluídos** — verificação online 29/29, unit 34/34 e regressão offline 17/17.
- **Pendente do usuário:** criar o serviço Render (`https://render.com/deploy?repo=https://github.com/luhno/Gat`)
  e informar a URL para eu validar o T1.1.
- Próximas entregas web na ordem: **T1.6 PWA**, **T1.7 mobile/touch**, **T1.8 reconexão**, **T1.9 mídia/TURN**,
  **T1.10 capacidade**, **T1.5 compartilhar**, **T1.11 CI**, **T1.12 domínio**.
