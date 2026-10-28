# Build e execução — DittoApp

Guia de build e execução do DittoApp. **Decisão de produto (2026-10-28): o produto é 100% web** — o
fluxo principal é compilar o cliente + servidor online (`npm run build` + `node deploy/build-online.mjs`)
e rodar/deployar o servidor (seção "Modo online"). As seções de app desktop e empacotamento macOS
ficam como **legado/estudo**; não é mais necessário gerar `.app`/`.dmg` nas próximas entregas.

O app é um estudo de engenharia reversa independente, **não afiliado à Gather Presence Inc.**

## Pré-requisitos

- macOS (validado em macOS 27.0.1 arm64; o alvo de build é arm64).
- Node.js 24 (validado com v24.21.0) e npm 11 — os scripts usam ESM e `node --test`.
- Dependências fixadas no `package-lock.json`; nada é instalado em runtime.
- Sessão gráfica ativa para abrir o app (não é um app headless).

```bash
cd Gat
npm install        # só na primeira vez (é o único passo que precisa de internet)
npm run typecheck  # opcional: tsc --noEmit
```

> Se o seu shell exporta `ELECTRON_RUN_AS_NODE=1` (comum em IDEs/agentes), remova antes de
> executar o app: `unset ELECTRON_RUN_AS_NODE`. Veja [Troubleshooting](#troubleshooting).

## Build

```bash
npm run build
```

Gera:

| Saída | Conteúdo |
|---|---|
| `dist/client/` | bundle web (Vite: React, canvas, painéis, mídia) |
| `dist/main/main.cjs` | processo principal do Electron (esbuild, CJS) + `preload.cjs` |

Se a janela abrir com a página "Cliente não compilado", rode `npm run build` e abra de novo.
`npm start` **não** compila: ele assume um build existente (`npm run dev` faz build + start).

## Rodar

```bash
npm start          # electron .
```

No primeiro boot o app gera um certificado TLS self-signed no userData, sobe o servidor
HTTPS+WSS embutido em `https://127.0.0.1:8787` (se a porta estiver ocupada, tenta
8788…8791) e abre a janela.

- **Host**: preencha o nome e clique em **Abrir meu escritório**. A home mostra os endereços
  LAN (`https://192.168.x.y:8787/`) e a topbar mostra o endereço atual; compartilhe-o com os colegas.
- **Guest** (outra máquina, com o mesmo app): preencha o nome, informe `ip-do-host:8787` em
  **Entrar em sala da LAN** e clique em **Entrar**. A janela navega para a página do host
  (`?autojoin=1`) e entra na sala; **Sair** volta para a home local.
- Só endereços loopback/privados são aceitos (`127.0.0.1`, `localhost`, `10.x`, `172.16–31.x`,
  `192.168.x`). O certificado self-signed é aceito **apenas** para esses hosts.
- Não há descoberta automática de salas (mDNS): o endereço é informado manualmente.

### LAN e firewall (macOS)

- Todas as máquinas precisam estar na mesma sub-rede e conseguir alcançar a porta do host.
- No macOS, se o Firewall estiver ligado, permita conexões de entrada para o **DittoApp**
  (Ajustes do Sistema → Rede → Firewall → Opções) ou desative o modo de bloqueio para o teste.
  Na primeira execução o sistema pode perguntar "Deseja aceitar conexões de rede de entrada?".
- Redes com isolamento de clientes (AP isolation) bloqueiam o acesso ao host e o P2P da mídia:
  chat/presença funcionam pelo host, mas o WebRTC pode não conectar.
- Não há STUN/TURN externos: a mídia é peer-to-peer na LAN, por design.

### Flags e variáveis úteis

| Flag / env | Efeito |
|---|---|
| `--port=<n>` | porta base do servidor embutido (default 8787) |
| `--join=<host:porta>` | abre já como guest na sala indicada |
| `--multi-instance` | ignora o single-instance lock (usado pelo e2e) |
| `--fake-media` | `use-fake-device-for-media-stream` + `use-fake-ui-for-media-stream` |
| `--offline-guard-strict` | aborta o app no primeiro request fora de loopback/rede privada |
| `GATHER_OFFLINE_USER_DATA=<dir>` | userData isolado (perfil, settings, certificado, logs) |
| `GATHER_OFFLINE_NO_TRAY=1` | não cria o ícone de tray (usado nos testes) |

Exemplo (duas instâncias na mesma máquina, com câmera/mic falsos):

```bash
GATHER_OFFLINE_USER_DATA=/tmp/gather-host npm start -- --multi-instance --fake-media --port=8890
# noutro terminal (perfil isolado para não compartilhar settings/certificado):
GATHER_OFFLINE_USER_DATA=/tmp/gather-guest npm start -- --multi-instance --fake-media --port=8891
# na janela da 2ª instância, entre em 127.0.0.1:8890
```

## Testes

```bash
npm test           # unidade: node --test sobre dist/tests (30 testes)
npm run test:e2e   # end-to-end com 2 instâncias Electron reais (playwright-core)
```

`npm run test:e2e`:

- compila o app (`npm run build`) — use `--no-build` para reaproveitar `dist/` (`node tests/e2e/run-e2e.mjs --no-build`);
- sobe **duas instâncias** Electron reais com userData temporário isolado, `--multi-instance`,
  `--fake-media` e portas livres próprias;
- roda o fluxo completo: host abre o escritório, guest entra pela home com o fluxo LAN, os dois
  se veem, movimento sincroniza, chat, mídia por proximidade (peers + frames de vídeo),
  afastamento encerra peers, screen share, painéis, saída do guest;
- prova offline: os dois Chromium sobem com
  `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost` (sem DNS externo),
  e o script falha se **qualquer** request/WebSocket sair de loopback/rede privada ou tocar
  `*.gather.town`; depois confere `userData/logs/offline-guard.log` (vazio) e
  `[offline-guard] total bloqueado=0` no `main.log`;
- testa também `--offline-guard-strict` (se algo externo fosse tentado, o app abortaria);
- salva screenshots em `docs/screenshots/` e artefatos (`main.log`, requests, log da execução)
  em `tests/e2e/artifacts/` (gitignored);
- sai com código ≠ 0 se algum check obrigatório falhar; ao final mata os apps e remove o userData
  temporário.

Requisitos/custos: sessão gráfica, ~1 min, ~300 MB de RAM durante a execução. Os dispositivos são
falsos (`--fake-media`), então não é preciso câmera/microfone reais nem permissões de hardware.
Screen share usa o handler de `getDisplayMedia` do shell; a permissão de gravação de tela do macOS
afeta apenas o **conteúdo** capturado. Com `--fake-media`, o Chromium substitui o conteúdo capturado
pelo padrão de teste dele: o pipeline é o real, os pixels não são o desktop (o e2e valida
track/painel/frames, não os pixels).

## Modo online (web, sala única por link)

O app também pode rodar como **sala pública no navegador**: o entry `src/online/main.ts` sobe o mesmo
servidor de sala em HTTP atrás de um proxy TLS, servindo o cliente web. É aditivo — Electron/LAN
offline continuam iguais.

```bash
npm run build
node deploy/build-online.mjs
PORT=8080 ROOM_NAME="Escritório online" node dist/online/server.cjs
# landing:   http://localhost:8080        (website/, HTML/CSS sem build)
# app:       http://localhost:8080/room   (home: nome e avatar)
# link único: http://localhost:8080/join  (entra direto; ?name=Ana opcional)
node deploy/verify-online.mjs   # verificação automática com Chrome (landing + 2 jogadores)
```

Hospedagem grátis (Render, túnel Cloudflare, VM Oracle), STUN/TURN para mídia na internet, passo a
passo e limitações: **[`docs/ONLINE_DEPLOY.md`](ONLINE_DEPLOY.md)**. Há `Dockerfile` e `render.yaml`
na raiz prontos para deploy.

## Empacotamento (legado macOS — não faz parte do produto web)

```bash
npm run dist       # build + electron-builder --mac --dir
```

Saída: `release/mac-arm64/DittoApp.app` (`electron-builder.yml`, alvo `dir`, arm64, asar,
**sem assinatura**: `identity: null`, `hardenedRuntime: false`). O `.app` contém
`Contents/Resources/app.asar` com `dist/main`, `dist/client` e `package.json`.

Para gerar um **instalador DMG** (o `.app` + atalho para `/Applications`, pronto para arrastar):

```bash
npx electron-builder --mac dmg
# release/DittoApp-1.0.0-arm64.dmg (~128 MB) + .blockmap
```

O DMG não altera o `electron-builder.yml` (o alvo `dir` continua sendo o default do `npm run dist`);
a assinatura é ad-hoc/sem notarização, então em outra máquina o Gatekeeper bloqueia na primeira
abertura — use botão direito → **Abrir**, ou remova o quarentena:
`xattr -dr com.apple.quarantine "/caminho/DittoApp.app"`.

Para abrir o app empacotado em outra máquina (build não assinado/notarizado):

```bash
xattr -dr com.apple.quarantine "release/mac-arm64/DittoApp.app"
open "release/mac-arm64/DittoApp.app"
```

Ou clique com o botão direito → **Abrir** na primeira vez. O app é um estudo: não tem updater,
telemetria nem assinatura de distribuição.

## Troubleshooting

**`npm start` falha / Electron roda como Node.**
Se `ELECTRON_RUN_AS_NODE=1` estiver no ambiente, o binário do Electron executa como Node e o app não
sobe (erros de `require`/`app` indefinido). Rode `unset ELECTRON_RUN_AS_NODE` (ou
`env -u ELECTRON_RUN_AS_NODE npm start`). O harness e2e remove essa variável dos filhos.

**Aviso de certificado ao abrir `https://<ip>:8787` no navegador.**
Esperado: é self-signed. O app desktop aceita esse certificado só para hosts privados; no navegador
é preciso prosseguir manualmente. Não abra a URL pública: o app não depende de internet.

**"Falha ao abrir a sala" no guest.**
Confirme endereço e porta (o host mostra o endereço na topbar/home), mesma rede, firewall e se o
host está com o app aberto. O guest também precisa carregar o bundle do host — host e guest devem
rodar a mesma versão do app.

**Porta ocupada.**
O servidor tenta `porta`, `porta+1` … `porta+4`; se todas estiverem ocupadas, use
`--port=8890` e confira `userData/logs/main.log` (`[boot] localUrl=… port=…`).

**A segunda instância fecha sozinha.**
Single-instance lock do Electron; use `--multi-instance` apenas em testes/desenvolvimento.

**Câmera/microfone não funcionam.**
Permita em Ajustes do Sistema → Privacidade e Segurança → Câmera/Microfone. Sem dispositivo, o app
continua funcionando (aviso de mídia, chat/presença intactos). Para testes, use `--fake-media`.

**Compartilhar tela abre com conteúdo preto.**
Conceda "Gravação de Tela e Áudio do Sistema" em Ajustes do Sistema → Privacidade e Segurança para
o app/Electron. Sem a permissão o track pode abrir com frames pretos; o app não quebra.

**App/página externa bloqueada.**
A guarda de rede aborta qualquer request fora de loopback/rede privada e grava a URL em
`userData/logs/offline-guard.log` (e `[offline-guard] total bloqueado=N` no `main.log`). Com
`--offline-guard-strict` o app encerra no primeiro bloqueio. Se esse log tiver conteúdo, algo tentou
sair da rede local — abra um bug.

**Cliente não compilado.**
Rode `npm run build`; `npm start` não compila.

## Onde ficam os dados

- userData padrão do app (perfil, `settings.json`, certificado TLS, `logs/main.log` e
  `logs/offline-guard.log`); use `GATHER_OFFLINE_USER_DATA=<dir>` para isolar/testar.
- Build em `dist/`, pacote em `release/`, evidências de teste em `docs/screenshots/` e
  `tests/e2e/artifacts/`.
