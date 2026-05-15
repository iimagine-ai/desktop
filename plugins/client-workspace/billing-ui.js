// Client Workspace — Billing Tab UI
// Simple milestone billing tracker: name, amount, completed/billed/paid toggles.

const cwDb = require('./db');

/**
 * Render the billing section for a project.
 */
function renderBillingSection(project) {
  const items = cwDb.getBillingItems(project.id);

  const totalAmount = items.reduce((sum, i) => sum + (i.amount || 0), 0);
  const totalBilled = items.filter(i => i.billed).reduce((sum, i) => sum + (i.amount || 0), 0);
  const totalPaid = items.filter(i => i.paid).reduce((sum, i) => sum + (i.amount || 0), 0);

  const rows = items.map(item => renderBillingRow(item)).join('');

  return `
    <div class="space-y-4">

      <!-- Summary -->
      <div class="grid grid-cols-3 gap-3">
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 text-center">
          <div class="text-base font-semibold text-neutral-900 dark:text-neutral-100">${formatAmount(totalAmount)}</div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Total</div>
        </div>
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 text-center">
          <div class="text-base font-semibold text-amber-600 dark:text-amber-400">${formatAmount(totalBilled)}</div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Billed</div>
        </div>
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 text-center">
          <div class="text-base font-semibold text-emerald-600 dark:text-emerald-400">${formatAmount(totalPaid)}</div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Paid</div>
        </div>
      </div>

      <!-- Add Item Button -->
      <div class="flex items-center justify-between">
        <span class="text-xs text-neutral-500 dark:text-neutral-400">${items.length} milestone${items.length !== 1 ? 's' : ''}</span>
        <button onclick="window.cwShowBillingForm('${project.id}')"
          class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
          + Add Milestone
        </button>
      </div>

      <!-- Add Item Form (hidden) -->
      <div id="cw-billing-form" class="hidden bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 space-y-3">
        <div>
          <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Milestone Name *</label>
          <input type="text" id="cw-billing-name" placeholder="e.g. Phase 1 — Discovery"
            class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
        </div>
        <div>
          <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Amount</label>
          <input type="number" id="cw-billing-amount" placeholder="0.00" min="0" step="0.01"
            class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
        </div>
        <div class="flex justify-end gap-2">
          <button onclick="window.cwHideBillingForm()"
            class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
            Cancel
          </button>
          <button onclick="window.cwCreateBillingItem('${project.id}')"
            class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            Add
          </button>
        </div>
      </div>

      <!-- Edit Item Modal -->
      <div id="cw-billing-edit-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
        <div class="bg-white/90 dark:bg-neutral-800/90 backdrop-blur-xl border border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl p-6 w-full max-w-sm shadow-xl">
          <h3 class="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Edit Milestone</h3>
          <div class="space-y-3">
            <div>
              <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Name *</label>
              <input type="text" id="cw-billing-edit-name"
                class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
            </div>
            <div>
              <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Amount</label>
              <input type="number" id="cw-billing-edit-amount" min="0" step="0.01"
                class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
            </div>
          </div>
          <div class="flex justify-between mt-4">
            <button onclick="window.cwDeleteBillingFromEdit()"
              class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all shadow-sm">
              Delete
            </button>
            <div class="flex gap-2">
              <button onclick="window.cwHideBillingEdit()"
                class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
                Cancel
              </button>
              <button onclick="window.cwSaveBillingEdit()"
                class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
                Save
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Items Table -->
      <div class="space-y-2">
        ${rows || '<p class="text-sm text-neutral-500 dark:text-neutral-400">No milestones yet. Add one to start tracking billing.</p>'}
      </div>

    </div>
  `;
}

function renderBillingRow(item) {
  const completedClass = item.completed
    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800'
    : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-600';
  const billedClass = item.billed
    ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-800'
    : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-600';
  const paidClass = item.paid
    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-800'
    : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-600';

  return `
    <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 group hover:bg-white/80 dark:hover:bg-neutral-700/60 transition-all">
      <div class="flex items-center gap-3">
        <!-- Name + Amount -->
        <div class="flex-1 min-w-0">
          <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100 cursor-pointer hover:underline truncate block"
            onclick="window.cwEditBillingItem('${item.id}')">${escHtml(item.name)}</span>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">${formatAmount(item.amount)}</span>
        </div>
        <!-- Status Toggles -->
        <div class="flex items-center gap-1.5 shrink-0">
          <button onclick="window.cwToggleBilling('${item.id}', 'completed', ${item.completed ? 0 : 1})"
            title="Toggle completed"
            class="text-[10px] font-medium px-2 py-1 rounded-full border transition-all ${completedClass}">
            Completed
          </button>
          <button onclick="window.cwToggleBilling('${item.id}', 'billed', ${item.billed ? 0 : 1})"
            title="Toggle billed"
            class="text-[10px] font-medium px-2 py-1 rounded-full border transition-all ${billedClass}">
            Billed
          </button>
          <button onclick="window.cwToggleBilling('${item.id}', 'paid', ${item.paid ? 0 : 1})"
            title="Toggle paid"
            class="text-[10px] font-medium px-2 py-1 rounded-full border transition-all ${paidClass}">
            Paid
          </button>
        </div>
      </div>
    </div>
  `;
}

function getBillingScript() {
  return `
    window._cwEditBillingId = null;

    window.cwShowBillingForm = function(projectId) {
      document.getElementById('cw-billing-form').classList.remove('hidden');
      setTimeout(() => document.getElementById('cw-billing-name').focus(), 100);
    };
    window.cwHideBillingForm = function() {
      document.getElementById('cw-billing-form').classList.add('hidden');
      document.getElementById('cw-billing-name').value = '';
      document.getElementById('cw-billing-amount').value = '';
    };
    window.cwCreateBillingItem = async function(projectId) {
      const name = document.getElementById('cw-billing-name').value.trim();
      if (!name) { document.getElementById('cw-billing-name').focus(); return; }
      const amount = parseFloat(document.getElementById('cw-billing-amount').value) || 0;
      await window.api.plugins.sendEvent('cw:create-billing-item', { projectId, name, amount });
      window.cwHideBillingForm();
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'billing');
    };
    window.cwToggleBilling = async function(id, field, value) {
      const update = {};
      update[field] = value === 1;
      await window.api.plugins.sendEvent('cw:update-billing-item', { id, ...update });
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'billing');
    };
    window.cwEditBillingItem = async function(id) {
      const item = await window.api.plugins.sendEvent('cw:get-billing-item', { id });
      if (!item) return;
      window._cwEditBillingId = id;
      document.getElementById('cw-billing-edit-name').value = item.name || '';
      document.getElementById('cw-billing-edit-amount').value = item.amount || 0;
      document.getElementById('cw-billing-edit-modal').classList.remove('hidden');
      setTimeout(() => document.getElementById('cw-billing-edit-name').focus(), 100);
    };
    window.cwHideBillingEdit = function() {
      document.getElementById('cw-billing-edit-modal').classList.add('hidden');
      window._cwEditBillingId = null;
    };
    window.cwSaveBillingEdit = async function() {
      const id = window._cwEditBillingId;
      if (!id) return;
      const name = document.getElementById('cw-billing-edit-name').value.trim();
      if (!name) { document.getElementById('cw-billing-edit-name').focus(); return; }
      const amount = parseFloat(document.getElementById('cw-billing-edit-amount').value) || 0;
      await window.api.plugins.sendEvent('cw:update-billing-item', { id, name, amount });
      window.cwHideBillingEdit();
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'billing');
    };
    window.cwDeleteBillingFromEdit = async function() {
      const id = window._cwEditBillingId;
      if (!id) return;
      if (!confirm('Delete this milestone?')) return;
      await window.api.plugins.sendEvent('cw:delete-billing-item', { id });
      window.cwHideBillingEdit();
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'billing');
    };
  `;
}

function formatAmount(val) {
  if (!val && val !== 0) return '$0.00';
  return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { renderBillingSection, getBillingScript };
