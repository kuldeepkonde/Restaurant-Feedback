// AI feedback suggestions.
// Works with OpenAI or any OpenAI-compatible API (Groq, Together, OpenRouter, Gemini's
// OpenAI endpoint, a local Ollama, ...). If no key is set, or the API is slow or down,
// it falls back to built-in templates so customers never wait on a spinner.

const API_KEY = process.env.OPENAI_API_KEY || '';
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 6000);
const RESTAURANT = process.env.RESTAURANT_NAME || 'the restaurant';
const HIGHLIGHTS = process.env.RESTAURANT_HIGHLIGHTS || ''; // e.g. "misal pav, thali, filter coffee"

const LANGS = { en: 'English', hi: 'Hindi (Devanagari script)', mr: 'Marathi (Devanagari script)' };
const ASPECTS = ['food', 'service', 'ambiance', 'value', 'speed', 'cleanliness'];

const TONE = {
  5: 'Highly positive and enthusiastic: amazing food, excellent service, great ambiance. No complaints.',
  4: 'Positive overall, with one small, specific, polite thing that could be even better.',
  3: 'Neutral / mixed: some things were good, some were average. Balanced and fair.',
  2: 'Dissatisfied but constructive: name what went wrong and suggest a concrete improvement.',
  1: 'Strongly negative: a genuinely poor experience (e.g. rude or slow service, cold or bad food). Firm but not abusive.',
};

// ---------- Fallback templates (used when AI is unavailable) ----------
const TEMPLATES = {
  en: {
    5: [
      'Amazing food, excellent service and a lovely ambiance. Will definitely come back!',
      'Everything was perfect — fresh, flavourful food and staff who made us feel welcome.',
      'One of the best meals I have had in a while. Great taste, quick service, great value.',
      'Loved every dish! The staff were attentive and the place was spotless.',
      'Fantastic experience from start to finish. Highly recommended for family and friends.',
    ],
    4: [
      'Really good food and friendly staff. Service was a little slow at peak time, but worth it.',
      'Enjoyed the meal a lot. A bit more spice in the curry would make it perfect.',
      'Great taste and nice ambiance. Seating was slightly cramped, otherwise excellent.',
      'Very good experience overall. Would love a few more vegetarian options on the menu.',
      'Tasty food at fair prices. The wait for the bill could be shorter.',
    ],
    3: [
      'Food was okay — some dishes were good, others were average. Service was fine.',
      'Decent experience. Nothing special, but nothing bad either.',
      'Ambiance was nice but the food was just average for the price.',
      'Good starters, but the main course was lukewarm. Staff were polite.',
      'An average visit. Quicker service would make a big difference.',
    ],
    2: [
      'Disappointed this time. Food arrived cold and we waited a long time. Please improve kitchen timing.',
      'Service was slow and our order was mixed up. More attentive staff would help.',
      'The food lacked flavour and portions were small for the price. Please review the menu quality.',
      'Table was not cleaned properly when we sat down. Cleanliness needs attention.',
      'We had to ask several times for water and the bill. Staff should check on tables more often.',
    ],
    1: [
      'Very poor experience. We waited over 45 minutes and the food was cold when it came.',
      'Staff were rude and unhelpful. Not the service I expect from a restaurant.',
      'The food tasted stale and the place was not clean. Would not recommend.',
      'Wrong order, long wait and nobody apologised. Very disappointing visit.',
      'Terrible service and overpriced food. Will not be coming back.',
    ],
  },
  hi: {
    5: [
      'बहुत ही शानदार खाना, बढ़िया सर्विस और अच्छा माहौल। ज़रूर दोबारा आएँगे!',
      'सब कुछ परफेक्ट था — ताज़ा और स्वादिष्ट खाना, और स्टाफ़ बहुत अच्छा था।',
      'काफ़ी समय बाद इतना अच्छा खाना खाया। स्वाद, सर्विस और दाम — सब बढ़िया।',
    ],
    4: [
      'खाना बहुत अच्छा था और स्टाफ़ भी अच्छा था। भीड़ के समय सर्विस थोड़ी धीमी थी।',
      'खाना मज़ेदार था। करी में थोड़ा और मसाला होता तो परफेक्ट होता।',
      'अच्छा स्वाद और अच्छा माहौल। बिल आने में थोड़ा समय लगा।',
    ],
    3: [
      'खाना ठीक-ठाक था — कुछ डिश अच्छी थीं, कुछ औसत। सर्विस ठीक थी।',
      'औसत अनुभव। कुछ ख़ास नहीं, पर बुरा भी नहीं।',
      'माहौल अच्छा था, लेकिन दाम के हिसाब से खाना औसत था।',
    ],
    2: [
      'इस बार निराशा हुई। खाना ठंडा आया और बहुत इंतज़ार करना पड़ा। किचन की टाइमिंग सुधारें।',
      'सर्विस धीमी थी और ऑर्डर भी गलत आया। स्टाफ़ को थोड़ा ज़्यादा ध्यान देना चाहिए।',
      'खाने में स्वाद कम था और दाम के हिसाब से मात्रा भी कम थी।',
    ],
    1: [
      'बहुत खराब अनुभव। 45 मिनट से ज़्यादा इंतज़ार किया और खाना ठंडा आया।',
      'स्टाफ़ का व्यवहार अच्छा नहीं था। ऐसी सर्विस की उम्मीद नहीं थी।',
      'खाना बासी लगा और जगह साफ़ नहीं थी। मैं सलाह नहीं दूँगा।',
    ],
  },
  mr: {
    5: [
      'अप्रतिम जेवण, उत्तम सेवा आणि छान वातावरण. नक्की पुन्हा येऊ!',
      'सगळं परफेक्ट होतं — ताजं, चविष्ट जेवण आणि स्टाफ खूप आपुलकीने वागला.',
      'खूप दिवसांनी इतकं छान जेवण केलं. चव, सेवा आणि किंमत — सगळं उत्तम.',
    ],
    4: [
      'जेवण खूप छान होतं आणि स्टाफही चांगला होता. गर्दीच्या वेळी सेवा थोडी संथ होती.',
      'जेवण चविष्ट होतं. रश्श्यात थोडा अजून तिखटपणा असता तर परफेक्ट झालं असतं.',
      'छान चव आणि छान वातावरण. बिल यायला थोडा वेळ लागला.',
    ],
    3: [
      'जेवण ठीक होतं — काही पदार्थ छान, काही सर्वसाधारण. सेवा ठीक होती.',
      'सर्वसाधारण अनुभव. काही खास नाही, पण वाईटही नाही.',
      'वातावरण छान होतं, पण किमतीच्या मानाने जेवण सर्वसाधारण होतं.',
    ],
    2: [
      'या वेळी निराशा झाली. जेवण थंड आलं आणि खूप वेळ थांबावं लागलं. किचनची वेळ सुधारावी.',
      'सेवा संथ होती आणि ऑर्डरही चुकीची आली. स्टाफने अजून लक्ष द्यायला हवं.',
      'जेवणाला चव कमी होती आणि किमतीच्या मानाने प्रमाणही कमी होतं.',
    ],
    1: [
      'खूप वाईट अनुभव. ४५ मिनिटांहून जास्त थांबलो आणि जेवण थंड आलं.',
      'स्टाफचं वागणं चांगलं नव्हतं. अशा सेवेची अपेक्षा नव्हती.',
      'जेवण शिळं वाटलं आणि जागा स्वच्छ नव्हती. मी शिफारस करणार नाही.',
    ],
  },
};

function pick(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// ---------- AI call ----------
async function callAI(rating, lang, aspects) {
  const aspectLine = aspects.length
    ? `The customer said these stood out: ${aspects.join(', ')}. Focus the reviews on these aspects.`
    : 'Cover a natural mix of food, service, ambiance and value.';

  const system =
    'You write short, realistic restaurant reviews that a customer can post as their own. ' +
    'Write in first person, in a natural everyday voice (not marketing copy). ' +
    'Never invent staff names, prices, or specific dishes unless they are provided. ' +
    'Never include hashtags, emojis, or quotation marks. Return only JSON.';

  const user = [
    `Restaurant: ${RESTAURANT}.`,
    HIGHLIGHTS ? `Popular items (mention only if natural): ${HIGHLIGHTS}.` : '',
    `Star rating given: ${rating} out of 5.`,
    `Tone required: ${TONE[rating]}`,
    aspectLine,
    `Language: ${LANGS[lang]}.`,
    'Write 6 distinct reviews, each 1–2 sentences and under 35 words, varied in wording and focus.',
    'Respond as: {"suggestions": ["...", "..."]}',
  ].filter(Boolean).join('\n');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.9,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`AI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    const list = (parsed.suggestions || [])
      .map((s) => String(s).trim().replace(/^["']|["']$/g, ''))
      .filter((s) => s.length > 5 && s.length < 400);
    if (list.length < 3) throw new Error('AI returned too few suggestions');
    return list;
  } finally {
    clearTimeout(timer);
  }
}

// Cache a pool per (rating, language) when no aspects are chosen: keeps the page fast
// and the API bill tiny, while still giving each customer a random mix.
const cache = new Map();
const CACHE_MS = 15 * 60 * 1000;

async function getSuggestions({ rating, lang = 'en', aspects = [] }) {
  rating = Math.min(5, Math.max(1, Math.round(Number(rating))));
  if (!LANGS[lang]) lang = 'en';
  aspects = aspects.filter((a) => ASPECTS.includes(a)).slice(0, 4);

  const fallback = () => ({ suggestions: pick(TEMPLATES[lang][rating], 3), source: 'template' });
  if (!API_KEY) return fallback();

  const key = `${rating}:${lang}`;
  if (!aspects.length) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { suggestions: pick(hit.list, 3), source: 'ai' };
  }

  try {
    const list = await callAI(rating, lang, aspects);
    if (!aspects.length) cache.set(key, { list, at: Date.now() });
    return { suggestions: pick(list, 3), source: 'ai' };
  } catch (err) {
    console.warn('[ai] falling back to templates:', err.message);
    return fallback();
  }
}

module.exports = { getSuggestions, ASPECTS, aiEnabled: () => Boolean(API_KEY), MODEL };
