# Social drafts for the Run 6 post

Drafts only; nothing here has been posted. Every number comes from the Run 6 files in `docs/field-test/`: `run6-results.json` and `run6-judgments.json` for the pre-registered run on v0.2.0, and `run6-fixes-results.json` and `run6-fixes-judgments.json` for the rerun on v0.2.4.

## Hacker News

**Title (59 characters):** Show HN: Fresh-clone checks on the top 100 npm repositories

**First comment (method first):**

> I build CloneProof, a zero-dependency static checker for whether a fresh clone of a Node.js repo installs and runs. I ran it on the GitHub repos behind the 100 most-depended-on npm packages, with the method and judging rules committed before any check ran. Nothing was installed or executed.
>
> The first run mostly found bugs in my tool: 9 of its 10 build-failing findings were false (it read README usage examples as repo instructions). After fixing what the run exposed, v0.2.4 fails 3 of the 100 repos, all for real reasons, and 60 of 63 warnings are correct.
>
> Real findings: 6 repos start a browser in `npm test`, 5 have tests the root `npm test` can't run, 1 commits a stale npm lockfile. An AI assistant did the judging; every reason is in the repo. Try it: `npx cloneproof-check check <repo-url>`.

## r/node and r/javascript

**Title:** I ran a fresh-clone checker on the repos of the top 100 npm packages. Mostly it found bugs in itself, so I fixed them.

> I maintain CloneProof, a static "will a fresh clone of this repo install and run?" checker for Node.js. To test it on well-maintained code, I ran it on the GitHub repositories of the 100 npm packages with the most dependents, with the method and judging rules committed up front.
>
> What the first run (v0.2.0) got wrong:
>
> - 9 of its 10 blocking findings were false. It treated README examples like "add `deploy` to your package.json, then `npm run deploy`" as instructions for the repo itself.
> - 17 warnings were false, mostly environment variables set by Git, the OS, CI, or the tool itself.
>
> After the fixes (v0.2.4), the same 100 repos: 3 fail, all for real reasons, and 60 of 63 warnings are correct.
>
> What was real, in 12 repos:
>
> - 6 start a real browser in `npm test` (Playwright, Karma, web-test-runner).
> - 5 have tests the root `npm test` can't run (3 workspace roots, plus shell and Dart suites).
> - 1 commits a `package-lock.json` that `npm ci` rejects, next to the pnpm lockfile it actually uses.
>
> 29 libraries don't commit a lockfile; I count that as a choice, not breakage. 7 huge repos exceeded the clone limits.
>
> Data, judgments, and the write-up are in the repo. An AI assistant did the judging, so please re-judge anything that looks off. `npx cloneproof-check check <repo-url>`

## dev.to front matter

```yaml
---
title: "We fresh-cloned the top 100 npm packages. The biggest problem we found was in our own tool."
published: false
tags: node, javascript, opensource, devops
---
```
