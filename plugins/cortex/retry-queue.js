// Cortex Retry Queue — persists failed extractions for later processing
// Max 100 entries. Oldest dropped when full. Each entry retried up to 3 times.

const LOG = '[Cortex:RetryQueue]';
const MAX_SIZE = 100;
const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 10;

class RetryQueue {
  constructor(store) {
    this._store = store;
    this._queue = store.get('cortex.retryQueue', []) || [];
  }

  get length() {
    return this._queue.length;
  }

  enqueue({ userMessage, assistantResponse }) {
    if (!userMessage || userMessage.trim().length < 5) return;

    // Drop oldest if at capacity
    if (this._queue.length >= MAX_SIZE) {
      this._queue.shift();
    }

    this._queue.push({
      userMessage,
      assistantResponse,
      attempts: 0,
      queuedAt: Date.now(),
    });

    this._persist();
  }

  async processQueue(client, llmConfig) {
    if (!this._queue || this._queue.length === 0) return;

    console.log(`${LOG} Processing ${Math.min(BATCH_SIZE, this._queue.length)} queued extractions`);

    const batch = this._queue.splice(0, BATCH_SIZE);
    const requeue = [];

    for (const item of batch) {
      try {
        await client.extract(item.userMessage, item.assistantResponse, llmConfig);
      } catch (err) {
        item.attempts++;
        if (item.attempts < MAX_ATTEMPTS) {
          requeue.push(item);
        } else {
          console.warn(`${LOG} Dropping exchange after ${MAX_ATTEMPTS} attempts`);
        }
      }
    }

    // Re-add failed items that haven't exceeded attempts
    this._queue.push(...requeue);
    this._persist();
  }

  clear() {
    this._queue = [];
    this._persist();
  }

  _persist() {
    this._store.set('cortex.retryQueue', this._queue);
  }
}

module.exports = RetryQueue;
