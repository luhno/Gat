# CI — GitHub Actions

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
Badge: `https://github.com/luhno/Gat/actions/workflows/ci.yml/badge.svg?branch=main`

## O que roda em cada push/PR na `main`

| Passo | Comando | Por quê |
|---|---|---|
| Instalação | `npm ci` | reprodutível a partir do `package-lock.json` (Electron é pulado com `ELECTRON_SKIP_BINARY_DOWNLOAD=1`) |
| Chrome | checa `google-chrome`, instala estável se faltar | `deploy/verify-online.mjs` usa `playwright-core` no channel `chrome` (sem download de browser) |
| Tipos | `npm run typecheck` | pega regressões de contrato entre cliente/servidor |
| Unidade | `npm test` | sala/validação/colisão/proximidade/sessão (node:test) |
| Build | `npm run build && npm run build:online` | cliente Vite + main/preload + servidor web standalone |
| Online | `node deploy/verify-online.mjs` | 2 navegadores headless reais: link `/join`, nomes, chat, mídia fake, reconexão, sessão, soundboard, HUD, landing |
| PWA/mobile | `deploy/verify-pwa.mjs`, `deploy/verify-mobile.mjs` | rodam quando os arquivos existem (entregas em paralelo) |
| Artefatos | upload em falha | logs e screenshots em `tests/e2e/artifacts`, `docs/online`, `docs/screenshots` |

Tempo típico: 3–6 min. `concurrency` cancela runs antigos do mesmo ref.

## O que **não** roda no CI

- **e2e do app Electron offline/LAN** (`npm run test:e2e`): precisa de GUI macOS (janelas, certificate
  verify, permissões de mídia, screen-capture picker). GitHub Actions não oferece uma sessão gráfica
  confiável para Electron; o job macOS é lento (~10 min) e flaky. Ele é **gate local/manual**:
  ```bash
  npm run test:e2e   # 17/17 checks, roda na sua máquina antes de push/PR grande
  ```
- Mídia real (câmera/mic/screen share reais): o CI usa fake devices; captura real é manual.

## Reproduzir localmente

```bash
npm ci
npm run typecheck
npm test
npm run build && npm run build:online
node deploy/verify-online.mjs
```

## Adicionar um check novo

1. Crie/estenda um `deploy/verify-*.mjs` com `playwright-core` (channel `chrome`, servidor em porta
   efêmera, `process.exitCode = 1` em falha e cleanup em `finally`).
2. Adicione o passo no workflow (há um exemplo condicional para PWA/mobile).
3. Valide localmente o script antes do push.
