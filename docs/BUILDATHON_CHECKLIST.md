# OmniRush Frontier Buildathon checklist

Source checked on 2026-10-15: <https://omnirush.ai/buildathon>

## Official submission items

- [ ] Join the Buildathon with the GitHub account used for the submission.
- [ ] Keep the repository public and owned by that connected GitHub account.
- [ ] Include a README explaining what the project does, setup, usage, tests, architecture, security, and limitations.
- [ ] Include the OmniRush sessions used to build the project when submitting.
- [ ] Select the `Developer Tools & Open Source` track.
- [ ] Submit through the OmniRush Buildathon dashboard before 20 October 2026, 11:59 PM IST.
- [ ] Copy the resulting Submission ID into Unstop.
- [ ] Record a short demo video if possible; the official guide marks it as recommended, not required.

## Rebuild checklist

- [x] Git history contains small working-step commits — verified with `git log --oneline` after one working commit per review item.
- [x] Runtime is pinned in `.nvmrc` — verified by `npm test`, Docker build, and the runtime scan findings.
- [x] `package-lock.json` is committed — verified by `git status`, static scans, and `npm ci` in the image build.
- [x] `Dockerfile` installs, builds, and runs CloneProof's static check — verified by the Linux CI Docker job for the pushed baseline and its `docker build -t cloneproof .` / `docker run --rm --network none cloneproof` smoke commands; target workflow verification remains optional and local static inspection does not require Docker.
- [x] `.dockerignore` excludes local secrets, credential-like configuration, dependencies, and generated files from the Docker build context — dotenv files other than `.env.example`, npm/Yarn configuration, credential stores, and private key/certificate files are excluded.
- [x] `npm test` runs without internet access — the host command is the canonical offline check; the Linux CI Docker job for the pushed baseline also runs it with `--network none`.
- [x] `.env.example` contains placeholders only — verified by the tracked file and Docker staging tests.
- [x] No absolute paths, credentials, or private session data are committed — verified with tracked-file searches and Git-isolation tests.
- [x] Docker rebuild and test run are covered by the Linux CI Docker job. The current host suite is 193 tests (192 passed and one expected Windows symlink `EPERM` skip); the last recorded Linux container receipt was 189/189 for the earlier CI baseline.

## Current environment gaps

- The symlink integration test is skipped on Windows because symlink creation returns `EPERM`; the decision helper is unit-tested.
- `make` is not installed on this Windows host; `npm test` is the portable command and the Makefile wrapper remains intended for Linux judges.
- The `docs-final` baseline was merged into `main` and pushed at `1d817e7`; the current local fixes after that baseline still need a later push before dashboard submission and Unstop Submission ID entry.
