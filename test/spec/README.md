# Ethereum Consensus Spec Test Framework

This framework generates and runs Zig-based tests for Ethereum consensus specifications, based on the official test formats from [ethereum/consensus-specs](https://github.com/ethereum/consensus-specs/tree/master/tests/formats).

## Overview

The framework automates the creation of test files for various forks and test runners, ensuring compliance with spec tests.

Key components:
- **write_spec_tests.zig**: Main script to generate test files.
- **writer/**: Directory containing writer implementations for generating test code.
- **runner/**: Directory containing runner implementations (e.g., Operations.zig).

Generated files:
- `test/spec/test_case/<runner>_tests.zig`: Contains test functions for each runner.
- `test/spec/root.zig`: Imports all generated tests.

## Usage

1. Run `zig build run:write_spec_tests` to generate test files from spec test data.

- Spec tests can be re-downloaded by running `zig build run:download_spec_tests`

2. Execute tests with `zig build test:spec_tests`.

- Specific tests can be run by adding filters
- Minimal preset can be used with `-Dpreset=minimal`

## Supported Components

- **Forks**: See `supported_forks` in `write_spec_tests.zig`
- **Test Runners**: See `supported_test_runners` in `write_spec_tests.zig`; see below for adding more.

## Adding a New Test Runner

To add support for a new test runner (e.g., `fork` or `sanity`):

1. **Implement the Runner Module**: Create `runner/NewRunner.zig` defining the test case structure, handlers, and execution logic (similar to `Operations.zig`).
2. **Implement the Writer Module**: Create `writer/NewRunner.zig` with decls to generate test code (e.g.,`handlers`, `writeHeader` and `writeTest`).
3. **Update RunnerKind Enum**: Add the new runner to the `RunnerKind` enum in `runner_kind.zig`.
4. **Modify write_spec_tests.zig**: Add the new runner to the `supported_test_runners`, Add cases in the switches for `TestWriter` to import and use the new modules.

Ensure the new runner follows the spec test formats and integrates with existing state transition logic.

## Notes

- Generated files are auto-created; do not edit manually.
- Skips unsupported or incomplete test cases (e.g., certain operations or runners).
- Relies on external spec test data in SSZ format.
