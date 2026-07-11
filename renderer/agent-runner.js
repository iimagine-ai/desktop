// Agent Runner — agentic workflow orchestrator
// Triggered by @agent mention. Decomposes complex tasks into steps,
// shows a task panel in chat, executes each step sequentially.

const AgentRunner = {
  _isRunning: false,
  _currentPlan: null,
  _taskResults: [],
  _aborted: false,

  // System prompt that instructs the LLM to create a task plan
  PLANNER_PROMPT: `You are a task planner. Break the user's request into 2-5 numbered steps.

Output ONLY a numbered list like this:
1. First step description
2. Second step description
3. Third step description

Rules:
- Each step should be independently executable
- Keep descriptions concise (one sentence each)
- Output ONLY the numbered list, nothing else
- Do NOT execute the task, just plan the steps`,

  // System prompt for executing individual tasks
  EXECUTOR_PROMPT: `You are executing step {step} of {total} in a multi-step task.

Overall goal: {goal}
Previous results: {context}

Current step: {description}

Execute this step thoroughly. Provide a complete, useful result.`,

  /**
   * Check if a message should trigger agent mode
   */
  shouldActivate(mentions) {
    return mentions.some(m => m.name === 'agent');
  },

  /**
   * Run the full agent workflow
   * @param {string} userMessage - The user's original message
   * @param {HTMLElement} messagesContainer - Chat messages container
   * @param {object} chatPage - Reference to ChatPage for helpers
   */
  async run(userMessage, messagesContainer, chatPage) {
    if (this._isRunning) return;
    this._isRunning = true;
    this._aborted = false;
    this._taskResults = [];

    const pm = window.ProviderManager;
    if (!pm.activeProvider) {
      this._isRunning = false;
      return { error: 'No AI model active' };
    }

    // Step 1: Show planning indicator
    const planningEl = this._appendStatus(messagesContainer, '🧠 Planning tasks...');

    // Step 2: Ask LLM to create a plan
    const plan = await this._createPlan(userMessage, pm);
    planningEl.remove();

    if (!plan || !plan.tasks?.length) {
      this._isRunning = false;
      return { 
        error: true, 
        message: '⚠️ The current model couldn\'t create a task plan. Agentic workflows require a model that can follow structured instructions (e.g., GPT-5 Mini, Gemma 27B, or Llama 3 70B). Try switching to a more capable model in Settings → Models.' 
      };
    }

    this._currentPlan = plan;

    // Step 3: Show task panel with approval buttons
    const taskPanel = this._renderTaskPanel(messagesContainer, plan);
    
    // Step 4: Wait for user approval
    const approved = await this._waitForApproval(taskPanel);
    if (!approved || this._aborted) {
      this._updatePanelStatus(taskPanel, 'cancelled');
      this._isRunning = false;
      return { cancelled: true };
    }

    // Step 5: Execute each task
    let context = '';
    for (let i = 0; i < plan.tasks.length; i++) {
      if (this._aborted) break;

      const task = plan.tasks[i];
      this._updateTaskStatus(taskPanel, task.id, 'running');

      const result = await this._executeTask(task, i, plan.tasks.length, userMessage, context, pm);
      
      if (result.error) {
        this._updateTaskStatus(taskPanel, task.id, 'failed', result.error);
        break;
      }

      this._taskResults.push({ taskId: task.id, result: result.content });
      context += `\n\nStep ${task.id} result: ${result.content}`;
      this._updateTaskStatus(taskPanel, task.id, 'done', result.content);
    }

    // Step 6: Generate final summary
    if (!this._aborted && this._taskResults.length > 0) {
      this._updatePanelStatus(taskPanel, 'complete');
      const summary = this._taskResults.map((r, i) => 
        `**Step ${i + 1}:** ${r.result}`
      ).join('\n\n');
      
      this._isRunning = false;
      return { success: true, summary, taskCount: this._taskResults.length };
    }

    this._isRunning = false;
    return { success: false, partial: this._taskResults };
  },

  /**
   * Abort a running agent workflow
   */
  abort() {
    this._aborted = true;
  },

  /**
   * Ask the LLM to decompose the task into steps
   */
  async _createPlan(userMessage, pm) {
    const messages = [
      { role: 'system', content: this.PLANNER_PROMPT },
      { role: 'user', content: userMessage }
    ];

    try {
      const response = await window.api.agent.plan(messages);
      if (!response?.content) {
        // Fallback: create a simple 3-step plan
        return this._fallbackPlan(userMessage);
      }

      // Parse numbered list (1. Step one\n2. Step two\n...)
      const lines = response.content.split('\n').filter(l => l.trim());
      const tasks = [];
      for (const line of lines) {
        const match = line.match(/^\s*(\d+)[\.\)]\s*(.+)/);
        if (match) {
          tasks.push({
            id: parseInt(match[1]),
            description: match[2].trim(),
            plugins: [],
          });
        }
      }

      // If model didn't return a proper list, use fallback
      if (tasks.length < 2) {
        return this._fallbackPlan(userMessage);
      }

      return {
        plan: true,
        summary: userMessage,
        tasks,
      };
    } catch (err) {
      console.error('[Agent] Planning failed:', err);
      return this._fallbackPlan(userMessage);
    }
  },

  // Fallback plan when the model can't/won't create a numbered list
  _fallbackPlan(userMessage) {
    return null; // Return null to trigger the "model not capable" message
  },

  /**
   * Execute a single task step
   */
  async _executeTask(task, index, total, goal, previousContext, pm) {
    const systemPrompt = this.EXECUTOR_PROMPT
      .replace('{step}', String(index + 1))
      .replace('{total}', String(total))
      .replace('{goal}', goal)
      .replace('{context}', previousContext || 'None yet')
      .replace('{description}', task.description);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Execute this step: ${task.description}` }
    ];

    // If task has plugins, run preprocess with those mentions
    if (task.plugins?.length) {
      const availableMentions = await window.api.plugins.getMentions();
      const mentions = task.plugins
        .map(name => availableMentions.find(m => m.name === name))
        .filter(Boolean);

      if (mentions.length) {
        const preprocessed = await window.api.plugins.chatPreprocess({
          messages,
          mentions,
          assistant: null,
        });
        if (preprocessed.messages) {
          messages.length = 0;
          messages.push(...preprocessed.messages);
        }
      }
    }

    try {
      const response = await window.api.agent.execute(messages);
      if (!response?.content) return { error: 'No response from AI' };
      return { content: response.content };
    } catch (err) {
      return { error: err.message };
    }
  },

  /**
   * Render the task panel in chat
   */
  _renderTaskPanel(container, plan) {
    const panel = document.createElement('div');
    panel.className = 'message-enter flex justify-start w-full';
    panel.innerHTML = `
      <div class="assistant-bubble rounded-2xl px-5 py-4 max-w-[90%] w-full">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">📋 Task Plan</span>
          <span id="agentPlanStatus" class="text-xs px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-800">Awaiting approval</span>
        </div>
        <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-3">${plan.summary || ''}</p>
        <div id="agentTaskList" class="space-y-2 mb-4">
          ${plan.tasks.map(t => `
            <div id="agent-task-${t.id}" class="flex items-start gap-2 py-1.5">
              <span class="agent-task-icon text-neutral-300 dark:text-neutral-600 mt-0.5">○</span>
              <div class="flex-1 min-w-0">
                <span class="text-sm text-neutral-700 dark:text-neutral-300">${t.description}</span>
                ${t.plugins?.length ? `<span class="text-[10px] text-neutral-400 ml-1">${t.plugins.map(p => '@' + p).join(' ')}</span>` : ''}
                <div class="agent-task-result hidden mt-1 text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg p-2 max-h-24 overflow-y-auto"></div>
              </div>
            </div>
          `).join('')}
        </div>
        <div id="agentActions" class="flex gap-2">
          <button id="agentApproveBtn" class="px-4 py-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-xs font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all">Run</button>
          <button id="agentCancelBtn" class="px-4 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all">Cancel</button>
        </div>
      </div>
    `;
    container.appendChild(panel);
    container.scrollTop = container.scrollHeight;
    return panel;
  },

  /**
   * Wait for user to approve or cancel the plan
   */
  _waitForApproval(panel) {
    return new Promise(resolve => {
      const approveBtn = panel.querySelector('#agentApproveBtn');
      const cancelBtn = panel.querySelector('#agentCancelBtn');

      approveBtn.addEventListener('click', () => {
        panel.querySelector('#agentActions').classList.add('hidden');
        panel.querySelector('#agentPlanStatus').textContent = 'Running...';
        panel.querySelector('#agentPlanStatus').className = 'text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-800';
        resolve(true);
      });

      cancelBtn.addEventListener('click', () => {
        resolve(false);
      });
    });
  },

  /**
   * Update a task's status in the panel
   */
  _updateTaskStatus(panel, taskId, status, content) {
    const taskEl = panel.querySelector(`#agent-task-${taskId}`);
    if (!taskEl) return;

    const icon = taskEl.querySelector('.agent-task-icon');
    const resultEl = taskEl.querySelector('.agent-task-result');

    switch (status) {
      case 'running':
        icon.textContent = '⏳';
        icon.className = 'agent-task-icon mt-0.5';
        break;
      case 'done':
        icon.textContent = '✅';
        icon.className = 'agent-task-icon mt-0.5';
        if (content && resultEl) {
          resultEl.textContent = content.substring(0, 200) + (content.length > 200 ? '...' : '');
          resultEl.classList.remove('hidden');
        }
        break;
      case 'failed':
        icon.textContent = '❌';
        icon.className = 'agent-task-icon mt-0.5';
        if (content && resultEl) {
          resultEl.textContent = `Error: ${content}`;
          resultEl.classList.remove('hidden');
          resultEl.classList.add('text-red-500');
        }
        break;
    }

    const container = panel.closest('#messages') || panel.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  },

  /**
   * Update the overall panel status
   */
  _updatePanelStatus(panel, status) {
    const badge = panel.querySelector('#agentPlanStatus');
    if (!badge) return;

    switch (status) {
      case 'complete':
        badge.textContent = 'Complete';
        badge.className = 'text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800';
        break;
      case 'cancelled':
        badge.textContent = 'Cancelled';
        badge.className = 'text-xs px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700';
        panel.querySelector('#agentActions')?.classList.add('hidden');
        break;
    }
  },

  /**
   * Append a status message to the chat
   */
  _appendStatus(container, text) {
    const div = document.createElement('div');
    div.className = 'message-enter flex justify-start';
    div.innerHTML = `<div class="assistant-bubble rounded-2xl px-4 py-2.5 text-sm text-neutral-500 dark:text-neutral-400">${text}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  },
};

window.AgentRunner = AgentRunner;
