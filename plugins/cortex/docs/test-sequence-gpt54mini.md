# Test Sequence — GPT-5.4-mini Extraction

**Prerequisites:**
- Sidecar running on port 9199: `source .venv/bin/activate && python -m sidecar.run --port 9199`
- OpenAI API key ready

**Replace `sk-YOUR-KEY` with your actual OpenAI API key in all commands below.**

---

## Step 1: Verify clean state

```bash
curl -s http://127.0.0.1:9199/stats | python3 -m json.tool
```

**Expected:**
```json
{
    "entities": 0,
    "edges": 0,
    "facts": 0,
    "episodes": 0,
    "pending_updates": 0
}
```

---

## Step 2: First extraction — introduce yourself and your business

```bash
curl -s -X POST http://127.0.0.1:9199/extract \
  -H "Content-Type: application/json" \
  -d '{
    "user_message": "My name is Adam and I run a software consulting business called IIMAGINE. We have 4 full-time employees. Our main product is a desktop AI companion app. We also do contract development work for clients. Revenue is about $40K per month right now.",
    "assistant_response": "Nice to meet you, Adam! So IIMAGINE is a 4-person software consultancy doing around $40K/month in revenue, with a desktop AI companion as your main product plus contract dev work on the side. That is a solid foundation.",
    "llm_config": {
      "provider": "openai",
      "model": "gpt-5.4-mini",
      "api_key": "sk-YOUR-KEY",
      "engine_port": 8847
    }
  }' | python3 -m json.tool
```

**Expected (approximate):**
```json
{
    "entities_created": 3-5,
    "entities_updated": 0,
    "relationships_created": 2-4,
    "facts_stored": 2-4,
    "profile_updates_queued": 1-3
}
```

---

## Step 3: Check what was extracted

```bash
curl -s http://127.0.0.1:9199/stats | python3 -m json.tool
```

**Expected:** entities > 0, edges > 0, episodes = 1

---

## Step 4: Second extraction — add team and strategy info

```bash
curl -s -X POST http://127.0.0.1:9199/extract \
  -H "Content-Type: application/json" \
  -d '{
    "user_message": "My lead developer is Sarah, she handles most of the AI work. We are considering launching a SaaS version of the desktop app next quarter. Our biggest challenge right now is that 60% of revenue comes from one client, GreenTech Solutions.",
    "assistant_response": "That client concentration risk with GreenTech at 60% is significant. Having Sarah lead the AI work gives you strong technical capability for the SaaS launch. The transition from desktop to SaaS next quarter is ambitious but doable with your team.",
    "llm_config": {
      "provider": "openai",
      "model": "gpt-5.4-mini",
      "api_key": "sk-YOUR-KEY",
      "engine_port": 8847
    }
  }' | python3 -m json.tool
```

**Expected:** More entities_created (Sarah, GreenTech, SaaS product), relationships, facts.

---

## Step 5: Retrieve — test that memory works

```bash
curl -s -X POST http://127.0.0.1:9199/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the biggest risk in Adams business?", "token_budget": 1500}' | python3 -m json.tool
```

**Expected:**
- `context` should be non-empty
- Should mention GreenTech / 60% client concentration
- `facts_used` > 0
- `latency_ms` < 500

---

## Step 6: Retrieve — test entity recall

```bash
curl -s -X POST http://127.0.0.1:9199/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "Who works at IIMAGINE and what do they do?", "token_budget": 1500}' | python3 -m json.tool
```

**Expected:**
- Should mention Adam (owner) and Sarah (lead developer, AI work)
- `facts_used` > 0

---

## Step 7: Third extraction — contradict previous info (temporal test)

```bash
curl -s -X POST http://127.0.0.1:9199/extract \
  -H "Content-Type: application/json" \
  -d '{
    "user_message": "Update: we actually grew to 7 employees now. We hired 3 more people last month — two junior devs and a designer. Also GreenTech reduced their contract so they are now only 30% of revenue, which is much healthier.",
    "assistant_response": "Great news on both fronts! Growing to 7 people and reducing the GreenTech dependency from 60% to 30% significantly de-risks the business. The new hires in dev and design should accelerate the SaaS launch.",
    "llm_config": {
      "provider": "openai",
      "model": "gpt-5.4-mini",
      "api_key": "sk-YOUR-KEY",
      "engine_port": 8847
    }
  }' | python3 -m json.tool
```

**Expected:** entities_updated > 0 (team size changed, GreenTech revenue share changed)

---

## Step 8: Retrieve — verify temporal update

```bash
curl -s -X POST http://127.0.0.1:9199/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "How many employees does IIMAGINE have?", "token_budget": 1500}' | python3 -m json.tool
```

**Expected:**
- Should reference 7 employees (not 4)
- Should NOT show the old "4 employees" fact in retrieval

---

## Step 9: Check profile

```bash
curl -s http://127.0.0.1:9199/profile | python3 -m json.tool
```

**Expected:** Some sections should have `key_facts` populated (business info, team info).

---

## Step 10: Check pending updates

```bash
curl -s http://127.0.0.1:9199/pending-updates | python3 -m json.tool
```

**Expected:** Medium/high-salience facts queued for approval (revenue figures, strategic decisions).

---

## Step 11: Final stats

```bash
curl -s http://127.0.0.1:9199/stats | python3 -m json.tool
```

**Expected:**
```json
{
    "entities": 5-10,
    "edges": 5-15,
    "facts": 0,
    "episodes": 3,
    "pending_updates": 0-5
}
```

---

## Step 12: Clean up (optional)

```bash
curl -s -X DELETE http://127.0.0.1:9199/clear | python3 -m json.tool
```

---

## Troubleshooting

- **All zeros from extract:** Check the sidecar terminal for errors. Most likely the API key is wrong or the model name doesn't match.
- **Empty retrieve after successful extract:** The graph stored entities but embeddings may not be available (needs nomic-embed-text running on the engine). Keyword search should still work.
- **Temporal test not working:** Graphiti's contradiction detection needs the entity resolution to match "4 employees" → "7 employees" on the same entity. If it creates a new entity instead of updating, the extraction prompt may need tuning for your data.
