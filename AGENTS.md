# Working in this repo

## What to build next, the tracker and the feature reference

Before you answer or edit anything in these cases, read `.agents/skills/product-manager/SKILL.md` and follow its rules. For "what's next" questions, answer in its template. The cases:
- the user asks what to build, do or fix next, what's open, what's parked, or what to revisit;
- the user asks you to log, track or triage a bug, feature, piece of tech debt or security issue;
- the user asks how a Killcam feature works, what it captures, or whether it was checked on a device;
- you are about to edit `docs/TRACKER.md`, `docs/FEATURES.md` or `docs/BACKLOG.md`.

This applies whether or not anyone mentions a product manager. The tracker and backlog hold the items, and FEATURES.md holds how every feature works. The skill holds how to rank items, the answer's shape, and the rule that only the user brings parked work back.

The skill is the one definition every coding agent shares. Claude Code runs it as the `product-manager` agent, and Cursor has a pointer to it. If you can't start that agent, for example inside a subagent, follow the skill yourself.

## Tracker

`docs/TRACKER.md` is the live list of everything open: bugs (B-), features (F-), and tech debt and security (T-). It also lists the apps that integrate Killcam and the questions waiting on the user.

- When you find a bug, ship something, or defer work, update the tracker in the same change, following the product-manager skill (above).
- When you change how a feature behaves, update its section in `docs/FEATURES.md` in the same change.
- Long write-ups for deferred work go in `docs/BACKLOG.md`, linked from the tracker row.

## Rules that code changes must keep

- **Public API:** any change to the public API in `killcam/` needs the same change in `killcam-no-op/`. Run `scripts/check-noop-api.sh`.
- **Wire contract:** `dashboard/src/api/types.ts`, `killcam-core/.../model/Models.kt` and `docs/API.md` change together.
- **Dashboard build:** after changing `dashboard/`, run `npm run build` in `dashboard/`. It rewrites `killcam-core/src/main/resources/killcam-web/`, which is what phones load, and that output is committed.
- **Design system:** never edit `dashboard/src/design/`, which is vendored from swagperf. Wrap it in `dashboard/src/kit/`, and re-sync with `scripts/sync-design-system.sh`.
- **Security:** Killcam holds payment traffic, so it stays closed by default. The "Security model" section of `README.md` describes what that means.

## Wording

Copy in the dashboard, and anything a reader sees, follows swagperf's conventions:
- British spelling.
- No playful copy.
- Status never shown by colour alone.
- A unit on every number.
- "not measured" or "–" instead of a made-up 0.
- "RAM usage", never "RSS".
