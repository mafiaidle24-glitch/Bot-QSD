// Conteúdo do RPG "Idle Mafia": inimigos, itens e títulos. Para ampliar o jogo, basta editar este arquivo.
const ENEMIES = [
  { id: 'batedor', name: 'Batedor de carteira', emoji: '🧤', minLvl: 1, hp: 40, atk: 6, cash: [20, 40], xp: 15 },
  { id: 'capanga', name: 'Capanga de rua', emoji: '🥊', minLvl: 1, hp: 60, atk: 9, cash: [35, 60], xp: 22 },
  { id: 'seguranca', name: 'Segurança de cassino', emoji: '🎰', minLvl: 3, hp: 110, atk: 15, cash: [80, 130], xp: 40 },
  { id: 'contrabandista', name: 'Contrabandista do porto', emoji: '🚢', minLvl: 5, hp: 160, atk: 22, cash: [140, 220], xp: 60 },
  { id: 'policial', name: 'Policial corrupto', emoji: '🚔', minLvl: 7, hp: 220, atk: 28, cash: [200, 320], xp: 85 },
  { id: 'gangue', name: 'Gangue rival', emoji: '🔫', minLvl: 10, hp: 320, atk: 38, cash: [350, 500], xp: 120 },
  { id: 'caporival', name: 'Capo rival', emoji: '🕴️', minLvl: 14, hp: 480, atk: 50, cash: [600, 900], xp: 180 },
  { id: 'chefao', name: 'Chefão da Máfia', emoji: '👑', minLvl: 20, hp: 800, atk: 70, cash: [1500, 2500], xp: 320 },
];

const ITEMS = {
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

const START = { lvl: 1, xp: 0, hp: 100, cash: 100, weapon: '', armor: '', kits: 1, wins: 0, losses: 0, lastRest: 0, lastFight: 0 };

module.exports = { ENEMIES, ITEMS, TITLES, START };
