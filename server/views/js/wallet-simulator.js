// A tree-builder for a group's wallet structure, above the policy compiler on
// /playground. See docs/group-wallet-simulator.md for the phases and for the
// one thing it must not conflate: a group's t-of-n is off-chain, so the policy
// this emits never contains it.
//
// Vanilla on purpose. The site has no bundler: pug inlines this file into a
// script tag, so it must run as it is written, in a browser, with Materialize
// already loaded and nothing else.

(function (global) {
    "use strict";

    // BIP68 can express a relative lock of at most 65,535 blocks, and Bennu
    // will not take one below 6. Twelve is the app's own default.
    var MIN_DELAY = 6;
    var MAX_DELAY = 65535;
    var DEFAULT_DELAY = 12;

    // ---- state ------------------------------------------------------------
    // One object, redrawn whole. The tree is a few dozen nodes at most, and a
    // full redraw is easier to keep correct than a partial one.

    var state = {
        root: null,
        nextId: 1,
        adding: null, // { parentId, kind, draft }
        selectedId: null,
    };

    // A group's wallet is guarded or not from the moment it is made, and the
    // root answers to nobody, so the root is always unguarded.
    function makeNode(kind, name, overrides) {
        var node = {
            id: "n" + state.nextId++,
            kind: kind,
            name: name,
            members: kind === "member" ? 1 : 3,
            threshold: kind === "member" ? 1 : 2,
            guarded: false,
            delay: DEFAULT_DELAY,
            children: [],
        };
        Object.keys(overrides || {}).forEach(function (k) {
            node[k] = overrides[k];
        });
        return node;
    }

    function eachNode(node, visit, parent) {
        if (!node) return;
        visit(node, parent);
        node.children.forEach(function (child) {
            eachNode(child, visit, node);
        });
    }

    function findNode(id) {
        var found = null;
        eachNode(state.root, function (node) {
            if (node.id === id) found = node;
        });
        return found;
    }

    function hasGuardedChild(node) {
        return node.children.some(function (child) {
            return child.guarded;
        });
    }

    // ---- the policy -------------------------------------------------------

    // One alias per node, derived from its name and made unique across the
    // whole tree in a single pass, so the names in the policy are the names on
    // the cards and two groups called "Treasury" do not collide.
    function aliases() {
        var used = {};
        var map = {};
        eachNode(state.root, function (node) {
            var base = (node.name || "unnamed")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "");
            if (!base) base = "unnamed";
            var name = base;
            var n = 2;
            while (used[name]) name = base + "_" + n++;
            used[name] = true;
            map[node.id] = name;
        });
        return map;
    }

    // Nearest parent first, up to the root. These are the groups holding a leaf
    // over the node, each at the delay it chose for itself.
    function ancestorsOf(id) {
        var chain = [];
        (function walk(node, trail) {
            if (!node) return;
            if (node.id === id) {
                chain = trail.slice().reverse();
                return;
            }
            node.children.forEach(function (child) {
                walk(child, trail.concat([node]));
            });
        })(state.root, []);
        return chain;
    }

    // What the chain is asked to enforce, and nothing more. The quorum is
    // deliberately absent: a group is one taproot key on-chain, and writing
    // thresh(t, ...) here would emit a policy the compiler draws perfectly and
    // that is false. Phase 7 says so on the page.
    function policyFor(node, map) {
        map = map || aliases();
        var self = "pk(" + map[node.id] + ")";
        if (!node.guarded) return self;

        var ancestors = ancestorsOf(node.id);
        if (!ancestors.length) return self;

        var leaves = ancestors.map(function (a) {
            return "and(pk(" + map[a.id] + "),older(" + a.delay + "))";
        });

        // or() is binary, so several guardians nest rather than listing.
        var guards = leaves[leaves.length - 1];
        for (var i = leaves.length - 2; i >= 0; i--) {
            guards = "or(" + leaves[i] + "," + guards + ")";
        }

        // The weights are not decoration. They tell the compiler that the owner
        // is the common case and belongs on the key path, with the guardians in
        // leaves; without them it may pick a shape Bennu would never produce.
        return "or(99@" + self + ",1@" + guards + ")";
    }

    // ---- the bridge to the compiler ---------------------------------------

    // The only code that reaches into the iframe. Every id below belongs to the
    // vendored bdk-cli bundle and a refresh of it may rename any of them, so
    // each one is checked and a miss degrades to a copy button rather than
    // throwing: the tree and the policy are useful on their own, and a broken
    // bridge must not take them down.
    //
    // It is same-origin only because the bundle is served from our own
    // /static/playground/. Point the iframe back at bitcoindevkit.org and this
    // stops working, silently, and the fallback is what the reader gets.
    var compilerBridge = {
        IDS: ["policy", "compile_button", "compiler_script_type", "compiler_aliases", "add_key_alias"],

        doc: function () {
            try {
                var frame = document.querySelector(".simulator-page iframe, iframe");
                return frame && frame.contentDocument;
            } catch (e) {
                return null;
            }
        },

        available: function () {
            var d = this.doc();
            if (!d) return false;
            return this.IDS.every(function (id) {
                return !!d.getElementById(id);
            });
        },

        send: function (policy, names) {
            var d = this.doc();
            if (!d) return false;
            try {
                var box = d.getElementById("compiler_aliases");
                var rows = function () {
                    return box.querySelectorAll("input[name=alias]");
                };
                // One row per alias. The add button lives in the last row and
                // the rows default to "Generate WIF Key", which is what we want:
                // the simulator has names, not keys.
                var guard = 0;
                while (rows().length < names.length && guard++ < 64) {
                    d.getElementById("add_key_alias").click();
                }
                rows().forEach(function (input, i) {
                    if (i >= names.length) return;
                    input.value = names[i];
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                });

                // The compiler offers sh, wsh and sh-wsh — there is no taproot
                // here. P2WSH is the honest closest: the spending conditions are
                // exactly the ones above, and only the wrapper differs from what
                // Bennu builds.
                d.getElementById("compiler_script_type").value = "wsh";
                d.getElementById("policy").value = policy;
                d.getElementById("compile_button").click();
                return true;
            } catch (e) {
                return false;
            }
        },
    };

    // ---- words ------------------------------------------------------------

    // Blocks are ten minutes each, give or take. Everywhere Bennu shows a
    // delay it also says roughly how long that is, because nobody holds a
    // conversion for 4,320 blocks in their head.
    function blockDuration(blocks) {
        var minutes = blocks * 10;
        function about(value, unit) {
            var rounded = Math.round(value);
            return "about " + rounded + " " + unit + (rounded === 1 ? "" : "s");
        }
        if (minutes < 60) return about(minutes, "minute");
        if (minutes < 60 * 24) return about(minutes / 60, "hour");
        if (minutes < 60 * 24 * 60) return about(minutes / (60 * 24), "day");
        if (minutes < 60 * 24 * 365 * 2) return about(minutes / (60 * 24 * 30), "month");
        return about(minutes / (60 * 24 * 365), "year");
    }

    function quorumSentence(node) {
        if (node.kind === "member") return "Spends alone, with one signature.";
        return node.threshold + " of " + node.members + " members must sign.";
    }

    // ---- rendering --------------------------------------------------------

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === "class") node.className = attrs[k];
            else if (k === "text") node.textContent = attrs[k];
            else if (k === "checked") { if (attrs[k]) node.checked = true; }
            else if (k === "disabled") { if (attrs[k]) node.disabled = true; }
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function (child) {
            if (child) node.appendChild(child);
        });
        return node;
    }

    function renderEmpty() {
        return el("div", { class: "simulator-empty center" }, [
            el("p", {
                class: "flow-text",
                text: "Nothing yet. Start with the group at the top — the one that answers to nobody — and hang the rest off it.",
            }),
            el("button", {
                class: "btn black",
                type: "button",
                "data-action": "add-root",
                text: "add a root group",
            }),
        ]);
    }

    function numberField(attrs, label) {
        return el("label", { class: "simulator-field" }, [
            el("span", { text: label }),
            el("input", attrs),
        ]);
    }

    // The form the truncated instruction asked for. Everything on it is a thing
    // Bennu fixes at a child's birth and cannot change afterwards, which is why
    // it is asked here rather than left to the card.
    function renderAddForm(parent) {
        var draft = state.adding.draft;
        var isMember = state.adding.kind === "member";
        var rows = [];

        rows.push(
            el("label", { class: "simulator-field simulator-field-wide" }, [
                el("span", { text: "name" }),
                el("input", {
                    type: "text",
                    value: draft.name,
                    "data-draft": "name",
                    "aria-label": "Name",
                }),
            ])
        );

        if (!isMember) {
            rows.push(
                numberField(
                    {
                        type: "number",
                        value: String(draft.threshold),
                        min: "1",
                        max: String(draft.members),
                        "data-draft": "threshold",
                    },
                    "signatures"
                )
            );
            rows.push(
                numberField(
                    { type: "number", value: String(draft.members), min: "1", "data-draft": "members" },
                    "members"
                )
            );
        }

        var guardChoice;
        if (parent.guarded) {
            // Rule 2: once an ancestor holds a leaf every descendant carries it,
            // so there is no choice left to offer here — only a reason.
            guardChoice = el("p", { class: "simulator-note" }, [
                el("strong", { text: "Guarded, because its parent is. " }),
                el("span", {
                    text:
                        "Every group above a guarded group holds a leaf over it, all the way up, so this cannot be opted out of.",
                }),
            ]);
        } else if (isMember) {
            guardChoice = el("p", { class: "simulator-note" }, [
                el("strong", { text: "Guarded. " }),
                el("span", {
                    text: "Asking a group to guard it is the only reason to make a member wallet here.",
                }),
            ]);
        } else {
            guardChoice = el("label", { class: "simulator-check" }, [
                el("input", {
                    type: "checkbox",
                    "data-draft-toggle": "guarded",
                    checked: draft.guarded,
                }),
                el("span", {
                    text: "Guarded — " + parent.name + " and every group above it can take a coin after a delay",
                }),
            ]);
        }

        var delayRow = null;
        if (draft.guarded) {
            delayRow = el("div", { class: "simulator-delay" }, [
                numberField(
                    {
                        type: "number",
                        value: String(draft.delay),
                        min: String(MIN_DELAY),
                        max: String(MAX_DELAY),
                        "data-draft": "delay",
                    },
                    parent.name + " waits (blocks)"
                ),
                el("span", {
                    class: "simulator-duration",
                    "data-draft-duration": "1",
                    text: blockDuration(draft.delay),
                }),
            ]);
        }

        return el("div", { class: "simulator-form" }, [
            el("div", { class: "simulator-form-title", text: isMember ? "A member wallet" : "A subgroup" }),
            el("div", { class: "simulator-node-fields" }, rows),
            guardChoice,
            delayRow,
            el("div", { class: "simulator-form-actions" }, [
                el("button", {
                    class: "btn black",
                    type: "button",
                    "data-action": "confirm-add",
                    text: "add it",
                }),
                el("a", { href: "#", "data-action": "cancel-add", text: "cancel" }),
            ]),
        ]);
    }

    function renderNode(node) {
        var fields = [
            el("input", {
                type: "text",
                class: "simulator-name-input",
                value: node.name,
                "data-id": node.id,
                "data-field": "name",
                "aria-label": "Name",
            }),
        ];

        if (node.kind === "group") {
            fields.push(
                numberField(
                    {
                        type: "number",
                        class: "simulator-number",
                        value: String(node.threshold),
                        min: "1",
                        max: String(node.members),
                        "data-id": node.id,
                        "data-field": "threshold",
                    },
                    "signatures"
                )
            );
            fields.push(
                numberField(
                    {
                        type: "number",
                        class: "simulator-number",
                        value: String(node.members),
                        min: "1",
                        "data-id": node.id,
                        "data-field": "members",
                    },
                    "members"
                )
            );
        }

        var meta = [
            el("span", {
                class: "simulator-chip",
                text: node.guarded ? "guarded" : "unguarded",
            }),
        ];

        // A node's delay is what its own leaf imposes on everything below it,
        // so it is shown here rather than on the children, and only once it
        // guards something.
        if (hasGuardedChild(node)) {
            meta.push(
                numberField(
                    {
                        type: "number",
                        class: "simulator-number",
                        value: String(node.delay),
                        min: String(MIN_DELAY),
                        max: String(MAX_DELAY),
                        "data-id": node.id,
                        "data-field": "delay",
                    },
                    "waits (blocks)"
                )
            );
            meta.push(
                el("span", {
                    class: "simulator-duration",
                    "data-duration-for": node.id,
                    text: blockDuration(node.delay),
                })
            );
        }

        var controls = null;
        if (node.kind === "group") {
            controls = el("div", { class: "simulator-node-controls" }, [
                el("button", {
                    class: "btn-flat simulator-add",
                    type: "button",
                    "data-action": "add-child",
                    "data-id": node.id,
                    "data-kind": "group",
                    text: "+ subgroup",
                }),
                el("button", {
                    class: "btn-flat simulator-add",
                    type: "button",
                    "data-action": "add-child",
                    "data-id": node.id,
                    "data-kind": "member",
                    text: "+ member wallet",
                }),
            ]);
        }

        var body = [
            el("div", { class: "simulator-node-fields" }, fields),
            el("div", { class: "simulator-node-detail", "data-quorum-for": node.id, text: quorumSentence(node) }),
            el("div", { class: "simulator-node-meta" }, meta),
            controls,
        ];

        if (state.adding && state.adding.parentId === node.id) {
            body.push(renderAddForm(node));
        }

        var card = el(
            "div",
            {
                class: "simulator-node" + (state.selectedId === node.id ? " is-selected" : ""),
                "data-id": node.id,
                "data-action": "select",
            },
            body
        );

        if (!node.children.length) return card;

        return el("div", {}, [
            card,
            el(
                "div",
                { class: "simulator-children" },
                node.children.map(renderNode)
            ),
        ]);
    }

    function renderPolicy() {
        var node = findNode(state.selectedId);
        if (!node) return null;

        var map = aliases();
        var policy = policyFor(node, map);
        var ancestors = node.guarded ? ancestorsOf(node.id) : [];

        var rows = [
            el("tr", {}, [
                el("td", { class: "simulator-alias", text: map[node.id] }),
                el("td", { text: node.name + " itself — the key path" }),
            ]),
        ];
        ancestors.forEach(function (a) {
            rows.push(
                el("tr", {}, [
                    el("td", { class: "simulator-alias", text: map[a.id] }),
                    el("td", {
                        text:
                            a.name +
                            ", after " +
                            a.delay +
                            " blocks (" +
                            blockDuration(a.delay) +
                            ")",
                    }),
                ])
            );
        });

        return el("div", { class: "simulator-policy" }, [
            el("h3", { text: "What the chain enforces for " + node.name }),
            el("code", { class: "simulator-policy-text", text: policy }),
            el("table", { class: "simulator-aliases" }, [el("tbody", {}, rows)]),
            renderOmission(node, map),
            renderCompileControl(node, policy, map),
        ]);
    }

    function renderCompileControl(node, policy, map) {
        var names = [map[node.id]].concat(
            (node.guarded ? ancestorsOf(node.id) : []).map(function (a) {
                return map[a.id];
            })
        );

        if (!compilerBridge.available()) {
            return el("div", { class: "simulator-compile" }, [
                el("button", {
                    class: "btn black",
                    type: "button",
                    "data-action": "copy-policy",
                    "data-policy": policy,
                    text: "copy the policy",
                }),
                el("span", {
                    class: "simulator-note",
                    text: " then paste it into the policy compiler below.",
                }),
            ]);
        }

        return el("div", { class: "simulator-compile" }, [
            el("button", {
                class: "btn black",
                type: "button",
                "data-action": "compile",
                "data-policy": policy,
                "data-names": names.join(","),
                text: "compile it below",
            }),
            el("p", { class: "simulator-note" }, [
                el("span", {
                    text:
                        "The compiler wraps these conditions in P2WSH and generates a key for each name. Bennu uses taproot, so the script it draws is not the one Bennu builds — the conditions inside it are.",
                }),
            ]),
        ]);
    }

    // Without this the simulator is actively misleading, which is why it is
    // drawn with the policy rather than left to a footnote: everything above
    // is the chain's half of the rules, and the group's own half is invisible
    // to it.
    function renderOmission(node, map) {
        // A member wallet is 1 of 1. There is nothing the policy leaves out.
        if (node.kind === "member") return null;

        return el("p", { class: "simulator-omission" }, [
            el("strong", { text: "The quorum is not in there. " }),
            el("span", {
                text:
                    "pk(" +
                    map[node.id] +
                    ") is one signature from a key that " +
                    node.threshold +
                    " of " +
                    node.members +
                    " members have to co-operate to use. That agreement happens off the chain, in the key ceremony, and no policy, descriptor or block explorer can tell it apart from one person's wallet.",
            }),
        ]);
    }

    function renderTree() {
        return el("div", { class: "simulator-tree" }, [
            renderNode(state.root),
            renderPolicy(),
            el("div", { class: "center simulator-reset" }, [
                el("a", { href: "#", "data-action": "reset", text: "start again" }),
            ]),
        ]);
    }

    function render() {
        var mount = document.getElementById("wallet-simulator");
        if (!mount) return;

        mount.innerHTML = "";
        mount.appendChild(state.root ? renderTree() : renderEmpty());
    }

    // ---- actions ----------------------------------------------------------

    var actions = {
        "add-root": function () {
            state.root = makeNode("group", "Group");
            state.selectedId = state.root.id;
            render();
        },
        select: function (target) {
            state.selectedId = target.getAttribute("data-id");
            render();
        },
        reset: function () {
            state.root = null;
            state.nextId = 1;
            state.adding = null;
            state.selectedId = null;
            render();
        },
        "add-child": function (target) {
            var parent = findNode(target.getAttribute("data-id"));
            if (!parent) return;
            var kind = target.getAttribute("data-kind");
            state.adding = {
                parentId: parent.id,
                kind: kind,
                draft: {
                    name: kind === "member" ? "Member" : "Subgroup",
                    threshold: 2,
                    members: 3,
                    // A member wallet is only worth making here if a group
                    // guards it, and a guarded parent leaves no choice at all.
                    guarded: kind === "member" ? true : parent.guarded,
                    delay: parent.delay,
                },
            };
            render();
        },
        compile: function (target) {
            var ok = compilerBridge.send(
                target.getAttribute("data-policy"),
                target.getAttribute("data-names").split(",")
            );
            if (!ok) render();
        },
        "copy-policy": function (target) {
            var policy = target.getAttribute("data-policy");
            if (navigator.clipboard) navigator.clipboard.writeText(policy);
            target.textContent = "copied";
        },
        "cancel-add": function () {
            state.adding = null;
            render();
        },
        "confirm-add": function () {
            var parent = findNode(state.adding.parentId);
            var draft = state.adding.draft;
            if (!parent) return;

            var child = makeNode(state.adding.kind, draft.name || "Unnamed", {
                threshold: state.adding.kind === "member" ? 1 : draft.threshold,
                members: state.adding.kind === "member" ? 1 : draft.members,
                guarded: draft.guarded,
            });
            parent.children.push(child);
            state.selectedId = child.id;
            // The delay belongs to the ancestor doing the guarding, so it is
            // written to the parent rather than to the child it was chosen for.
            if (draft.guarded) parent.delay = draft.delay;

            state.adding = null;
            render();
        },
    };

    function onClick(event) {
        var toggle = event.target.closest("[data-draft-toggle]");
        if (!toggle && event.target.closest("input, label")) {
            // Clicking into a field selects the card it is on, but must not
            // redraw: the redraw would take the caret out of the field again.
            var owner = event.target.closest("[data-id]");
            if (owner && state.selectedId !== owner.getAttribute("data-id")) {
                state.selectedId = owner.getAttribute("data-id");
                var mount = event.currentTarget;
                mount.querySelectorAll(".simulator-node.is-selected").forEach(function (n) {
                    n.classList.remove("is-selected");
                });
                var card = mount.querySelector('.simulator-node[data-id="' + state.selectedId + '"]');
                if (card) card.classList.add("is-selected");
            }
            return;
        }
        if (toggle) {
            state.adding.draft[toggle.getAttribute("data-draft-toggle")] = toggle.checked;
            render();
            return;
        }

        var target = event.target.closest("[data-action]");
        if (!target) return;
        var action = actions[target.getAttribute("data-action")];
        if (!action) return;
        event.preventDefault();
        action(target);
    }

    // The policy is derived from names and delays, which are edited in place, so
    // it is swapped on its own rather than left stale until the next redraw.
    function refreshPolicy(mount) {
        var existing = mount.querySelector(".simulator-policy");
        if (!existing) return;
        var fresh = renderPolicy();
        if (fresh) existing.replaceWith(fresh);
    }

    // A full redraw on every keystroke would take the caret with it, so an edit
    // writes to state and patches only what it derives: the quorum sentence,
    // the duration, the policy, and the other number when a rule pulls it.
    function onInput(event) {
        var draftInput = event.target.closest("[data-draft]");
        if (draftInput && state.adding) {
            var key = draftInput.getAttribute("data-draft");
            if (key === "name") {
                state.adding.draft.name = draftInput.value;
            } else {
                var n = parseInt(draftInput.value, 10);
                if (isNaN(n)) return;
                state.adding.draft[key] = n;
                if (key === "members" && state.adding.draft.threshold > n) {
                    state.adding.draft.threshold = n;
                    var t = event.currentTarget.querySelector('[data-draft="threshold"]');
                    if (t) t.value = String(n);
                }
                if (key === "delay") {
                    var out = event.currentTarget.querySelector("[data-draft-duration]");
                    if (out) out.textContent = blockDuration(n);
                }
            }
            return;
        }

        var input = event.target.closest("[data-field]");
        if (!input) return;
        var node = findNode(input.getAttribute("data-id"));
        if (!node) return;
        var field = input.getAttribute("data-field");

        if (field === "name") {
            node.name = input.value;
            refreshPolicy(event.currentTarget);
            return;
        }

        var value = parseInt(input.value, 10);
        if (isNaN(value)) return;
        node[field] = Math.max(1, value);

        if (field === "delay") {
            var duration = event.currentTarget.querySelector('[data-duration-for="' + node.id + '"]');
            if (duration) duration.textContent = blockDuration(node.delay);
            refreshPolicy(event.currentTarget);
            return;
        }

        // 1 <= threshold <= members, enforced as it is typed rather than on a
        // submit that does not exist.
        if (node.threshold > node.members) {
            node.threshold = node.members;
            var other = event.currentTarget.querySelector(
                '[data-id="' + node.id + '"][data-field="threshold"]'
            );
            if (other) other.value = String(node.threshold);
        }

        var thresholdInput = event.currentTarget.querySelector(
            '[data-id="' + node.id + '"][data-field="threshold"]'
        );
        if (thresholdInput) thresholdInput.setAttribute("max", String(node.members));

        var sentence = event.currentTarget.querySelector('[data-quorum-for="' + node.id + '"]');
        if (sentence) sentence.textContent = quorumSentence(node);

        // The quorum is absent from the policy but named in the sentence under
        // it, so t and n have to reach that one too.
        if (node.id === state.selectedId) refreshPolicy(event.currentTarget);
    }

    // ---- wiring -----------------------------------------------------------

    function init() {
        var mount = document.getElementById("wallet-simulator");
        if (!mount) return;
        mount.addEventListener("click", onClick);
        mount.addEventListener("input", onInput);
        render();
    }

    if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }

    global.WalletSimulator = {
        state: state,
        render: render,
        makeNode: makeNode,
        findNode: findNode,
        quorumSentence: quorumSentence,
        blockDuration: blockDuration,
        aliases: aliases,
        ancestorsOf: ancestorsOf,
        policyFor: policyFor,
        compilerBridge: compilerBridge,
        MIN_DELAY: MIN_DELAY,
        MAX_DELAY: MAX_DELAY,
    };
})(typeof self !== "undefined" ? self : this);
