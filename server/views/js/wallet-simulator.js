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
    };

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

    function render() {
        var mount = document.getElementById("wallet-simulator");
        if (!mount) return;

        mount.innerHTML = "";
        mount.appendChild(renderEmpty());
    }

    // ---- wiring -----------------------------------------------------------

    function init() {
        var mount = document.getElementById("wallet-simulator");
        if (!mount) return;
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
    };
})(typeof self !== "undefined" ? self : this);
