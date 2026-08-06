# 04. Design Philosophy

## Core Philosophy & Design Principles

Mandatory engineering rules for all software modules, shared libraries, and UI layers.

---

## 1. Strategic vs. Tactical Programming

- **Principle:** Working code is not enough. The primary goal is creating clean, well-factored abstractions that minimize future cognitive load.
- **Rule:** Every feature task MUST allocate 10–20% of effort toward refining abstractions, updating architecture documentation, and cleaning up touched subsystems. "Tactical Tornadoes" (quick patches that introduce hidden caller complexity) are prohibited.

---

## 2. Deep Modules & Information Hiding

- **Principle:** Modules MUST provide a simple, narrow public interface that conceals extensive internal implementation complexity.
- **Rule:** Prohibit pass-through / shallow modules that merely re-export underlying functions with zero domain enrichment.
- **Boundary Test:** Unit tests MUST target the public interface of a deep module, never its internal private methods. Refactoring module internals MUST NOT break existing unit tests.

```typescript
// SHALLOW MODULE ANTI-PATTERN (Pass-through interface)
export function checkStock(id: string) {
  return dbCheckStock(id);
}
export function reserveStock(id: string, qty: number) {
  return dbReserve(id, qty);
}
export function updateLedger(id: string, qty: number) {
  return dbLedger(id, qty);
}

// DEEP MODULE CANONICAL PATTERN (Simple interface, heavy execution)
export async function executeInventoryCheckout(
  input: CheckoutInput,
): Promise<ActionResult<CheckoutResult>> {
  // Internally handles validation, stock checks, reservation locks,
  // ledger updates, and event notifications behind one clean call.
}
```

## 3. Define Errors Out of Existence

**Principle:** Exception handling is a primary source of software complexity. Design module interfaces so that edge cases fall naturally within normal execution semantics rather than throwing exceptions.

**Rule:** Favor idempotent operations (e.g., deleting a non-existent cart item succeeds silently) and null-object representations over throwing disruptive runtime errors. Reserve exceptions strictly for unrecoverable system faults.

## 4. Distinct Abstraction per Layer ("Different Layer, Different Abstraction")

**Principle:** Adjacent layers in the system stack MUST present fundamentally different representations of the domain.

**Rule:** A Server Action MUST NOT simply mirror the parameter signatures and return types of an underlying database hook. Each layer must add distinct value (authorization, request validation, error wrapping).

## 5. Pull Complexity Downward

**Principle:** It is far better for a module implementation to be internally complex if it makes its callers vastly simpler.

**Rule:** Modules MUST absorb state machine checks, retry loops, hardware status polling, and parameter defaults internally, presenting callers with clean, single-line invocations.

## 6. Elimination of Temporal Decomposition & Context Objects

**Principle:** Code structured based on the temporal sequence of operations forces callers to orchestrate complex multi-step setup chains (init(), configure(), process()).

**Rule (Self-Initialization):** Modules MUST handle their own internal setup and state checks on demand.

**Rule (Context Objects):** Group environment, session, and location parameters into a single, unified ContextObject to prevent intermediate functions from acting as pass-through parameter carriers.

```typescript
// PASS-THROUGH PARAMETERS (Intermediate function carries unused context)
function processItem(item: Item, locationId: string, userToken: string, config: StoreConfig) {
  return calculateItemDiscount(item, config); // locationId and userToken passed through unused
}

// CONTEXT OBJECT CANONICAL PATTERN
function processItem(item: Item, ctx: PosSecurityContext) {
  return calculateItemDiscount(item, ctx.config);
}
```

## 7. Code Cohesion: Bring Together What Belongs Together

**Principle:** Splitting closely related logic into micro-functions or micro-files creates "code splatter," forcing developers to jump across files to trace execution.

**Rule:** Code that shares secret knowledge, operates on the same data structures, or is always executed together MUST reside within the same deep module. Do not decompose functions unless sub-methods represent genuinely reusable abstractions.
