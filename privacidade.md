# Política de Privacidade do Bot QSD

A sua privacidade é extremamente importante para nós. Esta Política de Privacidade explica como o **Bot QSD** coleta, armazena e protege as informações do seu servidor e dos membros.

## 1. Informações que Coletamos
Para funcionar corretamente, o bot pode processar e armazenar:
* **Dados do Servidor:** IDs de servidores, IDs de canais, IDs de cargos configurados e logs de ações (como mensagens de boas-vindas/saída).
* **Dados do Usuário:** IDs de membros, nomes de usuário (tags), ranks/níveis alcançados no sistema de XP e dados de saldo de mini-jogos.
* **Funções de gangue do Idle Mafia (coaching, guerra e pontos semanais):** o nome de quem enviou o print, o nome da conta no jogo informado pelo membro, poder e nomes dos Capos dos times, marcações da guerra (times de defesa, ataques e prédios) e pontos semanais da gangue. Os prints continuam no canal do Discord onde foram enviados; o bot guarda só os dados lidos e o link da mensagem.
* **Dados do Painel Web:** Informações básicas do seu perfil do Discord obtidas via login seguro por OAuth2 (ID, nome e avatar).

## 2. Uso das Informações
Os dados coletados são utilizados exclusivamente para:
* Operar as funções principais do bot (moderação, rank/nível, economia e traduções).
* Autenticar o seu acesso como administrador no painel web.
* Garantir o funcionamento dos mini-jogos e rankings públicos do servidor.

## 3. Armazenamento e Compartilhamento de Dados
Nós **não** vendemos nem alugamos nenhuma informação. Os dados ficam salvos no banco de dados do bot. Para algumas funções, o bot usa serviços de terceiros, que recebem apenas o necessário:
* **Leitura de prints por IA (Google Gemini):** a imagem do print enviada nos canais configurados (formações e pontos) é enviada ao Google para ser lida. O uso dessas imagens pelo Google segue os termos e a política de privacidade do próprio Google. Por isso, **não envie nos canais de leitura prints com informações pessoais ou sensíveis**.
* **Tradução:** o texto traduzido é enviado a um serviço de tradução (Google Translate ou o servidor de tradução configurado).
* **Pagamentos do plano Premium:** são processados pelo Mercado Pago/Pix. O bot **não** guarda dados de cartão nem de conta bancária, apenas o status e a validade do plano.
* **Discord:** o bot funciona sobre a API do Discord e segue os termos dela.

## 4. Segurança
Implementamos medidas técnicas para proteger os dados coletados de acessos não autorizados. No entanto, por depender de serviços de terceiros (como a hospedagem e a própria API do Discord), não há um método de transmissão 100% seguro.

## 5. Por quanto tempo guardamos
Os pontos semanais da gangue ficam guardados por cerca de 12 semanas. Os demais dados ficam enquanto o bot estiver no servidor ou até a equipe corrigi-los ou apagá-los no painel.

## 6. Seus Direitos e Remoção de Dados
Qualquer administrador pode solicitar a exclusão completa dos dados do seu respectivo servidor de nossa base de dados. Basta remover o bot do servidor ou entrar em contato com o suporte do projeto. Um membro também pode pedir à liderança do servidor que apague os dados dele (a equipe consegue apagar membros e contas pelo painel).

---
*Última atualização: Novembro de 2026*
