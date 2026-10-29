# PWA (T1.6) — decisões e verificação

App web instalável em `https://<deploy>/room`: manifest + ícones PNG + service worker do shell.
O app Electron offline/LAN continua no repo e **não** usa service worker (já é instalado e vive
na rede local); o `pwa.ts` detecta a ponte `window.gather` e não registra nada nesse caso.

## Arquivos

| Arquivo | Papel |
|---|---|
| `client/public/manifest.webmanifest` | `name` DittoApp, `short_name` Ditto, `start_url` `/room`, `scope` `/`, `display` standalone, `lang` pt-BR, cores `#0f1117`/`#16181d` |
| `client/public/icons/` | PNGs reais: `icon-192`, `icon-512` (purpose `any`), `icon-192-maskable`, `icon-512-maskable` (safe zone ~60%), `apple-touch-icon` 180 |
| `client/public/sw.js` | service worker na raiz (`scope: "/"`) |
| `client/index.html` | link do manifest, `theme-color` (já existia), `apple-touch-icon`, `apple-mobile-web-app-*`, viewport com `viewport-fit=cover` |
| `client/src/pwa.ts` | export `registerPwa()` — registra o SW e monta o aviso de "sem conexão" |
| `client/src/components/InstallPrompt.tsx` | export `InstallPrompt` — botão "Instalar app" via `beforeinstallprompt` |
| `deploy/verify-pwa.mjs` | verificação local (17 checks) |

`client/public/**` é copiado pelo Vite para `dist/client/**` em `npm run build` (confirmado).

## Decisões

- **Zoom acessível**: `viewport-fit=cover` sem `maximum-scale`/`user-scalable=no`; o zoom por pinça
  continua liberado no app e na landing.
- **Status bar do iOS**: `black` (não `black-translucent`), assim o conteúdo nunca fica sob a barra de
  status. O T1.7 pode trocar para translucent quando o padding `safe-area-inset-top` cobrir a home.
- **Precache do shell**: no `install` o SW busca `/room`, guarda o HTML e descobre no próprio HTML
  os `/assets/<hash>.{js,css}` (nomes mudam a cada build) e os cacheia. Nada de asset fixo no código.
- **Estratégias**: navegação em `/room*` = network-first com fallback para o shell cacheado (online
  nunca serve versão velha); `/assets/*` (hash imutável) = cache-first; todo o resto passa direto.
- **Nunca interceptado/cacheado**: `POST`/etc., cross-origin, `/ws`, `/join`, `/client-config.json`,
  `/healthz`, `/site/*` (landing). A sala continua falando com o servidor sem o SW no meio.
- **Offline**: abrir `/room` sem rede mostra o shell real (home) + faixa fixa "Sem conexão…"
  (`[data-pwa-offline]`, `role="status"`). Abrir `/room?autojoin=1` sem rede também mostra o shell,
  e a tentativa de entrar na sala cai no overlay "Sem conexão com a sala" que já existia.
- **Registro**: só em contexto seguro (`isSecureContext`) e fora do Electron; falha de registro é
  silenciosa (enhancement progressivo). Localhost/`127.0.0.1` contam como seguro.
- **InstallPrompt**: renderiza `null` até o `beforeinstallprompt`; `prompt()` no clique; some em
  `appinstalled`. iOS não dispara o evento (lá é "Compartilhar → Adicionar à Tela de Início"), então
  o botão simplesmente não aparece.

## Ícones

Gerados uma vez do mark do `favicon.svg` (fundo `#16181d`, "D" `#8b5cf6`, ponto `#4ade80`) com Pillow,
sem dependência npm. `favicon.svg` continua sendo o favicon da aba. Para regerar: desenhe o mesmo
mark em 192/512/180 com Pillow — o CSS/HTML não depende de nada além dos PNGs.

## Integração pendente (Lead)

1. `client/src/main.tsx`: `import { registerPwa } from "./pwa"` e chamar `registerPwa()` no boot.
2. Montar `<InstallPrompt />` uma vez (ex.: em `App`); ele se esconde sozinho quando não há instalação.
3. `src/server/server.ts` (fora do escopo do PWA): adicionar `.webmanifest: "application/manifest+json"`
   ao mapa `MIME`. Hoje o servidor estático devolve `application/octet-stream`; o Chrome **aceita**
   (verificado via CDP `Page.getAppManifest` sem erros), mas é o MIME recomendado e o `verify-pwa`
   mostra um aviso até lá.

Com 1 e 2 integrados, os 2 avisos restantes do `verify-pwa` viram ✓ automaticamente (nenhuma mudança
no script).

## Verificação

```
npm run build && node deploy/build-online.mjs
node deploy/verify-pwa.mjs   # 17/17 (avisa enquanto a integração de main.tsx não existe)
node deploy/verify-online.mjs # 31/31 (gate de regressão online)
```

`verify-pwa` sobe o servidor online em porta efêmera e checa, com Chrome real (`playwright-core`
channel `chrome`):

- manifest 200 + JSON, campos obrigatórios; MIME (aviso se não for `application/manifest+json`);
- cada ícone do manifest responde 200, é PNG de verdade (magic + IHDR) e a dimensão bate com `sizes`;
  `apple-touch-icon` 180×180;
- `sw.js` na raiz com handlers `install`/`fetch` e os bypass de runtime;
- `/room` com manifest/theme-color/apple-*/`viewport-fit=cover` e CSP intacta, sem travar zoom;
- shell carrega; SW registrado (pelo app, ou aviso + registro direto enquanto o `main.tsx` não integra),
  controlando a página após reload, com shell e assets no Cache Storage;
- Chrome aceita o manifest (`Page.getAppManifest`) e não aponta erro de instalabilidade
  (`Page.getInstallabilityErrors`, ignorando `in-incognito` do contexto headless);
- offline (`context.setOffline(true)` + reload): shell abre com o aviso "sem conexão";
- `/healthz` e `/client-config.json` **falham** offline (prova de que não foram cacheados);
- zero `pageerror`.

Screenshot de instalação não é gerado: prompt de instalação real não aparece em contexto headless
incógnito; a evidência é o `Page.getInstallabilityErrors` sem erros.

O e2e offline (`npm run test:e2e`, 17/17) não foi tocado: nenhum arquivo de `src/**`, `tests/**`,
`client/src/{office,home,chat,styles}` ou do Electron foi alterado nesta tarefa.
