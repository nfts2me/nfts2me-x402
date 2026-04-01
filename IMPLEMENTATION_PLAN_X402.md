# NFTs2Me x402 Implementation Plan

## Objective
This document defines a phased implementation plan to bring the project to production-grade alignment with x402 best practices, while preserving your product intent for NFT minting workflows.

The plan is intentionally research-first:
- No implementation starts until each topic has a dedicated discovery stage.
- Each discovery stage includes explicit questions for you.
- Every task includes official x402 documentation references.

## How to use this plan
1. Complete Phase 0 first.
2. For each implementation topic, run the corresponding Research stage and answer all questions.
3. Approve the decision gate.
4. Execute implementation only after your written approval.
5. Update README and this plan after each completed task.

## Canonical documentation index
Primary index:
- https://docs.x402.org/llms.txt

Core references used across this plan:
- Quickstart for Sellers: https://docs.x402.org/getting-started/quickstart-for-sellers.md
- Client / Server responsibilities: https://docs.x402.org/core-concepts/client-server.md
- Networks and token support: https://docs.x402.org/core-concepts/network-and-token-support.md
- Bazaar extension: https://docs.x402.org/extensions/bazaar.md
- Payment-Identifier extension: https://docs.x402.org/extensions/payment-identifier.md
- Signed Offers and Receipts: https://docs.x402.org/extensions/offer-receipt.md

---

## Phase 0 - Program setup and decision governance

### Purpose
Create a controlled process so every technical choice is validated with you before coding.

### Tasks
1. Define decision owners and approval protocol.
2. Define implementation environment matrix:
   - local dev
   - staging
   - production
3. Define acceptance criteria per phase.
4. Define rollback policy for every deployment.

### Research questions for you
1. What is your target date for production readiness?
2. Do you want staging to use testnet facilitator only, or production facilitator with safe limits?
3. Who gives final approval for architecture-level decisions?
4. Do you want strict change freeze windows?

### Deliverables
1. Signed decision log template.
2. Environment matrix document.
3. Phase-level acceptance checklist.

### Documentation references
- Quickstart for Sellers: https://docs.x402.org/getting-started/quickstart-for-sellers.md
- Client / Server: https://docs.x402.org/core-concepts/client-server.md

### Decision gate
No technical phase starts without your approval of governance rules.

---

## Phase 1 - Dependency and SDK unification

### Why this phase
Avoid runtime mismatches and incompatible server instances.

### Current risk addressed
Mixed package families can produce incompatible internals at runtime.

### Stage 1A - Research before implementation
#### Questions for you
1. Do you want to standardize fully on @x402 packages only?
2. Are there any reasons to keep @coinbase/x402 in the app package right now?
3. Is pnpm the single package manager going forward?
4. Do you want lockfile normalization as part of this phase?

#### Required analysis tasks
1. Build full dependency tree snapshot.
2. Identify duplicate versions of @x402/core and related packages.
3. Identify transitive packages that force incompatible versions.

#### Documentation references
- Quickstart for Sellers install guidance: https://docs.x402.org/getting-started/quickstart-for-sellers.md

### Stage 1B - Implementation
1. Remove package family mixing.
2. Pin compatible versions of x402 packages.
3. Regenerate lockfile with one package manager.
4. Validate that API routes no longer fail due to package-level mismatches.

### Stage 1C - Validation
1. Endpoint-level smoke tests for mint routes.
2. Verify 402 behavior and successful paid flow.
3. Confirm no runtime extension errors.

### Decision gate
You approve final dependency matrix before merge.

---

## Phase 2 - Environment and facilitator strategy

### Why this phase
Test and production need explicit, controlled facilitator and network behavior.

### Stage 2A - Research before implementation
#### Questions for you
1. Which facilitator do you want for production?
2. Do you want to support only Base mainnet initially, or multiple mainnets?
3. Should testnet mode be switchable per environment variable?
4. Do you want hard startup failure if production env vars are missing?

#### Required analysis tasks
1. Define facilitator URLs per environment.
2. Define network allowlist per environment.
3. Define payTo wallet policy per environment.

#### Documentation references
- Running on Mainnet: https://docs.x402.org/getting-started/quickstart-for-sellers.md
- Supported facilitators and networks: https://docs.x402.org/core-concepts/network-and-token-support.md

### Stage 2B - Implementation
1. Add explicit FACILITATOR_URL configuration.
2. Add per-environment allowed CAIP-2 networks.
3. Add startup validation for required env vars.
4. Add explicit error responses for unsupported network requests.

### Stage 2C - Validation
1. Verify testnet and production mode switching.
2. Verify unsupported networks return deterministic errors.
3. Verify all configured networks use CAIP-2 identifiers.

### Decision gate
You approve environment matrix and facilitator policy.

---

## Phase 3 - Route design and chain handling hardening

### Why this phase
Dynamic mint routes must be deterministic, explicit, and safe.

### Stage 3A - Research before implementation
#### Questions for you
1. Must all mint routes remain fully dynamic?
2. Do you want strict allowlists for chain IDs and token assets?
3. Should unsupported chains return 400 or 404?
4. Do you want contract allowlisting at launch, or open contract input?

#### Documentation references
- Network identifiers and CAIP-2: https://docs.x402.org/core-concepts/network-and-token-support.md
- Quickstart route configuration model: https://docs.x402.org/getting-started/quickstart-for-sellers.md

### Stage 3B - Implementation
1. Keep explicit chain mapping with no implicit fallback.
2. Validate and sanitize path parameters.
3. Enforce deterministic network selection.
4. Return stable machine-readable errors.

### Stage 3C - Validation
1. Positive tests for supported chains.
2. Negative tests for unsupported chains.
3. Regression tests against stale fallback behavior.

### Decision gate
You approve chain and route policy.

---

## Phase 4 - Mint economics and idempotency study (special analysis)

### Why this phase
You raised a key product concern: users may intentionally mint multiple times, so blind idempotency can be incorrect.

### Important framing
Idempotency in x402 is optional and should be modeled per business operation, not blindly enabled globally.

### Stage 4A - Research before implementation
#### Questions for you
1. What defines one logical purchase in your product?
2. Should two identical requests from the same wallet within seconds be:
   - treated as duplicate retry
   - or treated as intentional second mint
3. Do you want idempotency only for technical retries and not for business repeats?
4. Should clients pass an explicit clientRequestId/orderId?
5. Should idempotency be endpoint-specific (for example enabled on one endpoint, disabled on another)?

#### Analysis options
1. No idempotency at protocol extension level, and business-level deduplication only where required.
2. Optional payment-identifier extension with short TTL and strict payload hash checks.
3. Hybrid model:
   - verify-only flow supports repeat mints by design
   - settlement endpoint deduplicates exact retries only

#### Documentation references
- Payment-Identifier extension: https://docs.x402.org/extensions/payment-identifier.md
- Client / Server flow and settlement: https://docs.x402.org/core-concepts/client-server.md

### Stage 4B - Implementation decision (only after your approval)
Pick one model and document exact behavior for:
1. same payload same payment ID
2. same payload different payment IDs
3. same wallet repeated mint intent
4. retries after timeouts

### Stage 4C - Validation
1. Retry safety tests.
2. Intentional double mint tests.
3. Consistency tests across distributed instances.

### Decision gate
No idempotency implementation without your explicit product decision.

---

## Phase 5 - Bazaar discovery strategy and metadata quality

### Why this phase
Bazaar is recommended but should be enabled when route shape and metadata are stable.

### Stage 5A - Research before implementation
#### Questions for you
1. Do you want public discoverability now or after stabilization?
2. Should mint endpoints be discoverable by all agents, or only selected endpoints?
3. Do you want richer metadata with input/output schemas from day one?
4. Should route templates be normalized for dynamic paths?

#### Documentation references
- Bazaar overview and FAQ: https://docs.x402.org/extensions/bazaar.md
- Quickstart discovery recommendations: https://docs.x402.org/getting-started/quickstart-for-sellers.md

### Stage 5B - Implementation
1. Re-enable bazaar only after SDK unification is complete.
2. Add complete metadata:
   - clear description
   - parameter descriptions
   - input schema
   - output schema
3. Ensure discovery behavior is tested against facilitator responses.

### Stage 5C - Validation
1. Validate extension response headers and catalog status.
2. Confirm resources appear correctly in discovery listings.
3. Confirm no wildcard normalization surprises in production behavior.

### Decision gate
You approve public discoverability scope and metadata standard.

---

## Phase 6 - Settlement architecture and business flow finalization

### Why this phase
You currently have standard settlement and verify-only paths. Product needs one canonical path.

### Stage 6A - Research before implementation
#### Questions for you
1. Is your long-term architecture fully verify-only plus on-chain atomic execution?
2. Should standard withX402 route remain as fallback?
3. How do you want to version these API paths for clients?
4. Which path is considered production SLA path?

#### Documentation references
- withX402 recommendation for API routes: https://docs.x402.org/getting-started/quickstart-for-sellers.md
- Client / Server settlement model: https://docs.x402.org/core-concepts/client-server.md

### Stage 6B - Implementation
1. Declare canonical production path.
2. Mark alternate path as experimental or deprecated.
3. Add migration notes for clients.
4. Ensure return payload contracts are stable.

### Stage 6C - Validation
1. Contract tests for canonical path.
2. Backward compatibility tests for transition period.

### Decision gate
You approve the canonical payment and minting flow.

---

## Phase 7 - Logging, diagnostics, and production controls

### Why this phase
You explicitly requested logs in development but removed or reduced in production.

### Stage 7A - Research before implementation
#### Questions for you
1. Which log fields are mandatory in development?
2. Which fields are forbidden in production logs?
3. Do you want structured JSON logs in production?
4. Do you want runtime switch by NODE_ENV only, or explicit LOG_LEVEL and LOG_MODE?

#### Documentation references
- Client / Server operational flow: https://docs.x402.org/core-concepts/client-server.md
- Quickstart operational testing and error handling: https://docs.x402.org/getting-started/quickstart-for-sellers.md

### Stage 7B - Implementation
1. Add environment-aware logger wrapper.
2. Keep verbose request/payment logs in development.
3. Redact or remove sensitive fields in production.
4. Add correlation IDs for tracing.

### Stage 7C - Validation
1. Verify verbose output in dev.
2. Verify redaction and reduced verbosity in production mode.
3. Verify no secret leakage in logs.

### Decision gate
You approve final production logging policy.

---

## Phase 8 - End-to-end x402 contract and regression testing

### Clarification of what this means
This phase is not generic unit testing only.
It means testing the complete payment contract behavior at HTTP and business levels so changes do not break x402 flow.

### What should be tested
1. Request without payment returns 402 with payment requirements.
2. Request with valid payment proof returns success payload.
3. Failure cases return expected error shape.
4. Mint business outcomes match payment outcomes.
5. Retry behavior matches your idempotency decision from Phase 4.

### Stage 8A - Research before implementation
#### Questions for you
1. Which test environments are mandatory for CI?
2. Do you want integration tests against local mocks, real testnet, or both?
3. What is your acceptable CI runtime budget?
4. What is your minimum coverage goal for critical payment paths?

#### Documentation references
- Quickstart testing flow: https://docs.x402.org/getting-started/quickstart-for-sellers.md
- Client / Server communication flow: https://docs.x402.org/core-concepts/client-server.md

### Stage 8B - Implementation
1. Add HTTP integration test suite for mint routes.
2. Add regression tests for 402 and paid responses.
3. Add environment-specific test profiles.
4. Add CI gates for payment-critical paths.

### Stage 8C - Validation
1. Repeatability in CI.
2. Deterministic behavior under retries and failures.
3. Fail-fast diagnostics with actionable errors.

### Decision gate
You approve CI quality gate thresholds.

---

## Phase 9 - Security and key management hardening

### Why this phase
Production payment systems need strict key isolation and secret hygiene.

### Stage 9A - Research before implementation
#### Questions for you
1. Do you have a KMS or managed signer available?
2. Do you want immediate key rotation policy?
3. Should signing key and payment wallet be separated now?
4. What is your incident response process for key leakage?

#### Documentation references
- Signed Offers and Receipts key management guidance: https://docs.x402.org/extensions/offer-receipt.md
- Running on Mainnet recommendations: https://docs.x402.org/getting-started/quickstart-for-sellers.md

### Stage 9B - Implementation
1. Remove plaintext secrets from repository artifacts.
2. Enforce secure env handling.
3. Add startup checks for required secrets.
4. Add key separation policy documentation.

### Stage 9C - Validation
1. Secret scanning.
2. Key rotation dry run.
3. Production readiness sign-off.

### Decision gate
You approve security baseline and go-live controls.

---

## Phase 10 - Trust and ecosystem extensions (optional but high value)

### Why this phase
Improve trust, auditability, and ecosystem positioning.

### Stage 10A - Research before implementation
#### Questions for you
1. Do you want signed offers and receipts in initial production?
2. Is your immediate use case reputation, audit trail, or disputes?
3. Do you prefer EIP-712 or JWS signing format?
4. Do you have infrastructure for did:web if JWS is chosen?

#### Documentation references
- Signed Offers and Receipts: https://docs.x402.org/extensions/offer-receipt.md

### Stage 10B - Implementation
1. Add offer-receipt extension if approved.
2. Configure signing format and key source.
3. Add client verification examples for integrators.

### Stage 10C - Validation
1. Verify signed offer on 402.
2. Verify signed receipt on successful paid response.
3. Verify signature validation from independent client.

### Decision gate
You approve extension rollout scope and timeline.

---

## Cross-phase mandatory policy

1. Every phase starts with a research questionnaire.
2. No implementation without your explicit approval.
3. External-facing text must be in English.
4. Development logs stay enabled.
5. Production logs must be reduced and redacted.
6. README and this plan must be updated in every feature change.

---

## Proposed execution order

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 6
6. Phase 4
7. Phase 7
8. Phase 8
9. Phase 9
10. Phase 5
11. Phase 10

Notes:
- Phase 6 is moved earlier to lock the canonical mint architecture before idempotency and test matrix expansion.
- Phase 5 Bazaar is postponed until technical stability and metadata quality are guaranteed.

---

## Immediate next step
Run Phase 0 interview and complete all decision questions before coding changes.