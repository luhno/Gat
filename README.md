# Gather Offline

Reescrita offline do app desktop do Gather, feita a partir de engenharia reversa do `GatherV2.app`
0.55.2 (macOS, Electron 44.4.3) — um estudo independente, não afiliado ao Gather.

**O original** é só uma casca Electron: ele carrega o cliente web remoto `app.v2.gather.town`.
**Este projeto** reimplementa a casca e o produto para rodar **sem internet**, com escritório em
mapa, avatar que anda, chat e voz/vídeo por proximidade via WebRTC — inclusive multiplayer na LAN.

## Começando

```bash
cd gather-offline
npm install
npm run build      # cliente (Vite) + main/preload (esbuild)
npm start          # abre o app
```

No app: preencha seu nome, clique em **Abrir meu escritório** (host). Para outro usuário na mesma
rede: no app dele, informe `ip-do-host:8787` em **Entrar em sala da LAN**.

Testes:

```bash
npm run typecheck
npm test           # unidade (protocolo/colisão/proximidade)
npm run test:e2e   # 2 instâncias, LAN, mídia fake, prova de offline
```

Empacotamento local (sem assinatura): `npm run dist` → `release/mac-arm64/Gather Offline.app`.

## Documentação

- [`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md) — dossiê do app original (evidências,
  IPC, mídia, rede/identidade, observabilidade, build, análise do cliente web).
- [`docs/OFFLINE_ARCHITECTURE.md`](docs/OFFLINE_ARCHITECTURE.md) — arquitetura da reescrita e por que
  ela é offline de verdade; limites de escopo.
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — contratos internos (protocolo, bridge, mídia).
- [`docs/BUILD_AND_RUN.md`](docs/BUILD_AND_RUN.md) — build, LAN, empacotamento e troubleshooting.
- [`docs/ONLINE_DEPLOY.md`](docs/ONLINE_DEPLOY.md) — modo online no navegador (sala única por link,
  STUN/TURN, opções grátis de hospedagem e passo a passo de deploy).
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — matriz de verificação e evidências (screenshots).

Artefatos da engenharia reversa ficam em `../recover/`: asar extraído, código-fonte recuperado dos
source maps, bundle público do cliente web original e script de extração.
