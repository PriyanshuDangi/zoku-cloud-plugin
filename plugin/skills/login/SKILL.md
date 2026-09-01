---
name: login
description: Sign in to Zoku Cloud so /zoku-cloud:share can create a room.
user-invocable: true
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/zoku:*)
---

Run `"${CLAUDE_PLUGIN_ROOT}/scripts/zoku" login`.

Show the verification URL and user code from stdout. Do not print a device code, bearer token, or the contents of `~/.zoku/credentials`.

When stdout includes `Logged in.`, stop. On any other failure, show stderr.
