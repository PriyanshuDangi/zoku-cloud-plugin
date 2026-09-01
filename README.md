# Zoku Cloud for Claude Code

Fork a local Claude Code session into a shareable room at [cloud.heyzoku.com](https://cloud.heyzoku.com).

The command to tell people is **`/zoku-cloud:share`**. Claude can also offer it when you ask to share the session.

## Install

In Claude Code:

```text
/plugin marketplace add PriyanshuDangi/zoku-plugin
/plugin install zoku-cloud@zoku
```

Start a **new** session after installing so the session hooks run. Needs **Node.js 22+** on the machine.

## Use

Run this from a git repo whose `origin` is GitHub:

1. `/zoku-cloud:share`
2. First time: Claude will run login. Open the URL, enter the code, sign in to Zoku Cloud with GitHub. Or type `/zoku-cloud:login`.
3. If the GitHub App is not on that repo, the error includes an install URL. Install it, then share again.
4. If your branch is ahead of or behind `origin`, confirm push or pull **in the chat**.

Stdout is a room URL: `https://cloud.heyzoku.com/s/<id>`. Local Claude keeps running. This is a fork, not a live teleport.

Commit and push inside the cloud room is a human action in the UI, not something the agent does.

## Layout

```text
.claude-plugin/marketplace.json   # catalog name: zoku
plugin/                           # Claude Code plugin (source: ./plugin)
```

Do not use `git-subdir`. Claude Code copies `./plugin` from this repository.
