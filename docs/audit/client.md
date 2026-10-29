# Auditoria do cliente web — DittoApp (2026-10-28)

Auditoria **somente leitura** de `client/**` (React + Vite + WebRTC). Baseline: 127 checagens
automatizadas verdes (34 unit, 32 online, 17 PWA, 27 mobile, 17 e2e Electron — ver
`docs/audit/verification.md`). A suíte não testa Safari/Firefox, screen share no navegador,
reconexão com mídia ativa, `devicechange` nem autoplay; os achados abaixo vivem nesse vão.

## O que este cliente faz

- **Home (`/room`)**: escolhe nome, cor, cabelo, status; link `/join` entra direto na sala
  (`autojoin=1`, nome automático `Convidado NNNN`). Perfil fica em `localStorage` na web.
- **Escritório**: canvas em tela cheia com mapa 44×28 tiles, colisão, câmera com ease, avatares
  procedurais (andar, respirar, piscar), clique-para-andar, atalhos WASD/setas.
- **Voz/vídeo por proximidade**: malha P2P (1–5 conexões), entra a ~4,5 tiles e sai a ~5,5;
  negociação "perfect negotiation" com iniciador pelo menor id; troca de dispositivo por
  `replaceTrack`; áudio remoto em `<audio>` oculto com `setSinkId`.
- **Screen share**: `getDisplayMedia`, troca o track de vídeo e força conexão com todos. Painel do
  viewer; HUD de saúde (câmera/tela ao vivo, viewers, rota/`getStats`).
- **Chat** (rate limit 8/5 s), **participantes**, **configurações**, **soundboard** (até 20 clipes
  em IndexedDB + envio por WS para quem está perto), **sons de interface** sintetizados.
- **PWA**: `manifest` + service worker cache-first de `/assets` e network-first do shell `/room`,
  aviso offline; **camada touch** (joystick, bottom sheets); **bridge Electron legado** opcional.
- Reconnect WS com backoff+jitter, token de sessão e retomada por 30 s no servidor.

## Carga assumida

- Navegador desktop atual (Chrome/Safari/Firefox das últimas 2 versões), 1280–1920 px, DPR ≤ 2,
  máquina de 4+ núcleos; alvo 60 fps no canvas.
- Sala única pública de **até 6 pessoas**, tráfego pela internet: sinalização via WSS same-origin,
  mídia P2P por STUN (TURN opcional). Cada cliente mantém no máximo 5 conexões WebRTC simultâneas.
- Câmera 640×360@24 por padrão; tela compartilhada via `getDisplayMedia` (resolução do monitor).
- Entrada principal é o link `/join`; `/room` é a home opcional. Mobile é secundário (manter
  funcionando, não investir).

## Resumo

| ID | Severidade | Achado |
|---|---|---|
| C1 | Must | `connect()` sem guarda: dois sockets → jogador fantasma na sala |
| C2 | Must | Token de sessão só em memória: F5 com sala cheia = bloqueado ~30 s |
| C3 | Must | Permissão de mídia negada é definitiva; toolbar e peers mentem que mic/câmera estão ligados |
| C4 | Must | Anel "quem está falando" nunca acende (analyser criado em stream vazio) |
| C5 | Must | Áudio remoto toca em dobro (tile de vídeo sem `muted` + `<audio>` oculto) |
| C6 | Must | Link `/join` sem gesto: áudio remoto pode ficar mudo sem retry nem aviso |
| C7 | Should | Qualquer `move` re-renderiza a árvore React inteira (~66×/s com 6 pessoas) |
| C8 | Should | Canvas redesenha o piso e aloca gradiente/arrays a cada frame |
| C9 | Should | `room_full`/`protocol_mismatch` viram 10 tentativas de reconexão e mensagem genérica |
| C10 | Should | Screen share sem cap de bitrate/resolução: 5 encodes e até ~10 Mbps de upload |
| C11 | Should | Painéis/overlays sem gestão de foco: teclado não alcança conteúdo e foca controles atrás do overlay |
| C12 | Should | Atalho `S` colide com andar para baixo (abre soundboard **e** move o avatar) |
| C13 | Should | Escolha de microfone/câmera/saída não persiste na web; sem `devicechange` |
| C14 | Should | Chat/soundboard somem em silêncio durante reconexão (e o app diz "enviado") |
| C15 | Should | PWA: navegação sem timeout → tela branca no cold start (Render dorme 30–60 s) |
| C16 | Should | Cache do SW nunca é versionado/limpo e pode gravar o fallback HTML como se fosse JS |
| C17 | Nice | HUD diz "câmera pausada" ao compartilhar tela, mas a câmera continua capturando |
| C18 | Nice | Pegada mobile (~340 linhas) e Electron-no-cliente (~180) para deprioritizar/remover |
| C19 | Nice | Endurecimento: sourcemap público, CSP permissiva, hook de teste no bundle de produção |
| C20 | Nice | Screen share: iOS sem suporte com erro genérico; 2º sharer invisível; painel fechado não reabre |

**4 itens menores omitidos** (listados no fim). Esforço: **S** ≤ 0,5 dia · **M** 0,5–2 dias · **G** > 2 dias.

---

## Must fix

### C1 — `connect()` sem guarda abre dois WebSockets e cria jogador fantasma

**Onde:** `client/src/net/connection.ts:76` (só retorna se `OPEN`), `client/src/net/connection.ts:80-118`,
`client/src/home/HomeScreen.tsx:156-161` (Enter não checa `busy`), `client/src/office/OfficeScreen.tsx:178-180` (retry).
**Cenário:** na home, apertar Enter duas vezes rápido no campo Nome (o handler chama `openOffice()` de
novo antes do `disabled` valer) → segunda chamada vê `readyState === CONNECTING` (não `OPEN`), cria
outro socket e sobrescreve `this.socket`. O servidor recebe dois `join` sem token de sessão e cria
**dois jogadores** (`src/server/room.ts:100-155`). O segundo `welcome` vira o `selfId`; o primeiro
socket fica aberto e ignorado (`connection.ts:92`: `if (this.socket !== socket) return`), mas ocupa
uma vaga das 6 e aparece para os outros como "Convidado NNNN" parado. Pior: quando esse socket órfão
fechar, o `onclose` dele chama `stopTimers()` sem verificar identidade (`connection.ts:112-117`) e
derruba os timers de move/ping do socket bom → reconexão em cascata.
**Menor correção:** guardar a promise em voo (`if (this.socket && this.socket.readyState !== CLOSED) return this.pending`)
e, no `onclose`, só agir se `this.socket === socket`; em `HomeScreen`, ignorar Enter quando `busy/connecting`.
**Esforço:** S.
**Se ficar:** jogador duplicado/oculto consumindo vaga, mídia que "não conecta" com esse fantasma e
reconexões em cascata; qualquer duplo clique/Enter chega lá.

### C2 — Token de sessão só existe em memória: F5 com a sala cheia bloqueia o usuário por ~30 s

**Onde:** `client/src/net/connection.ts:36` (token só no módulo), `:87-89` (reenvia no reconnect),
`:267` (zera no leave); grace de 30 s em `src/server/room.ts:79` e `:245-258`.
**Cenário:** sala com 6 pessoas; alguém dá F5. O documento novo nasce sem `sessionToken`, então o
`join` é um jogador **novo** — mas o servidor ainda mantém o slot antigo em `detach` por 30 s. O
`join` esbarra em `players.size >= MAX_PLAYERS` e devolve `room_full`. O cliente reconecta 10 vezes
(1 s, 2 s, 4 s, 8 s, 10 s…) até o slot expirar (~35 s), mostrando "Reconectando…". Enquanto isso a
pessoa não consegue voltar e os outros a veem "na sala" duas vezes (nome igual, um parado).
**Menor correção:** guardar o token em `sessionStorage` ao receber o `welcome` e reenviá-lo no
primeiro `join` após reload (limpar em `disconnect()`); assim o servidor retoma o mesmo id/posição.
**Esforço:** S.
**Se ficar:** recarregar a página em sala cheia é uma armadilha de 30 s com mensagem errada; em
sala não cheia, todo F5 deixa um fantasma visível por 30 s.

### C3 — Permissão de mídia negada é terminal: toolbar e os peers dizem que mic/câmera estão ligados

**Onde:** `client/src/media/useMedia.ts:466-494` (`acquireTrack` só na inicialização),
`:590-610` (aquisição única no mount), `:822-836` (`toggleAudio/toggleCamera` só trocam flags),
`:492` (`setMediaError` nunca é limpo em caso de sucesso); `useMedia.ts:242-247`/`:249-254`;
`client/src/components/SettingsPanel.tsx:169-215`; `client/src/office/OfficeScreen.tsx:204-213`.
**Cenário:** no primeiro boot a pessoa clica "Bloquear" no prompt de câmera/microfone. Ficam
`localAudioTrack = localCameraTrack = null`, mas `audioEnabled/videoEnabled` continuam `true`: a
toolbar mostra mic e câmera ligados e `sendMedia` anuncia para a sala que estão ligados. Clicar no
mic liga/desliga uma flag que não controla track nenhum; quem está perto vê "microfone ligado" e não
ouve nada. Se a pessoa liberar a permissão depois nas configurações do navegador, plugar um headset ou
uma webcam, **nada acontece** (não há `devicechange` nem nova tentativa de `getUserMedia`) — só
recarregar resolve; e o aviso vermelho de erro nunca some.
**Menor correção:** ao ligar um dispositivo sem track, tentar `acquireTrack` de novo; assinar
`navigator.mediaDevices.addEventListener("devicechange", refreshDevices)`; limpar `mediaError` em
sucesso; só anunciar `audioEnabled/videoEnabled` depois de ter (ou tentar) o track.
**Esforço:** M.
**Se ficar:** a primeira impressão de quem nega o prompt é "o app não funciona"; o estado exibido é
falso dos dois lados e não há recuperação sem reload. Já previsto como WC-3/WC-7 no ROADMAP.

### C4 — O anel "quem está falando" nunca acende

**Onde:** `client/src/media/useMedia.ts:314-323` (analyser criado em `createPeer`, quando o
`MediaStream` remoto ainda está vazio), `client/src/office/OfficeCanvas.tsx:306-314` (lê
`dataset.speaking`), `:329`/`:346` (usa no avatar).
**Cenário:** `createPeer()` roda antes da oferta/ICE, portanto `session.stream` tem **zero tracks**
quando `createMediaStreamSource(stream)` é criado. A Web Audio API fixa a faixa na criação do nó: um
stream vazio fica em silêncio para sempre (e no Firefox a chamada pode até lançar, caindo no `catch`
e deixando `analyser = null`). Resultado: o RMS é sempre 0, `document.body.dataset.speaking` fica
vazio e nenhum avatar — nem o próprio, que nem é analisado — ganha o anel verde. O item J1.6 do
`docs/QOL_AND_JUICE.md` está marcado como entregue.
**Menor correção:** criar o analyser dentro de `pc.ontrack` quando chegar uma track de áudio
(`new MediaStream([track])` ou `createMediaStreamTrackSource`), guardar o source no `PeerSession` e
desconectar no `closePeer`.
**Esforço:** S/M.
**Se ficar:** recurso anunciado (e testado só visualmente?) que não funciona; pior, a lógica de
`speaking` fica como código morto.

### C5 — Áudio do peer toca em dobro

**Onde:** `client/src/office/OfficeCanvas.tsx:396-399` (`<VideoTile stream={stream} label={...} />`
sem `muted`), `client/src/media/VideoTile.tsx:51` (`<video ... muted={muted}>` com `muted` indefinido),
`client/src/media/useMedia.ts:276-313` (stream remoto contém áudio **e** vídeo; `<audio>` oculto
separado toca o mesmo áudio).
**Cenário:** duas pessoas com câmera perto uma da outra. O mesmo stream remoto é tocado duas vezes:
no `<audio>` oculto (o único que respeita `selected.audioOutputId` via `setSinkId`) e no `<video>`
do tile do avatar, que não está mutado. O som sai ~6 dB mais alto/possivelmente com diferença de
fase, e o dispositivo de saída escolhido nas Configurações só vale para um dos dois plays.
**Menor correção:** `<VideoTile ... muted />` no `OfficeCanvas` (o componente já aceita a prop;
o áudio continua no `<audio>` oculto).
**Esforço:** S (uma prop).
**Se ficar:** áudio duplicado e volume errado em toda conversa com vídeo; quem troca saída de áudio
continua ouvindo pelo alto-falante padrão no tile.

### C6 — Link `/join` entra sem gesto: áudio remoto pode ficar mudo, sem retry nem aviso

**Onde:** `client/src/App.tsx:36-52` (autojoin imediato, sem interação), `client/src/media/useMedia.ts:307-313`
(`audioEl.play()` chamado uma única vez, com stream vazio; erro engolido), `client/src/audio/uiSound.ts:210-216`
(só o som de interface tem unlock por gesto).
**Cenário:** a pessoa abre o link compartilhado `/join`; o app conecta sozinho, sem nenhum gesto no
documento. O `<audio>` remoto nasce e `play()` é chamado **antes de existir áudio** e o catch descarta
qualquer falha. Navegadores que aplicam a política de autoplay ao passar a haver áudio (Safari/iOS é o
caso clássico; Chrome trata áudio WebRTC pela mesma política de ativação do usuário) deixam a sala
muda; como não há retry em gesto nem botão "ativar som", só recarregar resolve — e o problema volta,
porque o reload de `/room?autojoin=1` também é autojoin.
**Menor correção:** escutar o primeiro `pointerdown`/`keydown` e chamar `play()` em todos os
`audioEl` (reaproveitar o unlock do `uiSound`); se algum `play()` rejeitar, mostrar "Toque para ouvir".
**Esforço:** S.
**Se ficar:** o link principal do produto pode abrir uma sala silenciosa, sem nenhum sinal de erro —
falha total para o caso de uso. **Depende do navegador; testar em Safari iOS** (ver Não verificado).

---

## Should fix

### C7 — Qualquer `move` re-renderiza a árvore React inteira

**Onde:** `client/src/state/store.ts:75-81` (`setState` notifica todos; `useStore` assina o estado
inteiro), `:107-112` (`updatePlayer` cria novo `players` a cada mensagem), `client/src/net/connection.ts:228-231`
(`queueMove` **também** escreve no store a cada ~90 ms), `client/src/App.tsx:16`,
`client/src/office/OfficeScreen.tsx:56`, `client/src/office/OfficeCanvas.tsx:56`.
**Cenário:** com 6 pessoas andando, cada cliente recebe ~11 `playerMoved/s` por peer (≈55/s) e ainda
grava o próprio movimento (~11/s) → **~66 atualizações de store/s**, cada uma re-renderizando App +
OfficeScreen + OfficeCanvas (o comentário em `OfficeCanvas.tsx:15-16` diz que o movimento não
re-renderiza — está incorreto). São ~200 renderizações de componente por segundo junto do canvas a
60 fps; em notebook fraco isso vira quedas de frame e leque subindo.
**Menor correção:** assinatura seletiva (`useSyncExternalStore` com seletor) ou separar o slice de
`players`; o canvas já lê `getState()` no rAF e poderia manter os anchors por DOM/ref sem assinar o
store inteiro.
**Esforço:** M.
**Se ficar:** custo de CPU desnecessário que cresce com o número de pessoas; é o tipo de coisa que
só aparece justamente na sala cheia.

### C8 — Canvas: piso redesenhado e gradiente/arrays alocados a cada frame

**Onde:** `client/src/office/OfficeCanvas.tsx:350-357` (cria `RadialGradient` de vinheta + `fillRect`
de tela cheia por frame), `:267` (`Object.entries(stateNow.players)` por frame), `:390`
(`Array.from(anchors.children)` por frame), `client/src/office/scene.ts:546-567` (redesenha tile a
tile), `:501` (`[...players].sort` por frame).
**Cenário:** 27×17 tiles visíveis = **459 tiles** redesenhados a cada frame (≈27,5 mil `fillRect`/s,
cada um com 1–4 operações) + vinheta full-screen criada do zero; a 1440×900 com DPR 2 isso é ~5,2 M
pixels de fill por frame (front face + vinheta) além dos móveis/avatares. Em máquina integrada/
bateria isso é o que derruba o alvo de 60 fps — e o piso é estático, pode ser desenhado uma vez.
**Menor correção:** pré-renderizar o piso (mapa 44×28 = 1408×896 px de mundo) num canvas offscreen
e desenhar com 1 `drawImage` por frame; cachear a vinheta por tamanho/DPR no `resize()`; trocar
`Object.entries`/`Array.from` por arrays reutilizados.
**Esforço:** M.
**Se ficar:** frame budget gasto antes de mídia/avatares; queda em telas grandes/DPR 2 e aquecimento
do notebook.

### C9 — Erros terminais do servidor viram 10 reconexões e mensagem genérica

**Onde:** `client/src/net/connection.ts:99-106` (welcome), `:167-169` (`error` só seta texto),
`:112-117` (`onclose` rejeita com erro genérico), `:182-198` (reconexão sempre), `client/src/App.tsx:49-51`
e `client/src/home/HomeScreen.tsx:74-75` (catch sobrescreve); overlay em `client/src/components/ConnectionOverlay.tsx:25-29`.
**Cenário:** o 7º a abrir o link recebe `{t:"error", code:"room_full"}` e o servidor fecha. O cliente
não trata isso como terminal: descarta o texto específico no `reject` ("Não foi possível conectar ao
servidor da sala"), entra em "Reconectando…" e tenta mais 10 vezes por ~70 s; quando desiste mostra
erro genérico de internet. O mesmo acontece com `protocol_mismatch`/`invalid_profile`. Pior: o botão
"Tentar novamente" chama `connect()` com `reconnectAttempt` já em 10, então uma nova falha volta ao
error na hora, sem backoff.
**Menor correção:** guardar a última mensagem de `error`; ao recebê-la, parar reconexão e marcar
estado terminal; `connect()` rejeita com essa mensagem; retry manual zera `reconnectAttempt` e
`manualClose`.
**Esforço:** S.
**Se ficar:** "sala cheia" é comunicada como "sem internet" depois de 70 s; usuário acha que o
produto caiu e não sabe que basta esperar alguém sair.

### C10 — Screen share sem cap de bitrate/resolução: 5 encodes e até ~10 Mbps de upload

**Onde:** `client/src/media/useMedia.ts:533-554` (`getDisplayMedia` com `{video:true}`),
`:249-254` (`applyVideo` só faz `replaceTrack`); não há `contentHint`, `setParameters`,
`maxBitrate` nem `scaleResolutionDownBy` em lugar nenhum (`grep` vazio).
**Cenário:** uma pessoa compartilha o monitor 1440p para 5 pessoas. A malha abre 5 conexões, cada
uma com encoder próprio: o navegador é obrigado a codificar a tela **5× em paralelo** e cada conexão
negocia seu próprio bitrate (tipicamente ~1–2,5 Mbps para tela). Isso dá **5–12 Mbps de upload** no
sharer — acima do upload típico residencial (5–20 Mbps) — e CPU de 5 encodes. Resultado: todo mundo,
inclusive o sharer, trava a tela; a voz também degrada pela congestão.
**Menor correção:** limitar a captura (`width/height: {max: 1280×720}`, `frameRate: {max: 15}`) e
aplicar `sender.setParameters({ encodings: [{ maxBitrate: ... }] })` proporcional ao número de
peers (ex.: 1,2 Mbps / peers, mínimo ~250 kbps) ao criar/atualizar cada peer.
**Esforço:** M.
**Se ficar:** o recurso mais pesado do produto é justamente o que mais facilmente derruba a chamada
na internet real; já previsto como SS-2/NET-7 no ROADMAP.

### C11 — Painéis e overlays sem gestão de foco

**Onde:** `client/src/office/OfficeScreen.tsx:215-248` (painel renderizado antes da toolbar),
`client/src/components/ConnectionOverlay.tsx:22-41`, `client/src/media/ScreenSharePanel.tsx:20-25`,
`client/src/soundboard/SoundboardPanel.tsx:311-326` (dialog `aria-modal`), foco só em
`client/src/chat/ChatPanel.tsx:27-29`.
**Cenário:** usuário de teclado/cliente de leitor de tela tabula até "Abrir participantes" e aperta
Enter: o painel abre, mas o foco continua no botão da toolbar; como o painel vem **antes** da toolbar
no DOM, o Tab a partir do gatilho percorre o resto da página (outros botões, canvas, topbar) e só
chega ao painel depois de dar a volta no documento — enquanto isso o conteúdo aberto fica fora do
foco. Fechar com Esc remove o painel com o foco em um elemento que deixou de existir (volta ao
`body`). No overlay de reconexão, o fundo continua focável: Tab+Enter pode acionar "Sair" atrás do
overlay. O dialog do soundboard (`aria-modal`) não prende foco e o backdrop também não fecha.
**Menor correção:** ao abrir, focar o título/primeiro controle do painel; guardar o elemento
disparador e devolver o foco ao fechar; aplicar `inert`/`aria-hidden` no fundo enquanto overlay ou
dialog estiver aberto (ou prender Tab nos dois); no overlay, focar "Tentar novamente".
**Esforço:** M.
**Se ficar:** produto web inacessível por teclado justamente nos painéis principais; contraria a
regra de acessibilidade do `docs/CONTRACTS.md` (bug funcional, não estilo).

### C12 — Atalho `S` abre o soundboard e faz o avatar andar para baixo

**Onde:** `client/src/office/OfficeScreen.tsx:119-142` (`case "s": togglePanel("soundboard")`) +
`client/src/office/OfficeCanvas.tsx:24` (`MOVE_KEYS` inclui `"s"`) e `:109-117` (window keydown).
**Cenário:** no escritório, apertar `S` dispara os dois listeners globais: o painel de efeitos
sonoros abre **e** o avatar começa a andar para baixo enquanto a tecla estiver pressionada
(levantar solta). O `preventDefault` do canvas não impede o outro listener. Quem tenta usar os
atalhos documentados na home (`M · V · C · P · Esc`) descobre que só o `S` tem esse efeito colateral.
**Menor correção:** trocar o atalho do soundboard por uma tecla que não esteja em `MOVE_KEYS`
(ex.: `B`) ou ignorar teclas de painel no canvas quando houver painel aberto.
**Esforço:** S.
**Se ficar:** qualquer uso do atalho move o avatar sem intenção (e pode afastar a pessoa do grupo,
cortando o áudio).

### C13 — Escolha de dispositivo não persiste na web e não reage a hot-plug

**Onde:** `client/src/desktop.ts:88-91` (`persistDeviceSettings` retorna cedo sem bridge),
`client/src/media/useMedia.ts:122-129` (`selectedFromSettings` lê settings do desktop),
`:556-588` (selects atualizam só memória), `:497-509` (refresca lista só na inicialização/troca),
`client/src/components/SettingsPanel.tsx:169-215`.
**Cenário:** na web, a pessoa troca o microfone para o headset USB nas Configurações, conversa
normalmente e fecha a aba. No dia seguinte entra de novo: o app volta para o microfone padrão do
sistema (o do notebook) **sem avisar** — `selected.audioInputId` volta a `null`/default. Se ela
desconectar o headset durante a chamada, a track morre e nada migra para o padrão; se conectar uma
webcam depois de entrar, ela não aparece na lista até recarregar. Em Safari, o seletor "Saída de
áudio" aparece mas não faz nada (`setSinkId` não existe; falha é engolida em `useMedia.ts:142-144`).
**Menor correção:** persistir os três ids em `localStorage` (mesmo padrão do perfil em
`desktop.ts:17-43`) e restaurar no boot; `devicechange` → `refreshDevices()` e trocar para o default
quando o track atual morrer; esconder o seletor de saída quando `setSinkId` não existir.
**Esforço:** M.
**Se ficar:** as pessoas falam com o microfone errado sem perceber (o clássico "estou mudo?"); já
previsto como QoL-8/WC-3 no ROADMAP.

### C14 — Chat e soundboard somem em silêncio durante a reconexão

**Onde:** `client/src/net/connection.ts:214-218` (`send` descarta se o socket não está `OPEN`),
`:233-238` (`sendChat` retorna `true` mesmo descartando), `:249-255` (# soundboard em
`client/src/soundboard/soundboard.ts:223-246`), `client/src/chat/ChatPanel.tsx:54-61` (limpa o input
e toca "enviado").
**Cenário:** durante um blip de Wi-Fi o socket fecha; o overlay "Reconectando…" aparece, mas o foco
continua no input do chat aberto. A pessoa digita e aperta Enter nesse instante: `sendChat` corta/
valida, chama `send` que **descarta sem erro**, retorna `true`, o input é limpo e o som "mensagem
enviada" toca. A mensagem nunca chega a ninguém e o autor não tem como saber. No soundboard, um
clipe que estava sendo transmitido em chunks tem os chunks restantes descartados (`sendSoundboard`
→ `send`) e o receiver só toca clipes completos — falha silenciosa.
**Menor correção:** `send()`/`sendChat()` retornam `false` se o socket não está aberto (e o
`ChatPanel` mantém o texto + aviso "sem conexão, mensagem não enviada"); opcionalmente enfileirar
chat e drenar no `connected`.
**Esforço:** S/M.
**Se ficar:** perda silenciosa de mensagens no exato momento em que o usuário mais precisa de
feedback — e o app afirma que enviou.

### C15 — PWA: navegação sem timeout deixa tela branca no cold start

**Onde:** `client/public/sw.js:38-52` (`navigation()` faz `await fetch(request)` sem limite antes de
cair no cache), `client/src/pwa.ts:10-18` (probe só reage a eventos online/offline).
**Cenário:** o deploy documentado é Render Free, que dorme após ~15 min (`docs/ONLINE_DEPLOY.md`);
acordar leva 30–60 s. Abrir o app instalado (ou `/room`) com o proxy segurando a requisição → o SW
espera o `fetch` sem timeout, a página fica **branca** por até 1 min, e o shell cacheado (que abriria
imediatamente com o aviso offline e reconectaria sozinho em background) nunca é usado. Se o fetch
falhar rápido, o shell abre, mas a faixa "sem conexão" também não some sozinha quando a sala acorda.
**Menor correção:** `Promise.race([fetch(request), timeout(3500)])` → em timeout, servir o shell
do cache e deixar o WS/reconexão assumir quando a sala acordar (banner "Acordando a sala…").
**Esforço:** S.
**Se ficar:** o primeiro clique no link público pode ser uma página branca de até 1 min — o pior
primeiro contato possível; anula parte do valor do PWA.

### C16 — Cache do SW: versão estática, sem poda, e fallback HTML pode ser gravado como asset

**Onde:** `client/public/sw.js:8` (`CACHE = "ditto-shell-v1"` fixo), `:27-35` (activate só apaga
caches de nomes diferentes), `:55-62` (`asset()` cache-first grava qualquer resposta `ok` de
`/assets/*`).
**Cenário:** (a) a cada deploy os `/assets/index-<hash>.js|css` antigos continuam no cache para
sempre (o nome da cache nunca muda), porque a única poda é por nome de cache — o Cache Storage só
cresce. (b) O servidor devolve o `index.html` com **200 text/html para asset inexistente**
(medido em `docs/audit/verification.md`: `GET /assets/nope.js → 200 text/html`); se um asset for
pedido durante uma troca de deploy (ou por uma versão velha do HTML), o SW grava HTML (1,8 KB, `ok`)
na chave `/assets/*.js` em cache-first e aquela chave fica **permanentemente** envenenada naquele
dispositivo → boot quebrado até limpar o storage.
**Menor correção:** derivar o nome da cache do build (ou bumpar `v2` no deploy) e no `activate`
apagar assets que não pertencem ao shell atual; em `asset()`, só cachear quando
`content-type` bater com a extensão (JS/CSS/fonte) e responder com erro/network quando vier HTML.
**Esforço:** S.
**Se ficar:** cache crescendo sem limite e um risco pequeno mas irrecuperável (para o usuário) de
app quebrado por asset "cacheado" como HTML.

---

## Nice to have

### C17 — HUD diz "câmera pausada" ao compartilhar tela, mas a câmera continua capturando

**Onde:** `client/src/media/useMedia.ts:670-704` (`cameraLive` não muda ao compartilhar),
`:249-254` (troca só o track enviado; `localCameraTrack` segue `live`/`enabled`),
`client/src/media/MediaHealthHud.tsx:20-28` (texto "Câmera pausada enquanto a tela está no ar").
**Cenário:** a pessoa compartilha a tela e vê no HUD "Câmera pausada enquanto a tela está no ar";
ela acredita que a câmera parou, mas o LED do equipamento continua aceso e a captura continua
rodando (só não está sendo enviada). É uma promessa de privacidade que o código não cumpre; também
gasta CPU/câmera à toa durante todo o share.
**Menor correção:** ou `localCameraTrack.enabled = false` enquanto compartilha (LED pode continuar,
mas não processa frames) e reabilitar ao parar, ou trocar o texto para "Câmera ligada, mas não
está sendo enviada".
**Esforço:** S.
**Se ficar:** expectativa de privacidade errada e custo desnecessário; risco baixo, barato de ajustar.

### C18 — Pegada mobile (~340 linhas) e Electron-no-cliente (~180): deprioritizar/remover

**Onde:** `client/src/mobile/*` (160 linhas: `useIsTouch`, `VirtualJoystick`, viewport dinâmico),
~181 linhas de CSS só-mobile (`client/src/styles/global.css:1374-1518`, `:1829-1860`,
`client/src/media/media.css:194-206`), `client/src/desktop.ts` (96), `client/src/home/HomeScreen.tsx:276-345`
(seção LAN), `client/src/components/TopBar.tsx:30,55-60`, `client/src/components/SettingsPanel.tsx:15,51`.
**Cenário:** o app web tem 8.183 linhas em `client/src`; ~4% são exclusivamente touch e ~2% existem
só para o bridge Electron (que não faz parte do produto web). A camada touch já está pronta e testada
(27/27 em `verify-mobile`), então não há ganho em polir mais; o bridge Electron no cliente (`desktop.ts`,
bloco LAN da home, `persistDeviceSettings`) só adiciona branches e contratos que a web não usa
(`docs/CONTRACTS.md` descreve um cliente que já não é este — ex.: não menciona soundboard/HUD/stats).
**Menor correção:** decisão de produto: manter mobile "não quebrar" (sem investir) e, se a web for o
produto, executar a quarentena do Electron já proposta em `docs/audit/architecture.md` (mover
`src/main`/`src/preload` para `legacy/`, remover o bridge do cliente); atualizar o CONTRACTS para o
cliente web atual.
**Esforço:** 0 para a decisão; M para a remoção (tem receita no architecture.md).
**Se ficar:** cada feature web nova precisa passar por mais um caminho legado; docs desatualizados
levam a implementações divergentes.

### C19 — Endurecimento: sourcemap público, CSP permissiva, hook de teste no bundle

**Onde:** `client/vite.config.ts:15` (`sourcemap: true` no build de produção — medido:
`/assets/index-*.js.map` responde 1,4 MB com o código-fonte completo em `docs/audit/verification.md`),
`client/index.html:9` (`connect-src 'self' wss: ws:` — WebSocket para **qualquer** origem),
`client/src/main.tsx:10-55` (`window.__gatherTest` expõe nomes/posições/chats em produção).
Headers de segurança (`CSP` por header, `frame-ancestors`, `Referrer-Policy`, HSTS) são
responsabilidade do servidor — ver `docs/audit/server.md`.
**Cenário:** hoje não há injeção conhecida (React escapa tudo, `script-src 'self'`), então o risco é
de defesa em profundidade: se qualquer XSS surgir no futuro, a CSP permite abrir WebSocket para fora
e exfiltrar; e qualquer pessoa baixa o mapa do bundle para ler o código-fonte/webhook internos.
**Menor correção:** build de produção com `sourcemap: false` (ou mapas enviados só ao observability);
apertar `connect-src` para `'self'` (o app só fala WSS same-origin; STUN/TURN não passam por CSP);
manter o hook de teste, que é somente leitura e usado pelos harnesses, mas registrar a decisão.
**Esforço:** S.
**Se ficar:** postura de segurança abaixo do custo zero de corrigir; exposição de 1,4 MB de código.

### C20 — Screen share: iOS sem suporte com erro genérico; 2º sharer invisível

**Onde:** `client/src/media/useMedia.ts:533-554` (`getDisplayMedia` chamado sem feature-detect),
`client/src/office/OfficeScreen.tsx:182` (`Array.from(remoteScreenSharing).find(...)` — mostra só o
primeiro), `:186-188` + `:291-297` (dismiss por sharer).
**Cenário:** (a) no iPhone/Safari sem `getDisplayMedia`, tocar em "Compartilhar tela" cai no `catch`
genérico "Não foi possível compartilhar a tela." — sem dizer que o navegador não suporta nem que é
esperado no iOS (SS-5 do ROADMAP). (b) Duas pessoas compartilham ao mesmo tempo: o app escolhe o
primeiro do Set e só ele aparece; o segundo aperta compartilhar, a tela é capturada e os peers
recebem, mas **ninguém vê** nem existe indicação de "mais 1 tela compartilhada".
**Menor correção:** `if (!navigator.mediaDevices.getDisplayMedia) → mensagem específica e esconder/
desabilitar o botão`; para múltiplos, mostrar contador/lista de sharers ou permitir alternar
(roadmap SS-4); reabrir o painel quando o sharer "dismissado" começar um novo share.
**Esforço:** S/M.
**Se ficar:** botão morto no iOS e pessoas "compartilhando para ninguém" sem saber por quê.

---

## Itens menores omitidos (4)

1. `SettingsPanel` agenda `setSaved(false)` em `setTimeout` sem cleanup (`SettingsPanel.tsx:52-53`) e
   o aviso de mídia aparece duplicado (HUD + painel) sem botão de fechar (`OfficeScreen.tsx:211`).
2. `?name=` em `/?autojoin=1&name=Ana` é ignorado quando o visitante já tem perfil salvo
   (`App.tsx:42-46`); links com nome não funcionam para quem já usou o app.
3. Chat não vem no `welcome` (histórico só do que cada cliente presenciou), apesar de o ROADMAP
   prometer "histórico da sessão visível ao entrar" — decisão de produto/servidor, não bug do cliente.
4. Rolagem do chat sempre "pula" para o fim quando chega mensagem, mesmo se o usuário estiver lendo o
   histórico (`ChatPanel.tsx:31-34`); correção de 1 linha (só rolar se já estava perto do fim).

## Não verificado:

- **Não reproduzi os bugs em navegador real** nem rodei build/verify (escopo do `verification`);
  as evidências são leitura de código, docs e medições já registradas em `docs/audit/verification.md`.
- **Safari/iOS, Firefox e celulares reais não foram testados.** O achado C6 (autoplay no `/join`) e o
  C13 (`setSinkId`) dependem do navegador — precisam de teste manual em Safari iOS.
- **Números de C7/C8/C10 são analíticos** (constantes `MOVE_SEND_INTERVAL_MS=60`, throttle de 90 ms,
  459 tiles, resolução x bitrate default), não perfilados; não medi FPS, CPU, memória nem upload real.
- **NAT/TURN e internet real** não foram exercitados (verify roda em loopback); C10 não tem medição de
  banda.
- **Screen share no navegador web não tem teste automatizado** (só o e2e Electron cobre); não validei
  cancelamento de picker, troca de monitor nem iOS.
- **Reconexão com mídia ativa, esgotamento das 10 tentativas e retomada de sessão após 30 s** não foram
  exercitados de ponta a ponta.
- **Service worker em dois deploys consecutivos**, offline real, quota de IndexedDB e `localStorage`
  cheio/desabilitado não foram testados.
- **Acessibilidade** não foi auditada com leitor de tela real; C11 é análise de fluxo de foco, e a
  suíte cobre só contraste/zoom/`prefers-reduced-motion` da landing e app.
- **Carga e estresse** (6 clientes reais, many sockets, flood) não foram medidos; C1/C2 são cenários
  derivados do protocolo, não observados em produção.
- **Código Electron/legado** (`src/main`, `src/preload`, `client/src/desktop.ts`) não foi exercitado
  além do e2e existente; a pegada C18 é contagem de linhas, não análise de dependência.
