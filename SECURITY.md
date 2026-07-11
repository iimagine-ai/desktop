# Security Policy

## Reporting Vulnerabilities

**Do NOT open a public GitHub issue for security vulnerabilities.**

Email **security@iimagine.ai** with:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what an attacker could achieve)
- Any suggested fix (optional)

## Response Timeline

- **Acknowledge:** Within 48 hours
- **Initial assessment:** Within 72 hours
- **Patch (critical):** Within 7 days
- **Patch (non-critical):** Next scheduled release

## What Counts as a Security Issue

- Remote code execution via the app or plugin system
- Sandbox escape (renderer gaining node access)
- Local data exfiltration (conversations, KB content, API keys)
- Bypass of storage encryption
- Engine manager privilege escalation
- Plugin system permission bypass

## Scope

- IIMAGINE Desktop application
- Plugin system and plugin sandbox
- Engine manager (iimagine-engine lifecycle)
- Local storage encryption
- IPC channel security

## Out of Scope

- Third-party API key providers (OpenAI, Anthropic, etc.)
- Community plugins not distributed by IIMAGINE
- Vulnerabilities requiring physical access to an unlocked machine
- Social engineering attacks

## Disclosure

We follow coordinated disclosure. We'll work with you on timing and credit you in the release notes (unless you prefer anonymity).
