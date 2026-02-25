---
name: release-notes
description: >
  Write Lodestar release notes and Discord announcements for new versions.
  Use when cutting a new release, drafting announcement text, or updating
  the GitHub release body. Covers header text, Discord announcement,
  and changelog formatting. Requires access to the Lodestar repo and
  GitHub CLI for changelog generation.
---

# Release Notes

Write release notes for Lodestar versions by analyzing the changelog, identifying
operator-facing changes, and producing both GitHub release header text and a Discord
announcement.

## Quick Start

1. Read `references/style-guide.md` for tone, structure, and past examples
2. Read `references/changelog-analysis.md` for how to categorize and prioritize changes
3. Generate the changelog diff between the previous stable and new version
4. Draft the GitHub release header and Discord announcement
5. Output both as a single markdown file for review

## Workflow

### 1. Generate Changelog

```bash
# Get commits between last stable and new version
git log <prev-tag>..<new-tag> --oneline --no-merges

# Or use the auto-generated changelog from the RC
gh release view <new-tag> --json body -q '.body'
```

### 2. Categorize Changes

Read `references/changelog-analysis.md` for the prioritization framework.
Focus on what matters to **node operators**, not internal refactors.

### 3. Write Header Text

The header text goes at the top of the GitHub release body, before the `# Changelog` section.
Follow the structure in `references/style-guide.md`.

### 4. Write Discord Announcement

Shorter version of the header text for the `#lodestar-announcements` channel.
See `references/style-guide.md` for Discord-specific formatting rules.

### 5. Output

Produce a single markdown file with two sections:
- `## GitHub Release Header` — full header text
- `## Discord Announcement` — shorter announcement

## Key Rules

- **Operator-first**: Every highlight should answer "why should I upgrade?"
- **Breaking changes up front**: Node.js version drops, flag changes, migration steps
- **PR numbers**: Always link PRs as `(#XXXX)`
- **Recommendation level**: Always state mandatory / recommended / optional
- **Don't over-detail**: The full changelog is linked below the header
- **3-6 highlights**: Enough to convey the release but not overwhelming
- **Group related PRs**: Combine related changes into single highlights
