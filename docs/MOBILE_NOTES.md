# Mobile / touch (T1.7)

Notas do modo celular da sala web. O app Electron/LAN usa o mesmo cliente: nada aqui muda o
desktop (a HUD de toque só monta quando o aparelho é touch).

## O que foi feito

- **Detecção**: `client/src/mobile/useIsTouch.ts` — `(pointer: coarse)` + largura ≤ 1024px, com
  `navigator.maxTouchPoints` como reforço para emulação/tablets. Sem sniffing de user-agent.
- **Viewport dinâmico**: o mesmo arquivo publica `--app-height` (visualViewport) enquanto a sala
  está aberta; `.office-screen` usa essa altura. Barra de endereço recolhendo ou teclado abrindo
  não desalinham canvas nem chat, e o `ResizeObserver` do canvas reajusta o DPR sozinho.
- **Joystick**: `client/src/mobile/VirtualJoystick.tsx`, 132px, dead zone 18%, analógico (a
  deflexão escala a velocidade), captura um único pointer — dá para andar e tocar em botão ao
  mesmo tempo. Soltar/cancelar/sair da tela zera o vetor. No `OfficeCanvas` o vetor é lido no
  rAF (sem re-render) e o clique-no-chão e o WASD continuam iguais.
- **Ações**: a `Toolbar` existente é reaproveitada (mesmos handlers, mesmos `data-testid`) e vira
  um rail vertical flutuante à direita no celular; alvos de 46px, `aria-labels` e
  `aria-orientation="vertical"`.
- **Painéis**: chat, participantes, configurações e soundboard viram bottom sheet (72dvh, largura
  total, cantos superiores arredondados). Fecham pelo botão, por swipe para baixo no cabeçalho e
  por `Esc`. O wrapper `.office-side` só existe quando há painel aberto, então não rouba o toque
  do canvas.
- **Topbar compacta**: esconde nome do app, endereço LAN/link e latência; mantém sala, contagem de
  pessoas e status de conexão (com safe-area no topo).
- **Chat**: input com `enterKeyHint="send"`, fonte 16px (iOS não dá zoom no foco), `padding-bottom:
  env(safe-area-inset-bottom)` no painel.
- **Dicas de teclado**: rodapé da home (M/V/C/P/Esc) escondido em telas estreitas ou ponteiro
  coarse; o `aria-label` do canvas troca a instrução de WASD pela do joystick em touch.
- **Sem zoom acidental**: `touch-action: none` no canvas e no joystick; `manipulation` nos botões.
- **HUD local de câmera** (do media) sai do canto do joystick e vai para o topo-esquerda em touch.

## Verificação

```bash
npm run build && node deploy/build-online.mjs
node deploy/verify-mobile.mjs      # 27/27, screenshot docs/online/mobile-office.png
node deploy/verify-online.mjs      # 32/32 desktop/online
npm run test:e2e                   # 17/17 offline (mesmo OfficeCanvas, WASD/clique intactos)
```

`deploy/verify-mobile.mjs` sobe o servidor standalone numa porta efêmera e usa Chrome via
`playwright-core` (channel "chrome"), viewport 390x844 com `hasTouch`, DPR 2. Cobre: joystick
visível e arrastando o avatar (posição em `window.__gatherTest()`), parada ao soltar,
chat abre/envia/fecha, configurações e participantes (bottom sheet + swipe), câmera alterna e
prévia local aparece, sem overflow horizontal em 390px e 320px, `--app-height` acompanhando o
resize, `touch-action`, safe-area e o contexto desktop 1280x800 sem joystick e com toolbar
horizontal. Falha → exit code ≠ 0, servidor e browser fechados no `finally`.

## Limites conhecidos

- Teclado virtual não é emulável no harness headless: o ajuste de altura vem do
  `visualViewport` e da safe-area; conferir num aparelho real (iOS Safari e Chrome Android) antes
  de release.
- O layout de celular é o retrato (≤760px de largura). Celular deitado (ex.: 844x390) mantém o
  HUD de desktop com o joystick: dá para andar e usar os controles, mas chat/configurações abrem
  no painel lateral curto. Paisagem de tablet acima de 1024px também fica no layout de desktop
  (joystick escondido); para mudar, ajustar os breakpoints em `useIsTouch.ts` e no `global.css`.
- Pinch-zoom segue liberado de propósito (acessibilidade); o "zoom acidental" evitado é o
  double-tap nos controles e o do input ao focar.
- O joystick é só toque; teclado continua sendo o caminho acessível de movimento.
