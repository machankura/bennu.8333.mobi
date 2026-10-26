# A simulator for the group wallet structure

A tree-builder above the policy compiler on `/playground`. It starts empty with
one control — *Add a root group* — and grows: a group gains subgroups, subgroups
gain member wallets, each node carries its own quorum and its own guardian
delay. The node you select compiles to a miniscript policy, and that policy is
handed to the compiler already on the page, which draws it as blocks and emits
the descriptor.

**Built**, phases 1-10, one commit each. Written against
the page as it stood at `081d00a`; where the build found the plan wrong the
section says so, and it did twice — the compiler has no taproot option, and the
alias table has to be filled or every compile errors.

> The instruction this plan was written from ended mid-sentence: *"From the root
> node, add a control to allow a user"*. Phase 4 is what I take the rest to be —
> a control on each node that adds a child, with the child's kind (subgroup or
> member wallet) and its terms chosen at the moment of adding, because that is
> when Bennu itself makes that choice and it cannot be changed afterwards.
> If the sentence ended somewhere else, Phase 4 is the phase to rewrite; the
> others stand.

---

## The one thing it must not conflate

A group's key is a `t`-of-`n` FROST threshold key. **The chain cannot see the
threshold.** On-chain, a group is one taproot key — `pk(G)` — and whether that
signature took two members or five is invisible to any policy, descriptor or
block explorer.

So the simulator has two layers that must never be drawn as one:

| layer | where it lives | what the simulator does with it |
|---|---|---|
| the quorum — `t` of `n` members | off-chain, in the key ceremony | shown on the node, **never** in the policy |
| the spending conditions — key path and guardian leaves | in the descriptor | compiled to policy, handed to the compiler |

A simulator that renders `thresh(2, pk(alice), pk(bob), pk(carol))` for a 2-of-3
group would be telling a lie that the compiler would faithfully draw. The whole
value of putting this above the policy compiler is that a reader can see which
of the group's rules the chain enforces and which rest on honest clients, so
Phase 7 makes the boundary explicit rather than leaving it implied.

## What the page can and cannot do

Four constraints, all of them from the site as it is:

- **No bundler.** Scripts are vanilla files `include`d into a `script` tag by
  pug (`server/views/js/site.js`, `faq-collapsible.js`). The simulator is one
  more of those. No npm dependency, no build step beyond `npm run build`.
- **Materialize is already loaded**, and the page's own idiom is
  `.btn.black`, `.row`/`.col`, `.collapsible`. Use it rather than inventing a
  second look.
- **The compiler is a vendored third-party bundle in an iframe**, same-origin,
  so `iframe.contentDocument` reaches it. That is a real seam and is treated as
  one in Phase 8.
- **Everything must survive the static build**, which renders the same pug and
  copies `server/static/playground/` wholesale. Nothing may depend on the
  express app.

### The contract with the compiler

These are the ids the vendored bundle owns. The simulator touches only the
first three, and only through the adapter in Phase 8:

| id | what it is |
|---|---|
| `policy` | the policy input the compiler reads |
| `compile_button` | compiles what is in `policy` |
| `compiler_script_type` | `sh`/`wsh`/`sh-wsh` — the simulator sets `wsh`. **There is no taproot option**, so the compiler wraps the conditions in P2WSH and the page says so; the conditions are what is being illustrated, not the wrapper |
| `compiler_aliases`, `add_key_alias` | the alias → key table |
| `compiler_output` | where the descriptor lands |
| `network`, `descriptor`, `start_button` | the wallet half; untouched |

## The model

One node type, with a kind. Everything else hangs off it:

```js
{
  id: "n3",
  kind: "group" | "member",       // a member wallet is a leaf and has no children
  name: "Treasury",
  members: 5,                      // n
  threshold: 3,                    // t; a member wallet is 1 of 1
  guarded: true,                   // chosen at birth, never editable
  delay: 12,                       // blocks THIS node's key waits over its children
  children: [...]
}
```

Three rules the editor has to enforce, because Bennu enforces them and a
simulator that lets you build an impossible tree teaches the wrong thing:

1. `1 <= threshold <= members`.
2. **A guarded group's children are all guarded.** Once an ancestor holds a
   leaf, every descendant carries it; *unguarded* is only offered when the
   parent is unguarded, and the root is unguarded by definition because it has
   no ancestor.
3. `delay` is 6..65,535 blocks, the range BIP68 can express in blocks, and the
   delay belongs to the **ancestor**, not the child — each ancestor keeps the
   number it chose as its key passes down the tree.

## Phases

Each phase ends with something on the page that works. Phases 1–6 are the
builder, 7–8 are the join to the compiler, 9–10 are the honesty and the polish.

### Phase 1 — an empty canvas and one control

`server/views/js/wallet-simulator.js`, included from `playground.pug` above the
iframe. A bordered panel in the page's own style, empty but for a single
*Add a root group* button, and a paragraph saying what the thing is for.

State lives in one module-scoped object and renders through one `render()` that
redraws the panel from state. No framework, no diffing — the tree is at most a
few dozen nodes and a full redraw is simpler to keep correct than a partial one.

**Done when:** the button appears on `/playground` and on `playground.html` from
`dist/`, and clicking it does nothing yet.

### Phase 2 — the root node

Clicking *Add a root group* creates the root: kind `group`, default 2-of-3, name
*Group*, `guarded: false`, and renders it as a card. The control is then replaced
by the tree, since there is exactly one root and a second one would model nothing.

**Done when:** a root card appears, the add-root control is gone, and a
*Start again* link restores the empty state.

### Phase 3 — editing a node

Each card gets its name, and `t` of `n` as two number inputs with rule 1
enforced on input rather than on submit. The quorum reads as a sentence —
*3 of 5 members must sign* — because that is the wording Bennu's own screens use
and the number pair alone is read as a fraction by half the people who see it.

**Done when:** editing `n` below `t` pulls `t` down with it, and the sentence
updates.

### Phase 4 — adding a child

The control the truncated sentence asked for. On every group card, *Add a
subgroup* and *Add a member wallet*.

A subgroup opens a small form with the three things Bennu decides at a child's
birth: its name, its quorum, and **whether its wallet is guarded** — the last
offered only when the parent is unguarded, and otherwise shown as *guarded,
because its parent is* with the reason stated. Choosing *guarded* reveals the
parent's delay, defaulting to 12 blocks, with the duration spelled out beside it
(*about 2 hours*) exactly as the app does.

A member wallet is simpler: a name, `1` of `1` fixed, and always guarded —
asking a group to guard a wallet is the only reason to make one here.

Every node but the root carries a *remove*, pushed to the far edge of its row
away from the controls that build. It takes the whole subtree: nothing is
re-parented, because a group's children are guarded by *it*, and hanging them on
their grandparent would silently rewrite the terms they were made under. A leaf
goes without asking; a node carrying others says how many go first, which is the
only case where a mis-click costs real work. The root has none — it is the whole
tree, and *start again* already says that.

**Done when:** a tree three deep can be built, the guarded rule cannot be
violated through the UI, and each node shows its own delay rather than inheriting
the display of its parent's.

### Phase 5 — drawing the tree

Nested `ul`/`li` with a left rule per level, not a canvas: it is a tree of a few
dozen nodes, it must work at phone width, and the page already has no JS drawing
of any kind. Each node shows its name, its quorum sentence, a *guarded* or
*unguarded* chip, and its delay when it has one.

Selecting a node highlights it. Selection is what Phase 6 compiles.

**Done when:** the tree reads correctly at 375px with no horizontal scroll, and
exactly one node is selected at a time.

### Phase 6 — the policy for the selected node

The heart of it. For the selected node, walk up to the root collecting every
ancestor, and emit:

- **unguarded** — `pk(SELF)`. One key, key-path spend, nothing else. The point
  worth making on screen is that this is indistinguishable on-chain from any
  other single-key wallet.
- **guarded**, with ancestors `A1…An` at their own delays:

  ```
  or(pk(SELF),or(and(pk(A1),older(d1)),and(pk(A2),older(d2)),…))
  ```

  The plan originally put weights on that first `or` — `99@`/`1@` — to say the
  owner is the common case. The build dropped them. This compiler has no
  taproot, so there is no key path to steer anything onto; the block editor's
  `or` hardcodes its weights to 1 and rewrites the policy input without them;
  and compiling this shape with and without them yields byte-identical
  miniscript. They were the one reason the four views of the same tree did not
  agree, and they bought nothing to pay for it.

Aliases are generated per node from the node's name (`treasury`, `parent_1`),
shown in a small table beside the policy, and pushed into the compiler's alias
table in Phase 8 so the compiled output names the same things the tree does.

**Done when:** a three-deep guarded tree produces a policy with two `older()`
branches at the correct, *different* delays, and the root produces `pk(root)`.

### Phase 7 — saying what the policy leaves out

Directly under the generated policy, a short block naming what just happened:

> This policy is what the chain enforces. It does not include the quorum: `pk(treasury)`
> is one signature from a key that 3 of 5 members must co-operate to use, and no
> block explorer can tell that apart from a single person's wallet.

Without this the simulator is actively misleading, which is why it is a phase
and not a footnote. It is also the page's best sentence about what Bennu
actually is.

**Done when:** the block names the selected node's real `t` and `n`, and
disappears for a member wallet, where 1-of-1 makes it vacuous.

### Phase 8 — handing it to the compiler

One adapter, `compilerBridge`, the only code that touches the iframe:

```js
const doc = () => document.querySelector('iframe').contentDocument
```

It adds a row per alias through `#add_key_alias` — the rows default to
*Generate WIF Key*, which is what a simulator holding names and no keys wants —
fills each row's `input[name=alias]`, sets `#compiler_script_type` to `wsh`,
fills `#policy` and clicks `#compile_button`.

Compiling without the alias rows fails with *Couldn't map alias*, so filling
them is not a nicety; it is the difference between a button that works and one
that always errors.

Every one of those is third-party DOM that a future bundle refresh may rename,
so the bridge checks each id and, on a miss, degrades to a *Copy the policy*
button and a line saying to paste it below. A broken bridge must never take the
builder down with it — the tree and the policy are useful on their own, and the
compiler is a convenience on top.

The iframe is same-origin only because the bundle is served from our own
`/static/playground/`. If it is ever pointed back at bitcoindevkit.org this
whole phase stops working, silently, and the fallback is what the reader gets.

The control is on each node, in the row with *+ subgroup* and *+ member
wallet*, because compiling is a thing done to a node like adding a child to one.
At the foot of the tree it meant *the selected one, wherever that is*; on the
row it is where the attention already is, and it gives a member wallet a
controls row it had no reason to have before — the node most worth compiling,
since it is the guarded one. Pressing it selects that node too, so the policy
above the compiler is the one that was just drawn.

It also draws the tree in the visual editor, which is the most legible of the
views and otherwise sits on its default example while the policy below it says
something else. The bundle's `__descriptorPolicy.loadPolicy` does that, and it
takes a parsed tree rather than a string — `{type:'pk',alias}`,
`{type:'older',value}`, `{type:'and'|'or',subs:[a,b]}` — so `policyAstFor`
builds that shape from the same walk `policyFor` uses, rather than parsing the
string back out.

The control has to be put back after the first render. `available()` only asks
whether the ids are there, and on a cold load the iframe's `contentDocument` is
`about:blank` until the real document commits — 46ms on localhost, as long as
the network takes over the wire — so the panel first renders with the bridge
reported absent and leaves the compile controls out. Nothing redrew afterwards,
so a tree built in that window had no way to compile at all. A poll on
`available()` fires once and redraws, holding off while the panel owns the
caret.

Reaching it costs one line patched into the vendored bundle, which assigns the
module to `window`. Webpack scopes both it and Blockly itself — `window.Blockly`
is only the message catalogue — so there is no other way in. Without that line
the blocks simply stay as they were; nothing else breaks.

Draw before compiling. Loading blocks makes Blockly write its own rendering back
into `#policy` on a later tick, so drawing afterwards leaves the input showing
something other than what was compiled.

**Done when:** *Compile it below* draws the tree as blocks under the group's own
names, fills the policy and the aliases, produces a descriptor, and the policy
shown above, the input below, the blocks and the descriptor all describe the
same conditions. Renaming `#policy` in a local copy produces the copy-button
fallback instead of an exception.

### Phase 9 — sharing a tree

Serialise state to JSON, compress it into the URL fragment, and read it back on
load. The fragment, not the query string: it never reaches a server, and a tree
is the kind of thing someone pastes into a chat to ask *is this what we want?*

The selection travels with it, as a path of child indices rather than an id,
since the ids are reassigned on the way back in. Without it a link arrives
showing the root instead of the node the sender was looking at when they copied
it, which is usually the one the link was about.

And a tree that arrived in the url compiles itself: it draws the blocks, fills
the policy and produces the descriptor without a button being pressed, because
the sender already knows the answer and the picture is the thing they sent. A
tree built here by hand does not, which would mean recompiling on every
keystroke. The bundle is a 5MB wasm download, so this waits for a rendered block
in the workspace — the only evidence from outside that the workspace exists —
and gives up quietly after ~30s, leaving the button that still works.

**Done when:** a built tree survives copy-paste of the URL into a fresh tab with
the sender's node still selected and the compiler below already showing it, a
link made before the selection travelled still opens on the root, and a
malformed fragment falls back to the empty state rather than throwing.

### Phase 10 — what it does not model

A closing block on the page, listing what a reader should not conclude from a
green compile. All of these are real and all are invisible here:

- the ceremony — the tree says 3-of-5, but says nothing about every member
  having to take part to *create* the key
- the birth certificate — a subgroup's parentage is a signed statement, not a
  script, and nothing on-chain checks it
- the derivation — real addresses come off BIP86's unhardened tail under a
  public account step; the simulator names keys and stops
- the 100,000 sat mainnet cap per spend, which is a gate in the app and not in
  the script

**Done when:** the list is on the page and each item says, in one clause, where
the rule actually lives.

## Testing

There is no test runner in this repo — the suite went with the Machankura strip.
Two options, and the first is the honest one for a page of this size:

1. **A `docs/scripts/` node script** that imports the policy builder and asserts
   the mapping for a handful of trees. The builder is pure — tree in, string out
   — and the part most likely to be quietly wrong is exactly the part that needs
   no DOM.
2. Reinstate jest for one file. More ceremony than this earns today, but the
   right answer if the simulator grows.

Either way the cases worth pinning: root unguarded; one guarded child; two
levels with *different* delays; a member wallet under a guarded group; and the
boundary delays 6 and 65,535.

Manual checks that cannot be automated here: the tree at 375px, the compiler
bridge against the real bundle, and the fragment round-trip.

## Order, and what could be cut

Phases 1–6 are the deliverable: a tree and a correct policy. Phase 7 is not
optional — shipping 1–6 without it puts a misleading artefact on a public page.
Phase 8 can slip to a copy button for a release and nobody is stuck. Phases 9
and 10 are genuinely optional, though 10 is cheap and is the kind of honesty the
rest of the site already has.
