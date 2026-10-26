#!/usr/bin/env node

// Renders the Bennu pages to a folder of flat HTML files that any static host
// will serve, GitHub Pages included. The pug views stay the single source: this
// is the same layout the express app renders, with the absolute asset paths
// rewritten relative so the output works at a domain root and under a
// /repository/ path alike.
//
//     node scripts/build-static.js [outDir]
//
// Five pages is the whole site, so this builds all of it; the express app in
// server/ renders the same views and exists only to save a build while editing.

const fs = require("fs")
const path = require("path")
const pug = require("pug")

const root = path.resolve(__dirname, "..")
const views = path.join(root, "server", "views")
const staticDir = path.join(root, "server", "static")
const out = path.resolve(root, process.argv[2] || "dist")

const DOMAIN = "bennu.8333.mobi"

const pages = [
    { view: "home.pug", file: "index.html", title: "Bennu" },
    { view: "brand.pug", file: "brand.html", title: "Brand - Bennu" },
    { view: "faq.pug", file: "faqs.html", title: "Frequently Asked Questions - Bennu" },
    { view: "visualize.pug", file: "visualize.html", title: "Visualize - Bennu" },
    { view: "404.pug", file: "404.html", title: "Page Not Found - Bennu" },
]

// Everything the built pages load. Listed rather than copied wholesale: the
// static folder also holds the audio, the user manual and the intl-tel assets,
// none of which Bennu's pages reference.
const assets = [
    "css/materialize.min.css",
    "js/materialize.min.js",
    "img/logo.svg",
    "img/logo-white.svg",
    "img/logo-flame.svg",
    "img/app/chats.png",
    "img/app/ceremony.png",
    "img/app/wallet.png",
    "img/app/group.png",
    "img/icon/favicon.ico",
    "img/icon/favicon-16x16.png",
    "img/icon/favicon-32x32.png",
    "img/icon/apple-touch-icon.png",
    "img/icon/android-chrome-192x192.png",
    "img/icon/android-chrome-512x512.png",
    "img/icon/site.webmanifest",
]

// The server routes by path; a flat file tree cannot, so the internal links
// become their file names. Anything else absolute is an asset.
const links = [
    [/href="\/"/g, 'href="index.html"'],
    [/href="\/brand"/g, 'href="brand.html"'],
    [/href="\/faqs"/g, 'href="faqs.html"'],
    [/href="\/visualize"/g, 'href="visualize.html"'],
    [/(href|src)="\/static\//g, '$1="static/'],
]

function relativise(html) {
    return links.reduce((acc, [pattern, to]) => acc.replace(pattern, to), html)
}

function copy(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

for (const page of pages) {
    const html = pug.renderFile(path.join(views, page.view), {
        basedir: views,
        pageTitle: page.title,
        user: null,
        affiliateName: null,
    })
    fs.writeFileSync(path.join(out, page.file), relativise(html))
    console.log("rendered", page.file)
}

for (const asset of assets) {
    copy(path.join(staticDir, asset), path.join(out, "static", asset))
}
console.log("copied", assets.length, "assets")

// The page was playground.html before it was visualize.html, and a tree is
// shared as a link with its state in the fragment — so the old url keeps
// working and carries the fragment across. A meta refresh would drop it, which
// is the whole thing worth preserving, so the redirect is a line of script with
// a plain link behind it for anyone without one.
fs.writeFileSync(
    path.join(out, "playground.html"),
    [
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8">',
        '<title>Moved — Bennu</title>',
        '<link rel="canonical" href="visualize.html">',
        "<script>location.replace('visualize.html' + location.search + location.hash)</script>",
        "</head><body>",
        '<p>This page is now at <a href="visualize.html">visualize.html</a>.</p>',
        "</body></html>",
        "",
    ].join("\n")
)
console.log("wrote playground.html -> visualize.html redirect")

// Tells Pages to serve the tree as it is rather than running it through Jekyll,
// which would drop any file or folder whose name starts with an underscore.
fs.writeFileSync(path.join(out, ".nojekyll"), "")
fs.writeFileSync(path.join(out, "CNAME"), DOMAIN + "\n")

console.log("built", path.relative(root, out))
