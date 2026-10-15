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
- [ ] Docker rebuild and test run are verified on a Docker-capable Linux environment before submission.

## Current environment gaps

- Docker Desktop 4.95.0 is installed per-user, but its Linux engine cannot start until WSL 2 is enabled. The elevated WSL installation was canceled, so local Docker execution cannot yet be claimed as tested.
- The workspace started empty; Git was initialized for this project on 2026-10-15.
- `make` is not installed on the current Windows host; `npm test` is the portable test command and the Makefile wrapper is intended for Linux judges.
