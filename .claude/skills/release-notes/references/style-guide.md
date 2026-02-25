# Release Notes Style Guide

## Tone & Voice

- Friendly, professional, operator-focused
- Open with a casual greeting: "Good day Lodestar operators!", "Hey Lodestar users!", "Happy [month]!"
- State version and recommendation level immediately: "We've just released vX.Y.Z and **recommend** users update"
- Recommendation levels: **mandatory** (breaking/security), **recommended** (features/perf), maintenance (minor)
- Close with a link to full changelog and optionally a seasonal/fun sign-off

## GitHub Release Header Structure

```markdown
[Greeting]. We've just released vX.Y.Z, a **[level]** upgrade for all [mainnet and testnet] users.
[1-2 sentence summary of the theme of this release.]

[Optional: Breaking change / migration callout in bold]

### Highlights

- **[Feature/Fix name]** — 1-2 sentence description of what changed and why operators care. ([#XXXX])
- **[Feature/Fix name]** — ... ([#XXXX])
- [3-6 highlights total, ordered by operator impact]

[Optional: Additional context paragraphs for complex changes like migrations]

For the full changelog, please see: https://github.com/ChainSafe/lodestar/releases/vX.Y.Z
```

### Formatting Rules

- Use markdown headers, bold, bullet lists
- PR references: `(#8813)` or `(#8813, #8789)` for related PRs
- Keep highlights to 3-6 items — enough to convey the release but not overwhelming
- Each highlight should be one concept (combine related PRs into one bullet)
- Don't list every PR — that's what the changelog is for

## Discord Announcement Structure

```
[Greeting]. We've just released vX.Y.Z and **[level]** users update [reason].

[Breaking change if any]

Key highlights:
[emoji] [highlight 1]
[emoji] [highlight 2]
[emoji] [highlight 3]

For the full changelog: <https://github.com/ChainSafe/lodestar/releases/vX.Y.Z>
```

### Discord-Specific Rules

- No markdown tables — use bullet lists
- Wrap links in `<>` to suppress embeds (except the main release link)
- Use emoji bullets for visual scanning: 🧠 ⚡ 🔧 🌐 📡 🛡️ 🎯
- Keep under 2000 chars (Discord message limit)
- No headers — use **bold** or emoji for emphasis

## Past Examples (Distilled Patterns)

### Major Feature Release (e.g., mainnet fork activation)
- "**Mandatory** for all node operators"
- Detailed config changes (new flags, default values)
- Compatibility notes for validators
- Signed off with enthusiasm + emoji

### Performance Release
- "**Highly recommended** if you've seen performance declines"
- Runtime changes highlighted (e.g., Node.js version bump)
- Build-from-source migration note
- Holiday sign-off

### Maintenance Release
- "**Recommend** users update for latest features and best performance"
- Package manager migration with commands
- Breaking: deprecated feature removal
- Affected-user-specific note (e.g., DVT operators)
