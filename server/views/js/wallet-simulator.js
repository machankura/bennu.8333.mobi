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

    function eachNode(node, visit) {
        if (!node) return;
        visit(node);
        node.children.forEach(function (child) {
            eachNode(child, visit);
        });
    }

    function findNode(id) {
        var found = null;
        eachNode(state.root, function (node) {
            if (node.id === id) found = node;
        });
        return found;
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

    function numberField(node, field, label, min, max) {
        var input = el("input", {
            type: "number",
            class: "simulator-number",
            value: String(node[field]),
            min: String(min),
            max: String(max),
            "data-id": node.id,
            "data-field": field,
        });
        return el("label", { class: "simulator-field" }, [
            el("span", { text: label }),
            input,
        ]);
    }

    function renderNode(node) {
        var name = el("input", {
            type: "text",
            class: "simulator-name-input",
            value: node.name,
            "data-id": node.id,
            "data-field": "name",
            "aria-label": "Name",
        });

        var fields = [name];
        if (node.kind === "group") {
            fields.push(numberField(node, "threshold", "signatures", 1, node.members));
            fields.push(numberField(node, "members", "members", 1, 999));
        }

        return el("div", { class: "simulator-node", "data-id": node.id }, [
            el("div", { class: "simulator-node-fields" }, fields),
            el("div", {
                class: "simulator-node-detail",
                "data-quorum-for": node.id,
                text: quorumSentence(node),
            }),
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

    // A full redraw on every keystroke would take the caret with it, so an edit
    // writes to state and patches only what it derives: the quorum sentence,
    // and the other number when a rule pulls it.
    function onInput(event) {
        var input = event.target.closest("[data-field]");
        if (!input) return;
        var node = findNode(input.getAttribute("data-id"));
        if (!node) return;
        var field = input.getAttribute("data-field");

        if (field === "name") {
            node.name = input.value;
            return;
        }

        var value = parseInt(input.value, 10);
        if (isNaN(value)) return;
        node[field] = Math.max(1, value);

        // 1 <= threshold <= members, enforced as it is typed rather than on a
        // submit that does not exist. Lowering the members pulls the threshold
        // down with it; nothing else can be out of range.
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

        var sentence = event.currentTarget.querySelector(
            '[data-quorum-for="' + node.id + '"]'
        );
        if (sentence) sentence.textContent = quorumSentence(node);
    }

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
    };
})(typeof self !== "undefined" ? self : this);
