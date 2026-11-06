// Conteúdo do RPG "Idle Mafia": inimigos, itens e títulos. Para ampliar o jogo, basta editar este arquivo.
const ENEMIES = [
  { id: 'batedor', name: 'Batedor de carteira', emoji: '🧤', minLvl: 1, hp: 36, atk: 5, cash: [40, 80], xp: 15 },
  { id: 'capanga', name: 'Capanga de rua', emoji: '🥊', minLvl: 1, hp: 50, atk: 8, cash: [70, 120], xp: 22 },
  { id: 'seguranca', name: 'Segurança de cassino', emoji: '🎰', minLvl: 3, hp: 110, atk: 15, cash: [160, 260], xp: 40 },
  { id: 'contrabandista', name: 'Contrabandista do porto', emoji: '🚢', minLvl: 5, hp: 160, atk: 22, cash: [280, 440], xp: 60 },
  { id: 'policial', name: 'Policial corrupto', emoji: '🚔', minLvl: 7, hp: 220, atk: 28, cash: [400, 640], xp: 85 },
  { id: 'gangue', name: 'Gangue rival', emoji: '🔫', minLvl: 10, hp: 320, atk: 38, cash: [700, 1000], xp: 120 },
  { id: 'caporival', name: 'Capo rival', emoji: '🕴️', minLvl: 14, hp: 480, atk: 50, cash: [1200, 1800], xp: 180 },
  { id: 'chefao', name: 'Chefão da Máfia', emoji: '👑', minLvl: 20, hp: 800, atk: 70, cash: [3000, 5000], xp: 320 },
];

const ITEMS = {
  faca: { id: 'faca', kind: 'weapon', name: 'Faca de bolso', emoji: '🔪', atk: 3, price: 80 },
  taco: { id: 'taco', kind: 'weapon', name: 'Taco de beisebol', emoji: '🏏', atk: 4, price: 150 },
  pistola: { id: 'pistola', kind: 'weapon', name: 'Pistola', emoji: '🔫', atk: 9, price: 500 },
  escopeta: { id: 'escopeta', kind: 'weapon', name: 'Escopeta', emoji: '💥', atk: 16, price: 1500 },
  submetralhadora: { id: 'submetralhadora', kind: 'weapon', name: 'Submetralhadora', emoji: '🧨', atk: 26, price: 4000 },
  colete: { id: 'colete', kind: 'armor', name: 'Colete leve', emoji: '🦺', def: 2, price: 200 },
  tatico: { id: 'tatico', kind: 'armor', name: 'Colete tático', emoji: '🛡️', def: 5, price: 800 },
  blindagem: { id: 'blindagem', kind: 'armor', name: 'Blindagem pesada', emoji: '🏰', def: 9, price: 2500 },
  kit: { id: 'kit', kind: 'consumable', name: 'Kit médico', emoji: '💊', heal: 50, price: 60 },
};

const TITLES = [
  [1, 'Aprendiz'], [3, 'Capanga'], [6, 'Soldato'], [10, 'Caporegime'], [15, 'Subchefe'], [20, 'Chefão'],
];

// Negócios: rendem grana por hora (acumulam até 8 horas; é preciso coletar).
const BUSINESSES = [
  { id: 'bar', name: 'Bar clandestino', emoji: '🍺', price: 500, income: 40 },
  { id: 'deposito', name: 'Depósito de contrabando', emoji: '📦', price: 1500, income: 140 },
  { id: 'cassino', name: 'Cassino subterrâneo', emoji: '🎰', price: 3500, income: 330 },
  { id: 'lavanderia', name: 'Lavanderia de dinheiro', emoji: '🧺', price: 9000, income: 900 },
  { id: 'porto', name: 'Controle do porto', emoji: '🚢', price: 22000, income: 2400 },
];
const BIZ_CAP_HOURS = 8;

// Quem começa agora já sai com uma faca e 2 kits.
const START = { lvl: 1, xp: 0, hp: 110, cash: 250, weapon: 'faca', armor: '', kits: 3, wins: 0, losses: 0, biz: [], collectAt: 0 };

module.exports = { ENEMIES, ITEMS, TITLES, START, BUSINESSES, BIZ_CAP_HOURS };
