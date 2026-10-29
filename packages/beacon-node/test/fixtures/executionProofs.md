# Native proof verification fixtures

From the repository root, run `pnpm download-execution-proofs-fixtures`, then `pnpm test:8025`.
The download requires internet access and `tar`. These native tests use a separate Vitest project.
Ordinary unit tests, including the EIP-8025 unit tests, do not require these fixtures.

The script fills `packages/beacon-node/test/fixtures/executionProofs/`, which is ignored by version
control, with two fixture sets:

- `openvm/`, `sp1/`, `zisk/`: ere's own fixtures, each with `program_vk.bin`, `proof.bin` and
  `public_values.bin`. They come from `eth-act/ere` at
  [`24118285`](https://github.com/eth-act/ere/commit/24118285f6e9b8115b3ad568775f7fe55ff78bf5), the
  v0.19.6 tag, with the upstream MIT license in `LICENSE-MIT`. They verify test programs, not Ethereum
  execution, and exercise the binding, native verification and public-value matching.
- `sepolia/`: one stateless-validator proof per Sepolia proof type from `eth-act/zkboost`
  [`v0.19.1`](https://github.com/eth-act/zkboost/tree/v0.19.1/crates/mock-beacon-node/tests/fixture),
  the 43-byte `public_values.bin` they commit to, and the matching guest verification keys from the
  `eth-act/ere-guests` [`v0.19.0`](https://github.com/eth-act/ere-guests/releases/tag/v0.19.0) release,
  with the ere-guests MIT license in `sepolia/LICENSE-MIT`. These run through `NativeProofEngine` with
  explicit proof type assignments, so they prove the whole Lodestar path for the proofs gossiped on
  Sepolia.

Tests read the downloaded files without network access. If a fixture is missing, the native fixture
tests fail with the download command. They do not skip missing fixtures or download them automatically.
The dedicated EIP-8025 CI job runs the download command before `pnpm test:8025`. The unit-test CI job
does not download execution-proof fixtures.

The pinned revisions must match the `ere` release the installed `lodestar-z` verifier was built with.
Proofs from a newer SP1 or ZisK than the verifier fail verification, so bump the revisions here together
with the `@chainsafe/lodestar-z` catalog entry.
