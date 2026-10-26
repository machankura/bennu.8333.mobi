# bennu.8333.mobi

The Bennu website. Five pages — the home page, the brand page, the FAQ, the
playground and a 404 — and nothing behind them. Forked from machankura.com,
whose USSD flow, lightning addresses, clan pages and the database and lightning
node under them have all been removed; what is left is an informational site.

## Publishing it

```shell
npm run build
```

That renders the pug views into `dist/` as flat HTML, with every absolute asset
path rewritten relative, so the output works at a domain root and under a
`/repository/` path alike. Open `dist/index.html`, or serve the folder.

`.github/workflows/pages.yml` runs that build on every push to `bennu` and
publishes `dist/` to GitHub Pages. `dist/CNAME` names the domain; change `DOMAIN`
in `scripts/build-static.js` to publish somewhere else.

## Working on it

```shell
npm start
```

Serves the same views on http://localhost:2828, which saves a build between
edits. The site does not need this to run — the published site is the static
build — but pug's `include` of the stylesheets happens at compile time, so this
is the quickest way to see a change.
