// The Setup panel: scenarios, agenda, the 2-6 agent cards, and the rules.

import { FIGURES, getFigure, SCENARIOS, CUSTOM_PROPS } from '../../shared/figures.js';
import { normalizeCast, MIN_CAST, MAX_CAST } from '../../shared/cast.js';
import { catalogEntry, prettyModelName } from '../../shared/models.js';
import { buildFrame, gridToCanvas, lookForParticipant } from './sprites.js';
import { SLOT_COLORS } from './stage.js';

const AGENDA_IDEAS = [
  'What makes a life well lived?',
  'Is it ever right to break the law?',
  'What should humanity do about artificial intelligence?',
  'Does power always corrupt?',
  'Science and faith: rivals or partners?',
  'Design the ideal city together.',
];

const DEFAULT_CAST = ['preset:gandhi', 'preset:caesar', 'preset:leonardo', 'model'];
const FILL_ORDER = ['einstein', 'confucius', 'buddha', 'mlk', 'krishna', 'copernicus', 'machiavelli', 'jesus', 'malcolmx'];

const ORDER_HINTS = {
  natural: 'Natural: whoever is addressed by name answers next, and nobody waits more than a round.',
  'round-robin': 'Round robin: everyone speaks in seating order.',
  random: 'Random: a random speaker each turn, never the same one twice in a row.',
};

function slotFromToken(token, model) {
  if (token === 'model') return { kind: 'model', model };
  if (token.startsWith('model:')) return { kind: 'model', model: token.slice(6) };
  if (token.startsWith('preset:')) return { kind: 'preset', presetId: token.slice(7), model };
  return { kind: 'preset', presetId: token, model };
}

export function defaultConfig(defaultModel) {
  return {
    agenda: '',
    slots: DEFAULT_CAST.map((t) => slotFromToken(t, defaultModel)),
    turns: 12,
    order: 'natural',
    length: 'medium',
    effort: 'low',
    knowledge: 'era',
    recapModel: defaultModel,
  };
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export class Setup {
  constructor(doc, { onChange }) {
    this.onChange = onChange;
    this.models = [];
    this.backends = [];
    this.modelsByBackend = {};
    this.defaultBackend = 'demo';
    this.defaultModel = 'claude-opus-5-5';
    this.config = null;
    this.locked = false;
    const $ = (id) => doc.getElementById(id);
    this.els = {
      fields: $('setup-fields'),
      lock: $('lock-banner'),
      scenarios: $('scenario-chips'),
      agenda: $('agenda'),
      agendaChips: $('agenda-chips'),
      count: $('count-picker'),
      cards: $('agent-cards'),
      template: $('agent-card-template'),
      turns: $('turns'),
      order: $('order'),
      length: $('length'),
      effort: $('effort'),
      knowledge: $('knowledge'),
      recapModel: $('recap-model'),
      backend: $('backend'),
      backendHint: $('backend-hint'),
      orderHint: $('order-hint'),
    };
    this.buildStatic();
  }

  // ---------------------------------------------------------------- public

  setModels(models, defaultModel) {
    this.models = models || [];
    this.defaultModel = defaultModel || this.defaultModel;
  }

  // Power sources the server offers (API key, Claude Code subscription, demo),
  // each with its own model list.
  setBackends(backends, modelsByBackend, defaultBackend) {
    this.backends = backends || [];
    this.modelsByBackend = modelsByBackend || {};
    this.defaultBackend = defaultBackend || (this.backends[0] && this.backends[0].id) || 'demo';
  }

  useBackend(id) {
    const known = this.backends.some((b) => b.id === id);
    this.config.backend = known ? id : this.defaultBackend;
    const list = this.modelsByBackend[this.config.backend];
    if (list) this.models = list;
  }

  modelName(id) {
    const m = this.models.find((x) => x.id === id) || catalogEntry(id);
    return m ? m.name : prettyModelName(id);
  }

  setConfig(config) {
    const base = defaultConfig(this.defaultModel);
    const c = { ...base, ...(config || {}) };
    const slots = Array.isArray(c.slots) ? c.slots.filter(Boolean) : base.slots;
    c.slots = slots.slice(0, MAX_CAST).map((s) => this.cleanSlot(s));
    while (c.slots.length < MIN_CAST) c.slots.push(this.newSlot(c.slots));
    c.turns = clampInt(c.turns, 1, 200, 12);
    c.recapModel = c.recapModel || this.defaultModel;
    this.config = c;
    this.useBackend(c.backend);
    this.render();
  }

  getConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }

  getCast() {
    return normalizeCast(this.config.slots.map((s) => ({ ...s, modelName: this.modelName(s.model) })));
  }

  setLocked(locked) {
    this.locked = locked;
    this.els.fields.disabled = locked;
    this.els.lock.hidden = !locked;
  }

  // ---------------------------------------------------------------- internals

  cleanSlot(s) {
    const model = s.model || this.defaultModel;
    if (s.kind === 'preset' && getFigure(s.presetId)) return { kind: 'preset', presetId: s.presetId, model };
    if (s.kind === 'custom') {
      return { kind: 'custom', name: s.name || '', notes: s.notes || '', prop: s.prop || 'quill', model };
    }
    return { kind: 'model', model };
  }

  newSlot(existing) {
    const used = new Set(existing.filter((s) => s.kind === 'preset').map((s) => s.presetId));
    const next = FILL_ORDER.find((id) => !used.has(id));
    const model = (existing[existing.length - 1] && existing[existing.length - 1].model) || this.defaultModel;
    return next ? { kind: 'preset', presetId: next, model } : { kind: 'model', model };
  }

  changed() {
    this.onChange(this.getConfig());
  }

  buildStatic() {
    const { scenarios, agendaChips, count } = this.els;
    for (const sc of SCENARIOS) {
      const b = el('button', { type: 'button', class: 'chip', title: sc.agenda || 'Open-ended discussion' }, sc.name);
      b.addEventListener('click', () => this.applyScenario(sc));
      scenarios.append(b);
    }
    for (const idea of AGENDA_IDEAS) {
      const b = el('button', { type: 'button', class: 'chip' }, idea);
      b.addEventListener('click', () => {
        this.els.agenda.value = idea;
        this.config.agenda = idea;
        this.changed();
      });
      agendaChips.append(b);
    }
    const open = el('button', { type: 'button', class: 'chip' }, 'Open-ended');
    open.addEventListener('click', () => {
      this.els.agenda.value = '';
      this.config.agenda = '';
      this.changed();
    });
    agendaChips.append(open);

    for (let n = MIN_CAST; n <= MAX_CAST; n++) {
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': `${n} agents` }, String(n));
      b.addEventListener('click', () => this.setCount(n));
      count.append(b);
    }

    this.els.agenda.addEventListener('input', () => {
      this.config.agenda = this.els.agenda.value;
      this.changed();
    });
    this.els.turns.addEventListener('change', () => {
      this.config.turns = clampInt(this.els.turns.value, 1, 200, 12);
      this.els.turns.value = this.config.turns;
      this.changed();
    });
    this.els.backend.addEventListener('change', () => {
      this.useBackend(this.els.backend.value);
      this.render();
      this.changed();
    });
    for (const key of ['order', 'length', 'effort', 'knowledge', 'recapModel']) {
      this.els[key].addEventListener('change', () => {
        this.config[key] = this.els[key].value;
        if (key === 'order') this.renderOrderHint();
        this.changed();
      });
    }
  }

  applyScenario(sc) {
    const models = this.config.slots.map((s) => s.model);
    this.config.slots = sc.cast.map((token, i) => {
      const slot = slotFromToken(token, models[i] || this.defaultModel);
      if (slot.kind === 'model' && token.startsWith('model:') && this.models.length && !this.models.some((m) => m.id === slot.model)) {
        slot.model = models[i] || this.defaultModel;
      }
      return slot;
    });
    this.config.agenda = sc.agenda;
    this.render();
    this.changed();
  }

  setCount(n) {
    const slots = this.config.slots;
    while (slots.length < n) slots.push(this.newSlot(slots));
    slots.length = n;
    this.render();
    this.changed();
  }

  render() {
    const c = this.config;
    this.els.agenda.value = c.agenda;
    this.els.turns.value = c.turns;
    this.els.order.value = c.order;
    this.els.length.value = c.length;
    this.els.effort.value = c.effort;
    this.els.knowledge.value = c.knowledge;
    this.fillModelSelect(this.els.recapModel, c.recapModel);
    this.renderBackend();
    for (const b of this.els.count.children) b.setAttribute('aria-checked', String(Number(b.textContent) === c.slots.length));
    this.renderOrderHint();
    this.renderCards();
  }

  renderBackend() {
    const sel = this.els.backend;
    sel.textContent = '';
    for (const b of this.backends) sel.append(el('option', { value: b.id }, b.label));
    sel.value = this.config.backend;
    const hints = {
      api: 'Billed to your Anthropic API key. The ≈ $ meter estimates the cost.',
      'claude-code':
        'Uses Claude Code on this computer, so usage comes from the Claude account it is signed in with (for example your Pro or Max plan). Personal use only. Each turn takes a few extra seconds to start.',
      demo: 'Canned lines, no AI and no cost. Good for trying the controls.',
    };
    this.els.backendHint.textContent = hints[this.config.backend] || '';
  }

  renderOrderHint() {
    this.els.orderHint.textContent = ORDER_HINTS[this.config.order] || '';
  }

  fillModelSelect(select, value) {
    select.textContent = '';
    const list = this.models.length ? this.models : [];
    const ids = new Set(list.map((m) => m.id));
    const options = [...list];
    if (value && !ids.has(value)) options.unshift({ id: value, name: this.modelName(value), price: null });
    for (const m of options) {
      const price = m.price ? ` · $${m.price[0]}/$${m.price[1]}` : '';
      const opt = el('option', { value: m.id }, `${m.name}${price}`);
      opt.title = `${m.id}${m.price ? `: $${m.price[0]} input / $${m.price[1]} output per million tokens` : ''}${
        m.id === this.defaultModel ? ' (default)' : ''
      }`;
      select.append(opt);
    }
    select.value = value;
  }

  renderCards() {
    const { cards, template } = this.els;
    cards.textContent = '';
    const cast = this.getCast();
    this.config.slots.forEach((slot, i) => {
      const card = template.content.firstElementChild.cloneNode(true);
      card.style.setProperty('--slot-color', SLOT_COLORS[i % SLOT_COLORS.length]);
      card.querySelector('.agent-slot').textContent = `P${i + 1}`;
      card.querySelector('.agent-name').textContent = cast[i].name;

      const identity = card.querySelector('.agent-identity');
      const g1 = el('optgroup', { label: 'Claude' });
      g1.append(el('option', { value: 'model' }, 'Claude, as itself'));
      const g2 = el('optgroup', { label: 'Historical & mythical figures' });
      for (const f of FIGURES) g2.append(el('option', { value: `preset:${f.id}` }, f.name));
      const g3 = el('optgroup', { label: 'Your own' });
      g3.append(el('option', { value: 'custom' }, 'Custom figure…'));
      identity.append(g1, g2, g3);
      identity.value = slot.kind === 'preset' ? `preset:${slot.presetId}` : slot.kind;
      identity.setAttribute('aria-label', `Agent ${i + 1} identity`);
      identity.addEventListener('change', () => {
        const v = identity.value;
        if (v === 'model') this.config.slots[i] = { kind: 'model', model: slot.model };
        else if (v === 'custom') this.config.slots[i] = { kind: 'custom', name: '', notes: '', prop: 'quill', model: slot.model };
        else this.config.slots[i] = { kind: 'preset', presetId: v.slice(7), model: slot.model };
        this.renderCards();
        this.changed();
      });

      const model = card.querySelector('.agent-model');
      this.fillModelSelect(model, slot.model);
      model.setAttribute('aria-label', `Agent ${i + 1} model`);
      model.addEventListener('change', () => {
        this.config.slots[i].model = model.value;
        this.renderCards();
        this.changed();
      });

      const custom = card.querySelector('.agent-custom');
      if (slot.kind === 'custom') {
        custom.hidden = false;
        const name = card.querySelector('.agent-custom-name');
        const notes = card.querySelector('.agent-custom-notes');
        const prop = card.querySelector('.agent-custom-prop');
        name.value = slot.name;
        notes.value = slot.notes;
        for (const p of CUSTOM_PROPS) prop.append(el('option', { value: p.id }, p.name));
        prop.value = slot.prop;
        let timer = null;
        name.addEventListener('input', () => {
          this.config.slots[i].name = name.value;
          clearTimeout(timer);
          timer = setTimeout(() => {
            this.drawCardSprite(card, i);
            card.querySelector('.agent-name').textContent = this.getCast()[i].name;
          }, 250);
          this.changed();
        });
        notes.addEventListener('input', () => {
          this.config.slots[i].notes = notes.value;
          this.changed();
        });
        prop.addEventListener('change', () => {
          this.config.slots[i].prop = prop.value;
          this.drawCardSprite(card, i);
          this.changed();
        });
      }

      card.querySelector('.agent-blurb').textContent = this.blurb(slot);
      this.drawCardSprite(card, i);
      cards.append(card);
    });
  }

  blurb(slot) {
    if (slot.kind === 'preset') {
      const f = getFigure(slot.presetId);
      return `${f.era}. ${f.tagline}. Prop: ${f.artifact.name}.`;
    }
    if (slot.kind === 'custom') return 'A figure of your choosing, portrayed as faithfully as the model can.';
    return `${this.modelName(slot.model)} joins as itself, not playing a character.`;
  }

  drawCardSprite(card, i) {
    const canvas = card.querySelector('.agent-sprite');
    const p = this.getCast()[i];
    const sprite = gridToCanvas(buildFrame(lookForParticipant(p)));
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sprite, 0, 0);
  }
}
