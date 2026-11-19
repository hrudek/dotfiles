---
name: commit
description: Create Git commits. Use whenever the user asks to commit changes, including with "commit" or "commite".
disable-model-invocation: true
---

Create the requested commit with an English Conventional Commit message (`type(scope): description`).

Assume that the user has already completed all tests, checks, and preparation. Do not run tests, linters, formatters, or other validation commands. Only briefly inspect the existing changes, choose an appropriate commit message, and create the commit.
