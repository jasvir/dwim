# Releasing DWIM

## npm

From a clean checkout with Node.js 20+:

```sh
npm ci
npm test
npm pack --dry-run
npm login
npm publish
```

The package is public and contains only `index.js`, `package.json`, the README,
and the MIT license. Publishing runs the tests again. Bump `version` before
publishing a later release; npm versions cannot be overwritten.

## GitHub Pages

The playground lives at **https://jasvir.github.io/dwim/**.

Select **Settings → Pages → Build and deployment → Source: GitHub Actions**,
then run **Actions → Deploy Pages → Run workflow**. Later pushes to `main` deploy
automatically. The demo is public; the repository can stay private if your
GitHub plan supports Pages for private repositories. Only `dist/` is deployed.

To check the same static build locally:

```sh
npm run build:demo
npm run preview
```

The preview serves the site under `/dwim/`, just like Pages. The build includes
the library, playground, and Acorn with its license; it needs no CDN. Generated
files stay in `dist/` and aren't committed or published to npm.
