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

    // ---- state ------------------------------------------------------------
    // One object, redrawn whole. The tree is a few dozen nodes at most, and a
    // full redraw is easier to keep correct than a partial one.

    var state = {
        root: null,
        nextId: 1,
    };

    // A group's wallet is guarded or not from the moment it is made, and the
    // root answers to nobody, so the root is always unguarded.
    function makeNode(kind, name) {
        return {
            id: "n" + state.nextId++,
            kind: kind,
            name: name,
            members: kind === "member" ? 1 : 3,
            threshold: kind === "member" ? 1 : 2,
            guarded: false,
            delay: 12,
            children: [],
        };
    }

    // ---- rendering --------------------------------------------------------

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === "class") node.className = attrs[k];
            else if (k === "text") node.textContent = attrs[k];
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function (child) {
            node.appendChild(child);
        });
        return node;
    }

    function quorumSentence(node) {
        if (node.kind === "member") return "Spends alone, with one signature.";
        return node.threshold + " of " + node.members + " members must sign.";
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

    function renderNode(node) {
        return el("div", { class: "simulator-node", "data-id": node.id }, [
            el("div", { class: "simulator-node-name", text: node.name }),
            el("div", { class: "simulator-node-detail", text: quorumSentence(node) }),
        ]);
    }

    function renderTree() {
        return el("div", { class: "simulator-tree" }, [
            renderNode(state.root),
            el("div", { class: "center simulator-reset" }, [
                el("a", {
                    href: "#",
                    "data-action": "reset",
                    text: "start again",
                }),
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
            render();
        },
        reset: function () {
            state.root = null;
            state.nextId = 1;
            render();
        },
    };

    function onClick(event) {
        var target = event.target.closest("[data-action]");
        if (!target) return;
        var action = actions[target.getAttribute("data-action")];
        if (!action) return;
        event.preventDefault();
        action(target);
    }

    // ---- wiring -----------------------------------------------------------

    function init() {
        var mount = document.getElementById("wallet-simulator");
        if (!mount) return;
        mount.addEventListener("click", onClick);
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
    };
})(typeof self !== "undefined" ? self : this);
