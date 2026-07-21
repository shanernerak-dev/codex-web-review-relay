# Review Request

Package kind: `review-request`
Review stream: `main`
Effective round: `1`
Target PR: `#1`
Review scope: README documentation quality for public repository launch

## Context

This repository (`shanernerak-dev/codex-web-review-relay`) has just transitioned from an internal project to a **public GitHub repository**. The README has been rewritten from internal Stage-oriented descriptions to user-facing public documentation, with an English primary (`README.md`) and a complete Chinese translation (`README.zh-CN.md`).

PR #1 (feat: implement Stage B relay host core) has been merged. The README rewrite was done in subsequent commits on `main` (a914868, 92800a2, 14c0978).

## What to review

Please review `README.md` and `README.zh-CN.md` as the public-facing documentation of this repository. Focus on:

### 1. Accuracy
Verify that technical descriptions (port numbers, file paths, CLI commands, schema fields, job phases, config keys) match the actual source code:
- `src/server.ts` — MCP server implementation
- `src/review-transport.ts` — job lifecycle and fail-closed semantics
- `src/relay-contract.ts` — relay export schema validation
- `src/envelope.ts` — trigger envelope generation (6 dynamic fields + 1 fixed instruction)
- `contracts/mcp-tools.schema.json` — MCP tool definitions
- `config/relay.config.example.json` — configuration example
- `extension/manifest.json` — extension manifest and permissions
- `scripts/install-native-host.ps1` — installer script

### 2. Completeness
Can an external user go from zero to a working review relay using only the README? Check for missing prerequisites, unexplained steps, or undocumented configuration requirements.

### 3. Comprehensibility
For developers unfamiliar with MCP, Chrome Native Messaging, or Chrome extensions: are concepts explained sufficiently? Is the architecture diagram clear?

### 4. Chinese-English consistency
`README.zh-CN.md` should be a section-by-section semantic equivalent of `README.md` — no omissions, no additions, no translation ambiguity.

### 5. Platform dependency description
Is the distinction between public repos (no special setup) and private repos (requires GitHub App connector) clear and accurate?

### 6. Security claims
Does the Security Model section accurately reflect the implementation (localhost-only binding, Bearer token auth, fail-closed validation, no credential storage)?

### 7. Over-promising / under-promising
Are there claims that exceed current MVP capabilities, or important limitations that are missing?

## Output format

Please provide your verdict as:
- Verdict: `PASS` / `REQUEST CHANGES` / `HUMAN DECISION REQUIRED`
- Itemized findings (if any), each with: location, issue description, suggested fix
- If no blocking findings, verdict is PASS

## Notes

- This review covers **README documentation quality only**, not source code implementation correctness (implementation passed 22/22 targeted tests + compat check).
- Stage Gate governance is the producer repository's internal convention — not required for this companion repo.
- The formal verdict does not need to be published as a GitHub PR comment. Returning the review result through the relay MCP channel is sufficient for this round.
- Review language: Chinese or English both acceptable; preserve original text when citing code/paths.
