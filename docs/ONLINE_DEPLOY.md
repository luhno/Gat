# Modo online — sala única com link público

O app nasceu **offline/LAN** (Electron). Este modo é **aditivo**: sobe o mesmo servidor de sala em
HTTP atrás de um proxy TLS, servindo o cliente web, para que qualquer pessoa entre por um **link
único** no navegador. O app Electron e o fluxo offline/LAN continuam funcionando como antes.

```
navegador ──HTTPS/WSS──> proxy (Render/VM/Caddy) ──HTTP──> dist/online/server.cjs
                                                             └── 1 sala em memória (6 pessoas)
mídia: WebRTC P2P com STUN (TURN opcional p/ NAT restritivo) — o servidor não carrega áudio/vídeo
```

- **1 deploy = 1 sala.** Todos que abrirem o link entram na mesma sala.
- Link único: `https://<host>/join` → redireciona para `/?autojoin=1`; o visitante entra como
  `Convidado NNNN` (nome único automático) e pode renomear no painel **Configurações**.
  Também dá para compartilhar `/?autojoin=1&name=Ana` (nome na URL) ou `/` (home, escolhe o nome).
- Estado em memória (reiniciar limpa a sala), sem login/persistência, máximo de 6 jogadores.
- Queda curta de rede: o cliente reconecta e **retoma o mesmo jogador** (token de sessão, grace de
  30 s). Queda do servidor/processo reinicia a sala (estado em memória).
- TLS é do proxy/plataforma; o servidor Node fala HTTP puro internamente.

## Rodar localmente

```bash
npm run build                 # cliente web + main/preload do Electron
node deploy/build-online.mjs  # gera dist/online/server.cjs (bundle self-contained)
PORT=8080 ROOM_NAME="Escritório online" node dist/online/server.cjs
# abra http://localhost:8080           (landing pública)
#      http://localhost:8080/room      (app: home, escolhe o nome)
#      http://localhost:8080/join      (entrada direta na sala, link único)
```

Verificação automática (2 contextos de Chrome reais, devices fake, offline na máquina):

```bash
node deploy/verify-online.mjs
```

| Env | Default | Para quê |
|---|---|---|
| `PORT` | `8080` | porta HTTP interna |
| `CLIENT_DIR` | `dist/client` | diretório do cliente compilado |
| `ROOM_NAME` | `Escritório online` | nome da sala na topbar |
| `ICE_SERVERS` | Google + Cloudflare STUN | STUN/TURN p/ mídia na internet (JSON ou lista de URLs; vazio = STUN padrão) |
| `PUBLIC_URL` | auto (Render/Fly) | URL usada só nos logs p/ montar o link |

Endpoints: `GET /` (landing), `GET /room` (app), `GET /join` (entrada direta, 302 →
`/room?autojoin=1`), `GET /healthz` (health check), `GET /client-config.json` (online, sala, ICE) e
`GET /site/*` (assets estáticos da landing).

## Landing pública (`website/`)

A página de apresentação fica em [`../website/`](../website/): `index.html`, `styles.css`,
`favicon.svg` e `office.jpg` (captura real da sala web). É HTML/CSS sem build, sem dependências e
sem JavaScript — o servidor a serve em `/` e os assets em `/site/*`. Para editar textos/estilo,
mexa nesses arquivos e recarregue; o Dockerfile copia a pasta `website/` para a imagem.
Se a pasta não existir no deploy, `/` volta a servir o app (comportamento anterior).

## Mídia na internet (STUN/TURN)

- Por padrão usa **dois STUN públicos** (`stun:stun.l.google.com:19302` e
  `stun:stun.cloudflare.com:3478`), o que resolve a maioria das redes residenciais; se um estiver
  bloqueado, o outro ainda coleta candidatos.
- Redes corporativas/cone simétrico podem precisar de **TURN** (relay). Configure sem alterar código:

```bash
ICE_SERVERS='[{"urls":"turn:SEU-TURN:443","username":"user","credential":"pass"}]' \
  PORT=8080 node dist/online/server.cjs
```

- Opções grátis para TURN: **Metered Open Relay** (openrelay.metered.ca, credenciais públicas de
  teste, com limite de banda), **Cloudflare Calls TURN** (tem free tier), ou **coturn** self-hosted
  numa VM grátis (Oracle Always Free). Sem TURN, em NAT restritivo a sala/chat funcionam mas o
  áudio/vídeo pode não conectar.

## Opções grátis para hospedar (comparativo, out/2026)

| Opção | WebSocket | Sempre ligado | Conta/cartão | Prós | Contras |
|---|---|---|---|---|---|
| **Render Free Web Service** (Docker) | ✅ | ❌ dorme após ~15 min | conta Render (login GitHub) | deploy mais simples (Dockerfile + `render.yaml` prontos), TLS/domínio grátis | cold start de ~30–60 s ao acordar; 1 instância |
| **Cloudflare Quick Tunnel** (na sua máquina) | ✅ | enquanto o Mac estiver ligado | nenhuma | link HTTPS imediato, zero configuração | não é hospedagem; URL aleatória/temporária; sem SLA |
| **Oracle Cloud Always Free** (VM ARM) | ✅ | ✅ | cartão p/ verificação | grátis permanente, roda Docker + coturn junto, controle total | setup manual (SSH, Caddy/nginx, firewall) |
| **Cloudflare Workers + Durable Objects** | ✅ (WSS) | ✅ | conta Cloudflare | sempre ligado, escala automática, barato/grátis | exige portar o signaling para Worker/DO (não incluso) |
| **Koyeb free** | ✅ | ❌ escala a zero | cartão (verificação) | Docker simples | limites de free tier |
| **Deno Deploy** | ✅ | ✅ | conta Deno | grátis, sem servidor | exige porte do servidor p/ Deno |
| **Railway** | ✅ | ❌ | — | DX boa | sem free permanente ($5 de trial) |
| **Fly.io** | ✅ | parcial | cartão | CLI deploy local | sem free tier real hoje (PAYG) |
| **Vercel / Netlify** | ❌ | — | — | — | serverless não mantém WebSocket persistente (nosso sinalizador precisa) |
| **GitHub Codespaces** | ✅ | ❌ | conta GitHub | rápido p/ testar | temporário, não é hospedagem |

**Recomendação:** comece com **Cloudflare Quick Tunnel** para testar com colegas hoje, e para um link
fixo use **Render Free** (mais fácil, este repo já tem `Dockerfile` + `render.yaml`) ou, se quiser
sempre-ligado de graça, **Oracle Cloud Always Free** (com `coturn` na mesma VM para mídia confiável).

## Passo a passo — Render Free (recomendado p/ link fixo)

O repositório já está em <https://github.com/luhno/Gat> (branch `main`), com `.gitignore`,
`Dockerfile` e `render.yaml`.

1. Em <https://render.com>: **New → Blueprint**, conecte o GitHub e selecione o repositório
   `luhno/Gat`.
   O Render lê o `render.yaml` (serviço Docker free, health check `/healthz`) → **Apply**.
   (Alternativa manual: **New → Web Service → Docker**, repo, health check `/healthz`.)
2. Aguarde o build (~2–5 min). A URL fica `https://dittoapp-xxxx.onrender.com`; abra
   `https://dittoapp-xxxx.onrender.com/join` e compartilhe.
3. Variáveis: `ROOM_NAME` e, se necessário, `ICE_SERVERS` (TURN). `PORT` é injetado pelo Render.
4. Push na `main` → redeploy automático. O serviço free dorme após ~15 min sem visitas; a primeira
   visita após dormir demora ~30–60 s (basta recarregar).

## Passo a passo — Docker em qualquer VPS

```bash
docker build -t dittoapp .
docker run -d --restart=unless-stopped -p 8080:8080 \
  -e ROOM_NAME="Escritório online" dittoapp
```

Coloque atrás de Caddy/nginx com TLS e WebSocket habilitado (no nginx: `proxy_set_header Upgrade
$http_upgrade; proxy_set_header Connection "upgrade";`). Compartilhe `https://<domínio>/join`.

## Demo imediata (sem conta) — Cloudflare Quick Tunnel

```bash
PORT=8090 ROOM_NAME="Escritório online" node dist/online/server.cjs   # terminal 1
cloudflared tunnel --url http://127.0.0.1:8090                        # terminal 2
# compartilhe https://<algo>.trycloudflare.com/join
```

É um túnel temporário (some quando o processo/máquina para, sem SLA) — bom para testar com pessoas,
não para produção.

## Limites e segurança

- Sem login: **quem tem o link entra**. Não use para conteúdo sensível; no máximo 6 pessoas.
- Chat/presença/sinalização passam pelo servidor; áudio/vídeo são P2P (o servidor não vê a mídia).
- Sem persistência (chat/histórico somem ao reiniciar).
- Validação/rate limits do servidor continuam ativos; TLS e HTTPS são responsabilidade da plataforma.
- O app é um estudo de engenharia reversa, não afiliado à Gather Presence Inc.

## Verificação feita (2026-10-28)

- `npm run build && node deploy/build-online.mjs` ok.
- `node deploy/verify-online.mjs` → **32/32** (link `/join`, `client-config.json`, capacidade de 6,
  retomada de sessão, link copiável, diagnóstico de conexão e prévia local da câmera, 2 navegadores,
  nomes únicos, canvas, chat, WebRTC por proximidade, nenhum request externo, metas OG/favicon,
  landing em `/` com assets `/site/*`, home web clara, perfil persistido entre reloads,
  acessibilidade da landing (h1 único, skip link, alt, zoom), contraste medido ≥ 4.5:1, foco visível,
  sem rolagem horizontal em 320px, `prefers-reduced-motion` respeitado e **reconexão automática**
  (derrubar e subir o servidor no meio da sala — o cliente volta sozinho).
- **Túnel público** `https://…trycloudflare.com/join`: 2 navegadores em contextos separados
  entraram, 2 pessoas, chat e **mídia WebRTC peers=1** pela internet
  ([screenshot](online/online-public.png)). Landing: [desktop](online/landing.png) e
  [mobile](online/landing-mobile.png).
- Regressão do modo offline: `npm test` 30/30, `npm run test:e2e` 17/17 verdes.
- Dockerfile não foi testado localmente (Docker não está instalado nesta máquina); o Render o
  constrói no deploy.
