const NORMALIZED_ROUTES = [
  {
    slug: 'manager',
    intents: [
      'who am i', 'what is my name', 'my actual name', 'my real name', 'do you know my name', 'profile', 'logged in', 'session',
      'your role', 'who are you', 'what are you', 'locally running', 'running locally',
      'services', 'service catalog', 'integrations',
      'mero naam', 'naam ke ho', 'mera naam', 'hamar naam', 'mein name', 'wie heisse'
    ]
  },
  {
    slug: 'noc',
    intents: [
      'olt', 'ont', 'onu', 'radius', 'rx', 'tx', 'signal', 'offline', 'outage', 'network',
      'latency', 'packet', 'fiber', 'pppoe', 'tr069', 'tr-069', 'acs', 'genieacs',
      'nas', 'bng', 'bras', 'splitter', 'internet slow', 'slow internet', 'device status',
      'device online', 'devices online', 'resync', 'sync devices', 'test again',
      'wifi name', 'wi-fi name', 'ssid', 'wlan', 'update wifi', 'change wifi', 'rename wifi',
      'network down', 'net slow', 'wifi slow', 'internet dhilo', 'नेट स्लो', 'इन्टरनेट स्लो'
    ]
  },
  {
    slug: 'billing',
    intents: [
      'invoice', 'bill', 'payment', 'paid', 'due', 'balance', 'charge', 'discount',
      'tax', 'renewal', 'recharge', 'outstanding', 'proration', 'billing',
      'baki', 'bhuktani', 'paisa', 'बिल', 'भुक्तानी'
    ]
  },
  {
    slug: 'finance',
    intents: ['revenue', 'collection', 'profit', 'expense', 'settlement', 'reconcile', 'forecast', 'finance']
  },
  {
    slug: 'sales',
    intents: [
      'lead', 'sales', 'package', 'quotation', 'quote', 'coverage', 'new connection',
      'prospect', 'new customer', 'plan suggest'
    ]
  },
  {
    slug: 'inventory',
    intents: ['stock', 'inventory', 'warehouse', 'serial', 'device assignment', 'rma', 'vendor']
  },
  {
    slug: 'field-operations',
    intents: ['technician', 'site visit', 'work order', 'dispatch', 'installation', 'repair', 'field']
  },
  {
    slug: 'ceo',
    intents: ['kpi', 'executive', 'dashboard', 'business summary', 'company today', 'briefing', 'risk', 'overview']
  },
  {
    slug: 'support',
    intents: [
      'support', 'ticket', 'complaint', 'help', 'customer issue', 'customer', 'account',
      'create ticket', 'open ticket', 'raise ticket', 'log ticket',
      'not working', 'problem', 'issue'
    ]
  }
];

function normalizeMessage(message = '') {
  return String(message)
    .toLowerCase()
    .replace(/[\u0964.,!?;:()[\]{}"'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLanguage(message = '') {
  const text = String(message);
  if (/[\u0900-\u097F]/.test(text)) return 'hi-ne';
  const lower = normalizeMessage(text);
  if (/\b(mero|tapai|kati|dhilo|chha|chaina|bhayo|garna|hernu)\b/.test(lower)) return 'ne';
  if (/\b(mera|kya|hai|kripya|bhai|dhanyavad|kaise)\b/.test(lower)) return 'hi';
  if (/\b(hamar|ka ho|ba|raur|tohar)\b/.test(lower)) return 'bhojpuri';
  if (/\b(hamar|achhi|kiya|ahaan)\b/.test(lower)) return 'maithili';
  if (/[äöüß]/i.test(text) || /\b(und|bitte|gerät|geraet|rechnung|kunde|danke|hallo|wie viele|status der)\b/.test(lower)) return 'de';
  return 'en';
}

function detectAgentIntent(message = '') {
  const text = normalizeMessage(message);
  let best = { slug: 'manager', score: 0, matched: [] };

  for (const route of NORMALIZED_ROUTES) {
    const matched = route.intents.filter(term => text.includes(term));
    const score = matched.reduce((total, term) => total + Math.max(1, term.split(' ').length), 0);
    if (score > best.score) best = { slug: route.slug, score, matched };
  }

  const patternRoutes = [
    { slug: 'noc', label: 'internet slow', regex: /\b(internet|wifi|net|network)\b.{0,40}\b(slow|dhilo|down|offline|not working)\b|\b(slow|dhilo|down|offline)\b.{0,40}\b(internet|wifi|net|network)\b/i, score: 4 },
    { slug: 'noc', label: 'device status', regex: /\b(device|router|onu|ont)\b.{0,40}\b(status|online|offline|sync|resync)\b/i, score: 3 },
    { slug: 'noc', label: 'wifi configuration', regex: /\b(update|change|set|rename|modify|configure)\b.{0,50}\b(wifi|wi-fi|ssid|wlan|wireless)\b|\b(wifi|wi-fi|ssid|wlan|wireless)\b.{0,50}\b(update|change|set|rename|modify|configure)\b/i, score: 6 },
    { slug: 'support', label: 'create ticket', regex: /\b(create|open|raise|log|make|generate|new)\b.{0,40}\btickets?\b|\btickets?\b.{0,40}\b(create|open|raise|log|make|generate|new)\b/i, score: 7 },
    { slug: 'billing', label: 'billing due', regex: /\b(bill|invoice|payment|due|balance)\b.{0,40}\b(check|show|how much|status|pay)\b/i, score: 3 },
    { slug: 'manager', label: 'identity', regex: /\b(?:who am i|(?:who|what|know|tell).{0,30}(?:my (?:actual |real )?name|logged|profile)|my (?:actual |real )?name)\b/i, score: 7 }
  ];
  for (const pattern of patternRoutes) {
    if (pattern.regex.test(text) && pattern.score > best.score) {
      best = { slug: pattern.slug, score: pattern.score, matched: [pattern.label] };
    }
  }

  const confidence = best.score ? Math.min(0.98, 0.52 + best.score * 0.08) : 0.4;
  return { ...best, confidence, language: detectLanguage(message) };
}

async function resolveAgent(prisma, ispId, message, requestedAgentId, structuredIntent = null) {
  if (requestedAgentId) {
    const requested = await prisma.aiAgent.findFirst({ where: { id: Number(requestedAgentId), ispId, status: 'ACTIVE' } });
    if (requested && requested.slug !== 'manager') {
      return { agent: requested, routing: { slug: requested.slug, confidence: 1, matched: [], manual: true, language: detectLanguage(message) } };
    }
  }

  const modelRouting = structuredIntent?.source === 'model' && structuredIntent.confidence >= 0.65
    ? { slug:structuredIntent.targetAgentSlug,score:Math.round(structuredIntent.confidence*10),matched:[structuredIntent.intent],confidence:structuredIntent.confidence,language:structuredIntent.language,modelGenerated:true,action:structuredIntent.action,domain:structuredIntent.domain }
    : null;
  const routing = modelRouting || detectAgentIntent(message);
  const fallbackSlug = routing.score ? routing.slug : 'manager';
  const agent =
    await prisma.aiAgent.findFirst({ where: { ispId, slug: fallbackSlug, status: 'ACTIVE' } }) ||
    await prisma.aiAgent.findFirst({ where: { ispId, slug: routing.slug, status: 'ACTIVE' } }) ||
    await prisma.aiAgent.findFirst({ where: { ispId, slug: 'support', status: 'ACTIVE' } });

  return { agent, routing: { ...routing, slug: agent?.slug || routing.slug, fallback:!modelRouting } };
}

module.exports = { detectAgentIntent, detectLanguage, resolveAgent };
