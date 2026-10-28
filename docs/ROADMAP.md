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
| **A. Link-first (1 sala por deploy)** — **recomendada** | Melhorar o online atual: deploy fixo, onboarding, PWA, mobile, reconexão, TURN, meta/OG, capacidade. Sem refactor de servidor. | 1–2 semanas | Cada deploy = 1 sala (16 pessoas). Simples e entrega valor rápido; multi-room fica para depois. |
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
| T1.1 | Deploy fixo | Render Free (Blueprint `render.yaml`), health check `/healthz`, doc "deploy em 5 min"; uptime/monitor opcional documentado | URL pública estável; `/healthz` 200; `/join` abre a sala; cold start explicado | 0,5 d (usuário cria conta) |
| ✅ T1.2 | Link preview + favicon | meta `description`, Open Graph/Twitter no `index.html`; favicon e `theme-color` | colar o link no WhatsApp/Discord mostra DittoApp + descrição; favicon correto | 0,5 d |
| ✅ T1.3 | Nome/avatar persistidos no navegador | `localStorage` para perfil quando não há bridge desktop; restaurar no boot; opção de limpar | recarregar e abrir nova aba mantém nome/avatar; anônimo vira `Convidado NNNN` | 1 d |
| ✅ T1.4 | Home web clara | esconder seção LAN no navegador, CTA "Entrar na sala", campo nome, contador de pessoas, link copiável | usuário novo entra em 2 cliques sem instruções; sem textos de "host" enganosos | 1 d |
| T1.5 | Compartilhar | botão copiar link + `navigator.share` (mobile); QR fica para a Fase 2 | copiar/share funcionam em desktop e mobile | 0,5 d |
| T1.6 | PWA instalável | `manifest.webmanifest` + ícones + service worker cache do shell + página de fallback sem rede | "adicionar à tela inicial" no Android/iOS; reabrir offline mostra shell com aviso; WS continua funcionando quando online | 1–1,5 d |
| T1.7 | Mobile/touch | canvas responsivo (viewport dinâmico), joystick/mobile controls, safe-area, esconder dicas de teclado, chat usável no celular | Safari iOS + Chrome Android: andar, abrir chat, mídia; sem overflow/zoom acidental | 2–3 d |
| T1.8 | Reconexão visível | overlay "reconectando (n/5)", retry manual, volta automática sem sair da tela | desligar Wi-Fi 10 s → overlay → volta sozinho; sem recarregar página | 1 d |
| T1.9 | Mídia na internet | `ICE_SERVERS` documentado + indicador de qualidade/estado; teste de câmera/mic nas configurações; unlock de áudio no mobile (gesto) | mídia conecta atrás de NAT comum; sem TURN, mensagem clara; áudio toca no celular após toque | 1–2 d |
| T1.10 | Capacidade | contador `X/16` e mensagem amigável de sala cheia | a 17ª conexão vê "sala cheia", sem stack trace | 0,5 d |
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

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Render free dorme (~15 min) → cold start 30–60 s ao abrir o link | aviso na home, keep-alive via monitor (trade-off de horas free) ou Oracle Always Free quando doer |
| NAT restritivo quebra mídia | STUN padrão + doc de TURN grátis + indicador/estado claro na UI |
| Escopo mobile inflar e atrasar o link | T1.7 com meta "funciona bem, não perfeito"; sem app nativo; validar em 2 celulares reais |
| Sem login → link público, qualquer pessoa entra (máx. 16) | manter rate limits, contador de capacidade, sem dados sensíveis; avaliar lock/moderação na Fase 2 |
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

- M0 (rebrand) e T1.2/T1.3/T1.4 (link preview/favicon, perfil persistido no navegador, home web)
  **concluídos** — verificação online 11/11 e regressão offline 17/17.
- **Pendente do usuário:** criar o serviço Render (`https://render.com/deploy?repo=https://github.com/luhno/Gat`)
  e informar a URL para eu validar o T1.1.
- Próximas entregas web na ordem: **T1.6 PWA**, **T1.7 mobile/touch**, **T1.8 reconexão**, **T1.9 mídia/TURN**,
  **T1.10 capacidade**, **T1.5 compartilhar**, **T1.11 CI**, **T1.12 domínio**.
