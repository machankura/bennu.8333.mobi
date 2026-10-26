#!/usr/bin/env node

// The policy builder is the part of the simulator most likely to be quietly
// wrong: it is pure, it has no DOM in it, and a mistake in it produces a policy
// the compiler draws perfectly and that says the wrong thing.
//
//     node docs/scripts/policy-cases.js
//
// There is no test runner in this repo — the suite went with the Machankura
// strip — so this is a script that exits non-zero. If the simulator grows past
// this, reinstate jest for it.

const path = require("path");

// The simulator hangs itself off the global and only touches the DOM inside
// init(), behind a `typeof document` check, so it loads under node as it is.
global.self = global;
require(path.resolve(__dirname, "../../server/views/js/wallet-simulator.js"));
const S = global.WalletSimulator;

let failures = 0;

function check(name, actual, expected) {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(ok ? "  ok  " : " FAIL ", name);
    if (!ok) {
        console.log("        expected:", expected);
        console.log("        actual:  ", actual);
    }
}

// Builds a tree directly in the simulator's state, the way the UI would.
function tree(build) {
    S.state.root = null;
    S.state.nextId = 1;
    const make = (kind, name, props) => Object.assign(S.makeNode(kind, name), props || {});
    const root = make("group", "Root");
    S.state.root = root;
    build(root, make);
    return root;
}

console.log("policy cases");

// A root is unguarded by definition: it answers to nobody, so nobody holds a
// leaf over it, and on-chain it is one key like any other wallet.
{
    const root = tree(() => {});
    check("root is a bare key", S.policyFor(root), "pk(root)");
}

// One guardian: the owner on the key path, the parent in a leaf behind its own
// delay. The weights push the owner to the key path.
{
    let child;
    const root = tree((r, make) => {
        child = make("group", "Child", { guarded: true });
        r.delay = 12;
        r.children.push(child);
    });
    check(
        "one guardian",
        S.policyFor(child),
        "or(pk(child),and(pk(root),older(12)))"
    );
}

// Two levels, and the delays must not be shared: each ancestor keeps the number
// it chose as its key passes down the tree.
{
    let grandchild;
    const root = tree((r, make) => {
        const mid = make("group", "Mid", { guarded: true, delay: 12 });
        grandchild = make("group", "Leaf", { guarded: true });
        mid.children.push(grandchild);
        r.delay = 144;
        r.children.push(mid);
    });
    check(
        "two guardians keep their own delays",
        S.policyFor(grandchild),
        "or(pk(leaf),or(and(pk(mid),older(12)),and(pk(root),older(144))))"
    );
}

// A member wallet spends alone and is guarded by the group above it; on-chain
// it is the same shape as a guarded subgroup.
{
    let wallet;
    const root = tree((r, make) => {
        const group = make("group", "Treasury", { guarded: true, delay: 6 });
        wallet = make("member", "Alice", { guarded: true });
        group.children.push(wallet);
        r.delay = 144;
        r.children.push(group);
    });
    check(
        "member wallet under a guarded group",
        S.policyFor(wallet),
        "or(pk(alice),or(and(pk(treasury),older(6)),and(pk(root),older(144))))"
    );
}

// The quorum is off-chain. Changing it must not change a single character.
{
    let child;
    const root = tree((r, make) => {
        child = make("group", "Child", { guarded: true });
        r.delay = 12;
        r.children.push(child);
    });
    const before = S.policyFor(child);
    S.state.root.threshold = 5;
    S.state.root.members = 9;
    child.threshold = 4;
    child.members = 7;
    check("the quorum is not in the policy", S.policyFor(child), before);
}

// Names collide; aliases must not.
{
    let a, b;
    const root = tree((r, make) => {
        a = make("group", "Treasury", { guarded: true });
        b = make("group", "Treasury", { guarded: true });
        r.delay = 12;
        r.children.push(a, b);
    });
    const map = S.aliases();
    check("colliding names get distinct aliases", map[a.id] !== map[b.id], true);
    check("the second is suffixed", map[b.id], "treasury_2");
}

// The delay boundaries BIP68 and Bennu allow.
{
    let child;
    tree((r, make) => {
        child = make("group", "Child", { guarded: true });
        r.delay = S.MIN_DELAY;
        r.children.push(child);
    });
    check("minimum delay", S.policyFor(child), "or(pk(child),and(pk(root),older(6)))");
    S.state.root.delay = S.MAX_DELAY;
    check("maximum delay", S.policyFor(child), "or(pk(child),and(pk(root),older(65535)))");
}

// The AST the blocks are drawn from has to say the same thing as the string,
// or the picture and the text disagree about the same tree.
console.log("block tree cases");
{
    let grandchild;
    tree((r, make) => {
        const mid = make("group", "Mid", { guarded: true, delay: 12 });
        grandchild = make("group", "Leaf", { guarded: true });
        mid.children.push(grandchild);
        r.delay = 144;
        r.children.push(mid);
    });
    const ast = S.policyAstFor(grandchild);
    check(
        "ast mirrors the string",
        JSON.stringify(ast),
        JSON.stringify({
            type: "or",
            subs: [
                { type: "pk", alias: "leaf" },
                {
                    type: "or",
                    subs: [
                        { type: "and", subs: [{ type: "pk", alias: "mid" }, { type: "older", value: 12 }] },
                        { type: "and", subs: [{ type: "pk", alias: "root" }, { type: "older", value: 144 }] },
                    ],
                },
            ],
        })
    );

    // Every node type in it must be one the bundle's policyToXml can draw.
    const drawable = new Set(["pk", "older", "after", "and", "or", "thresh"]);
    let unknown = [];
    (function walk(n) {
        if (!drawable.has(n.type)) unknown.push(n.type);
        (n.subs || []).forEach(walk);
    })(ast);
    check("every node type is drawable", unknown.join(",") || "none", "none");
}

{
    const root = tree(() => {});
    check("an unguarded root is a single pk block", JSON.stringify(S.policyAstFor(root)), JSON.stringify({ type: "pk", alias: "root" }));
}

console.log("duration cases");
check("6 blocks", S.blockDuration(6), "about 1 hour");
check("12 blocks", S.blockDuration(12), "about 2 hours");
check("144 blocks", S.blockDuration(144), "about 1 day");
check("1008 blocks", S.blockDuration(1008), "about 7 days");

if (failures) {
    console.log("\n" + failures + " failed");
    process.exit(1);
}
console.log("\nall passed");
