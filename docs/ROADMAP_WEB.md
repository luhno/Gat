# Roadmap web — DittoApp

Status: **proposta aprovada com defaults** (2026-10-28). Foco: **produto web**, sala única por deploy,
até 6 pessoas. Substitui como plano vigente a parte de produto do [`ROADMAP.md`](ROADMAP.md) (histórico de
rebrand/fases) e complementa [`QOL_AND_JUICE.md`](QOL_AND_JUICE.md) (game feel). Base do diagnóstico:
[`CHECKUP_REPORT.md`](CHECKUP_REPORT.md) e [`docs/audit/roadmap.md`](audit/roadmap.md).

Direção do dono: **não investir em mobile/desktop**. Electron e touch ficam em *keep-alive*: não
quebrar, não polir (regras na seção 6). Nada de telemetria de terceiros. Nada de conta/login.

## 1. Objetivo e sucesso (horizonte de 30–60 dias)

Qualquer pessoa recebe **um link** e, em menos de 15 s e sem instalar nada, entra numa sala onde
consegue: andar pelo escritório, conversar por chat e voz/vídeo perto das pessoas, compartilhar a tela e
usar o soundboard. O deploy é barato, observável e estável; os dados continuam sem sair do par (mídia
P2P) e sem telemetria.

Critérios de sucesso observáveis:

- `/join` abre a sala em produção; `/healthz` responde e diz quantas pessoas estão na sala;
- 7º visitante recebe "sala cheia" **na hora**, com mensagem clara (não "sem internet" após 70 s);
- abrir a sala depois de dormir (Render free) → aviso "acordando a sala" e entrada sem reload manual;
- queda de rede curta mostra "reconectando" e volta preservando jogador, chat e mídia;
- mídia conecta atrás de NAT comum (STUN) e, quando há TURN, a rota aparece no diagnóstico;
- um visitante malicioso **não** consegue ocupar as 6 vagas, inundar a sala nem abrir WS de outro site;
- quem nega permissão de câmera/mic consegue recuperar sem recarregar, e a UI nunca mostra "ligado" sem track;
- `npm test`, `verify-online` (32+), `verify-pwa`, `verify-mobile` e e2e local seguem verdes.

## 2. Onde o produto está (verificado no código)

**Pronto e funcionando:** sala única por deploy (máx. 6), landing pública em `/`, entrada por `/join`
com convidado único, perfil persistido no navegador, canvas do escritório com colisão compartilhada,
avatares com idle/blink, chat com rate limit, voz/vídeo por proximidade (malha WebRTC + STUN), screen
share com painel do viewer, HUD de mídia/diagnóstico, soundboard com corte ≤10 s e relay, sons de UI,
reconexão com backoff + retomada de sessão por 30 s, PWA instalável, mobile/touch funcional, deploy
Docker/Render documentado. Verificação: **127 checagens verdes** em 28/10.

**O que impede ser um produto web confiável** (detalhe e correção no checkup):

- servidor exposto sem limites de abuso, sem validação de `Origin`, sem headers de segurança;
- sourcemap público e fallback SPA que envenena o cache do service worker;
- proximidade/velocidade não impostas no servidor (teleporte e mídia para qualquer distância);
- `room_full`/reload/queda geram vaga-fantasma e reconexão errada; token de sessão só em memória;
- mídia "mente" (permissão negada terminal, áudio em dobro, `/join` pode abrir mudo) e o anel de fala não funciona;
- sem observabilidade (só log de boot; `/healthz` fixo), TURN com credencial pública, CI não versionado;
- dia a dia raso: sem moderação/host, sem histórico de chat, sem persistência de preferências, sem
  mídia "de reunião" (presets/teste de mic/PTT/volume), chat sem links/@menções, mapa sem zoom.
- deploy público ainda não existe (depende do dono criar o serviço Render).

## 3. H0 — "Web confiável" (1–2 semanas, ~8 d dev + 0,5 d dono) · P0

Gate para mandar o link. É a versão de produto dos P0 do [`CHECKUP_REPORT.md`](CHECKUP_REPORT.md) §3.
**Status 2026-10-28:** H0.2–H0.4, H0.6 e H0.7 entregues (código + testes + CI; ver checkup §1.1);
H0.5 (observabilidade) segue pendente; H0.1 (deploy público) depende do dono criar o serviço.

| # | Entrega | Escopo mínimo | Aceite observável | Dep. | Esf. |
|---|---|---|---|---|---|
| H0.1 | **Deploy público** | criar serviço Render pelo Blueprint (`render.yaml`) ou VM sempre-ligada; informar URL | `/join` entra, `/healthz` 200, 2 pessoas em redes diferentes com chat+mídia | dono | 0,5 d (dono) |
| H0.2 ✅ | **Servidor à prova de abuso** | teto de sockets + timeout de join 10 s + limite por IP (XFF via `TRUST_PROXY`), token bucket global p/ frames/bytes, relay de soundboard só p/ quem está perto | 25º socket recusado, 7º join = `room_full`, flood de `signal`/`profile` não passa do orçamento, som de quem está longe não chega | H0.1 | 2 d |
| H0.3 ✅ | **Borda segura** | `Origin`/`Host` no upgrade WS; headers (CSP com `frame-ancestors`, XFO, Referrer-Policy, Permissions-Policy); sourcemap off; fallback SPA só em navegação; `USER node` no Docker | `curl -I` mostra headers; `Origin: evil` recusado; `/assets/inexistente.js` → 404; `.map` → 404 | H0.1 | 1 d |
| H0.4 ✅ | **Cold start e retomada** | estado "acordando a sala" com timeout maior + retry; `leave` no `pagehide`; despejar vaga desconectada quando cheio; token em `sessionStorage` | abrir sala dormindo entra sem reload; F5 em sala cheia volta para a sala (mesmo nome; token retoma o mesmo id se o leave final não chegar); 7º entra quando alguém saiu | H0.2 | 1 d |
| H0.5 | **Observabilidade sem telemetria** | logs JSON de join/leave/room_full/erro WS/close (sem IP completo) + `/healthz` com `{ok, players, uptime, version}` | sessão de 7 conexões gera 6 joins + 1 `room_full`; `/healthz` mostra `players`; logs contam a história | H0.2 | 1 d |
| H0.6 ✅ | **TURN de produção** | validar `ICE_SERVERS` (stun/turn, url string/array); credencial efêmera coturn REST por env (`TURN_SECRET`) ou documentar relay público compartilhado | com TURN, Configurações mostra "Relay (TURN)"; credencial expira e renova; config inválida cai no default com log de erro | decisão | 1–1,5 d |
| H0.7 ✅ | **CI e regressão de abuso** | commitar `.github/workflows/ci.yml`; 6–8 testes de abuso (Origin, cap, timeout, flood, asset 404, headers); passo de `docker build` ou smoke do servidor web | run verde na `main`; badge resolve; testes novos quebram se algum fix regredir | H0.1 | 0,5 d |

## 4. H1 — "Web útil no dia a dia" (2–4 semanas, ~10–14 d) · P1

Depois de H0 no ar e com uso real. Sempre web-first.

| # | Entrega | Escopo mínimo | Aceite observável | Dep. | Esf. |
|---|---|---|---|---|---|
| H1.1 | **Host/moderação v1** | 1º a entrar = host (sem transferência na v1); pedir mute, expulsar por sessão, trancar sala; mensagens validadas no protocolo | host expulsa 1 de 3 → some e não volta na mesma sessão; sala trancada → mensagem clara; host sair não derruba a sala | H0.2 | 3 d |
| H1.2 | **Mídia de reunião** | presets 360p/720p persistidos; teste de mic com nível; hot-plug de câmera; erros acionáveis; depois PTT/deafen e volume por pessoa; áudio da aba (`getDisplayMedia({audio:true})`) | trocar preset sem reload; despluggar webcam não derruba a sala; nível do mic antes de entrar; som da aba chega ao par; volume por pessoa na sessão | H0.6 | 4 d |
| H1.3 | **Persistência de contexto** | últimas ~50 mensagens no `welcome` (memória), histórico local, preferências (dispositivo/preset) em `localStorage` | F5 mantém histórico e preferências; quem entra depois vê as últimas mensagens; nada de banco | — | 1,5 d |
| H1.4 | **Presença e chat do dia a dia** | toast de entrada/saída, "digitando…", mão levantada, emotes 1–4, autolink seguro + @menção | entrar/sair perceptível; emote/mão nas duas pontas <1 s; links viram âncora com `rel="noopener noreferrer"`; cooldown limita spam | H1.1 | 2,5 d |
| H1.5 | **Acessibilidade e foco** | foco inicial/restore nos painéis, `inert` no fundo de overlays, trap no dialog do soundboard, atalhos sem colisão (hoje `S` anda e abre painel) | fluxo completo por teclado; Esc devolve foco ao gatilho; sem controle atrás do overlay | — | 1 d |
| H1.6 | **Qualidade/performance do cliente** | assinatura seletiva do slice de jogadores; piso do mapa em offscreen; cache de vinheta; cap de bitrate do screen share | com 6 pessoas: sem queda de FPS no canvas, menos updates de store; share não passa do bitrate configurado | — | 2 d |
| H1.7 | **Mapa navegável (P2)** | zoom/pan (roda/pinça) + "onde estou" | zoom sem perder o avatar; atalho volta ao centro; sem conflito com clique-no-chão no touch | — | 1–2 d |
| H1.8 | **Multi-room (condicionado)** | `/r/<code>` + registro de salas + limites por sala | dois códigos = duas salas isoladas no mesmo deploy; `/join` segue na sala padrão | H0.2/H0.5 | 3–5 d |

Ordenação recomendada: **H0 inteiro → H1.1 → H1.3 → H1.2 → H1.4/H1.5 → H1.6**. H1.8 só se H0.5
mostrar picos/`room_full` que justifiquem; antes disso, dois deploys resolvem dois grupos.

## 5. H2 — "Ferramentas web diferenciadas" (só com demanda medida) · P2

Entram só com H1 estável e dados de uso (via H0.5) mostrando necessidade. Pequenas, sem dependência nova.

| # | Ferramenta | Por quê | Escopo mínimo | Esf. |
|---|---|---|---|---|
| H2.1 | **Timer compartilhado** | escritório virtual favorece foco/pomodoro; é a ferramenta colaborativa mais barata (estado pequeno no WS) | qualquer pessoa inicia/pausa; todos veem na topbar; sobrevive a reconexão | 0,5–1 d |
| H2.2 | **Enquete rápida** | decisão rápida sem sair da sala | pergunta + opções; voto validado no servidor (1 por jogador); resultado ao vivo | 1 d |
| H2.3 | **Quadro de recados da sala** | o que precisa ficar visível (agenda, links) sem poluir o chat | texto puro editável pelo host, last-write-wins, em memória, sanitizado | 1 d |

**Não construir agora:** whiteboard completo (3–5 d, só depois de H2.1–H2.3 provarem demanda; hoje
existe só o objeto decorativo), contas/login/billing, apps nativos/app store, editor de mapa, gravação de
reunião, upload de imagens/arquivos no chat (storage+moderação+custo), música via YouTube/Spotify
(licenciamento + request externo), fundo virtual, gamificação/streaks, integrações de calendário, push de
PWA, features de Electron, i18n além de EN e só com usuários fora do pt-BR.

## 6. Mobile e desktop: depriorização explícita

**Congelado (não investir):** app nativo iOS/Android/app store; features mobile-only (câmera traseira,
screen share no iOS, PTT no touch, push, install prompt A/B); PWA além do atual (push, background sync,
edição offline, splash); **Electron** — mini mode, auto-launch, notificações nativas, deep link, updater,
assinatura/notarização, DMG/releases, tray; otimização de layout mobile além de correção de regressão;
testes em aparelhos reais além de smoke; i18n/tema mobile.

**Keep-alive (não quebrar, não polir):**

- Gates obrigatórios continuam: `verify-pwa` 17/17, `verify-mobile` 27/27, sem overflow em 320 px,
  safe-area; e e2e Electron 17/17 como gate **local/manual** enquanto o legado existir.
- Mudança em canvas/avatar/chat/painéis/layout exige `verify-mobile` + `verify-pwa` e smoke em 1 iPhone +
  1 Android quando mexer em touch (~0,5 d por release que toque UI).
- Bug mobile só se impedir entrar/andar/chat/mic em Chrome Android/Safari iOS atuais.
- Electron: manter compilando e o fluxo LAN funcionando; nenhum release novo; DMG é arquivo de estudo.
- Arquivamento definitivo do Electron fica para depois de H1 (proposta em [`ARCHITECTURE.md`](ARCHITECTURE.md),
  passo 5) — funciona hoje e tirá-lo agora compete com H0.

## 7. Próximos 14 dias (ordem de execução, ~12 d)

1. **Dono (0,5 d):** criar deploy Render e informar a URL; validar `/join`, `/healthz`, 2 navegadores.
2. **H0.2 (2 d):** tetos de socket/IP/join, orçamento de mensagens, soundboard filtrado no servidor.
3. **H0.3 (1 d):** Origin/Host, headers, sourcemap off, fallback 404 de asset, Docker non-root.
4. **H0.4 (1 d):** cold start + `pagehide` + token em `sessionStorage` + despejo de vaga desconectada.
5. **H0.5 (1 d):** logs JSON + `/healthz` útil.
6. **H0.7 (0,5 d):** commitar CI + testes de abuso + docker build/smoke.
7. **H0.6 (1–1,5 d):** validação de ICE + TURN efêmero (ou documentar relay público).
8. **H1.1 (3 d):** host/moderação v1.
9. **H1.3 (1,5 d):** histórico/welcome + preferências web.
10. **Verificação final (1 d):** `typecheck`, `npm test`, `test:e2e` local, `verify-online/pwa/mobile`,
    smoke em 2 redes; atualizar `docs/VERIFICATION.md` com os checks novos.

Se estourar: corta H1.1 para a semana seguinte — **H0 é o gate para mandar o link**.

## 8. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Render free dorme (~15 min) → cold start 30–60 s | H0.4 (aviso + retry); aceitar e reavaliar always-on depois de uso real |
| NAT restritivo quebra mídia sem TURN | H0.6 + diagnóstico já existente na UI |
| Abuso de sala pública sem login | H0.2/H0.3; host/moderação em H1.1 |
| Vaga-fantasma/limite de 6 expulsa quem chega pelo link | H0.4 (despejo de desconectado + token persistido) |
| Escopo de "ferramentas web" inflar antes do produto ser confiável | H2 só com dados de H0.5; H0/H1 têm prioridade absoluta |
| Refactor de arquitetura competir com entrega | migração em passos ≤1 dia **depois** de H0; quarentena Electron adiada |
| Credencial TURN/cota | H0.6 com credencial efêmera ou relay público documentado; monitorar custo |

## 9. Decisões abertas (com recomendação)

1. **Multi-room vs 1 sala/deploy:** recomendo **1 sala** até H0.5 + 2–4 semanas de uso; se precisar de
   dois grupos antes, **dois deploys** (quase zero esforço). Multi-room = 3–5 d + estado/limites/roteamento.
2. **Auth/moderação:** recomendo **sem login**; host = 1º a entrar, sem transferência na v1; lock por env;
   expulsão por sessão. Contas só com uso externo real.
3. **TURN/provider:** recomendo TURN gerenciado com free tier (Cloudflare Calls TURN ou Metered para
   teste) + `/turn-credentials` HMAC; coturn self-host só com VM always-on. **Decisão necessária para H0.6.**
4. **Hospedagem/domínio:** recomendo **Render Free agora**; sempre-ligado (Oracle always free/pago) e
   domínio próprio depois de H0 mostrar uso. Domínio não bloqueia.
5. **Observabilidade:** recomendo logs estruturados no Render + `/healthz` JSON; nada de analytics de
   terceiros. Uptime monitor externo opcional (ping evita sleep mas consome horas free — aceitar cold start).
6. **Limites:** manter **6 jogadores** (mesh O(n²)) configurável por env; revisar com métricas de
   `room_full`. Soundboard filtrado no servidor.
7. **Persistência:** recomendo `localStorage` + últimas 50 mensagens em memória; **sem banco** enquanto
   for 1 sala efêmera.
8. **Mobile:** recomendo confirmar keep-alive (sem feature nova) e reavaliar em ~6 meses.

## 10. Não verificado

- Deploy público, cold start do Render, headers/compressão/limites do proxy: não há URL pública validada
  (T1.1 pendente) e nada foi deployado neste checkup.
- TURN/NAT reais, câmera/mic/screen share com hardware real e Safari iOS/Chrome Android físicos: testes
  usam devices fake e loopback (ver [`docs/VERIFICATION.md`](VERIFICATION.md) e
  [`docs/audit/verification.md`](audit/verification.md)).
- Carga/soak/produção (6 peers mesh, memória, rate limits sob flood) e custos/quota de TURN/Render.
- PWA em iOS real, upgrade do service worker entre deploys e comportamento atrás de proxy corporativo.
