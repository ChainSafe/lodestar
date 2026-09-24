# Lodestar High-Availability Validator: Design Research

Working folder for the design of a high-availability (HA) validator product that will eventually be built here as an extension or rebuild of `@lodestar/validator`. Nothing in this folder is shipped code yet.

## Documents

| Document                                                                               | Purpose                                                                                                                                            |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [lodestar-ha-baseline.md](./lodestar-ha-baseline.md)                                   | What the current Lodestar validator client does and does not do for HA. Defines gaps `L1`..`L16` cited by the other documents.                     |
| [vouch-feature-analysis.md](./vouch-feature-analysis.md)                               | Vouch (Attestant) features relative to Lodestar, HA focus.                                                                                         |
| [dirk-feature-analysis.md](./dirk-feature-analysis.md)                                 | Dirk (Attestant) distributed signer relative to the Lodestar signer stack, HA focus.                                                               |
| [vero-feature-analysis.md](./vero-feature-analysis.md)                                 | Vero (Serenita) features relative to Lodestar, HA focus, including the Dirk sidecar path.                                                          |
| [post-quantum-signing-options.md](./post-quantum-signing-options.md)                   | Options for keeping the HA product safe and redundant under Ethereum's post-quantum validator signatures.                                          |
| [ha-first-principles-and-architectures.md](./ha-first-principles-and-architectures.md) | HA from first principles: operator goals, failure model, design principles, reference architectures A0 to A6, coverage matrix and UX implications. |
| [ha-validator-prd.md](./ha-validator-prd.md)                                           | Minimal product requirements for the Lodestar HA offering, aggregated from the analyses and architectures.                                         |

Suggested reading order: baseline, the three competitor analyses, first principles and architectures, post-quantum options, then the PRD.

## Research material

`.research/` holds shallow clones of the analysed repositories and is gitignored. Re-create it with:

```sh
mkdir -p .research && cd .research
git clone --depth 1 https://github.com/attestantio/vouch.git
git clone --depth 1 https://github.com/attestantio/dirk.git
git clone --depth 1 https://github.com/serenita-org/vero.git
git clone --depth 1 https://github.com/jshufro/remote-signer-dirk-interop.git
```

Commits analysed on 2026-09-24: Vouch `64d4db5d`, Dirk `9429ac80`, Vero `71a6176f`, remote-signer-dirk-interop `8b9aac13`, Lodestar `57bd7a28a0`.
