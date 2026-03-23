# Claude Code Configuration

This directory contains shared [Claude Code](https://code.claude.com/) configuration for the Lodestar project. See also [`AGENTS.md`](../AGENTS.md) at the repo root for project conventions and architecture guidance.

## Structure

```
.claude/
├── settings.json          # Shared project settings (permissions allowlist)
├── settings.local.json    # Personal settings (gitignored)
├── skills/                # Agent skills — Claude auto-discovers these
│   ├── kurtosis-devnet/   # Multi-client devnet testing
│   ├── release-notes/     # Release note drafting
│   └── local-mainnet-debug/ # Debug with real mainnet peers
└── README.md              # This file
```

## Skills

Skills are automatically loaded by Claude Code based on task context. You can also invoke them manually:

| Skill                   | When to use                                                                |
| ----------------------- | -------------------------------------------------------------------------- |
| **kurtosis-devnet**     | Spinning up local testnets, cross-client interop testing, fork transitions |
| **release-notes**       | Drafting release notes for GitHub and Discord                              |
| **local-mainnet-debug** | Debugging networking/peer issues against real mainnet peers                |

## Shared Plugins

For cross-project Ethereum development resources (consensus specs, client cross-reference), install from the shared marketplace:

```bash
claude plugin marketplace add ChainSafe/lodestar-claude-plugins
claude plugin install ethereum-rnd
claude plugin install consensus-clients
```

## Personal Configuration

Add personal settings to `.claude/settings.local.json` (gitignored). This is useful for:

- Personal API keys or tool preferences
- Local MCP server configurations
- Additional permission rules for your workflow
