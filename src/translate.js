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
  ['Indonésio', 'id'],
  ['Tailandês', 'th'],
  ['Vietnamita', 'vi'],
  ['Grego', 'el'],
  ['Hebraico', 'iw'],
  ['Sueco', 'sv'],
  ['Dinamarquês', 'da'],
  ['Norueguês', 'no'],
  ['Finlandês', 'fi'],
  ['Tcheco', 'cs'],
  ['Romeno', 'ro'],
  ['Húngaro', 'hu'],
  ['Búlgaro', 'bg'],
  ['Persa', 'fa'],
  ['Bengali', 'bn'],
  ['Urdu', 'ur'],
  ['Malaio', 'ms'],
  ['Filipino', 'tl'],
  ['Chinês (tradicional)', 'zh-TW'],
];

const FLAGS = {
  '🇧🇷': 'pt', '🇵🇹': 'pt', '🇺🇸': 'en', '🇬🇧': 'en', '🇪🇸': 'es', '🇲🇽': 'es', '🇦🇷': 'es',
  '🇫🇷': 'fr', '🇩🇪': 'de', '🇮🇹': 'it', '🇯🇵': 'ja', '🇰🇷': 'ko', '🇷🇺': 'ru',
  '🇨🇳': 'zh-CN', '🇸🇦': 'ar', '🇹🇷': 'tr', '🇮🇳': 'hi', '🇵🇱': 'pl', '🇳🇱': 'nl', '🇺🇦': 'uk',
};

// Idioma de cada país (qualquer bandeira de país funciona na reação).
const COUNTRY_LANG = {};
const addCountries = (lang, codes) => codes.split(' ').forEach((c) => { COUNTRY_LANG[c] = lang; });
addCountries('pt', 'BR PT AO MZ CV GW ST TL');
addCountries('en', 'US GB CA AU NZ IE ZA SG NG GH KE JM TT BS BB BZ GY LR SL UG ZW ZM MW BW NA FJ PG LC VC GD AG DM KN SS GU VI AS');
addCountries('es', 'ES MX AR CO CL PE VE EC BO PY UY CR PA GT HN SV NI DO CU PR GQ');
addCountries('fr', 'FR BE LU HT SN CI CM CD CG GA ML NE BF TD MG BJ TG GN RW BI DJ KM MC MQ GP RE NC PF GF');
addCountries('de', 'DE AT CH LI');
addCountries('it', 'IT SM VA');
addCountries('ja', 'JP');
addCountries('ko', 'KR KP');
addCountries('ru', 'RU BY KG');
addCountries('zh-CN', 'CN');
addCountries('zh-TW', 'TW HK MO');
addCountries('ar', 'SA AE EG IQ JO KW LB LY MA DZ TN OM QA BH YE SY SD MR PS EH');
addCountries('tr', 'TR');
addCountries('hi', 'IN');
addCountries('pl', 'PL');
addCountries('nl', 'NL SR AW CW SX');
addCountries('uk', 'UA');
addCountries('id', 'ID');
addCountries('th', 'TH');
addCountries('vi', 'VN');
addCountries('el', 'GR CY');
addCountries('iw', 'IL');
addCountries('sv', 'SE AX');
addCountries('da', 'DK GL FO');
addCountries('no', 'NO SJ');
addCountries('fi', 'FI');
addCountries('cs', 'CZ');
addCountries('sk', 'SK');
addCountries('ro', 'RO MD');
addCountries('hu', 'HU');
addCountries('bg', 'BG');
addCountries('sr', 'RS ME');
addCountries('hr', 'HR');
addCountries('bs', 'BA');
addCountries('sl', 'SI');
addCountries('fa', 'IR AF');
addCountries('bn', 'BD');
addCountries('ur', 'PK');
addCountries('ms', 'MY BN');
addCountries('tl', 'PH');
addCountries('sw', 'TZ');
addCountries('et', 'EE');
addCountries('lv', 'LV');
addCountries('lt', 'LT');
addCountries('is', 'IS');
addCountries('sq', 'AL XK');
addCountries('mk', 'MK');
addCountries('ka', 'GE');
addCountries('hy', 'AM');
addCountries('az', 'AZ');
addCountries('kk', 'KZ');
addCountries('uz', 'UZ');
addCountries('mn', 'MN');
addCountries('ne', 'NP');
addCountries('si', 'LK');
addCountries('my', 'MM');
addCountries('km', 'KH');
addCountries('lo', 'LA');
addCountries('am', 'ET');
addCountries('so', 'SO');
addCountries('ca', 'AD');
addCountries('mt', 'MT');

/** Idioma da bandeira (emoji de país). Devolve '' se não for uma bandeira conhecida. */
function flagLang(emoji) {
  if (FLAGS[emoji]) return FLAGS[emoji];
  const cps = Array.from(String(emoji || ''));
  if (cps.length === 2) {
    const a = cps[0].codePointAt(0) - 0x1f1e6;
    const b = cps[1].codePointAt(0) - 0x1f1e6;
    if (a >= 0 && a < 26 && b >= 0 && b < 26) {
      return COUNTRY_LANG[String.fromCharCode(65 + a, 65 + b)] || '';
    }
  }
  if (String(emoji).startsWith('\u{1F3F4}')) return 'en'; // Inglaterra, Escócia, País de Gales
  return '';
}

/** Nome do idioma em português (ex.: "inglês"). */
function langName(code) {
  const c = String(code || '').trim();
  if (!c) return '?';
  try {
    const n = new Intl.DisplayNames(['pt-BR'], { type: 'language' }).of(c === 'iw' ? 'he' : c);
    if (n && n !== c) return n;
  } catch {}
  return c;
}

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
        target: target === 'iw' ? 'he' : target === 'zh-TW' ? 'zh' : baseLang(target),
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

module.exports = { translate, LANGS, FLAGS, baseLang, flagLang, langName };
