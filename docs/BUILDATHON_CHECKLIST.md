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
- [x] `Dockerfile` installs, builds, and runs CloneProof's static check — verified locally with `docker build -t cloneproof .` and `docker run --rm --network none cloneproof` (last recorded for PR #2 on 2026-10-20). The CI `docker-e2e` job does not build this image; it runs `cloneproof setup` and `verify` on the two examples with the pinned verifier image. Target workflow verification remains optional and local static inspection does not require Docker.
- [x] `.dockerignore` excludes local secrets, credential-like configuration, dependencies, and generated files from the Docker build context — dotenv files other than `.env.example`, npm/Yarn configuration, credential stores, and private key/certificate files are excluded.
- [x] `npm test` runs without internet access — the host command is the canonical offline check; `docker run --rm --network none cloneproof npm test` also passed locally (last recorded for PR #2).
- [x] `.env.example` contains placeholders only — verified by the tracked file and Docker staging tests.
- [x] No absolute paths, credentials, or private session data are committed — verified with tracked-file searches and Git-isolation tests.
- [x] Docker rebuild and the container test run are local checks; for PR #2, `docker build`, `npm test`, and `npm run test:leaks` in the container all passed. At `32bf359` the suite is 323 tests: 320 passed with 3 symlink `EPERM` skips on the Windows host, and 322 passed with 1 Windows-only skip on Linux CI.

## Current environment gaps

- Three symlink tests are skipped on this Windows host because symlink creation returns `EPERM`; GitHub's Windows runner runs them, and the decision helper is unit-tested.
- `make` is not installed on this Windows host; `npm test` is the portable command and the Makefile wrapper remains intended for Linux judges.
- All implementation work is merged and pushed: `origin/main` is at `32bf359` (2026-10-30). The official submission items above are still unchecked; whether the submission was made is not recorded here.
