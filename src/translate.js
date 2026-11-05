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

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Cache: se a mesma frase já foi traduzida para o mesmo idioma, não chama a API de novo.
// Isso reduz muito os erros 429 (limite de requisições) quando alguém reage com bandeira
// numa mensagem que a tradução automática já traduziu.
const CACHE = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hora
const CACHE_MAX = 500;

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL) { CACHE.delete(key); return null; }
  return hit.v;
}

function cacheSet(key, value) {
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { t: Date.now(), v: value });
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
};

async function translateRaw(text, target) {
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

  const q = encodeURIComponent(text);
  const tl = encodeURIComponent(target);
  let lastErr;

  for (let attempt = 0; attempt < 3; attempt++) {
    // 1) endpoint principal do Google
    try {
      const r = await fetch(
        'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' + tl + '&q=' + q,
        { headers: HEADERS, signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) throw new Error('Tradutor respondeu ' + r.status);
      const j = await r.json();
      const out = (j[0] || []).map((x) => x[0]).join('');
      if (out) return { text: out, from: j[2] || '' };
    } catch (e) {
      lastErr = e;
    }

    // 2) endpoint reserva do Google
    try {
      const r = await fetch(
        'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=' + tl + '&q=' + q,
        { headers: HEADERS, signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) throw new Error('Reserva respondeu ' + r.status);
      const j = await r.json();
      const out = (j.sentences || []).map((s) => s.trans || '').join('');
      if (out) return { text: out, from: j.src || '' };
    } catch (e) {
      lastErr = e;
    }

    // 3) MyMemory (serviço diferente do Google; aceita textos de até 500 caracteres)
    if (text.length <= 450) {
      try {
        const t = target === 'iw' ? 'he' : target;
        const r = await fetch(
          'https://api.mymemory.translated.net/get?q=' + q + '&langpair=' + encodeURIComponent('Autodetect|' + t),
          { headers: HEADERS, signal: AbortSignal.timeout(10000) }
        );
        if (!r.ok) throw new Error('MyMemory respondeu ' + r.status);
        const j = await r.json();
        const out = j?.responseData?.translatedText;
        if (out && j.responseStatus == 200) {
          return { text: out, from: String(j.responseData.detectedLanguage || '').split('-')[0] };
        }
      } catch (e) {
        lastErr = e;
      }
    }

    // espera um pouco mais a cada tentativa (1,5 s, depois 3 s)
    if (attempt < 2) await sleep(1500 * (attempt + 1));
  }
  throw lastErr || new Error('Falha ao traduzir');
}

async function translate(text, target) {
  text = String(text).slice(0, 1500);
  const key = target + '\n' + text;
  const cached = cacheGet(key);
  if (cached) return cached;
  const result = await translateRaw(text, target);
  if (result && result.text) cacheSet(key, result);
  return result;
}

module.exports = { translate, LANGS, FLAGS, baseLang, flagLang, langName };
