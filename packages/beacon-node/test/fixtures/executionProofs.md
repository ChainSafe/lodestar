# Native proof verification fixtures

From the repository root, run `pnpm download-execution-proofs-fixtures` before running the native proof
tests or `pnpm test:unit`. The download requires internet access and `tar`.

The script downloads a pinned archive and extracts the OpenVM, SP1, and ZisK fixtures into
`packages/beacon-node/test/fixtures/executionProofs/`. This directory is ignored by version control.
Each zkVM directory contains `program_vk.bin`, `proof.bin`, and `public_values.bin`. The script also
extracts the upstream MIT license into `executionProofs/LICENSE-MIT`.

Tests read the downloaded files without network access. If a fixture is missing, the native fixture
tests fail with the download command. They do not skip missing fixtures or download them automatically.
The unit-test CI job runs the download command before running tests.

The fixtures come from `eth-act/ere` at
[`c0c411ae`](https://github.com/eth-act/ere/commit/c0c411ae9215e0f72a00d52e32e267b30ef48606).
The source path is `crates/verifier/<zkvm>/tests/fixtures/`. This is the fixture revision used by the
pinned `lodestar-z` verifier. Rerun the command to replace missing or modified files with this revision.

The fixtures verify test programs, not Ethereum execution. The tests check native verification and
public-value matching. EIP-8025 guest selection and public-input construction belong to the beacon-node
integration.
