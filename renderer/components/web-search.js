// Web Search — performs web searches and formats results for chat context injection

const WebSearch = {
  /**
   * Perform a web search via the main process
   * @param {string} query - search query
   * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
   */
  async performWebSearch(query) {
    if (!query || !query.trim()) return [];
    try {
      const results = await window.api.webSearch.search(query);
      return results || [];
    } catch (err) {
      console.warn('[WebSearch] Search failed:', err.message);
      return [];
    }
  },

  /**
   * Check if web search is enabled in settings
   * @returns {Promise<boolean>}
   */
  async isEnabled() {
    try {
      const enabled = await window.api.webSearch.isEnabled();
      return !!enabled;
    } catch {
      return false;
    }
  },

  /**
   * Format search results as a string suitable for injecting into chat context
   * @param {Array<{title: string, url: string, snippet: string}>} results
   * @returns {string}
   */
  formatSearchResults(results) {
    if (!results || !results.length) return '';

    const formatted = results.map((r, i) => {
      let entry = `[${i + 1}] ${r.title}`;
      if (r.url) entry += `\n    URL: ${r.url}`;
      if (r.snippet) entry += `\n    ${r.snippet}`;
      return entry;
    }).join('\n\n');

    return `--- WEB SEARCH RESULTS ---\n\n${formatted}\n\n--- END SEARCH RESULTS ---`;
  },

  /**
   * Perform search and return formatted context string
   * Convenience method combining search + format
   * @param {string} query
   * @returns {Promise<string>}
   */
  async searchAndFormat(query) {
    const results = await this.performWebSearch(query);
    if (!results.length) return '';
    return this.formatSearchResults(results);
  },

  /**
   * Determine if a user message should trigger a web search
   * Simple heuristic: questions, current events, "search for", "look up"
   * @param {string} message
   * @returns {boolean}
   */
  shouldSearch(message) {
    if (!message) return false;
    const lower = message.toLowerCase();
    const triggers = [
      'search for', 'look up', 'find out', 'what is the latest',
      'current', 'today', 'recent', 'news about', 'how to',
    ];
    return triggers.some(t => lower.includes(t));
  },

  /**
   * Build augmented messages array with web search context injected
   * @param {Array} messages - original messages array
   * @param {string} searchContext - formatted search results string
   * @returns {Array} - messages with search context prepended to system message
   */
  augmentMessages(messages, searchContext) {
    if (!searchContext) return messages;

    const augmented = [...messages];
    const systemIdx = augmented.findIndex(m => m.role === 'system');

    if (systemIdx >= 0) {
      augmented[systemIdx] = {
        ...augmented[systemIdx],
        content: augmented[systemIdx].content + '\n\n' + searchContext,
      };
    } else {
      augmented.unshift({
        role: 'system',
        content: `You have access to web search results. Use them to provide up-to-date information.\n\n${searchContext}`,
      });
    }

    return augmented;
  },
};

window.WebSearch = WebSearch;
