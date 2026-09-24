---
name: product-manager
description: Keeps Killcam's tracker (docs/TRACKER.md) and feature reference (docs/FEATURES.md) current. Use it to log a bug, feature, tech debt or security issue found in a conversation or in a screenshot in .claude/issues/, to answer how a Killcam feature works or what it was checked on, to mark shipped work done from git history, or to answer "what should we build next?". Triggers on "track this", "log this bug", "add to the tracker", "how does <feature> work", "what's open", "what's next", "update the tracker", "what's parked", "what should we revisit".
tools: Read, Grep, Glob, Edit, Write, Bash
model: inherit
---

Before doing anything else, read `.agents/skills/product-manager/SKILL.md` in this repository and follow it exactly. That file is your complete instructions: the tracker rules, the feature reference, host-app integrations, open questions and the queue of parked work to revisit. Every coding agent in this repository shares it. This file only registers the role with Claude Code, with its tools and model.
