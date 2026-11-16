// Pix manual (chave aleatória): gera o "copia e cola" do QR Code de pagamento do Premium.
// O Pix de chave comum NÃO avisa o bot quando alguém paga: o dono confere o recebimento e
// libera o Premium pelo painel (aba 💎 Premium → Área do dono). O QR em public/pix-qr.png
// é gerado a partir deste mesmo texto; se mudar o valor, o QR precisa ser gerado de novo.
const KEY = 'd93d1d2f-e401-410c-afc7-f5526209afd3'; // chave Pix aleatória
const NAME = 'BOT QSD';      // nome exibido no QR (até 25 letras)
const CITY = 'SAO PAULO';    // cidade (até 15 letras, só consta no Pix)
const TXID = 'DqcPAp8gn4';   // identificador da cobrança no Nubank
const AMOUNT = 14.9;         // valor em reais

const field = (id, value) => id + String(value.length).padStart(2, '0') + value;

function crc16(text) {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Texto do Pix "copia e cola" (o mesmo que está dentro do QR Code). */
function payload(amount = AMOUNT) {
  const body =
    field('00', '01') +
    field('26', field('00', 'BR.GOV.BCB.PIX') + field('01', KEY)) +
    field('52', '0000') +
    field('53', '986') +
    field('54', Number(amount).toFixed(2)) +
    field('58', 'BR') +
    field('59', NAME) +
    field('60', CITY) +
    field('62', field('05', TXID)) +
    '6304';
  return body + crc16(body);
}

module.exports = { payload, crc16, AMOUNT, NAME, CITY, KEY, TXID };
