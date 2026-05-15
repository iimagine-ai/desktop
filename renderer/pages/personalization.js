// Personalization page — AI Persona management

const PERSONA_TEMPLATES = [
  { label: 'Friend – Soft & Supportive', name: 'Supportive Friend', persona_name: 'Jamie', persona_role: 'Supportive Friend', description: 'Warm, empathetic companion who listens and encourages', communication_style: 'empathetic', detail_level: 'balanced', response_format: 'conversational', warmth_level: 5, directness_level: 2, emotional_depth: 5, challenge_level: 1, structure_preference: 2, custom_instructions: 'You are a warm, supportive friend. Listen actively, validate feelings, and offer gentle encouragement. Prioritize emotional support over solutions unless asked.' },
  { label: 'Friend – Honest & Grounded', name: 'Honest Friend', persona_name: 'Alex', persona_role: 'Honest Friend', description: 'Direct, grounded friend who tells it like it is', communication_style: 'direct', detail_level: 'concise', response_format: 'conversational', warmth_level: 3, directness_level: 5, emotional_depth: 3, challenge_level: 4, structure_preference: 2, custom_instructions: 'You are an honest, grounded friend. Be direct and truthful. Challenge assumptions when needed. Keep things real without being harsh.' },
  { label: 'Work Assistant – Focused & Concise', name: 'Work Assistant', persona_name: 'Ada', persona_role: 'Work Assistant', description: 'Efficient, no-nonsense productivity partner', communication_style: 'professional', detail_level: 'concise', response_format: 'bullet-points', warmth_level: 2, directness_level: 5, emotional_depth: 1, challenge_level: 3, structure_preference: 5, custom_instructions: 'You are a focused work assistant. Be concise, structured, and action-oriented. Prioritize clarity and efficiency. Use bullet points and clear formatting.' },
  { label: 'Work Assistant – Strategic Partner', name: 'Strategic Partner', persona_name: 'Morgan', persona_role: 'Strategic Partner', description: 'Thoughtful advisor for complex decisions', communication_style: 'professional', detail_level: 'comprehensive', response_format: 'step-by-step', warmth_level: 3, directness_level: 4, emotional_depth: 2, challenge_level: 4, structure_preference: 4, custom_instructions: 'You are a strategic thinking partner. Help analyze complex situations, weigh trade-offs, and develop actionable plans. Ask clarifying questions before advising.' },
  { label: 'Coach – Compassionate', name: 'Compassionate Coach', persona_name: 'Sam', persona_role: 'Compassionate Coach', description: 'Gentle coach who meets you where you are', communication_style: 'empathetic', detail_level: 'balanced', response_format: 'conversational', warmth_level: 4, directness_level: 3, emotional_depth: 4, challenge_level: 2, structure_preference: 3, custom_instructions: 'You are a compassionate coach. Guide with empathy, celebrate small wins, and help set realistic goals. Meet people where they are without judgment.' },
  { label: 'Coach – High Performance', name: 'Performance Coach', persona_name: 'Max', persona_role: 'High Performance Coach', description: 'Demanding coach who pushes you to excel', communication_style: 'direct', detail_level: 'concise', response_format: 'step-by-step', warmth_level: 2, directness_level: 5, emotional_depth: 2, challenge_level: 5, structure_preference: 4, custom_instructions: 'You are a high-performance coach. Push for excellence, set high standards, and hold accountable. Be direct about what needs improvement. Focus on results and growth.' },
];

window.PersonalizationPage = {
  _editing: null,

  render(container) {
    container.innerHTML = `<div class="flex-1 overflow-y-auto p-6 space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Personas</h1>
        <button id="createPersonaBtn" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 transition-all shadow-sm">+ Create Persona</button>
      </div>
      <div id="personaGrid" class="grid grid-cols-1 sm:grid-cols-2 gap-4"></div>
      <div id="personaFormWrap" class="hidden"></div>
    </div>`;
    this._bindCreate(container);
    this._loadPersonas(container);
  },

  _bindCreate(container) {
    container.querySelector('#createPersonaBtn').addEventListener('click', () => {
      this._editing = null;
      this._showForm(container, {});
    });
  },

  async _loadPersonas(container) {
    const personas = await window.api.personas.list();
    const grid = container.querySelector('#personaGrid');
    if (!personas.length) {
      grid.innerHTML = `<p class="text-sm text-neutral-500 col-span-2">No personas yet. Create one or pick a template.</p>`;
      return;
    }
    grid.innerHTML = personas.map(p => `
      <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 shadow-sm relative">
        ${p.is_active ? '<span class="absolute top-3 right-3 text-[10px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">Active</span>' : ''}
        <div class="flex items-center gap-3 mb-2">
          ${p.image_url ? `<img src="${p.image_url}" class="w-10 h-10 rounded-full object-cover"/>` : `<div class="w-10 h-10 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-neutral-500 text-sm font-medium">${(p.persona_name || p.name || '?')[0]}</div>`}
          <div class="min-w-0"><p class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">${p.name}</p><p class="text-xs text-neutral-500 truncate">${p.persona_role || ''}</p></div>
        </div>
        <p class="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2 mb-3">${p.description || ''}</p>
        <div class="flex gap-2">
          ${p.is_active ? `<button data-deactivate="${p.id}" class="text-xs px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors">Deactivate</button>` : `<button data-activate="${p.id}" class="text-xs px-2.5 py-1 rounded-md bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 transition-colors">Activate</button>`}
          <button data-edit="${p.id}" class="text-xs px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors">Edit</button>
          <button data-delete="${p.id}" class="text-xs px-2.5 py-1 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">Delete</button>
        </div>
      </div>
    `).join('');
    this._bindCards(container, personas);
  },

  _bindCards(container, personas) {
    container.querySelectorAll('[data-activate]').forEach(btn => btn.addEventListener('click', async () => { await window.api.personas.activate(btn.dataset.activate); this._loadPersonas(container); }));
    container.querySelectorAll('[data-deactivate]').forEach(btn => btn.addEventListener('click', async () => { await window.api.personas.deactivate(); this._loadPersonas(container); }));
    container.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', async () => { if (confirm('Delete this persona?')) { await window.api.personas.delete(btn.dataset.delete); this._loadPersonas(container); } }));
    container.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
      const p = personas.find(x => x.id === btn.dataset.edit);
      if (p) { this._editing = p.id; this._showForm(container, p); }
    }));
  },

  _showForm(container, data) {
    const wrap = container.querySelector('#personaFormWrap');
    wrap.classList.remove('hidden');
    wrap.innerHTML = `
      <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-sm space-y-4">
        <div class="flex items-center justify-between"><h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">${this._editing ? 'Edit Persona' : 'Create Persona'}</h2><button id="cancelForm" class="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">Cancel</button></div>
        <div><label class="text-xs text-neutral-500 mb-1 block">Template</label><select id="pTemplate" class="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm"><option value="">— Choose a template —</option>${PERSONA_TEMPLATES.map((t, i) => `<option value="${i}">${t.label}</option>`).join('')}</select></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs text-neutral-500 mb-1 block">Display Name</label><input id="pName" value="${data.name || ''}" class="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm"/></div>
          <div><label class="text-xs text-neutral-500 mb-1 block">AI Name</label><input id="pPersonaName" value="${data.persona_name || ''}" class="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm"/></div>
          <div><label class="text-xs text-neutral-500 mb-1 block">Role</label><input id="pRole" value="${data.persona_role || ''}" class="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm"/></div>
          <div><label class="text-xs text-neutral-500 mb-1 block">Image URL</label><input id="pImage" value="${data.image_url || ''}" class="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm" placeholder="Optional file path"/></div>
        </div>
        <div><label class="text-xs text-neutral-500 mb-1 block">Description</label><input id="pDesc" value="${data.description || ''}" class="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm"/></div>
        <div><label class="text-xs text-neutral-500 mb-1 block">System Prompt</label><textarea id="pInstructions" rows="3" class="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm resize-none">${data.custom_instructions || ''}</textarea></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="text-xs text-neutral-500 mb-1 block">Style</label><select id="pStyle" class="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm">${['empathetic','direct','humorous','professional'].map(o => `<option value="${o}" ${data.communication_style === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          <div><label class="text-xs text-neutral-500 mb-1 block">Detail</label><select id="pDetail" class="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm">${['concise','balanced','comprehensive'].map(o => `<option value="${o}" ${data.detail_level === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          <div><label class="text-xs text-neutral-500 mb-1 block">Format</label><select id="pFormat" class="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm">${['conversational','bullet-points','step-by-step'].map(o => `<option value="${o}" ${data.response_format === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
        </div>
        <div class="space-y-2">
          ${this._sliderHtml('Warmth', 'pWarmth', data.warmth_level ?? 3)}
          ${this._sliderHtml('Directness', 'pDirectness', data.directness_level ?? 3)}
          ${this._sliderHtml('Emotional Depth', 'pEmotion', data.emotional_depth ?? 3)}
          ${this._sliderHtml('Challenge', 'pChallenge', data.challenge_level ?? 3)}
          ${this._sliderHtml('Structure', 'pStructure', data.structure_preference ?? 3)}
        </div>
        <button id="savePersonaBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 transition-all shadow-sm">${this._editing ? 'Save Changes' : 'Create Persona'}</button>
      </div>`;
    this._bindForm(container);
  },

  _sliderHtml(label, id, val) {
    return `<div class="flex items-center gap-3"><span class="text-xs text-neutral-500 w-28">${label}</span><input type="range" id="${id}" min="1" max="5" value="${val}" class="flex-1 accent-neutral-900 dark:accent-white h-1.5"/><span class="text-xs text-neutral-600 dark:text-neutral-400 w-4 text-center">${val}</span></div>`;
  },

  _bindForm(container) {
    container.querySelector('#cancelForm').addEventListener('click', () => { container.querySelector('#personaFormWrap').classList.add('hidden'); });
    container.querySelector('#pTemplate').addEventListener('change', (e) => {
      const idx = e.target.value;
      if (idx === '') return;
      const t = PERSONA_TEMPLATES[parseInt(idx)];
      container.querySelector('#pName').value = t.name;
      container.querySelector('#pPersonaName').value = t.persona_name;
      container.querySelector('#pRole').value = t.persona_role;
      container.querySelector('#pDesc').value = t.description;
      container.querySelector('#pInstructions').value = t.custom_instructions;
      container.querySelector('#pStyle').value = t.communication_style;
      container.querySelector('#pDetail').value = t.detail_level;
      container.querySelector('#pFormat').value = t.response_format;
      container.querySelector('#pWarmth').value = t.warmth_level;
      container.querySelector('#pDirectness').value = t.directness_level;
      container.querySelector('#pEmotion').value = t.emotional_depth;
      container.querySelector('#pChallenge').value = t.challenge_level;
      container.querySelector('#pStructure').value = t.structure_preference;
      container.querySelectorAll('input[type=range]').forEach(s => { s.nextElementSibling.textContent = s.value; });
    });
    container.querySelectorAll('input[type=range]').forEach(s => { s.addEventListener('input', () => { s.nextElementSibling.textContent = s.value; }); });
    container.querySelector('#savePersonaBtn').addEventListener('click', () => this._save(container));
  },

  async _save(container) {
    const payload = {
      name: container.querySelector('#pName').value.trim(),
      description: container.querySelector('#pDesc').value.trim(),
      persona_name: container.querySelector('#pPersonaName').value.trim(),
      persona_role: container.querySelector('#pRole').value.trim(),
      custom_instructions: container.querySelector('#pInstructions').value.trim(),
      image_url: container.querySelector('#pImage').value.trim(),
      communication_style: container.querySelector('#pStyle').value,
      detail_level: container.querySelector('#pDetail').value,
      response_format: container.querySelector('#pFormat').value,
      warmth_level: parseInt(container.querySelector('#pWarmth').value),
      directness_level: parseInt(container.querySelector('#pDirectness').value),
      emotional_depth: parseInt(container.querySelector('#pEmotion').value),
      challenge_level: parseInt(container.querySelector('#pChallenge').value),
      structure_preference: parseInt(container.querySelector('#pStructure').value),
    };
    if (!payload.name) return alert('Name is required');
    if (this._editing) { await window.api.personas.update(this._editing, payload); }
    else { await window.api.personas.create(payload); }
    container.querySelector('#personaFormWrap').classList.add('hidden');
    this._loadPersonas(container);
  },
};
