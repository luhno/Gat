# DittoApp

Sala de escritório virtual privada, **100% web**: um link único e todos entram no mesmo escritório
pelo navegador, com chat e voz/vídeo por proximidade. O app Electron/LAN continua no repositório
como modo offline/legado de estudo. Feita a partir de engenharia reversa do `GatherV2.app` 0.55.2
(macOS, Electron 44.4.3) — um estudo independente, **não afiliado ao Gather**.

Antes chamava-se *Gather Offline*; o nome atual é **DittoApp**.

**O original** é só uma casca Electron: ele carrega o cliente web remoto `app.v2.gather.town`.
**O DittoApp** reimplementa a casca e o produto: escritório em mapa, avatar que anda, chat e
voz/vídeo por proximidade via WebRTC, com multiplayer na LAN e, opcionalmente, sala pública na web
por link único.

## Sala web (produto principal)

```bash
git clone https://github.com/luhno/Gat.git
cd Gat
npm install
npm run build
node deploy/build-online.mjs
PORT=8080 ROOM_NAME="Escritório online" node dist/online/server.cjs
# abra http://localhost:8080  (home)  ou  http://localhost:8080/join (entrada direta)
```

Rotas do modo online: `/` abre a landing pública, `/room` abre o app (home com nome/avatar) e
`/join` é a entrada direta na sala. A landing é um site estático em [`website/`](website/)
(sem build e sem dependências) e é servida pelo próprio servidor.

Deploy grátis e link público: [`docs/ONLINE_DEPLOY.md`](docs/ONLINE_DEPLOY.md).
Verificação do modo web: `node deploy/verify-online.mjs`.

## App desktop (legado/estudo)

```bash
git clone https://github.com/luhno/Gat.git
cd Gat
npm install
npm run build      # cliente (Vite) + main/preload (esbuild)
npm start          # abre o app desktop
```

No app desktop: preencha seu nome e clique em **Abrir meu escritório**; outro usuário na mesma rede
informa `ip-do-host:8787` em **Entrar em sala da LAN**. Para a sala pública no navegador, veja
[`docs/ONLINE_DEPLOY.md`](docs/ONLINE_DEPLOY.md) e compartilhe `https://<deploy>/join`.

Testes:

```bash
npm run typecheck
npm test           # unidade (protocolo/colisão/proximidade)
npm run test:e2e   # 2 instâncias, LAN, mídia fake, prova de offline
```

Empacotamento local (sem assinatura): `npm run dist` → `release/mac-arm64/DittoApp.app`;
DMG: `npx electron-builder --mac dmg`.

## Documentação

- [`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md) — dossiê do app original (evidências,
  IPC, mídia, rede/identidade, observabilidade, build, análise do cliente web).
- [`docs/OFFLINE_ARCHITECTURE.md`](docs/OFFLINE_ARCHITECTURE.md) — arquitetura da reescrita e por que
  ela é offline de verdade; limites de escopo.
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — contratos internos (protocolo, bridge, mídia).
- [`docs/BUILD_AND_RUN.md`](docs/BUILD_AND_RUN.md) — build, LAN, empacotamento e troubleshooting.
- [`docs/ONLINE_DEPLOY.md`](docs/ONLINE_DEPLOY.md) — modo online no navegador (sala única por link,
  STUN/TURN, opções grátis de hospedagem e passo a passo de deploy).
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — plano de melhorias/QoL, rebrand DittoApp e fases de entrega.
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — matriz de verificação e evidências (screenshots).

Artefatos da engenharia reversa ficam em `../recover/`: asar extraído, código-fonte recuperado dos
source maps, bundle público do cliente web original e script de extração.
