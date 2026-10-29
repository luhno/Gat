# Verificação empírica — baseline do DittoApp (rodada 2026-10-28)

**Status da suíte: VERDE.** Todas as 8 etapas executaram com exit code 0 e todas as checagens
passaram: **34 testes unitários, 32 checks online, 17 PWA, 27 mobile, 17 e2e Electron** (127
checagens automatizadas), mais typecheck e builds sem erro/aviso.

**Achados fora da suíte (não são falha de teste, são fato medido):**
1. **Sourcemap do cliente é público em produção** — `GET /assets/index-*.js.map` responde
   `200 application/json` com 1.411.933 bytes (código-fonte completo exposto).
2. **`.github/workflows/ci.yml` não está versionado** (untracked), embora `docs/CI.md` esteja no
   git e linke para ele — o CI não roda a partir deste checkout.
3. Fallback SPA responde `200 text/html` para asset inexistente (não 404).

Rodada executada em 2026-10-28, ~21:31–21:36 (-03), na mesma máquina e working tree reportados
abaixo. Nenhum arquivo de código/config foi alterado; ver “Efeitos colaterais”.

---

## Ambiente

| Item | Valor |
|---|---|
| OS / arquitetura | macOS 27.0.1 (build 26A434), **arm64** (Apple M3 Pro) |
| Sessão gráfica | **sim** (Dock ativo; janelas Electron abriram de verdade) |
| Node / npm | v24.21.0 / 11.19.0 |
| Google Chrome | 156.0.8078.48 (playwright-core 1.64.1, channel `chrome`) |
| Electron | 44.4.3 |
| TypeScript / Vite / esbuild | 5.9.3 / 7.3.7 / 0.28.2 |
| Docker | **não instalado** |
| Repositório | `gather-offline`, branch `main`, HEAD `fb0e669` |
| Working tree antes da rodada | limpo, exceto `.github/` untracked |
| Dependências | já instaladas (`node_modules` existente; `npm ci` não foi rodado) |

---

## Resultado por comando

| # | Comando | Resultado | Contagem | Tempo (parede) | Notas |
|---|---|---|---|---|---|
| 1 | `npm run typecheck` | ✅ exit 0 | — | 2,2 s | `tsc --noEmit`, sem saída |
| 2 | `npm test` | ✅ exit 0 | **34/34** (3 arquivos) | 1,1 s | `build:tests` + `node --test`; `duration_ms 538` |
| 3a | `npm run build` | ✅ exit 0 | 67 módulos (Vite) | 2,0 s | client 992 ms + main 64 ms; **0 warnings** |
| 3b | `npm run build:online` | ✅ exit 0 | — | 0,25 s | esbuild, **0 warnings** |
| 4 | `node deploy/verify-online.mjs` | ✅ exit 0 | **32/32** | 21,8 s | 2 contextos Chrome reais, mídia fake; porta 55105; 6 screenshots em `docs/online/` |
| 5 | `node deploy/verify-pwa.mjs` | ✅ exit 0 | **17/17** | 6,7 s | porta 55191; manifest/SW/shell offline |
| 6 | `node deploy/verify-mobile.mjs` | ✅ exit 0 | **27/27** | 10,4 s | porta 55211; viewport, joystick, sheets, safe-area |
| 7 | `npm run test:e2e` | ✅ exit 0 | **17/17** | 28,8 s | **funcionou** (sessão gráfica real); host 55247, guest 55248, strict 55274; screen share real via `getDisplayMedia`; 6 screenshots em `docs/screenshots/` |
| 8a | `npm audit --omit=dev` | ✅ exit 0 | 0 vulnerabilidades | 1 s | rede ok |
| 8b | `npm ls --depth=0` | ✅ exit 0 | 14 deps, 0 problems | <1 s | sem `invalid/missing/extraneous` |
| extra | `node --test --experimental-test-coverage …` | ⚠️ inútil | relatório vazio | 1 s | “all files 100%” é artefato: testes são bundles esbuild. **Não há número real de cobertura** |

**Total da suíte**, uma rodada: ~75 s (o e2e sozinho = 38% do tempo).

**Portas:** os três verify scripts escolhem porta efêmera livre em tempo de execução e imprimem a
URL; nenhum usou porta fixa. **Artefatos:** `docs/online/*.png` (verify-online/mobile),
`docs/screenshots/*.png` e `tests/e2e/artifacts/*.log` (e2e; gitignored).

### Repetições (prova de estabilidade)

| Rodada | Comando | Resultado | Tempo |
|---|---|---|---|
| 2ª | `npm test` | ✅ 34/34 (`duration_ms 520`) | 1,0 s |
| 2ª | `node deploy/verify-online.mjs` | ✅ 32/32, porta 55479 | 21,0 s |

Isso é tudo que foi repetido. As demais etapas rodaram 1×.

---

## Falhas, flakes e travamentos

**Nenhuma falha, nenhum flake, nenhum timeout, nenhum hang.** Nenhum comando precisou ser
interrompido. Trechos verbatim dos vereditos:

```
  34/34  pass 34 fail 0 skipped 0            (npm test, as duas rodadas)
  32/32 checks ok, 0 falha(s)  VEREDITO: VERDE  (verify-online, as duas rodadas)
  17/17 checks ok, 0 falha(s)  VEREDITO: VERDE  (verify-pwa)
  27/27 checks ok, 0 falha(s)  VEREDITO: VERDE  (verify-mobile)
  17/17 checks obrigatórios verdes, 0 falha(s)  VEREDITO: VERDE  (test:e2e)
```

Também não houve aviso/⚠ em nenhum verify (todos os checks `pass`; o e2e não emitiu `warn`).
Observações de ambiente, não falhas:

- O e2e **é suportado nesta máquina** (não é preciso “trick” de GUI/DNS): abriu duas janelas
  Electron reais, `getDisplayMedia` real em 615 ms e vídeo 3024×1702 chegando no guest.
- `ELECTRON_RUN_AS_NODE=1` está exportado no shell desta sessão; não impediu o e2e (que roda via
  Playwright/Electron com janela), mas faz `electron --version` imprimir a versão do Node.
- Havia um servidor residual **de outra sessão** durante a rodada
  (`node dist/online/server.cjs`, `ROOM_NAME="Audit"`, porta 55293). As minhas etapas usam portas
  efêmeras e não foram afetadas; os servidores que eu mesma subi foram encerrados e conferi com
  `lsof` que não sobrou processo meu escutando. O diretório temporário do e2e (`gather-e2e-*`)
  foi limpo pelo próprio harness (0 sobras em `$TMPDIR`).

---

## Build e tamanhos

Build sem warnings de nenhum dos bundlers. Saída relevante:

| Artefato | Bytes | Tamanho | Gzip | Observação |
|---|---:|---:|---:|---|
| `dist/client/assets/index-xzGyADtO.js` | 321.870 | 321,87 kB | 101,43 kB | **chunk único** (React + app; sem code-splitting) |
| `dist/client/assets/index-BxER0VfL.css` | 28.095 | 28,10 kB | 6,58 kB | |
| `dist/client/index.html` | 1.856 | 1,86 kB | 0,78 kB | |
| `dist/client/sw.js` | 2.867 | 2,87 kB | — | service worker |
| `dist/client/manifest.webmanifest` | 858 | 0,86 kB | — | |
| `dist/client/favicon.svg` | 254 | 0,25 kB | — | |
| `dist/client/icons/*.png` (5) | 3.499–12.029 | 3,4–11,7 kB cada | — | 192/512 + maskable + apple-touch |
| **`dist/client` (total)** | — | **1,7 MB** | — | inclui 1,41 MB de **sourcemap** |
| `assets/index-xzGyADtO.js.map` | 1.411.933 | 1,41 MB | — | **servido publicamente** (ver achados) |
| **`dist/online/server.cjs`** | 164.304 | **160,5 kB** | — | servidor web standalone (ws embutido) |
| `dist/online/server.cjs.map` | 284.988 | 278,3 kB | — | fonte do servidor em sourcemap |
| `dist/main/main.cjs` | 975.806 | 952,9 KiB | — | **Electron legado** (não é o produto web) |
| `dist/main/main.cjs.map` | 1.597.089 | 1,5 MB | — | idem |
| `dist/main/preload.cjs` | 1.638 | 1,6 kB | — | idem |
| **`dist` (total)** | — | **7,1 MB** | — | client 1,7 MB + online 444 kB + main 2,5 MB + tests |

Leitura: o cliente web é **um único JS de 322 kB (101 kB gzip)** — aceitável para app de sala, mas
sem divisão de chunks e sem orçamento de bundle no CI. O `main.cjs` de ~1 MB é peso legado Electron.

---

## Verificações estáticas

### tsconfig (`tsconfig.json`)

| Flag | Valor |
|---|---|
| `strict` | ✅ `true` |
| `noUncheckedIndexedAccess` | ❌ ausente (indexação de array/objeto não vira `T \| undefined`) |
| `exactOptionalPropertyTypes` | ❌ ausente |
| `noImplicitOverride` | ❌ ausente |
| `noUnusedLocals` / `noUnusedParameters` | ❌ ausentes |
| `noFallthroughCasesInSwitch` / `noImplicitReturns` | ❌ ausentes |
| `skipLibCheck` | `true` |
| `include` | apenas `src`, `client/src`, `tests/unit` — **`deploy/*.mjs`, `scripts/*.mjs`, `tests/e2e/run-e2e.mjs`, `client/public/sw.js` são JS e não passam por typecheck** |

### Marcadores e higiene de código (grep no código versionado)

| Item | Ocorrências | Detalhe |
|---|---:|---|
| `any` (palavra) | **1** | só em comentário: `src/server/validation.ts:44`; **0** `as any` / `<any>` |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | **0** | |
| `TODO` / `FIXME` / `HACK` / `XXX` | **0** | case-sensitive com word boundary, em `src`, `client`, `tests`, `deploy`, `scripts`, `website` |
| `shortcut:` / `ponytail:` | **0** | |
| `console.*` em `client/src` | **0** | cliente não loga em produção |
| `console.*` em `src` (server/Electron) | **7** | 6 em `src/online/main.ts` (startup/shutdown) + 1 em `src/main/logger.ts` |
| config de lint/formatação | **nenhuma** | sem eslint/prettier/biome e sem script `lint` |
| config/script de cobertura | **nenhuma** | ver linha “coverage” da tabela de comandos |

### Garantia offline / URLs externas no cliente web

- **Nenhum recurso externo** em `client/src` ou `client/index.html`: greps de `https?://` só acham
  (a) `client/src/home/HomeScreen.tsx:27,31` — normalização `https://` de endereço digitado no
  fluxo LAN legado (não é request automático); (b) `xmlns` do SVG.
- `website/index.html` (landing pública, servida em `/`) tem **2 links** para `github.com` — link
  de saída intencional do site, não recurso carregado.
- **CSP** no `client/index.html` via `<meta>`: `default-src 'self'; script-src 'self'; …;
  connect-src 'self' wss: ws:`. Ou seja: web sockets para **qualquer origem** são permitidos pela
  CSP (mitiga só código injetado; `script-src 'self'`).
- Prova empírica de zero requests externos: `verify-online` check “sem requests externos na página —
  tudo same-origin”; e2e Electron “21 requests, 0 externos, DNS externo desabilitado”.

### Achados medidos em runtime (não são teste de unidade)

| Verificação | Resultado medido |
|---|---|
| `GET /assets/index-xzGyADtO.js.map` | **`200` `application/json`, 1.411.933 B** — sourcemap público |
| `GET /assets/nope.js` | `200` `text/html`, 1.856 B — **SPA fallback** devolve o HTML em vez de 404 |
| `GET /room` | `200` `text/html`, CSP `<meta>` presente |
| `GET /` | `200` `text/html` (landing), `cache-control: no-store`, `x-content-type-options: nosniff` |
| `GET /join` | `302` → `/room?autojoin=1` |
| `GET /healthz` | `200` (2 B) |
| `GET /sw.js` | `200` `text/javascript`, 2.867 B |
| `GET /client-config.json` | `200` `application/json`, 136 B (2 STUNs) |
| `GET /site/` | `404` (o diretório não é servido; assets `/site/*` são) |
| Headers de resposta de `/` | só `content-type`, `content-length`, `cache-control: no-store`, `nosniff` — **sem** HSTS, CSP-header, referrer-policy |
| Hook de teste no bundle de produção | `window.__gatherTest` presente no JS minificado final (leitura de estado para os harnesses; não há superfície de controle) |

### Git / docs

- `git status --short`: **nenhum arquivo de código/config alterado**; 11 PNGs modificados
  (screenshots) + `.github/` untracked. `dist/` é gitignored.
- `.github/workflows/ci.yml` existe no working tree, mas `git ls-files .github` = **0** →
  **não versionado**. `docs/CI.md` está versionado e documenta um workflow que não está no commit.
- Drift de contagem: o README do workspace (`../README.md`, fora do repo) diz
  `verify-online` “**31 checks**”; o real é **32**. `docs/VERIFICATION.md` (dentro do repo) está
  sincronizado (32/32, 34/34, 17/17).

---

## Mapa de cobertura da automação

Números de base: `src` 2.495 linhas/26 arquivos, `client/src` 8.183/39, `tests/unit` 946/3,
`tests/e2e` 850/1, `deploy` 1.643/4, `website` 1.105/2.

| Área / módulo | Coberto por | Tipo de prova |
|---|---|---|
| `src/shared/collision.ts`, `defaultMap.ts`, `constants.ts`, `protocol.ts`, `types.ts` | `tests/unit/collision.test.ts` + usados nos demais unit | unidade direta |
| `client/src/media/proximity.ts` | `tests/unit/proximity.test.ts` | unidade direta (histerese, iniciador/educado) |
| `src/server/validation.ts`, `collision.ts`, `room.ts`, `tls.ts` | `tests/unit/server.test.ts` (26 casos) | unidade: sanitização, rate limit, sessão/grace, relay, TLS persist/regen |
| `src/server/server.ts` (HTTP/WSS) | `tests/unit/server.test.ts` (HTTPS/WSS reais em loopback) + 3 verify | integração local: rotas, headers, path traversal, max payload, upgrade WS |
| `src/online/main.ts` (bootstrap web, env, SIGTERM) | `verify-online`/`verify-pwa`/`verify-mobile` sobem `dist/online/server.cjs` | e2e do processo (sem assert de shutdown; `ICE_SERVERS` custom não exercitado) |
| `client/src/App`, `state/store`, `net/connection`, `media/useMedia`, `office/*`, `chat`, `soundboard`, `components`, `home`, `audio/uiSound`, `pwa.ts` | `deploy/verify-online.mjs` (32) e `verify-mobile.mjs` (27) | e2e em Chrome real com mídia fake; sem unit (exceto proximity) |
| `client/src/mobile/*` | `deploy/verify-mobile.mjs` (27) | e2e mobile emulado (isTouch, joystick, sheets, safe-area) |
| `client/public/sw.js`, `manifest.webmanifest`, `client/index.html` | `deploy/verify-pwa.mjs` (17) | e2e PWA: SW controla página, shell offline, bypass de rotas de runtime |
| `website/*` (landing) | `deploy/verify-online.mjs` (checks de landing) | e2e: h1/skip link/alt/contraste/zoom/320px/reduced-motion/JS errors |
| `src/main/*`, `src/preload/*` (Electron legado), `client/src/desktop.ts` | `tests/e2e/run-e2e.mjs` (17) | e2e Electron **local/manual** (2 instâncias, TLS LAN, screen share real, offline guard) |
| `deploy/build-online.mjs`, `deploy/verify-*.mjs`, `scripts/build-*.mjs`, `Dockerfile`, `render.yaml`, `.github/workflows/ci.yml` | **nada** | harness/deploy não têm teste nem são typechecked |

Resumo: **127 checagens automatizadas** (34 unit + 32 online + 17 PWA + 27 mobile + 17 e2e). O
núcleo de servidor tem testes rápidos e reais; o cliente é provado por e2e de navegador, não por
unidade. O e2e Electron **não roda no CI** (documentado em `docs/CI.md`): é gate manual em macOS.

---

## O que não é coberto pela automação

1. **WebRTC real**: devices falsos + loopback. Não cobre câmera/mic reais, permissão de mídia do
   navegador, `devicechange`, troca de dispositivo no meio da call, qualidade/perda de pacotes.
2. **NAT/TURN e internet**: verify usa STUN configurado mas tudo roda na mesma máquina. Não há teste
   de peer atrás de NAT restritivo, TURN, firewall corporativo ou duas máquinas reais.
3. **Screen share no navegador web**: nenhum `verify-*.mjs` testa screen share; só o e2e Electron
   cobre (e lá com `getDisplayMedia` real + conteúdo fake do Chromium).
4. **Reconexão com mídia ativa**: `verify-online` prova só `connection === "connected"` de novo;
   não re-verifica peers/tracks WebRTC depois da queda, nem esgotamento das 10 tentativas.
5. **Persistência**: chat não persiste (estado em memória no `store`, por design); soundboard tem
   IndexedDB mas nenhum teste recarrega a página para provar persistência; não há teste de
   localStorage/IndexedDB indisponível ou cheio.
6. **Moderação/host controls**: **não existem** (0 código de kick/mute/moderação) → nada a testar.
7. **`ICE_SERVERS` custom**: os verify passam `ICE_SERVERS=""` (branch padrão). Parse JSON e CSV do
   env não é testado.
8. **Deploy real**: Docker **não instalado** → Dockerfile/render.yaml nunca executados aqui; deploy
   em Render, TLS de borda, healthcheck do container, cold start e escala não verificados.
9. **CI**: workflow não versionado e não executado no GitHub a partir deste checkout; “pipelines
   verdes” não foram observados.
10. **Navegadores**: só Chrome 156. Safari, Firefox, browsers de celular reais não testados.
11. **Carga, soak e abuso**: sem teste de muitas conexões, memória ao longo do tempo, flood de
    mensagens, ou bypass do rate limiter sob pressão.
12. **Acessibilidade do app (sala/painéis)**: as medidas são da landing (contraste, skip link, foco
    do primeiro Tab) e de alvos touch no mobile; não há auditoria de teclado/foco/ARIA dos painéis
    de chat, settings, participantes e soundboard.
13. **Performance**: sem orçamento de bundle no CI, sem Lighthouse/Web Vitals, sem medição de
    60fps do canvas em máquina fraca.
14. **Caminhos de erro do cliente**: servidor 5xx, token inválido no browser, permissão de câmera
    negada, falha de rede no meio do upload do soundboard.
15. **Upgrade de PWA/service worker entre deploys**: novo hash de asset, cache antigo e troca de
    versão do SW não são exercitados (só o primeiro carregamento/offline).
16. **Typecheck/lint de scripts**: `deploy/*.mjs`, `scripts/*.mjs`, `tests/e2e/*.mjs` e
    `client/public/sw.js` ficam fora do `tsconfig` e não há lint no repo.
17. **Cobertura numérica**: não existe ferramenta configurada; a tentativa nativa deu relatório
    vazio (testes são bundles), então **não há percentual de cobertura** para citar.
18. **App Electron empacotado e codecs**: `npm run dist`/`.app` não rodados; assinatura/notarização
    fora de escopo; autoplay/áudio real do macOS não medido.
19. **Multi-máquina/LAN**: e2e simula guest via loopback + GET no IP privado; roteador, AP isolation
    e uma segunda máquina não são exercitados.
20. **SIGTERM gracioso**: os verify matam o servidor com SIGTERM, mas nenhum assert confirma que
    conexões/porta fecham de forma limpa (só não trava o teste).

---

## Riscos que os resultados deixam evidentes (para server/client/roadmap)

| # | Risco | Evidência |
|---|---|---|
| R1 | **Código-fonte do cliente exposto em produção** (sourcemap servido com 200) | probe HTTP: `.map` 1.411.933 B; `deploy/build-online` não remove e o static handler não bloqueia `.map` |
| R2 | Asset inexistente devolve **HTML 200** (fallback SPA) em vez de 404 — mascara erro de build/cache e pode servir HTML como JS | probe `GET /assets/nope.js` → `200 text/html` |
| R3 | Reconexão verde pode mascarar **mídia morta** após queda de servidor | `verify-online` só checa status da conexão |
| R4 | **Screen share web** e **upgrade de PWA** sem teste automatizado | 0 refs de screen share nos `verify-*.mjs`; SW testado só no 1º load |
| R5 | Sala pública sem prova de **TURN/carga** → falha só descoberta em campo | verifies em loopback/mídia fake; sem teste de carga |
| R6 | **Gate real depende de macOS local** (e2e fora do CI + workflow untracked) | `docs/CI.md` declara e2e manual; `git ls-files .github` = 0 |
| R7 | Regressão passa se quebrar script/JS fora do tsc, sem lint e sem cobertura | `tsconfig.include` só cobre 3 diretórios; 0 config de lint/coverage |
| R8 | Evidência suja/não determinística: cada rodada reescreve 11 PNGs; docs com contagem errada (31 vs 32) | `git status` e diff de screenshots; `../README.md:33` |

---

## Efeitos colaterais no working tree (esperados; nada commitado)

`npm test`/builds gravam em `dist/` (gitignored). Os verify e o e2e **regravaram screenshots
versionados** — 11 PNGs modificados, 0 arquivos de código/config:

- `docs/online/`: `media-health.png`, `mobile-office.png`, `online-home.png`, `online-room.png`,
  `soundboard-trim.png` (5).
- `docs/screenshots/`: `chat.png`, `home.png`, `office.png`, `participants.png`,
  `screen-share.png`, `settings.png` (6) — regenerados pelo e2e.

`docs/online/landing.png`, `landing-mobile.png` e `online-public.png` não mudaram nesta rodada
(landing é determinística; `online-public.png` é evidência manual antiga). Os bytes dos PNGs de app
**variam entre rodadas** (ex.: `media-health.png` 270.651 → 268.367 B na repetição) por causa de
animação/cursor: diff de screenshot é ruído esperado, não regressão.
`tests/e2e/artifacts/*.log` também foram regravados (gitignored).

---

## Não verificado:

- Docker build/run e deploy real em Render/Fly (Docker não instalado; TLS de borda, healthcheck do
  container, cold start e escala não exercitados).
- Câmera/microfone/screen share **reais** e permissões do navegador; NAT/TURN e duas máquinas
  reais; qualidade de áudio/vídeo e perda de pacotes em rede real.
- Safari, Firefox e hardware móvel real (só Chrome 156 emulado/desktop).
- Execução do CI no GitHub (workflow untracked e não rodado); `npm ci` a partir de checkout limpo.
- Carga/soak/concorrência além de 6 jogadores + 2 navegadores; memória em sessão longa.
- Percentual de cobertura de código; lint/formatação (não existem configurados).
- App Electron empacotado (`npm run dist`/DMG), assinatura/notarização, codecs/autoplay reais.
- Caminhos de erro do cliente (permissão negada, storage cheio/indisponível, 5xx, token inválido no
  browser), upgrade do service worker entre deploys e assert de shutdown SIGTERM gracioso.
- Acessibilidade completa do app (foco/teclado/ARIA dos painéis), performance/60fps e Web Vitals.
- `ICE_SERVERS` custom (JSON/CSV), `PUBLIC_URL`/`RENDER_EXTERNAL_URL`/`FLY_APP_NAME` e outros
  branches de env do `src/online/main.ts`.
