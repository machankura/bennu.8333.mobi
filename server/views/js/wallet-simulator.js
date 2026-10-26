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
        removing: null, // node id awaiting confirmation
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

    function parentOf(id) {
        var found = null;
        eachNode(state.root, function (node, parent) {
            if (node.id === id) found = parent;
        });
        return found;
    }

    function countBelow(node) {
        var n = 0;
        node.children.forEach(function (child) {
            n += 1 + countBelow(child);
        });
        return n;
    }

    function isWithin(ancestor, id) {
        var found = false;
        eachNode(ancestor, function (node) {
            if (node.id === id) found = true;
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

        // No weights. They said the owner is the common case, which is how a
        // taproot wallet picks its key path -- but this compiler has no taproot
        // option, the block editor's or cannot carry a weight, and compiling
        // this shape with and without them gives the same miniscript. They
        // bought nothing and were the one reason the policy here, the input
        // below, the blocks and the descriptor did not all say the same thing.
        return "or(" + self + "," + guards + ")";
    }

    // ---- sharing ----------------------------------------------------------

    // A tree is the kind of thing somebody pastes into a chat to ask "is this
    // what we want?", so it travels in the url. In the fragment rather than the
    // query string: it never reaches a server, and there is no server here to
    // reach.
    //
    // The shape is positional rather than an object per node, because the same
    // tree as {"kind":"group","name":...} runs to several times the length and
    // this ends up in a chat message.
    function serialise(node) {
        return [
            node.kind === "member" ? 1 : 0,
            node.name,
            node.threshold,
            node.members,
            node.guarded ? 1 : 0,
            node.delay,
            node.children.map(serialise),
        ];
    }

    // Anything out of range is clamped rather than rejected: a hand-edited
    // fragment should not be able to produce a tree the editor itself refuses
    // to make, and silently fixing it beats an error page over a toy.
    function deserialise(row, parentGuarded) {
        if (!Array.isArray(row) || row.length < 7) throw new Error("bad node");
        var kind = row[0] === 1 ? "member" : "group";
        var members = Math.max(1, parseInt(row[3], 10) || 1);
        var node = makeNode(kind, String(row[1] || "Unnamed"), {
            members: kind === "member" ? 1 : members,
            threshold:
                kind === "member" ? 1 : Math.min(members, Math.max(1, parseInt(row[2], 10) || 1)),
            // Rule 2 again, this time against whatever a url claims: a child of
            // a guarded parent is guarded whatever the fragment says.
            guarded: parentGuarded ? true : row[4] === 1,
            delay: Math.min(MAX_DELAY, Math.max(MIN_DELAY, parseInt(row[5], 10) || DEFAULT_DELAY)),
        });
        node.children = (row[6] || []).map(function (child) {
            return deserialise(child, node.guarded);
        });
        return node;
    }

    function encode(text) {
        var bytes = new TextEncoder().encode(text);
        var binary = "";
        bytes.forEach(function (b) {
            binary += String.fromCharCode(b);
        });
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function decode(text) {
        var padded = text.replace(/-/g, "+").replace(/_/g, "/");
        while (padded.length % 4) padded += "=";
        var binary = atob(padded);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }

    // The selection decides which node's conditions are shown and compiled, so a
    // link without it arrives showing the root -- not the node the sender was
    // looking at when they copied it. It travels as a path of child indices,
    // which survives the ids being reassigned on the way back in.
    function pathTo(id) {
        var path = null;
        (function walk(node, trail) {
            if (!node || path) return;
            if (node.id === id) {
                path = trail;
                return;
            }
            node.children.forEach(function (child, i) {
                walk(child, trail.concat([i]));
            });
        })(state.root, []);
        return path || [];
    }

    function nodeAtPath(path) {
        var node = state.root;
        for (var i = 0; i < path.length; i++) {
            if (!node || !node.children[path[i]]) return null;
            node = node.children[path[i]];
        }
        return node;
    }

    function syncFragment() {
        if (typeof history === "undefined" || !history.replaceState) return;
        var payload = state.root ? { t: serialise(state.root), s: pathTo(state.selectedId) } : null;
        var fragment = payload ? "#tree=" + encode(JSON.stringify(payload)) : "";
        history.replaceState(null, "", location.pathname + location.search + fragment);
    }

    // A fragment that will not parse is not worth an error: the page falls back
    // to the empty state, which is where a reader with a broken link should be.
    function readFragment() {
        try {
            var match = /(?:^|#|&)tree=([^&]+)/.exec(location.hash || "");
            if (!match) return false;
            var payload = JSON.parse(decode(match[1]));
            // Links made before the selection travelled are a bare tree. They
            // still open, on the root.
            var rows = Array.isArray(payload) ? payload : payload.t;
            var path = Array.isArray(payload) ? [] : payload.s || [];
            state.root = deserialise(rows, false);
            var selected = nodeAtPath(path);
            state.selectedId = (selected || state.root).id;
            return true;
        } catch (e) {
            state.root = null;
            state.selectedId = null;
            return false;
        }
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

        // The visual editor is the most legible of the three views, and leaving
        // it on its default example while the policy below it says something
        // else is worse than not drawing at all. The bundle's own loadPolicy
        // does it, reached through the one line this repo patches into the
        // vendored file; without that line the blocks simply stay put.
        draw: function (ast) {
            try {
                var frame = document.querySelector(".simulator-page iframe, iframe");
                var w = frame && frame.contentWindow;
                if (!w || !w.__descriptorPolicy || !w.__descriptorPolicy.loadPolicy) return false;
                w.__descriptorPolicy.loadPolicy(ast);
                return true;
            } catch (e) {
                return false;
            }
        },

        // Two different questions, and the compile control needs both answered.
        //
        // available() asks whether the ids are there at all. On a cold load the
        // iframe's contentDocument is about:blank until the real document
        // commits -- 46ms on localhost, and as long as the network takes over
        // the wire -- so it is false while the panel first renders, and the
        // compile controls are left out of a tree built in that window. This
        // polls for it and fires once, so they appear.
        whenAvailable: function (run) {
            var self = this;
            var tries = 0;
            (function poll() {
                if (self.available()) return run();
                if (tries++ > 240) return;
                setTimeout(poll, 250);
            })();
        },

        // The bundle is a 5MB wasm download and a Blockly workspace built after
        // it, so a link opened cold is interactive here long before the
        // compiler below exists. __descriptorPolicy appears when the chunk
        // executes, which is earlier still -- the workspace it draws into is
        // the thing worth waiting for, and a rendered block is the only
        // evidence of it from outside.
        whenReady: function (run) {
            var self = this;
            var tries = 0;
            (function poll() {
                var d = self.doc();
                var frame = document.querySelector(".simulator-page iframe, iframe");
                var w = frame && frame.contentWindow;
                var ready =
                    d &&
                    w &&
                    w.__descriptorPolicy &&
                    self.available() &&
                    d.querySelector("#blocklyDiv .blocklyDraggable");
                if (ready) return run();
                // ~30s, then give up quietly: the compile button still works,
                // and a visitor who waited that long has one to press.
                if (tries++ > 120) return;
                setTimeout(poll, 250);
            })();
        },

        send: function (policy, ast, names) {
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
                // Draw first. Loading the blocks makes Blockly write its own
                // rendering of them back into #policy, and its or blocks carry
                // no weights, so drawing afterwards would leave the input
                // showing an unweighted policy that is not the one just
                // compiled.
                this.draw(ast);

                d.getElementById("compiler_script_type").value = "wsh";
                d.getElementById("policy").value = policy;
                d.getElementById("compile_button").click();
                return true;
            } catch (e) {
                return false;
            }
        },
    };

    // The same conditions as policyFor, in the shape the vendored bundle's
    // policyToXml walks: {type:'pk',alias}, {type:'older',value},
    // {type:'and'|'or',subs:[a,b]}. Built from the tree rather than parsed back
    // out of the string, so the two cannot drift into disagreeing.
    //
    function policyAstFor(node, map) {
        map = map || aliases();
        var self = { type: "pk", alias: map[node.id] };
        if (!node.guarded) return self;

        var ancestors = ancestorsOf(node.id);
        if (!ancestors.length) return self;

        var leaves = ancestors.map(function (a) {
            return {
                type: "and",
                subs: [{ type: "pk", alias: map[a.id] }, { type: "older", value: a.delay }],
            };
        });

        var guards = leaves[leaves.length - 1];
        for (var i = leaves.length - 2; i >= 0; i--) {
            guards = { type: "or", subs: [leaves[i], guards] };
        }

        return { type: "or", subs: [self, guards] };
    }

    // ---- the taproot tree -------------------------------------------------

    // The output the hierarchy produces, as bennu-kmp/docs/group-wallet-guardians.md
    // specifies it: an internal key with one leaf per ancestor hanging off a
    // merkle root. Four of its properties are decisions rather than defaults.
    //
    // The leaves form a *caterpillar*, not a balanced tree, and the nearest
    // ancestor sits shallowest -- every ancestor can act at the same moment, so
    // the shape costs nothing in policy and only in bytes, and the parent is
    // the one most likely to ever spend. One ancestor is a tree of one leaf at
    // depth 0, not a branch with a single child. And an unguarded wallet has no
    // tree at all.
    function taprootTreeFor(node, map) {
        map = map || aliases();
        var ancestors = node.guarded ? ancestorsOf(node.id) : [];
        var k = ancestors.length;

        return {
            guarded: node.guarded && k > 0,
            key: { alias: map[node.id], name: node.name },
            leaves: ancestors.map(function (a, i) {
                return {
                    alias: map[a.id],
                    name: a.name,
                    delay: a.delay,
                    // Down the spine one level per ancestor, except the last,
                    // which shares the depth of the one before it: the final
                    // branch carries two leaves, not one leaf and a stub.
                    depth: i === k - 1 ? Math.max(0, k - 1) : i + 1,
                };
            }),
        };
    }

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

    // Drawn here rather than taken from the Material Icons font the layout
    // loads. Until that font arrives these links read "clearstart again" in
    // literal words, and if Google is slow or blocked they stay that way; an
    // inline path renders with the first paint and owes nothing to anyone.
    // currentColor keeps them the same ink as the link they sit in.
    function icon(d) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("class", "simulator-icon");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        svg.appendChild(path);
        return svg;
    }

    var ICON_CLEAR = "M7 7l10 10M17 7L7 17";
    var ICON_TRASH = "M5.5 7.5h13M10 7.5v-2h4v2M7.6 7.5l.8 11.3h7.2l.8-11.3";
    var ICON_LINK = "M10 7H7.5a4.5 4.5 0 0 0 0 9H10M14 7h2.5a4.5 4.5 0 0 1 0 9H14M8.5 11.5h7";

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
                el("button", {
                    class: "btn-flat simulator-quiet",
                    type: "button",
                    "data-action": "cancel-add",
                    text: "cancel",
                }),
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

        var buttons = [];
        if (node.kind === "group") {
            buttons.push(
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
                })
            );
        }

        // Compiling is a thing done to a node, like adding a child to one, so
        // it sits in the same row rather than at the foot of the tree where it
        // meant "the selected one, wherever that is". It gives a member wallet
        // a controls row of its own, which it had no reason to have before and
        // which is the node most worth compiling: it is the guarded one.
        if (compilerBridge.available()) {
            buttons.push(
                el("button", {
                    class: "btn black simulator-compile-node",
                    type: "button",
                    "data-action": "compile",
                    "data-id": node.id,
                    text: "compile",
                })
            );
        }

        // The root has no remove: it is the whole tree, and "start again"
        // already says that in words.
        if (node !== state.root) {
            buttons.push(
                el("button", {
                    class: "btn-flat simulator-add simulator-remove",
                    type: "button",
                    "data-action": "remove",
                    "data-id": node.id,
                    title: "Remove this wallet",
                }, [icon(ICON_TRASH), el("span", { text: "remove" })])
            );
        }

        var controls = buttons.length
            ? el("div", { class: "simulator-node-controls" }, buttons)
            : null;

        // Taking a node takes everything under it -- nothing is re-parented,
        // because a group's children are guarded by *it*, and hanging them on
        // their grandparent would silently rewrite the terms they were made
        // under. So a node with anything below it says how much goes.
        if (state.removing === node.id) {
            var below = countBelow(node);
            controls = el("div", { class: "simulator-node-controls simulator-confirm" }, [
                el("span", {
                    class: "simulator-note",
                    text:
                        "Remove " +
                        (node.name || "this") +
                        " and the " +
                        below +
                        (below === 1 ? " wallet" : " wallets") +
                        " under it?",
                }),
                el("button", {
                    class: "btn black simulator-compile-node",
                    type: "button",
                    "data-action": "confirm-remove",
                    "data-id": node.id,
                    text: "remove",
                }),
                el("button", {
                    class: "btn-flat simulator-quiet",
                    type: "button",
                    "data-action": "cancel-remove",
                    text: "cancel",
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

    var SVG_NS = "http://www.w3.org/2000/svg";

    function svgEl(tag, attrs) {
        var node = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === "text") node.textContent = attrs[k];
            else node.setAttribute(k, attrs[k]);
        });
        return node;
    }

    function svgBox(x, y, label, kind) {
        var g = svgEl("g", { class: "tap-" + kind });
        g.appendChild(
            svgEl("rect", { x: x - 42, y: y - 11, width: 84, height: 22, rx: 4 })
        );
        g.appendChild(
            svgEl("text", { x: x, y: y + 4, "text-anchor": "middle", text: label })
        );
        return g;
    }

    function svgLine(x1, y1, x2, y2) {
        return svgEl("line", { x1: x1, y1: y1, x2: x2, y2: y2 });
    }

    function shorten(text, n) {
        return text.length > n ? text.slice(0, n - 1) + "…" : text;
    }

    // Drawn with strokes rather than the bordered cards the group tree uses, so
    // the two trees on this page cannot be mistaken for each other: one is the
    // groups, this is the script.
    function renderTaprootDiagram(tree) {
        var k = tree.leaves.length;
        var rows = k <= 1 ? 2 : k + 1;
        var rowY = function (r) {
            return 26 + r * 46;
        };
        var LEFT = 74;
        var MID = 160;
        var RIGHT = 246;
        var height = rowY(rows - 1) + 22;

        var svg = svgEl("svg", {
            class: "tap-tree",
            viewBox: "0 0 320 " + height,
            role: "img",
            "aria-label":
                "The taproot output for " +
                tree.key.name +
                ": an internal key with " +
                k +
                (k === 1 ? " guardian leaf" : " guardian leaves"),
        });

        var edges = svgEl("g", { class: "tap-edges" });
        var boxes = svgEl("g", {});

        // Q over the key path and the script root.
        edges.appendChild(svgLine(MID, rowY(0) + 11, LEFT, rowY(1) - 11));
        edges.appendChild(svgLine(MID, rowY(0) + 11, RIGHT, rowY(1) - 11));
        boxes.appendChild(svgBox(MID, rowY(0), "Q", "out"));
        boxes.appendChild(svgBox(LEFT, rowY(1), "P", "key"));

        if (k === 1) {
            boxes.appendChild(
                svgBox(RIGHT, rowY(1), shorten(tree.leaves[0].alias, 11), "leaf")
            );
        } else {
            // The spine: a branch per level, with a leaf hanging off each, and
            // the last branch carrying two leaves rather than one.
            for (var r = 1; r <= k - 1; r++) {
                boxes.appendChild(
                    svgEl("circle", { cx: RIGHT, cy: rowY(r), r: 5, class: "tap-branch" })
                );
                edges.appendChild(svgLine(RIGHT, rowY(r) + 5, MID, rowY(r + 1) - 11));
                edges.appendChild(svgLine(RIGHT, rowY(r) + 5, RIGHT, rowY(r + 1) - (r === k - 1 ? 11 : 5)));
            }
            for (var i = 0; i < k - 1; i++) {
                boxes.appendChild(
                    svgBox(MID, rowY(2 + i), shorten(tree.leaves[i].alias, 11), "leaf")
                );
            }
            boxes.appendChild(
                svgBox(RIGHT, rowY(k), shorten(tree.leaves[k - 1].alias, 11), "leaf")
            );
        }

        svg.appendChild(edges);
        svg.appendChild(boxes);
        return svg;
    }

    function renderTaproot(node, map) {
        var tree = taprootTreeFor(node, map);
        if (!tree.guarded) return null;

        return el("div", { class: "simulator-taproot" }, [
            el("h3", { text: "The taproot output" }),
            el("p", {
                class: "simulator-note",
                text:
                    "One leaf per group above " +
                    node.name +
                    ", nearest first. The leaves lean to one side rather than balancing: every guardian can act at the same moment, so the shape costs nothing but bytes.",
            }),
            renderTaprootDiagram(tree),
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
            renderTaproot(node, map),
        ]);
    }

    function aliasNames(node, map) {
        return [map[node.id]].concat(
            (node.guarded ? ancestorsOf(node.id) : []).map(function (a) {
                return map[a.id];
            })
        );
    }

    function renderCompileControl(node, policy, map) {
        // With no bridge there is nothing to press on the nodes, so the way
        // through is here, beside the policy it copies.
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

        return el("p", { class: "simulator-note simulator-compile" }, [
            el("span", {
                text:
                    "Compile on any node to draw it below. The compiler wraps these conditions in P2WSH and generates a key for each name; Bennu uses taproot, so the script it draws is not the one Bennu builds — the conditions inside it are.",
            }),
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
                el("button", { class: "btn-flat simulator-quiet", type: "button", "data-action": "copy-link" }, [
                    icon(ICON_LINK),
                    el("span", { text: "copy a link to this tree" }),
                ]),
                el("button", { class: "btn-flat simulator-quiet", type: "button", "data-action": "reset" }, [
                    icon(ICON_CLEAR),
                    el("span", { text: "start again" }),
                ]),
            ]),
        ]);
    }

    function render() {
        var mount = document.getElementById("wallet-simulator");
        if (!mount) return;

        mount.innerHTML = "";
        mount.appendChild(state.root ? renderTree() : renderEmpty());
        syncFragment();
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
            state.removing = null;
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
                    // Guarded by default, for every wallet that can be. A
                    // group guarding what it makes is the arrangement Bennu is
                    // for, and under an unguarded parent this is still a
                    // checkbox rather than a rule. Under a guarded one there
                    // was never a choice, and the root cannot be guarded at
                    // all: nothing stands above it to hold a leaf.
                    guarded: true,
                    delay: parent.delay,
                },
            };
            render();
        },
        compile: function (target) {
            var node = findNode(target.getAttribute("data-id"));
            if (!node) return;
            // Compiling a node is also how you pick it: the policy above the
            // compiler has to be the one that was just drawn.
            state.selectedId = node.id;
            render();
            // The ids the bridge checks are in the static html, so it reports
            // itself available long before the wasm behind them is. An early
            // press waits rather than quietly doing nothing.
            compilerBridge.whenReady(function () {
                var map = aliases();
                compilerBridge.send(policyFor(node, map), policyAstFor(node, map), aliasNames(node, map));
            });
        },
        "copy-link": function (target) {
            syncFragment();
            if (navigator.clipboard) navigator.clipboard.writeText(location.href);
            // The link carries an icon now, so only its label changes.
            var label = target.querySelector("span");
            if (label) label.textContent = "link copied";
        },
        "copy-policy": function (target) {
            var policy = target.getAttribute("data-policy");
            if (navigator.clipboard) navigator.clipboard.writeText(policy);
            target.textContent = "copied";
        },
        remove: function (target) {
            var node = findNode(target.getAttribute("data-id"));
            if (!node) return;
            // A leaf goes without asking; anything carrying others asks first,
            // which is the only case where a mis-click costs real work.
            if (countBelow(node)) {
                state.removing = node.id;
                render();
                return;
            }
            removeNode(node);
        },
        "confirm-remove": function (target) {
            var node = findNode(target.getAttribute("data-id"));
            if (node) removeNode(node);
        },
        "cancel-remove": function () {
            state.removing = null;
            render();
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

    function removeNode(node) {
        var parent = parentOf(node.id);
        if (!parent) return;

        // The selection may be the node itself or anything beneath it, and
        // either way it is about to stop existing. The parent is where
        // attention goes: it is what is left where the node was.
        if (isWithin(node, state.selectedId)) state.selectedId = parent.id;

        parent.children = parent.children.filter(function (child) {
            return child !== node;
        });
        state.removing = null;
        if (state.adding && !findNode(state.adding.parentId)) state.adding = null;
        render();
    }

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
            syncFragment();
            return;
        }

        var value = parseInt(input.value, 10);
        if (isNaN(value)) return;
        node[field] = Math.max(1, value);

        if (field === "delay") {
            var duration = event.currentTarget.querySelector('[data-duration-for="' + node.id + '"]');
            if (duration) duration.textContent = blockDuration(node.delay);
            refreshPolicy(event.currentTarget);
            syncFragment();
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
        syncFragment();
    }

    // ---- wiring -----------------------------------------------------------

    function compileSelected() {
        var node = findNode(state.selectedId);
        if (!node) return;
        var map = aliases();
        compilerBridge.send(policyFor(node, map), policyAstFor(node, map), aliasNames(node, map));
    }

    function init() {
        var mount = document.getElementById("wallet-simulator");
        if (!mount) return;
        mount.addEventListener("click", onClick);
        mount.addEventListener("input", onInput);

        // A link carries a tree, and the whole point of sending one is the
        // picture it makes: so a tree that arrived in the url compiles itself
        // once the compiler below is up, rather than waiting for a button the
        // sender already knows the answer to. A tree built here by hand does
        // not — that would recompile on every edit.
        var restored = readFragment();
        render();

        // The first render almost always happens before the iframe has a
        // document, so the controls it decided to leave out have to be put back
        // once there is one. Redrawing under a caret would take it out of the
        // field, so this waits for the panel to not hold focus -- it fires
        // within a second or two of load, when nobody is usually typing, but a
        // name being typed is exactly when a surprise redraw hurts most.
        compilerBridge.whenAvailable(function reRender() {
            if (mount.contains(document.activeElement)) return setTimeout(reRender, 500);
            render();
        });

        if (restored) compilerBridge.whenReady(compileSelected);
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
        policyAstFor: policyAstFor,
        taprootTreeFor: taprootTreeFor,
        compilerBridge: compilerBridge,
        serialise: serialise,
        deserialise: deserialise,
        MIN_DELAY: MIN_DELAY,
        MAX_DELAY: MAX_DELAY,
    };
})(typeof self !== "undefined" ? self : this);
