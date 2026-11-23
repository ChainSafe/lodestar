# TypeScript coverage correction

The published include glob packages/**/src/**.{ts} matches zero files. A complete frozen-source unit run passes5547 tests but emits a zero-byte LCOV report. The corrected include packages/**/src/**/*.ts matches actual TypeScript source; existing exclusions still reject declarations, built JavaScript, dependencies and test files.

A new CLI guard requires an executed own-package TypeScript record. Six process-level controls reject empty, dependency-only, nested dependency, unexecuted and compiled-JS reports and accept executed source. The guard rejects the original real zero-byte report. An unchanged62-test bytes suite with the corrected include produces11 executed TypeScript records and the guard accepts it. This is selected-path evidence, not a whole-project coverage percentage.

The unit workflow runs the guard's regressions and then checks the actual LCOV output before upload. Normal upstream build/test commands and assertions remain unchanged. No protocol, native binding or dependency versions change. Source-native artifacts and full upstream hosted approval remain separately qualified; local fixture/source identities and toolchain limitations are in VALIDATION.json.
