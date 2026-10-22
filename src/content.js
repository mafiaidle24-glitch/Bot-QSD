// Conteúdo do bot: piadas, fatos, perguntas de quiz etc. Edite à vontade.

const JOKES = [
  'Por que o livro de matemática ficou triste? Porque tinha muitos problemas.',
  'O que o pagodeiro foi fazer na igreja? Cantar Pá-Gloria.',
  'Qual é o cúmulo da rapidez? Fechar a porta do guarda-roupa e ver o ator.',
  'O que o tomate foi fazer no banco? Tirar extrato.',
  'Por que o computador foi ao médico? Porque estava com vírus.',
  'Qual é o animal mais antigo? A zebra, porque é em preto e branco.',
  'O que a vaca disse para o vaqueiro? Nada, vaca não fala.',
  'Por que o esqueleto não brigou com ninguém? Porque ele não tem estômago pra isso.',
  'O que é um pontinho verde no meio do mato? Uma ervilha perdida.',
  'Qual é o fim da picada? Quando o mosquito vai embora.',
  'Por que o jacaré tirou o filho da escola? Porque ele réptil de ano.',
  'O que o zero disse pro oito? Belo cinto!',
  'Como se chama um boi que cochila? Um boi-constrictor... digo, um boi-dormido.',
  'Qual o contrário de volátil? Vem de ré, tio.',
  'Por que a plantinha não atende o telefone? Porque ela só dá ramal.',
];

const FACTS = [
  'Polvos têm três corações e sangue azul.',
  'O mel nunca estraga: já acharam potes comestíveis em tumbas egípcias.',
  'Bananas são ligeiramente radioativas por causa do potássio-40.',
  'Um dia em Vênus dura mais que um ano em Vênus.',
  'Os wombats fazem cocô em formato de cubo.',
  'O coração de um camarão fica na cabeça.',
  'A Torre Eiffel pode crescer até 15 cm no verão por causa da dilatação do metal.',
  'Formigas não dormem como a gente: fazem cochilos de cerca de 8 minutos.',
  'Existem mais estrelas no universo observável do que grãos de areia em todas as praias da Terra.',
  'O som não viaja no vácuo do espaço.',
  'Os golfinhos chamam uns aos outros por "nomes" feitos de assobios únicos.',
  'O Brasil tem mais de 8.000 km de litoral.',
  'Uma nuvem cumulus média pesa cerca de 500 toneladas.',
  'Os flamingos nascem cinza; a cor rosa vem da alimentação.',
  'Raios são cerca de cinco vezes mais quentes que a superfície do Sol.',
];

// answer = índice da opção correta
const QUIZ = [
  { q: 'Qual é a capital da Austrália?', options: ['Sydney', 'Canberra', 'Melbourne', 'Perth'], answer: 1 },
  { q: 'Quantos planetas existem no Sistema Solar?', options: ['7', '8', '9', '10'], answer: 1 },
  { q: 'Quem pintou a Mona Lisa?', options: ['Michelangelo', 'Van Gogh', 'Leonardo da Vinci', 'Picasso'], answer: 2 },
  { q: 'Qual é o maior oceano da Terra?', options: ['Atlântico', 'Índico', 'Ártico', 'Pacífico'], answer: 3 },
  { q: 'Em que ano o homem pisou na Lua pela primeira vez?', options: ['1965', '1969', '1972', '1959'], answer: 1 },
  { q: 'Qual é o elemento químico de símbolo "O"?', options: ['Ouro', 'Osmio', 'Oxigênio', 'Ozônio'], answer: 2 },
  { q: 'Qual é o maior animal terrestre?', options: ['Girafa', 'Rinoceronte', 'Elefante africano', 'Hipopótamo'], answer: 2 },
  { q: 'Quantos lados tem um hexágono?', options: ['5', '6', '7', '8'], answer: 1 },
  { q: 'Qual país tem o formato de uma bota?', options: ['Espanha', 'Grécia', 'Portugal', 'Itália'], answer: 3 },
  { q: 'Qual é o rio mais extenso do Brasil?', options: ['São Francisco', 'Amazonas', 'Paraná', 'Tocantins'], answer: 1 },
  { q: 'Qual é o resultado de 12 x 12?', options: ['124', '132', '144', '154'], answer: 2 },
  { q: 'Quem escreveu "Dom Casmurro"?', options: ['José de Alencar', 'Machado de Assis', 'Clarice Lispector', 'Graciliano Ramos'], answer: 1 },
  { q: 'Qual é o metal líquido à temperatura ambiente?', options: ['Ferro', 'Mercúrio', 'Chumbo', 'Cobre'], answer: 1 },
  { q: 'Qual é a língua mais falada do mundo por nativos?', options: ['Inglês', 'Espanhol', 'Mandarim', 'Hindi'], answer: 2 },
  { q: 'Quantos jogadores tem um time de futebol em campo?', options: ['9', '10', '11', '12'], answer: 2 },
  { q: 'Qual planeta é conhecido como "planeta vermelho"?', options: ['Vênus', 'Marte', 'Júpiter', 'Mercúrio'], answer: 1 },
  { q: 'Qual é o menor país do mundo?', options: ['Mônaco', 'Malta', 'Vaticano', 'San Marino'], answer: 2 },
  { q: 'Em que continente fica o Egito?', options: ['Ásia', 'Europa', 'África', 'Oceania'], answer: 2 },
  { q: 'Qual gás as plantas absorvem na fotossíntese?', options: ['Oxigênio', 'Nitrogênio', 'Gás carbônico', 'Hélio'], answer: 2 },
  { q: 'Quantos minutos tem uma hora e meia?', options: ['60', '80', '90', '100'], answer: 2 },
];

const EIGHT_BALL = [
  'Com certeza! ✅', 'Sem dúvida alguma.', 'Tudo indica que sim.', 'Pode apostar.',
  'Talvez... pergunte de novo mais tarde. 🤔', 'Não consigo prever agora.',
  'Não conte com isso. ❌', 'Minha resposta é não.', 'Muito duvidoso.', 'As fontes dizem que não.',
];

module.exports = { JOKES, FACTS, QUIZ, EIGHT_BALL };
