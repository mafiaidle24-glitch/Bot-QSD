// Tradução automática. Por padrão usa o endpoint público do Google Translate (sem chave).
// Se LIBRETRANSLATE_URL estiver no .env, usa o seu LibreTranslate.

const LANGS = [
  ['Português', 'pt'],
  ['Inglês', 'en'],
  ['Espanhol', 'es'],
  ['Francês', 'fr'],
  ['Alemão', 'de'],
  ['Italiano', 'it'],
  ['Japonês', 'ja'],
  ['Coreano', 'ko'],
  ['Russo', 'ru'],
  ['Chinês (simplificado)', 'zh-CN'],
  ['Árabe', 'ar'],
  ['Turco', 'tr'],
  ['Hindi', 'hi'],
  ['Polonês', 'pl'],
  ['Holandês', 'nl'],
  ['Ucraniano', 'uk'],
];

const FLAGS = {
  '🇧🇷': 'pt', '🇵🇹': 'pt', '🇺🇸': 'en', '🇬🇧': 'en', '🇪🇸': 'es', '🇲🇽': 'es', '🇦🇷': 'es',
  '🇫🇷': 'fr', '🇩🇪': 'de', '🇮🇹': 'it', '🇯🇵': 'ja', '🇰🇷': 'ko', '🇷🇺': 'ru',
  '🇨🇳': 'zh-CN', '🇸🇦': 'ar', '🇹🇷': 'tr', '🇮🇳': 'hi', '🇵🇱': 'pl', '🇳🇱': 'nl', '🇺🇦': 'uk',
};

const baseLang = (c) => String(c || '').toLowerCase().split('-')[0];

async function translate(text, target) {
  text = String(text).slice(0, 1500);
  if (process.env.LIBRETRANSLATE_URL) {
    const r = await fetch(process.env.LIBRETRANSLATE_URL.replace(/\/$/, '') + '/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: 'auto',
        target: baseLang(target),
        format: 'text',
        api_key: process.env.LIBRETRANSLATE_KEY || undefined,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error('LibreTranslate respondeu ' + r.status);
    const j = await r.json();
    return { text: j.translatedText, from: j.detectedLanguage?.language || '' };
  }
  const u =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' +
    encodeURIComponent(target) +
    '&q=' +
    encodeURIComponent(text);
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Tradutor respondeu ' + r.status);
  const j = await r.json();
  return { text: (j[0] || []).map((x) => x[0]).join(''), from: j[2] || '' };
}

module.exports = { translate, LANGS, FLAGS, baseLang };
