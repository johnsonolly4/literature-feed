---
name: phase-plan
description: Turns a goal into an agreed, phased plan before any code is written. Use for new features, refactors touching more than 2 files, or anything with design choices. Run on Opus.
---

# Phase plan

Do not edit code during this skill. Only `docs/plans/` and `STATUS.md` change.

1. **Understand.** Read `STATUS.md` and `docs/decisions.md`. Use the `explorer` agent to find the relevant code (file:line only).
2. **Ask.** Put the open design questions to the user as multiple choice (AskUserQuestion), 2–4 options each, recommended option first with one line of why. Max 4 questions per round. If there are many proposals, offer to build an approval page instead.
3. **Restate.** One paragraph: what was decided. If a reply could answer more than one question, say which you took it to answer.
4. **Split into phases.** Each phase must:
   - fit in one session;
   - be finishable and testable alone;
   - have a written "done when" (tests, outside reference, manual check);
   - add no new dependency unless agreed.
5. **Check order** against dependencies and say so.
6. **Write** `docs/plans/<feature>.md` from `docs/plans/_TEMPLATE.md`. Add the phases to `STATUS.md` → Next. Add decisions to `docs/decisions.md`.
7. **Stop.** End with the handoff starter prompt for Phase 1 (see the `handoff` skill, step 7). Recommend Sonnet for build phases that are fully specified.
