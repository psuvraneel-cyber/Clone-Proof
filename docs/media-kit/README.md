# CloneProof media kit

Logos, screenshots, social images, video, and copy for writing about
CloneProof. Everything here is MIT-licensed with the rest of the repository;
use it freely, and please don't alter the logo's shape or colors.

## Fact sheet

**One line.** CloneProof checks whether a fresh clone of a Node.js repository
will actually install and run, and shows file-and-line evidence for every
finding.

**One paragraph.** CI runs on a warm, configured machine; a new contributor,
reviewer, or coding agent starts from `git clone` and the README. CloneProof
looks for the gaps between the two (a lockfile `npm ci` rejects, a test script
that is missing or needs a browser, an undocumented environment variable, Node
versions that disagree) without running any of the repository's code. An
opt-in `verify` mode then proves install and tests inside a locked-down Docker
container with the network off. It ships as a zero-dependency CLI and as a
GitHub Action.

| | |
|---|---|
| Name | CloneProof (the npm package is `cloneproof-check`; the command is `cloneproof`) |
| Try it | `npx cloneproof-check check https://github.com/OWNER/REPO` |
| Install | `npm install -g cloneproof-check` |
| GitHub Action | [CloneProof Check](https://github.com/marketplace/actions/cloneproof-check) on the Marketplace |
| Current release | v0.2.4, published to npm from CI with provenance |
| Requirements | Node.js ≥ 22.19.0; Docker only for `verify` |
| Runtime dependencies | 0 |
| License | MIT |
| Repository | <https://github.com/psuvraneel-cyber/Clone-Proof> |
| Maintainer | [@psuvraneel-cyber](https://github.com/psuvraneel-cyber) |

**Key facts**

- `check` never executes repository code. A local folder is read without
  starting any process; a GitHub URL gets one isolated, shallow clone first.
- `verify` runs only `npm ci --ignore-scripts` and `npm test`, in a pinned
  image, as a non-root user, with capabilities dropped and `--network=none`
  unless `--allow-network` is given.
- Reports are deterministic: the same commit gives byte-identical JSON. Every
  finding has a stable code (documented in [FINDINGS.md](../FINDINGS.md)) and
  evidence as `file:line`.
- Field-tested in the open: on the repositories behind the 100 most-depended-on
  npm packages, with the method committed before any check ran, v0.2.4 fails 3
  repositories and all 3 deserve it; 12 of the 100 have at least one real setup
  finding. See the [write-up](../blog/2026-top100-fresh-clone.md) and
  [FIELD_TEST.md](../FIELD_TEST.md). The judging was done by an AI assistant and
  was not blind; every judgment has a written reason.

## Logo

The wordmark is set in Cascadia Code Bold (SIL Open Font License) and
converted to outlines, so the SVGs need no font. The mark is two stacked
cards, a clone, with a check on the front one.

| File | Use |
|---|---|
| [`logo/logo-dark.svg`](logo/logo-dark.svg) · [png](logo/logo-dark.png) | Mark + wordmark, for dark backgrounds |
| [`logo/logo-light.svg`](logo/logo-light.svg) · [png](logo/logo-light.png) | Mark + wordmark, for light backgrounds |
| [`logo/wordmark-dark.svg`](logo/wordmark-dark.svg) · [png](logo/wordmark-dark.png) | Wordmark only, dark backgrounds |
| [`logo/wordmark-light.svg`](logo/wordmark-light.svg) · [png](logo/wordmark-light.png) | Wordmark only, light backgrounds |
| [`logo/icon-dark.svg`](logo/icon-dark.svg) · [png](logo/icon-dark.png) | Square app icon / avatar, dark tile |
| [`logo/icon-light.svg`](logo/icon-light.svg) · [png](logo/icon-light.png) | Square app icon / avatar, light tile |

PNGs are transparent and rendered at 2× (the icon is 1024 × 1024).

**Colors**

| | Dark backgrounds | Light backgrounds |
|---|---|---|
| Green ("Proof", check) | `#3fb950` | `#1a7f37` |
| Text ("Clone") | `#e6edf3` | `#1f2328` |
| Background | `#0d1117` | `#ffffff` |
| Warning / failure accents | `#d29922` / `#f85149` | |

## Screenshots

All taken from real CLI runs at the v0.2.4 code.

| File | What it shows |
|---|---|
| [`screenshots/terminal-chai.png`](screenshots/terminal-chai.png) | `check` on [chaijs/chai](https://github.com/chaijs/chai) at commit `8cd999c735f0`: passes with one real warning (`npm test` starts a browser). |
| [`screenshots/terminal-broken.png`](screenshots/terminal-broken.png) | `check` on the bundled [`examples/broken-node`](../../examples/broken-node): fails, with three warnings. |
| [`screenshots/html-report-broken.png`](screenshots/html-report-broken.png) | The self-contained HTML report (`--format html`): summary and coverage. |
| [`screenshots/html-report-findings.png`](screenshots/html-report-findings.png) | The same report's findings, with evidence and recommendations. |
| [`screenshots/html-report-chai.png`](screenshots/html-report-chai.png) | The HTML report for chai. |

The terminal screenshots are excerpts: every finding's heading line is kept,
and full detail is shown only for warnings and failures. The "What was
checked" and "Finding counts" sections are left out.

## Social images

| File | Size | Use |
|---|---|---|
| [`social/og-1280x640.png`](social/og-1280x640.png) | 1280 × 640 | Link previews, X, LinkedIn, Bluesky, HN-linked pages (same as the repository's social preview) |
| [`social/square-1080.png`](social/square-1080.png) | 1080 × 1080 | LinkedIn and Instagram feed posts |
| [`social/vertical-1080x1920.png`](social/vertical-1080x1920.png) | 1080 × 1920 | Stories, Shorts, Reels |

## Video

| File | Length | Use |
|---|---|---|
| [`video/launch-1920x1080.mp4`](video/launch-1920x1080.mp4) · [poster](video/launch-poster.jpg) | 20 s, with audio | Launch video: "It works on my machine", static evidence instead of assumptions, annotations on every pull request, and locked-down Docker verification. For X, LinkedIn, YouTube, and the dev.to post. |
| [`video/launch-1080x1080.mp4`](video/launch-1080x1080.mp4) | 20 s | The same video centered on a square frame, for LinkedIn and Instagram feeds. |
| [`video/launch-1080x1920.mp4`](video/launch-1080x1920.mp4) | 20 s | The same video centered on a vertical frame, for Stories, Shorts, and Reels. |
| [`video/demo-loop.mp4`](video/demo-loop.mp4) · [gif](video/demo-loop.gif) | 12 s, loops, silent | `cloneproof check examples/broken-node` being typed and its result, for READMEs, X, and slides. The evidence lines are shortened from the real output. |

Suggested caption for the launch video: "'It works on my machine' isn't
evidence. CloneProof checks whether a fresh clone of your Node.js repo installs
and runs, without executing its code. Try it: `npx cloneproof-check check <url>`"

## Copy

Ready-to-paste posts for Show HN, Reddit, dev.to, Hashnode, X, Bluesky,
LinkedIn, and newsletters are in `docs/blog/launch-kit.md`, and the long-form story is
[We fresh-cloned the top 100 npm packages](../blog/2026-top100-fresh-clone.md).

**Boilerplate (50 words).** CloneProof is an open-source, zero-dependency
checker for whether a fresh clone of a Node.js repository installs and runs.
It reads the repository without executing it, reports every finding with
file-and-line evidence, and can prove install and tests in a network-isolated
Docker container. It is available on npm and as a GitHub Action.

## Contact

Open an issue at <https://github.com/psuvraneel-cyber/Clone-Proof/issues>.
