# Moving the playground to bdk-wasm

Replacing the vendored bdk-cli playground under `/playground` with
[bdk-wasm](https://github.com/bitcoindevkit/bdk-wasm), the Bitcoin Dev Kit
compiled to WebAssembly and published as `@bitcoindevkit/bdk-wallet-web`.

**Not built.** This is the plan, written against the page at `01e93d9` and
against bdk-wasm at `73cb4df` (crate version 0.3.0).

---

## Read this first: it is not a drop-in

bdk-wasm **cannot compile a miniscript policy**. That is the one thing the
current page is built around, and the whole plan follows from it.

Verified against the source rather than the README:

| what | where |
|---|---|
| `Cargo.toml` dependencies are `bdk_wallet`, `bdk_esplora`, `bitcoin` | no `miniscript` crate, so no `policy::Concrete::compile()` |
| `src/lib.rs` exposes `bitcoin` and `types`, nothing else | no policy module |
| `src/bitcoin/` is `descriptor`, `tx_builder`, `wallet`, `wallet_tx`, `esplora_client` | wallet operations |
| `src/bitcoin/descriptor.rs` is BIP44/49/84/86 templates from a seed, xprv or xpub | single-key wallets, not script paths |

So a straight swap loses the policy compiler and the Blockly editor with it.
Both belong to the bdk-cli bundle, not to BDK.

What it gains is larger than what it loses, but only because of the decision in
the next section.

## What the move is actually for

Three things the current page cannot do, all of which bdk-wasm can:

**Taproot.** The vendored compiler offers `sh`, `wsh` and `sh-wsh` and no `tr`,
which is why the page has to say the script it draws is not the one Bennu
builds. bdk-wasm's `Wallet` takes descriptor strings and `bdk_wallet` handles
taproot, so a `tr()` descriptor with script-path leaves — exactly what Bennu
builds — becomes loadable. **This is the reason to do the work.** It turns the
page from an analogy into the thing itself.

**A wallet that is actually a wallet.** Sync against Esplora, a balance, derived
addresses, UTXOs, a `TxBuilder`. The current page has a wallet section, but it
is the bdk-cli REPL wrapped in a textarea.

**Something maintained.** The bdk-cli playground is a prebuilt bundle vendored
into this repo at a version nobody records, already patched twice by us. bdk-wasm
is a published npm package with a changelog.

## The decision everything else rests on

**Stop compiling policies. Emit descriptors.**

The simulator already knows the tree exactly — it builds the policy string and
the block AST from the same walk. A taproot descriptor is no harder:

```
tr(SELF, { and_v(v:pk(A1),older(d1)), and_v(v:pk(A2),older(d2)) })
```

That is the shape `docs/group-wallet-simulator.md` describes Bennu building: the
owner on the key path, one leaf per ancestor behind its own delay. Emitting it
directly removes the compiler from the page entirely, and with it the P2WSH
caveat, the alias table, the `or(...)` weights question and the whole
`compilerBridge`.

The compiler was never the point. It was the only way to get from a policy to a
script with a library we did not have to build. With bdk-wasm we are no longer
asking a third party to infer a structure we already know.

**What is lost:** the Blockly block diagram, which is bdk-cli's, not BDK's. The
tree the simulator draws is already a diagram of the same thing, and the blocks
have been a second view of it since the simulator landed. Phase 8 decides
whether anything replaces it; the honest default is nothing.

## Two constraints that shape the phases

**The site has no bundler.** `@bitcoindevkit/bdk-wallet-web` is built with
`wasm-pack --target bundler`, which emits ES modules with bare imports that a
browser cannot resolve. Three ways out, in order of preference:

1. **esbuild at build time.** One devDependency, one line in
   `scripts/build-static.js`, output a single `playground.js` plus the `.wasm`.
   No Rust, and `npm ci && npm run build` still describes the whole build.
2. Build bdk-wasm ourselves with `wasm-pack --target web`, which needs no
   bundler at runtime but puts Rust and `wasm-pack` in CI — a large change to a
   repo whose whole toolchain is node.
3. An import map and a CDN. No build step, but it reintroduces a third-party
   request on a page we deliberately made self-contained.

Phase 1 is a spike to confirm (1) works before anything depends on it.

**Esplora only, which means Blockstream.** bdk-wasm cannot use Electrum — wasm
has no sockets — so syncing still asks `blockstream.info` for the history of
every address. The warning now on the page stays true word for word, and the
move does not improve it.

## Phases

Phases 1–3 answer whether this is possible at all. Stop after 3 if the answer
is no; nothing before Phase 4 touches the live page.

### Phase 1 — a spike, behind no flag and on no page

A scratch HTML file outside `server/`, loading `@bitcoindevkit/bdk-wallet-web`
bundled by esbuild, that creates a wallet from a hardcoded `tr()` descriptor
with one script-path leaf and prints its first address.

This answers the three questions that decide the plan, and none of them is
answered by the README:

- does `Wallet.create` accept a `tr()` descriptor with leaves, or only the
  BIP86 template shape its own helpers produce?
- what is the wasm actually worth in bytes next to the 5.3MB we ship now?
- does esbuild produce something that runs from a `file://` and from a
  `/repository/` subpath, as the build's output has to?

**Done when:** an address appears, and the three answers are written into this
document.

### Phase 2 — the descriptor builder, pure and tested

`descriptorFor(node)` beside `policyFor` in `wallet-simulator.js`, built from
the same walk, emitting the `tr()` above. Keys are the open question and
Phase 3's subject; this phase emits placeholders and is tested on structure.

Cases worth pinning, in `docs/scripts/`: an unguarded root (`tr(SELF)`, no
leaves at all); one guardian; two guardians at different delays; a member
wallet; the delay boundaries. The existing policy cases stay until Phase 7
removes the policy.

**Done when:** `npm test` covers the descriptor the same way it covers the
policy, and the two agree about which conditions they describe.

### Phase 3 — keys

The simulator has names. A descriptor needs keys, and this is the phase with a
real choice in it.

Today the bdk-cli compiler generates a WIF per alias, so two people opening the
same link get different descriptors and different addresses. **Deriving keys
from the tree instead would make a shared link produce the same addresses for
everyone**, which is a better page and a strictly better demonstration: two
members could each open the link and see the same wallet.

The obvious route is a fixed test xprv in the source, with each node taking a
path from its position in the tree. It must be unmistakably a toy — a published
BIP32 test vector, labelled in the UI and in this document, never generated and
never user-supplied. The page already says never paste a private key; it must
not start quietly holding one that looks real.

**Done when:** the same link gives the same addresses in two browsers, and the
page says in one sentence where the keys come from and that they are nobody's.

### Phase 4 — the wallet panel

Replace the iframe with our own panel: the descriptor, the first few receive
addresses, and — behind an explicit button, never on load — a sync against
Esplora showing the balance.

Sync stays opt-in for the reason the page already gives: it hands Blockstream
every address the descriptor derives. The existing wording moves here intact.

**Done when:** the selected node shows its descriptor and addresses with no
network traffic at all, and sync is one button that says what it will disclose.

### Phase 5 — delete the bridge

`compilerBridge`, `whenReady`, `whenAvailable`, the alias plumbing, the
`policyAstFor` AST and the one line patched into the vendored bundle all go.

Roughly 150 lines of the simulator exist to talk to that iframe, and every one
of them is a workaround for not owning the compiler. This phase is the payoff
and should be a visible deletion.

**Done when:** `server/static/playground/` is gone, nothing in the repo is a
vendored third-party bundle, and the page's weight drops by whatever Phase 1
measured.

### Phase 6 — the caveats, rewritten

Three things the page currently says stop being true, and saying them anyway
would be worse than having never said them:

- *"The compiler wraps these conditions in P2WSH… Bennu uses taproot"* — gone;
  it **is** taproot now.
- *"generates a key for each name"* — becomes whatever Phase 3 decided.
- *"What this does not model"* loses the derivation bullet, because real
  addresses are what the page now shows.

What must not be lost: the quorum is still off-chain, and `tr(treasury,…)` still
cannot show that 3 of 5 members stand behind that key. Phase 7 of the simulator
plan stays exactly as it is.

**Done when:** every sentence on the page is true of the page as it then is.

### Phase 7 — the policy, kept or dropped

The policy string is now a second description of what the descriptor already
says. Two defensible endings:

- **Keep it**, as prose: miniscript policy reads closer to English than a
  descriptor does, and the page is explanatory.
- **Drop it**, and show the descriptor alone.

Decide with the page in front of you, not now. If it stays, it stays as text the
simulator emits, with nothing compiling it.

### Phase 8 — what replaces the blocks

Nothing, probably. The tree is already the diagram. If something does, it is
ours and it draws the descriptor — not a reimplementation of Blockly.

Worth doing before this: look at whether anyone used the block editor. It was
only ever reachable by pressing compile.

## What could sink this

Honest list, roughly by likelihood:

- **`Wallet.create` rejects a descriptor with script paths.** Phase 1 exists to
  find this out on day one. If it does, the move still buys a real wallet but
  not taproot leaves, which is most of the reason to do it.
- **The wasm is no smaller.** `opt-level = "z"`, `lto`, `wasm-opt -Oz` and
  `panic = "abort"` suggest it should be, but the current 5.3MB includes a whole
  CLI and Blockly.
- **esbuild cannot flatten the bundler-target package cleanly**, pushing us to
  option (2) and Rust in CI.
- **bdk-wasm is young.** Thirteen stars, a fork of MetaMask's, no tagged
  releases on the repo, five open issues. The API will move. That is an argument
  for pinning an exact version, not for staying on an unmaintained bundle.

## What we stop being able to do

- Compile an arbitrary policy somebody types in. The page becomes about *this*
  tree rather than a general miniscript toy. For Bennu's site that is an
  improvement, but it is a narrowing and should be a decision rather than a
  discovery.
- Show the block editor.
- Choose `sh` or `wsh` output. Everything is taproot, as Bennu is.
