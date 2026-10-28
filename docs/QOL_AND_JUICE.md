# DittoApp — Roadmap de QoL e Game Juice

Status: **proposta para aprovação** (2026-10-28) · Complementa (não substitui) o
[`ROADMAP.md`](ROADMAP.md). Escopo: produto **100% web**, salas de até 6 pessoas.

"Juice" aqui é **game feel**: resposta imediata, peso, som, presença e personalidade — sempre a
serviço da clareza. Nada de animação que esconde estado, som sem controle ou gamificação viciante.

## Objetivo e critérios de sucesso

Fazer o escritório parecer vivo e gostoso de usar sem custar acessibilidade, privacidade ou
performance.

- Toda ação responde em **≤ 100 ms** com feedback visual (e sonoro opcional): entrar, andar, clicar
  no chão, mandar mensagem, ligar/desligar mídia, compartilhar tela, usar um som.
- Dá para **sentir presença** sem falar: quem entrou/saiu, quem está perto, quem está falando, quem
  digitou, quem levantou a mão, reações.
- O ambiente tem **personalidade discreta** (mapa vivo, som ambiente opcional), sem virar carnaval.
- **Tudo desligável**: som (volume/mute) e movimento (respeitar `prefers-reduced-motion` + override).
- 60 fps no canvas com as animações novas; nenhuma dependência ou asset externo; nenhuma telemetria.

## Inventário atual (para calibrar o esforço)

Já existe: walk cycle com bob/stride, câmera com ease, HUD de captura (câmera/tela), soundboard,
badge de chat não lido, status/chips, painéis funcionais. Lacunas principais:

- transições de UI inconsistentes (sem tokens de movimento/press state universal);
- **nenhum som de interface** (só o soundboard);
- sem reação expressiva além do avatar andando (sem emotes, sem mão levantada, sem digitação);
- nenhuma pista de presença (entrada/saída, conexão por proximidade, quem está falando);
- mapa quase estático e sem ambiência; `prefers-reduced-motion` não é tratado no app;
- preferências de som/movimento inexistentes.

## Princípios de design

1. **Clareza primeiro**: juice reforça estado, nunca é a única informação (todo motion tem cue
   estático: cor, ícone ou texto).
2. **Reduced motion é requisito**: movimento vira crossfade; parallax/partículas desligam.
3. **Som opt-in e com mixer**: nada toca antes de um gesto; mute global, volume de efeitos e de
   ambiente separados; persistido.
4. **Rápido e curto**: 100–300 ms; entradas raras podem ser mais expressivas; alta frequência
   (hover/tab) ≤ 150 ms.
5. **Zero assets externos**: síntese via Web Audio + CSS/canvas; sem CDN, sem arquivos pesados.
6. **Sem dark patterns**: sem streaks, moedas, recompensa compulsiva; a diversão vem da presença.

## Sprint 1 — "Resposta imediata" (3–5 dias) — P0

| # | Entrega | Detalhe | Aceite | Esf. |
|---|---|---|---|---|
| J1.1 | Tokens de movimento | durações/easings em token; press 0.96 em 150 ms (`:not(:disabled)`), hover só em `(hover:hover)`, foco visível | todo controle com press/focus consistentes; nenhum `transition: all` | 0,5 d |
| J1.2 | Painéis e toasts | painéis entram com slide+fade 180 ms, saem 150 ms; chat badge "pula" ao receber; toast de sistema no canto | abrir/fechar chat, participantes, settings e soundboard com transição e foco correto | 1 d |
| J1.3 | Avatar com micro-vida | respiração e piscada em idle, giro suave de direção, sombra que acompanha o passo | avatar parado não parece "congelado"; sem custo perceptível de FPS | 1 d |
| J1.4 | Entrada/saída com presença | pop scale+fade ao entrar/sair, toast discreto "Fulano entrou" e som opcional | entrar/sair é perceptível sem abrir participantes | 0,5 d |
| J1.5 | Andar com peso | ripple no clique do chão, marcador de destino, poeirinha curta nos pés, parada com leve "settle" | andar e clicar no chão dão confirmação imediata | 0,5 d |
| J1.6 | Quem está falando | anel/glow pulsando no avatar quando o áudio do peer está ativo (RMS via AnalyserNode), respeitando reduced motion | falante identificado visualmente; sem análise quando sem áudio | 1 d |
| J1.7 | Sons de interface | biblioteca Web Audio sintetizada: mic on/off, obturador da câmera, chime de entrar/sair, pop de mensagem, tela iniciar/parar, erro suave | todos os sons têm master mute + volume; nada antes de gesto | 1,5 d |
| J1.8 | Preferências de feel | "Sons da interface" (on/off+volume), "Som ambiente" (futuro), "Reduzir movimento" (auto + override), persistidas no navegador/desktop | desligar som/movimento funciona e sobrevive a reload | 0,5 d |

## Sprint 2 — "Presença expressiva" (3–5 dias) — P0/P1

| # | Entrega | Detalhe | Aceite | Esf. |
|---|---|---|---|---|
| J2.1 | Conexão por proximidade | linha/faísca entre avatares quando a mídia conecta + ping suave; fade ao afastar | ao chegar perto de alguém há feedback claro do "canal abriu" | 1 d |
| J2.2 | Emotes/reações | 👋 👍 😂 ❤️ ❓, atalhos 1–4, cooldown 5 s, emoji flutua no canvas, som curto | reação aparece para quem está perto e para o próprio autor; abuso limitado | 1,5 d |
| J2.3 | Levantar a mão | toggle com pulso no avatar + toast; atalho dedicado | mão levantada visível e desligável | 0,5 d |
| J2.4 | Digitando… | indicador no chat e "…" acima do avatar enquanto digita; throttle | aparece/desaparece sem flicker; não vaza conteúdo | 1 d |
| J2.5 | Status expressivo | depois de 2 min sem interação vira "Ausente"; foco mostra zZz discreto; dot de status anima só ao mudar | status lido sem abrir painel | 0,5 d |
| J2.6 | Passos com espacialidade | som de passos por proximidade, pan pela posição x, volume no mixer; opcional | liga/desliga no mixer; não atrapalha voz | 1 d |

## Sprint 3 — "Ambiente e personalidade" (1–2 semanas) — P1

- **J3.1 Mapa vivo (1,5 d)**: plantas balançando, variação de luz quente por horário real, reflexos
  leves; tudo em sprites/offscreen com cap de partículas.
- **J3.2 Onboarding com personalidade (1 d)**: preview do avatar respirando, entrada animada uma vez,
  confete discreto no primeiro join (sem repetir em reloads).
- **J3.3 Micro-copy com voz (0,5 d)**: estados vazios, toasts e mensagens de sistema no tom do produto
  (direto, sem "oops", sem exclamação).
- **J3.4 Chat juice (1 d)**: mensagens entram com slide curto, menção pulsa, som distinto para menção.
- **J3.5 Celebrações leves (0,5 d)**: primeira mídia conectada, sala cheia (6 pessoas) com toast/som
  discreto; nada repetitivo.
- **J3.6 Mixer completo (1 d)**: canais Interface / Passos / Ambiente / Soundboard, com mute e volume
  por canal e persistência.

## Sprint 4 — "Polimento, acessibilidade e performance" (contínuo) — P0

- **J4.1 Reduced motion completo (0,5 d)**: todas as animações com fallback de crossfade; teste
  automatizado com `prefers-reduced-motion: reduce`.
- **J4.2 Feedback não-visual (1 d)**: `aria-live` para entrada/saída/menção/mão levantada; sons com
  texto redundante; nunca só cor/movimento.
- **J4.3 Orçamento de performance (1 d)**: medir FPS/churn antes e depois, cap de partículas,
  offscreen para o mapa, sem alocações no loop.
- **J4.4 Calibração de feel (0,5 d)**: A/B de durações/easings/volumes com checklist de "parece certo"
  (gravar GIFs de antes/depois como evidência).
- **J4.5 Modo sóbrio (0,25 d)**: um toggle "menos animação/som" para quem prefere o essencial.

## Catálogo priorizado (P0 → P2)

**P0 (fazer primeiro):** tokens de movimento, press/feedback de controles, painéis/toasts, entrada e
saída com presença, sons de UI com mixer, quem está falando, reduced motion, preferências de feel.

**P1:** emotes, mão levantada, digitando, conexão por proximidade com ping, passos espaciais, mapa
vivo, chat juice, onboarding com personalidade.

**P2:** celebrações leves, mixer completo, modo sóbrio, calibrações finas, ambiência por horário.

## Fora de escopo / anti-patterns

- partículas pesadas, screen shake, flash, motion que esconde estado;
- sons em loop sem controle, volume alto, autoplay sem gesto;
- streaks/moedas/loot/notificações compulsivas; qualquer telemetria;
- assets externos ou dependências novas para animação/som;
- gamificação que atrapalhe a reunião real (juice para trabalhar, não para viciar).

## Arquitetura técnica (o que será tocado)

- `client/src/styles/global.css` + novos tokens de motion; `client/src/media/media.css` para o HUD.
- `client/src/office/avatar.ts`, `scene.ts`, `OfficeCanvas.tsx` — idle/blink, partículas com cap,
  floating emotes, ripple, speaking ring (canvas).
- Novo `client/src/audio/uiSound.ts` — singleton Web Audio (synth), unlock por gesto, mixer e
  persistência; análise de RMS dos streams remotos para o anel de fala.
- Novo `client/src/office/juice.ts` — fila de efeitos visuais (partículas/emojis), cap e descarte.
- `client/src/state/store.ts` + `SettingsPanel` — preferências (`soundEnabled`, `sfxVolume`,
  `reducedMotion` override, `juiceLevel`).
- Protocolo: emote/reaction/typing/hand-raise como mensagens WS validadas e com rate limit (mesmo
  padrão do chat/soundboard); sem mudança em mídia/WebRTC.
- Hook de teste: `__gatherTest().juice` (último emote, mão levantada, reduced motion, som) +
  `dataset` para o `verify-online`.

## Verificação por entrega

- Gates que não podem quebrar: `npm run typecheck`, `npm test`, `npm run test:e2e` (offline 17/17),
  `node deploy/verify-online.mjs` (crescer com checks novos).
- Checks novos no `verify-online`: emote via atalho → `juice.lastEmote` nas duas pontas; toggle de som
  persiste; `prefers-reduced-motion` desliga partículas (contexto `reducedMotion: 'reduce'`); typing
  indicator via WS.
- E2E Electron: screenshots antes/depois para office/chat/HUD; checar que o canvas continua 60 fps
  (amostra de frames em 1 s) e que HUD/captura seguem corretos.
- Revisão de acessibilidade a cada sprint: nomes acessíveis, foco, contraste, reduced motion, nenhum
  estado só por cor/movimento.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Movimento causar enjoo/distração | tokens curtos, reduced motion, modo sóbrio, nada de shake/parallax |
| Som irritar em reunião | mixer, mute, volumes baixos, nada de loop obrigatório, reset por sessão |
| Perda de FPS em máquinas fracas | cap de partículas, offscreen canvas, medir antes/depois, desligar efeitos sob carga |
| Escopo de "juice virar produto" | cada item precisa de aceite de clareza; cortar o que não melhora a percepção de estado |
| Acessibilidade regredir | reduced motion + aria-live como gate, não como polimento final |

## Ordem recomendada e próximo passo

1. Aprovar este roadmap e priorizar (sugestão: Sprint 1 inteiro).
2. Executar J1.1 → J1.2 → J1.7 → J1.3/J1.4/J1.5/J1.6 → J1.8, cada um com commit e evidência
   (screenshot/GIF quando for visual).
3. Medir com o time real: quais efeitos ajudam e quais distraem; cortar sem dó.

Enquanto isso, o roadmap técnico segue em paralelo nos itens bloqueados por terceiros (deploy Render,
domínio) e nas pendências de webcam/screen share.
