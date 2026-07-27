# Contributing to Monolythium Desktop Wallet

Thanks for considering a contribution. This is a **preview** Tauri 2 desktop wallet that holds Monolythium keys and signs transactions through an Operations drawer + OS-keychain-bound auth. The threat model is meaningful — please respect the boundaries below.

## Before opening a pull request

Run the three gates locally — there is no public CI workflow that exercises them today:

```bash
pnpm install
pnpm typecheck                                    # tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml  # Rust side
pnpm test                                         # vitest run
```

Keep all three green before opening the PR.

## What we're looking for

- **Bug fixes** in `src/` or `src-tauri/src/` — welcome any time.
- **Doc fixes** in `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/` — welcome any time.
- **Test coverage improvements** for the keychain bridge (`src-tauri/src/keychain.rs`), the vault encryption path (`src-tauri/src/vault.rs`), and the Operations drawer state machine (`src/operations/`).
- **SDK hook extensions** in `src/sdk/` as additional `@monolythium/core-sdk` methods become useful.
- **Polish on existing pages** — Home, Activity, Tokens, Delegate, Trade, AI Trading, Wallets, Settings, etc.

## What we'll push back on

- **Direct destructive Tauri commands that skip the Operations drawer.** Every privileged action goes through `OpsContext` → drawer preview → explicit auth (password / keychain) → execute. Don't add a "silent sign" path.
- **Storing key material in module-scope variables or `localStorage`.** The vault is encrypted with XChaCha20-Poly1305 under an Argon2id-derived key; the encrypted blob lives in the OS keychain; the unlocked seed lives in service-worker-equivalent state only for the duration of one operation.
- **Hardcoding production operator RPC IPs.** The wallet's RPC source is the SDK chain-registry. Tests that need IP-shaped fixtures use `192.0.2.0/24` (TEST-NET-1 reserved).
- **Commits without an honest author.** Sign every commit with your own identity, and make sure the author and email on each commit are accurate.

## Reviewing a change — the failures a green build misses

Types, tests and a passing build catch a lot. These are the ones they routinely don't — each earned here by a real bug that shipped or nearly did. Work down them on anything non-trivial, whether you're writing the change or reviewing one. They're phrased as questions, not rules, so they survive a refactor.

- **State that outlives its scope must carry that scope.** Anything that survives a render or crosses a scope boundary — a store key, cache, queue, debounce, in-flight flag, subscription, one-shot guard — is only correct if its identity includes the whole scope it belongs to (here, normally an address *and* a chain). The type system won't remind you; it all reads fine. Ask: does every persisted or long-lived value carry its full scope, with the chain taken from the one shared active-chain accessor rather than a hardcoded or builtin-chain id? After an `await`, are you writing under an identity you captured *before* it — when the answer came back from whoever you were addressing then? Can two things that must agree — a trust anchor and a storage key, say — drift because they derive from different sources? And watch read-time scoping over a single flat key: a review that only inspects key shapes cannot see it.
- **A guard can pass for the wrong reason.** A source-scan or conformance test is trusted *because* it's green, so a green one that checks nothing is worse than none. Four ways it happens: it scanned nothing (an empty walk, a glob matching no files, a wrong root); it flags legitimate uses it can't tell from real violations, and gets widened until it means nothing; it keeps passing after the thing it guarded was deleted, because "no offenders" is trivially true when the protected code is gone; or — the hardest to notice — its model of what a violation looks like is narrower than the violations that can actually occur. That last one is dangerous precisely because the guard reads as targeted and specific: it names a real rule and checks a real thing, while the breach takes a shape it was never written to recognise, and it stays green for the whole life of the problem it was meant to prevent. Ask of any guard: does it assert it actually scanned something? Does a deliberately-planted violation make it red? Does it assert the thing it protects still *exists*, not only that violations are absent? And if this rule were broken in a form you did not anticipate, would this guard still catch it? When the answer to the last one is no, the fix is usually to move the assertion to the level where the property manifests — what a surface actually renders, what a function actually returns — rather than the level where you expected someone to write the violation.
- **Which way a guard fails is a decision, not a matter of taste.** Any check that cannot always evaluate its own condition — an unresolved read, a balance that didn't come back, an empty set to verify against — has to choose between refusing on doubt and proceeding on doubt, and that choice is usually made by whichever felt safer while writing it. The two are not symmetric. Where a wrong pass is caught downstream — refused at admission, rejected before anything moves — it costs a free refusal, while a wrong block denies a legitimate action outright, so proceeding is the honest default. Where nothing downstream catches it — a plausible-but-wrong destination that is perfectly valid, a clearance that has quietly gone stale, a cost signed alongside the thing it is charged against — there is no backstop and nothing to recover afterwards, so refusing is. Ask: when this guard cannot evaluate its condition, does anything downstream catch what it lets through? Whichever way it lands, write the argument down beside it — the next reader will otherwise "fix" it to match its neighbours, and neighbours are not the standard.
- **Two parameters of the same type, meaning different things, get swapped eventually.** A function taking two strings — a key and a value, an address and a name, a source and a destination — accepts them in either order with no compiler error and no failing test; only reading catches it. A removal function here changed its lookup key while both parameters stayed strings, so every caller kept passing the old one and removal silently did nothing. Ask: does any signature take two adjacent same-typed values that mean different things? Make the swap impossible to *express* — a named-argument object, or a branded type — rather than merely something a test might catch.
- **Read a rule for what it's *for*, not just what it says.** A predicate, a convention, a validation can be stale (written before a later change moved the ground under it), internally wrong (it never actually satisfies its own goal), or correct as written but harmful in a case the author didn't enumerate. Only the first is findable by reading history. Ask: what is this rule for, does it still serve that after recent changes, does it actually achieve its stated goal, and is there a case it doesn't cover where following it does harm?

Three more were sharpened by getting them wrong in review:

- **A comment that makes a checkable claim is code that isn't run.** A comment saying "this is the chokepoint" or "the check belongs here" asserts something about control flow that *can* be tested — and one here pointed at the wrong line: disabling the mechanism it named changed nothing, because a second independent path produced the same effect. Nothing catches a wrong comment, and the next reader trusts it. Ask: if I disabled the thing this comment says is load-bearing, would the outcome actually change? If not, the comment is wrong.
- **A fact is not the same as its exclusivity.** "X works this way" and "X is the *only* thing that produces this behaviour" are different claims, and reading the first as the second has produced wrong conclusions here more than once. Ask: does this decision depend on something being the *only* cause? If so, has that been shown — or only that it's *a* cause? (The same caution applies to a measurement: a probe once reported every operator unreachable, and the probe itself was what was broken.)
- **Before deleting something that looks unused, find what uses it.** "No callers" looks conclusive and isn't: a symbol's only consumer can be a test that enforces a policy through it, or a path a plain search won't surface. Applied twice here it gave opposite answers, both right — one parameter was genuinely dead and removed; one export looked dead but was a conformance test's only handle on a rule, so deleting it would have retired the rule or forced it re-implemented inline. Ask: what actually depends on this? The answer can be "nothing, remove it" or "the only handle on a live rule, keep it" — both are fine, but only after looking.

## Commit + PR conventions

- Plain English in the imperative ("Add foo", "Fix bar") — no emoji, no `:phase:` or colon-prefixes.
- One logical change per commit when practical. Squash before merge if a PR grew several commits during review.
- For changes touching the keychain / vault / Operations drawer state machine, link the matching test file in the PR description.

## Security

If you've found a vulnerability, please **do not open a public issue**. Email `security@monolythium.com` — see [`SECURITY.md`](./SECURITY.md) for the full policy.

## Code of conduct

Be respectful. Disagree on technical merit. Don't be a jerk.
