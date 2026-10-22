# Bot QSD – bot de Discord + painel web

Funções: interação com membros, boas-vindas, saída, botões/cargos, rank/nível, comandos personalizados, tradução automática e mini jogos. **Tudo é configurado no painel web** (login com Discord).

## 1. Criar o bot no Discord

1. Acesse https://discord.com/developers/applications → **New Application**.
2. **Bot** → clique em *Reset Token* e copie o token (`DISCORD_TOKEN`).
3. Ainda em **Bot**, ligue os dois *Privileged Gateway Intents*:
   - **Server Members Intent** (boas-vindas/saída)
   - **Message Content Intent** (níveis, comandos, tradução, interação)
4. **General Information** → copie o *Application ID* (`DISCORD_CLIENT_ID`).
5. **OAuth2** → copie o *Client Secret* (`DISCORD_CLIENT_SECRET`) e em **Redirects** adicione:
   `http://localhost:3000/auth/callback` (ou `SEU_SITE/auth/callback` se hospedar online).

## 2. Rodar

```bash
cd qsd-bot
cp .env.example .env     # preencha os valores
npm install
npm start
```

Abra o endereço do `BASE_URL` (ex.: http://localhost:3000), entre com o Discord, escolha o servidor e configure.
Se o bot ainda não estiver no servidor, o painel mostra o botão **Adicionar bot** (já com as permissões certas).

> O bot e o painel rodam juntos no mesmo processo e precisam ficar ligados 24h (VPS, Railway, Render, etc.).
> Em hospedagem online use `https://` no `BASE_URL` e o mesmo endereço no Redirect do portal.

## 3. Importante

- **Cargos:** no Discord, arraste o cargo do bot para **cima** dos cargos que ele vai entregar (botões, recompensas de nível e cargo automático). Ele precisa da permissão *Gerenciar Cargos*.
- **Imagem de boas-vindas/saída:** o painel mostra prévia ao vivo. O fundo pode ser qualquer link direto de imagem (ideal 1024×500). Emojis não aparecem dentro da imagem, só no texto.
- **Fontes (Linux/hospedagem):** se o texto da imagem sair como quadradinhos, instale uma fonte (`apt install fonts-dejavu-core`) ou coloque um `.ttf` em `assets/font.ttf`.
- **Dados:** ficam em `data/db.json` (faça backup dessa pasta). Em hospedagens com disco temporário, aponte `DATA_DIR` para um volume persistente.
- **Tradução:** por padrão usa o endpoint público do Google Translate (sem chave, pode ter limites). Para algo mais estável, aponte `LIBRETRANSLATE_URL` para um LibreTranslate.

## 4. Comandos de barra

`/rank` `/top` `/traduzir` `/dado` `/moeda` `/ppt` `/quiz` `/adivinhar` `/piada` `/fato` `/abracar` `/bola8` `/painel`

Comandos personalizados (prefixo + nome, ex.: `!regras`) são criados no painel.

## 5. Variáveis nas mensagens

`{user}` menciona • `{username}` nome • `{server}` servidor • `{count}` nº de membros • `{level}` nível • `{args}` texto após o comando • `{channel}` canal.
Para marcar cargos/canais use os seletores "+ mencionar" do painel.

## 6. Estrutura

```
src/index.js      inicia bot + painel
src/bot.js        toda a lógica do bot
src/web.js        login Discord + API do painel
src/config.js     padrões e validação das configurações
src/card.js       imagens (boas-vindas, saída, rank)
src/translate.js  tradução
src/content.js    piadas, fatos e perguntas do quiz (edite à vontade)
src/db.js         armazenamento em JSON
public/index.html painel web
```

## 7. Bot-Hosting.net / GitHub

- Envie **todas** as pastas e arquivos para o GitHub (`index.js`, `package.json`, `src/`, `public/`, `assets/`), **menos** o `.env`, que tem seus segredos.
- Crie o `.env` direto no gerenciador de arquivos da hospedagem (ou use as variáveis de ambiente dela).
- Comando de início: `node index.js` (a porta vem de `SERVER_PORT`/`PORT` automaticamente).
- `BASE_URL` = o link do seu site na hospedagem, e o Redirect no Discord = `BASE_URL/auth/callback`.
