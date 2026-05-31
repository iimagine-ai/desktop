# GGUF Model Registry — COMPLETE ✅

Last updated: 2026-05-31

## Status: DONE

All models scraped, verified, and implemented in `desktop-companion/model-registry.js`.

## Source

All GGUF files come from **bartowski** on HuggingFace — a trusted quantizer who converts official model weights to GGUF format for llama.cpp.

- bartowski profile: https://huggingface.co/bartowski
- URL pattern: `https://huggingface.co/bartowski/{repo}/resolve/main/{filename}`

## Verified Models (17 total)

### Gemma 4 (Google) ✅
| Model | Q4_K_M Size | RAM | Repo |
|-------|-------------|-----|------|
| Gemma 4 E2B (MoE 2B/9B) | 3.46 GB | 6 GB | `bartowski/google_gemma-4-E2B-it-GGUF` |
| Gemma 4 E4B (MoE 4B/9B) | 5.41 GB | 8 GB | `bartowski/google_gemma-4-E4B-it-GGUF` |
| Gemma 4 27B-A4B (MoE 4B/26B) | 17.04 GB | 20 GB | `bartowski/google_gemma-4-26B-A4B-it-GGUF` |
| Gemma 4 31B (Dense) | 19.60 GB | 24 GB | `bartowski/google_gemma-4-31B-it-GGUF` |

### Qwen 3/3.6 (Alibaba) ✅
| Model | Q4_K_M Size | RAM | Repo |
|-------|-------------|-----|------|
| Qwen 3 8B | 5.03 GB | 8 GB | `bartowski/Qwen_Qwen3-8B-GGUF` |
| Qwen 3 14B | 9.00 GB | 12 GB | `bartowski/Qwen_Qwen3-14B-GGUF` |
| Qwen 3 30B-A3B (MoE) | 18.63 GB | 22 GB | `bartowski/Qwen_Qwen3-30B-A3B-GGUF` |
| Qwen 3.6 35B-A3B (MoE) | 22.29 GB | 26 GB | `bartowski/Qwen_Qwen3.6-35B-A3B-GGUF` |

### Llama (Meta) ✅
| Model | Q4_K_M Size | RAM | Repo |
|-------|-------------|-----|------|
| Llama 3.1 8B | 4.92 GB | 8 GB | `bartowski/Meta-Llama-3.1-8B-Instruct-GGUF` |
| Llama 3.3 70B | 42.52 GB | 48 GB | `bartowski/Llama-3.3-70B-Instruct-GGUF` |

### Mistral (Mistral AI) ✅
| Model | Q4_K_M Size | RAM | Repo |
|-------|-------------|-----|------|
| Mistral Small 3.1 24B | 14.33 GB | 18 GB | `bartowski/mistralai_Mistral-Small-3.1-24B-Instruct-2503-GGUF` |

### DeepSeek ✅
| Model | Q4_K_M Size | RAM | Repo |
|-------|-------------|-----|------|
| DeepSeek R1 Distill 8B | 4.92 GB | 8 GB | `bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF` |
| DeepSeek R1 Distill 14B | 8.99 GB | 12 GB | `bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF` |

### Phi (Microsoft) ✅
| Model | Q4_K_M Size | RAM | Repo |
|-------|-------------|-----|------|
| Phi 4 (14B) | 9.05 GB | 12 GB | `bartowski/phi-4-GGUF` |
| Phi 4 Mini (3.8B) | 2.49 GB | 4 GB | `bartowski/microsoft_Phi-4-mini-instruct-GGUF` |

### Embedding Models ✅
| Model | Size | Repo |
|-------|------|------|
| Nomic Embed Text v1.5 | 0.27 GB | `nomic-ai/nomic-embed-text-v1.5-GGUF` |
| All MiniLM L6 v2 | 0.09 GB | `leliuga/all-MiniLM-L6-v2-GGUF` |

## How to Check for Updates

1. Visit https://huggingface.co/models?library=gguf&sort=modified&author=bartowski
2. Sort by "Recently Modified" to see newest uploads
3. Look for repos with official author prefix (google_, Qwen_, Meta-, microsoft_, deepseek-ai_, mistralai_)
4. Check the repo page for Q4_K_M files and their sizes
5. Update `model-registry.js` with new entries

## RAM Tier Recommendations

| User RAM | Recommended Models |
|----------|-------------------|
| 4 GB | Phi 4 Mini (2.49 GB) |
| 8 GB | Gemma 4 E2B, E4B, Qwen 3 8B, Llama 3.1 8B, DeepSeek R1 8B |
| 12-16 GB | Phi 4, Qwen 3 14B, DeepSeek R1 14B |
| 18-24 GB | Mistral Small 3.1, Gemma 4 27B-A4B, Gemma 4 31B |
| 26-32 GB | Qwen 3.6 35B-A3B, Qwen 3 30B-A3B |
| 48+ GB | Llama 3.3 70B |
