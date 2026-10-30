# Social drafts for the Run 6 post

Drafts only; nothing here has been posted. Every number comes from `docs/field-test/run6-results.json` and `docs/field-test/run6-judgments.json`.

## Hacker News

**Title (59 characters):** Show HN: Fresh-clone checks on the top 100 npm repositories

**First comment (method first):**

> I build CloneProof, a zero-dependency static checker for whether a fresh clone of a Node.js repo installs and runs. I ran it on the GitHub repos behind the 100 most-depended-on npm packages (ecosyste.ms ranking; archived repos skipped, shared monorepos de-duplicated). Method and judging rules were committed before any check ran. Nothing was installed or executed.
>
> Results: 10 of 100 repos had a real setup finding (6 run a real browser in `npm test`, 3 workspace roots can't run their tests from the root, 1 commits a stale npm lockfile next to its pnpm one). 9 of the 10 build-failing findings were false: my tool read README usage examples as repo instructions. 7 repos exceeded its clone limits.
>
> Judgments were made by an AI assistant and aren't blind; every reason is in the repo. Corrections welcome.

## r/node and r/javascript

**Title:** I ran a fresh-clone checker on the repos of the top 100 npm packages. Mostly it found bugs in itself.

> I maintain CloneProof, a static "will a fresh clone of this repo install and run?" checker for Node.js. To test it on well-maintained code, I ran it on the GitHub repositories of the 100 npm packages with the most dependents, with the method and judging rules committed up front.
>
> What was real, in 10 of 100 repos:
>
> - 6 repos start a real browser in `npm test` (Playwright, Karma, web-test-runner), so a minimal container needs a browser first.
> - 3 workspace roots have tests that the root `npm test` doesn't run.
> - 1 repo commits a `package-lock.json` that `npm ci` rejects, next to the pnpm lockfile it actually uses.
>
> What was wrong:
>
> - 9 of the 10 blocking findings were false. The tool treated README examples like "add `deploy` to your package.json, then `npm run deploy`" as instructions for the repo itself.
> - 14 environment warnings were variables set by Git, the OS, CI, or the tool itself.
>
> 29 libraries don't commit a lockfile; I count that as a deliberate choice, not breakage. 7 huge repos (TypeScript, DefinitelyTyped, webpack, Babel, Rollup, jsdom, Inquirer.js) exceeded the clone limits.
>
> Full data, judgments, and the write-up are in the repo. An AI assistant did the judging, so please re-judge anything that looks off.

## dev.to front matter

```yaml
---
title: "We fresh-cloned the top 100 npm packages. The biggest problem we found was in our own tool."
published: false
tags: node, javascript, opensource, devops
---
```
