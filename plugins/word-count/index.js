// Word Count Plugin — sample plugin demonstrating the plugin API
// Appends word/character count to assistant responses

let enabled = true;

module.exports = {
  activate(context) {
    console.log('[WordCount] Plugin activated');
    enabled = true;
  },

  deactivate() {
    console.log('[WordCount] Plugin deactivated');
    enabled = false;
  },

  // Called after LLM generates a response
  async onChatPostprocess({ response, assistant }) {
    if (!enabled || !response) return { response, assistant };

    const words = response.trim().split(/\s+/).length;
    const chars = response.length;
    const footer = `\n\n---\n📊 ${words} words · ${chars} chars`;

    return { response: response + footer, assistant };
  },

  // Render settings panel (returns HTML string)
  renderSettings(container) {
    return `
      <div class="space-y-2">
        <p class="text-sm text-gray-600">Appends word and character count to every assistant response.</p>
        <p class="text-xs text-gray-400">No configuration needed — just enable or disable.</p>
      </div>
    `;
  },
};
