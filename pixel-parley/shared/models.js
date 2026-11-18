// Claude model catalog.
//
// With an API key, the server asks the Models API which models your key can use
// and which effort levels each supports. This static list is the fallback (and
// what demo mode shows). Prices are USD per million input/output tokens.

export const DEFAULT_MODEL = 'claude-opus-5-5';

const ALL_EFFORTS = ['low', 'medium', 'high'];

export const MODEL_CATALOG = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', family: 'opus', price: [4, 20], efforts: ALL_EFFORTS },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', family: 'sonnet', price: [2, 10], efforts: ALL_EFFORTS },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', family: 'haiku', price: [0.1, 0.5], efforts: ALL_EFFORTS },
  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', family: 'fable', price: [8, 40], efforts: ALL_EFFORTS },
  { id: 'claude-opus-5', name: 'Claude Opus 5', family: 'opus', price: [5, 25], efforts: ALL_EFFORTS },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', family: 'sonnet', price: [2, 10], efforts: ALL_EFFORTS },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', family: 'fable', price: [10, 50], efforts: ALL_EFFORTS },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', family: 'opus', price: [5, 25], efforts: ALL_EFFORTS },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', family: 'opus', price: [5, 25], efforts: ALL_EFFORTS },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', family: 'opus', price: [5, 25], efforts: ALL_EFFORTS },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', family: 'sonnet', price: [3, 15], efforts: ALL_EFFORTS },
  // Haiku 4.5 does not accept the effort parameter.
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', family: 'haiku', price: [1, 5], efforts: [] },
];

const catalogById = new Map(MODEL_CATALOG.map((m) => [m.id, m]));

export function catalogEntry(id) {
  return catalogById.get(id) || null;
}

export function modelFamily(id = '') {
  const m = /(opus|sonnet|haiku|fable|mythos)/.exec(id);
  return m ? m[1] : 'claude';
}

// "claude-sonnet-5-5" -> "Claude Sonnet 5.5" (used when the API gives no display name)
export function prettyModelName(id = '') {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (!m) return id;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return `Claude ${family} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
}

// "Claude Opus 5.5" -> "OPUS 5.5" (nameplate text)
export function shortModelName(name = '') {
  return name.replace(/^Claude\s+/i, '').toUpperCase().slice(0, 12);
}

export function formatPrice(price) {
  if (!price) return '';
  const fmt = (n) => (n < 1 ? n.toFixed(2) : String(n));
  return `$${fmt(price[0])} / $${fmt(price[1])} per MTok`;
}
