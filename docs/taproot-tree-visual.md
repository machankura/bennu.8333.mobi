# Drawing the taproot tree for a node's wallet

A second diagram under the selected node in the simulator on `/visualize`: not the group
hierarchy, which the tree already draws, but the **taproot output** that
hierarchy produces — the internal key, the script tree hanging off it, and what
each of those is worth in bytes and in privacy.

**Built**, phases 1-3 and 5-8, one commit each. Phase 4 is **not built** and is
blocked on its own precondition: it needs keys, and the key question belongs to
the shelved [bdk-wasm plan](./playground-bdk-wasm.md). Hashes over invented keys
would be real hashes of nothing.

Written against the simulator at `01e93d9`, and against
`bennu-kmp/docs/group-wallet-guardians.md` at `8cb6f04e`, which specifies the
shape this had to be faithful to. Where the build chose differently the phases
say so.

---

## What it draws

Bennu's own notes give the shape exactly, and the diagram should be recognisably
this rather than a generic taproot picture:

```
             Q  = P + H_TapTweak(P ‖ root)·G             output key
            ╱ ╲
  key path: P                                   the child's own key
                       root
                      ╱    ╲
          leaf(parent)      •
                           ╱ ╲
             leaf(grandparent) •
                              ╱ ╲
                            …    leaf(root group)
```

Four properties that are decisions, not incidentals, and that a drawing gets
wrong by default:

- **It is a caterpillar, not a balanced tree.** Every ancestor can act at the
  same moment, so the shape costs nothing in policy and only in bytes.
- **Nearest ancestor shallowest.** The parent — the ancestor most likely to
  ever use its leaf — gets the shortest control block.
- **One ancestor is a tree of one leaf**, depth 0, not a branch with one child.
- **An unguarded wallet has no tree at all.** `Q` is BIP86's empty tweak over
  `P`. Phase 6 is about drawing that, and it is the most important panel on the
  page.

Each leaf is `<L> OP_CHECKSIGVERIFY <d> OP_CHECKSEQUENCEVERIFY` — miniscript
`and_v(v:pk(L),older(d))`, which is exactly what `policyFor` already emits per
ancestor. The simulator is already holding every input this diagram needs.

## What it teaches, which is the reason to build it

The page says what the chain *enforces*. This says what the chain can *see*, and
the two are not the same:

| spend | a chain observer learns |
|---|---|
| the owner, key path | nothing beyond any single-key taproot spend |
| a guardian | that there was a script tree; the one leaf used and its delay; its depth, so a lower bound on how deep the hierarchy goes. The leaf key is unlinkable to any room id |

So a guarded wallet is **indistinguishable from an ordinary single-key wallet
until a guardian actually acts** — and even then, only one branch is revealed.
That is the strongest privacy claim Bennu has, it is invisible in the policy and
the descriptor, and the page currently does not make it anywhere.

## The hard constraint: what the browser can compute

This decides which phases are possible and which are a lie.

| quantity | how | can we? |
|---|---|---|
| TapLeaf hash | `tagged_hash("TapLeaf", ver ‖ compact_size(script) ‖ script)` | **yes** — SHA256, via `crypto.subtle.digest` |
| TapBranch hash | `tagged_hash("TapBranch", sorted(a, b))` | **yes** — same |
| merkle root | fold the branches | **yes** |
| script and control block sizes | arithmetic | **yes**, exactly |
| output key `Q = P + t·G` | secp256k1 point addition | **no** |

`crypto.subtle` has P-256, P-384 and P-521 and **not secp256k1**, so the tweak
cannot be computed without shipping a secp256k1 implementation. Phase 5 is where
that is confronted; the answer is to draw `Q` as a labelled box and say in words
what it is, rather than to add a crypto dependency to a page that currently has
none.

Note also that everything in the "yes" column needs **keys**, and the simulator
has names. Phases 1–3 need no keys at all and are the bulk of the value; Phase 4
is the first that does, and it inherits the decision the shelved
[bdk-wasm plan](./playground-bdk-wasm.md) ran into — see its Phase 3 before
reopening this one.

## Phases

1–3 need no cryptography and no keys. If only those three are ever built, the
diagram is still worth having.

### Phase 1 — the shape, drawn

`taprootTreeFor(node)` beside `policyFor`, returning the caterpillar from the
same ancestor walk: `{ internalKey, leaves: [{ name, delay, depth }], }`. Then an
SVG under the policy panel, in the page's own idiom — black strokes,
`currentColor`, inline, no font.

Leaves are labelled with the group's own name and its delay, as the alias table
already does: *Treasury, after 144 blocks*.

**Done when:** a three-deep guarded tree draws two leaves at the right depths,
nearest ancestor shallowest, and a one-ancestor wallet draws a single leaf at
depth 0 rather than a branch.

### Phase 2 — what each branch costs

Beside each leaf, the two numbers that follow from it:

- **the leaf script size.** 33 bytes of key push, one `OP_CHECKSIGVERIFY`, the
  delay's minimal `CScriptNum` push, one `OP_CHECKSEQUENCEVERIFY`. That is 36
  bytes at `d ≤ 16`, 37 to 127, 38 to 32,767 and 39 above — so across Bennu's
  own 6 to 65,535 range the leaf is 36 to 39 bytes, and **the delay a parent
  picks changes the size of the script**. Worth showing because it is a real
  consequence of a number the UI lets you type.
- **the control block**, `33 + 32·m` for a leaf at depth `m`: 33 bytes for a
  lone leaf, 65 for the parent in a deeper tree, up to `33 + 32·(k−1)` for the
  root group with `k` ancestors.

**Done when:** changing a delay from 12 to 144 moves a leaf from 36 to 38 bytes
on screen, and the numbers are covered in `docs/scripts/` the way the policy is.

### Phase 3 — what a spend reveals

The two-row table above, rendered for the selected node with its real names and
depths, and one sentence: until a guardian acts, this is indistinguishable from
a single-key wallet.

This is the phase that justifies the diagram. Everything before it is scaffolding
for it.

**Done when:** the table names the node's own ancestors, and says for a guardian
spend which leaf and which depth would be exposed.

### Phase 4 — real hashes

With placeholder keys, compute the TapLeaf hashes, fold them into the merkle
root, and show the first bytes of each on the diagram.

`crypto.subtle.digest` is async and the simulator's render is not, so this is
computed once per selection and patched in when it resolves — the same shape as
the policy refresh, not a new pattern. It must degrade to Phase 1's label-only
diagram if `crypto.subtle` is missing, which it is on any non-secure origin,
including plain `http://` and some `file://` loads.

Do not start this before the key question from the bdk-wasm plan is settled.
Hashes computed over invented keys are real hashes of nothing, and putting
32 convincing hex bytes on screen with no way to check them is worse than the
labels in Phase 1.

**Done when:** the merkle root shown matches one computed independently (a
`docs/scripts/` case with a fixed key and a known-good vector), and the diagram
falls back cleanly with no `crypto.subtle`.

### Phase 5 — the output key, and where this stops

`Q = P + H_TapTweak(P ‖ root)·G` needs secp256k1, which the browser does not
have and this page should not grow.

So `Q` is drawn as a box, labelled, with one line saying it is the internal key
tweaked by the merkle root and that **this is the only thing that appears in the
address** — which is the whole point and needs no arithmetic to make.

**Done when:** the diagram is honest that `Q` is not computed, and does not show
a plausible-looking key that is not one.

### Phase 6 — the unguarded wallet

An unguarded wallet has no script tree. `Q` is `P` under BIP86's empty tweak,
and the right drawing is a key with nothing hanging off it, captioned to say
there is nothing to hide because there is nothing to reveal.

Resist drawing an empty box where the tree would be. The absence is the content.

**Done when:** selecting the root draws a single key and one sentence, and the
contrast with a guarded sibling is visible by clicking between them.

### Phase 7 — the page at 375px

A caterpillar is tall and narrow, which is the one tree shape that suits a
phone. Depth is vertical, labels wrap, no horizontal scroll — the rule the
simulator already holds itself to.

**Done when:** a four-ancestor tree fits 375px with no sideways scroll.

### Phase 8 — the honesty pass

Add to *What this does not model*:

- the key path is a FROST threshold key, and the diagram cannot show that any
  more than the policy can
- the internal key is `account(K, network, n)/change/index`, so **every address
  has its own tree** with its own leaves and its own root; the diagram draws one
- a guardian's leaf key is derived one step further per child, so the same
  ancestor's leaf differs in every descendant's tree

**Done when:** each line says where the real rule lives, as the existing list
does.

## What could sink this

- **Phase 4 without settled keys** produces authoritative-looking hashes of
  nothing. The mitigation is ordering: 1–3 first, and they stand alone.
- **The diagram competes with the group tree.** Two trees on one page, one of
  groups and one of script branches, is a real risk of confusing exactly the
  reader this is for. If it cannot be made obvious which is which, it belongs
  behind a disclosure on the node rather than always open.
- **Scope.** This is a drawing of a thing the page already describes in words.
  If Phase 3's table turns out to carry the whole insight on its own, build the
  table and stop.
