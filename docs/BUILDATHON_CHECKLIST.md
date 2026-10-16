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
- [x] `Dockerfile` installs, builds, and runs the project — verified with `docker build -t cloneproof .` and both `docker run --rm --network none cloneproof` commands.
- [x] `.dockerignore` excludes local secrets, dependencies, and generated files from the Docker build context — verified by the build context and container static scan.
- [x] `npm test` runs without internet access — verified on the host and inside `docker run --rm --network none cloneproof npm test`.
- [x] `.env.example` contains placeholders only — verified by the tracked file and Docker staging tests.
- [x] No absolute paths, credentials, or private session data are committed — verified with tracked-file searches and Git-isolation tests.
- [x] Docker rebuild and test run verified using Docker Desktop's Linux engine — verified with the Phase 7 Docker build, static run, and 109-test container run.

## Current environment gaps

- The symlink integration test is skipped on Windows because symlink creation returns `EPERM`; the decision helper is unit-tested.
- `make` is not installed on this Windows host; `npm test` is the portable command and the Makefile wrapper remains intended for Linux judges.
- Final merge, push, dashboard submission, and Unstop Submission ID entry are intentionally not done pending user approval.
