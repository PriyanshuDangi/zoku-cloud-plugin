---
name: share
description: Fork this local Claude Code session to Zoku Cloud and return a share URL.
user-invocable: true
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/zoku:*)
---

Run the bundled CLI. Git push/pull confirmation happens **in this chat**, not a terminal prompt.

1. Execute: `"${CLAUDE_PLUGIN_ROOT}/scripts/zoku" share`
2. Exit 0: stdout is the session URL. Reply with that URL and nothing else of interest.
3. Exit 2: stderr is a question for the **human** (last line is `confirm: --push`, `--pull`, or `--sync`). Ask them that question here. Do not answer yes for them.
   - They agree: run the same binary again with that flag, e.g. `"${CLAUDE_PLUGIN_ROOT}/scripts/zoku" share --push`. Then step 2.
   - They refuse or abort: stop. Do not share.
4. If stderr is `run zoku login`: run `"${CLAUDE_PLUGIN_ROOT}/scripts/zoku" login`. Show the verification URL and user code. Never print a device code, bearer token, or seed token. When it prints `Logged in.`, go to step 1.
5. Any other failure: show stderr. Do not invent a URL.

Never:

- `cat` `~/.zoku/credentials` or any other credential file
- echo, log, or ask to print a seed token, device code, or bearer token
- `curl` / `fetch` / `wget` Zoku Cloud APIs yourself
- add flags that dump secrets or bundle contents
- read or paste `session.jsonl` into the chat
- type `y` into the CLI or invent `--push` / `--pull` / `--sync` without the human agreeing
