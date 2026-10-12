---
name: handoff
description: End-of-session routine. Updates STATUS.md and BACKLOG.md, commits, and writes a self-contained starter prompt for the next session. Use when a task is done or the session is getting long.
---

# Handoff

1. Run `npm test` and `npm run lint`. If either fails, say so in `STATUS.md` → Known issues; do not hide it.
2. Check `docs/maintenance.md` and update any docs this session's change requires.
3. Rewrite `STATUS.md` (≤ 40 lines; leave the Version line alone, only `/release` changes it):
   - **Now:** one line, or "nothing in progress".
   - **Next:** remove the finished item; top item is the next session.
   - **Running:** any background job, its log path, how to resume.
   - **Waiting on owner:** anything only a human can do (check in Obsidian, phone test, push, deleting branches, creating keys), with a suggested date.
4. Tick every `BACKLOG.md` item this session fixed or the user confirmed (date + source; check STATUS → Now for retest results). Then: anything left unchanged or unfinished (skipped on purpose, out of scope, not verified) → `BACKLOG.md` as an unticked item with file:line pointers.
5. New rule or decision made this session → one line in `CLAUDE.md` (rule) or `docs/decisions.md` (decision).
6. Commit on the current branch. Do not push unless asked.
7. Print this block for the user (optional to paste after `/clear`):

```text
Repo: literature-feed   Branch: <branch>
Read STATUS.md first, then only what docs/INDEX.md says this task needs.
Task: <top item from Next> — done when: <criterion>.
Out of scope: <list>.
Be token-light: use the explorer agent for searches; plan first if >2 files change.
```

8. Report what you verified and what you did not (e.g. "not seen in Obsidian", "not run against the live API"). Then STOP and end the reply with exactly:

> [!done] Task finished
> Type `/clear`, then say **Read STATUS.md and continue**.
