# Cortex Memory — Manual Test Sequence (4 chats)

**Purpose:** Test long-term memory only. Verification questions are in separate chats from data input so the model can only answer from cortex graph retrieval.

**Setup:** 
1. Disable Knowledge Base (Settings → Knowledge → disconnect/disable all collections)
2. Clear memory: `rm -rf ~/.iimagine/memory/graph.db ~/.iimagine/memory/salience.json ~/.iimagine/memory/profile.json ~/.iimagine/memory/pending_updates.json ~/.iimagine/memory/graph.db.settings ~/.iimagine/memory/graph.rdb.settings`
3. Restart the app
4. Confirm Memory sidebar shows "Online"

---

## CHAT 1 — Seed Data (input only, don't worry about responses)

Send all of these one at a time. Wait for the AI to respond between each.

> I'm Adam, I run IIMAGINE. We're a 4-person AI software company based in Melbourne. We build a desktop AI companion app and a Chrome extension for YouTube analytics.

> Current MRR is $12k. We have $180k in the bank. Runway is about 15 months at current burn. No debt, no investors — growing from revenue only.

> The team is me plus three contractors: Liam does full-stack dev, Priya handles the ML pipeline, and Jordan does design and front-end. Liam started in March, Priya in January, Jordan just joined two weeks ago.

> I don't want to raise VC. I'd rather grow slower and keep full ownership. Weekends are non-negotiable — I won't work Saturdays or Sundays even if it means slower growth.

> We evaluated adding a mobile app but decided against it. The desktop + Chrome extension combo covers our users and mobile would stretch the team too thin.

> We're charging $29/month for the pro plan and $9/month for the starter plan. Thinking about raising pro to $39 next quarter.

> Our biggest customer is Vertex Studios — they're on an annual plan at $5k/year. Second biggest is DataLoop, paying monthly at $29. We have about 340 paying users total.

> Actually I misspoke earlier — we have $160k in the bank, not $180k. I was looking at last month's numbers.

**Wait 20 seconds after the last response, then close this chat.**

---

## CHAT 2 — Verify Basic Recall (all questions in one chat)

These questions all test different retrieval paths. Asking them in sequence within one chat is fine — the first question has no chat history to lean on, and subsequent questions test different topics so chat history from prior answers doesn't help.

> What's our current MRR?

**Expected:** $12k

> How much cash do we have in the bank?

**Expected:** $160k (not $180k — retraction should have worked)

> Who's on my team?

**Expected:** Liam, Priya, Jordan (+ you). No one else.

> Should I take on a weekend project to accelerate growth?

**Expected:** Should reference your weekends-off preference

> What do you think about us building a mobile app?

**Expected:** Should recall you already rejected it (team too thin)

> A distributor wants to resell our product at a 40% discount for volume. They'd bring maybe 200 users. Should I do it?

**Expected:** Should draw on pricing ($29/$9), growth preference (no VC, revenue-only), team size (4)

> What's our churn rate?

**Expected:** Should say it doesn't know. No hallucinated number.

> What if we hired three more engineers? We'd burn an extra $45k a month. Just thinking out loud though, we're not doing it.

**(This is a seed for Phase 4 — you're planting a hypothetical in this same chat)**

> Do you think we should pivot to enterprise?

**(This is also a seed — you're asking the AI to speculate. Its answer should NOT be stored as your decision.)**

**Close this chat.**

---

## CHAT 3 — Seed Updates (input only)

> We just hit $14k MRR this month. Also Vertex Studios upgraded to an $8k/year plan.

> I just hired a fifth person — Marcus, senior backend engineer, starting next Monday.

**Wait 20 seconds, then close this chat.**

---

## CHAT 4 — Verify Updates + Edge Cases (all questions in one chat)

> What's our MRR?

**Expected:** $14k (updated from $12k)

> How has our revenue changed recently?

**Expected:** Should mention $12k → $14k. May mention Vertex upgrade.

> How big is the team now?

**Expected:** 5 people. Should name Marcus.

> What's our monthly burn rate?

**Expected:** Should derive from facts (~$10-11k/mo from $160k/15mo) or say unknown. Should NOT say "$45k extra" or claim you hired three engineers.

> Are we planning to pivot to enterprise?

**Expected:** No. The AI's speculation from Chat 2 should NOT be stored as your decision.

---

## Scoring

| # | Test | Chat | Result |
|---|------|------|--------|
| 1 | MRR = $12k | 2 | |
| 2 | Bank = $160k (retraction) | 2 | |
| 3 | Team = Liam, Priya, Jordan | 2 | |
| 4 | Weekend preference recalled | 2 | |
| 5 | Mobile app rejected | 2 | |
| 6 | Advisory uses multiple facts | 2 | |
| 7 | Churn = unknown (no hallucination) | 2 | |
| 8 | MRR updated to $14k | 4 | |
| 9 | Revenue history ($12k→$14k) | 4 | |
| 10 | Team size = 5, names Marcus | 4 | |
| 11 | Hypothetical burn NOT stored | 4 | |
| 12 | Enterprise speculation NOT stored | 4 | |

**Target:** ≥10/12 at ✅. Zero ❌ on tests 2, 11, 12.

---

## Notes

- **Chat 2 asks multiple questions in sequence.** This is fine because each question is about a different topic — the model can't answer "What's our MRR?" from having just answered "Who's on my team?" The only question where prior chat context could theoretically help is the advisory (test 6), but it needs to pull from stored facts to give a good answer, not just from the answers it gave earlier in that chat.
- **The hypothetical and speculation seeds are planted in Chat 2.** This means when you test them in Chat 4 (a new chat), any wrong answer can ONLY come from cortex having incorrectly stored them.
- **Total: 4 chats.** That's it.
