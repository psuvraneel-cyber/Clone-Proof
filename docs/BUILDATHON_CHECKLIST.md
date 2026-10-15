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

- [ ] Git history contains small working-step commits.
- [ ] Runtime is pinned in `.nvmrc`.
- [ ] `package-lock.json` is committed.
- [ ] `Dockerfile` installs, builds, and runs the project.
- [ ] `.dockerignore` excludes local secrets, dependencies, and generated files from the Docker build context.
- [ ] `npm test` (and the Linux-friendly `make test` wrapper) runs without internet access.
- [ ] `.env.example` contains placeholders only.
- [ ] No absolute paths, credentials, or private session data are committed.
- [x] Docker rebuild and test run verified using Docker Desktop's Linux engine; repeat on a clean Linux host if available.

## Current environment gaps

- Docker Desktop 4.95.0, WSL 2.7.13, and Docker Linux engine 29.8.2 are now working after enabling the Windows optional features and restarting.
- The workspace started empty; Git was initialized for this project on 2026-10-15.
- `make` is not installed on the current Windows host; `npm test` is the portable test command and the Makefile wrapper is intended for Linux judges.
