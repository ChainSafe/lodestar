# Pull Request:Allow Voluntary Exit To Write-to-File Feature and Prepare a manual node Test.

## Summary
This PR adds a `--saveToFile` JSON file option to the validator `voluntary-exit` command for  later submission workflows. It does not submit to the beacon node.


## Changes Made
1. packages/cli/src/cmds/validator/voluntaryExit.ts` — implement saveToFile behavior
2. packages/cli/manual-tests/voluntaryExit.writefile.test.js` — manual script that:
   -runs the handler with `saveToFile`
   -verifies the file is created and readable.
   -submits to a mock beacon client rather than publish to network.

> **Note:** The manual test demonstrates the behavior and was run locally.I kept the manual script so reviewers can quickly run and validate.I'm working on Jest/CI setup. I’d appreciate guidance or help from maintainers about the preferred location/approach for the automated test in repo CI.

## How to run the node test manually:

From repo root, run:
 -$yarn install
 -$yarn build
 -$yarn workspace @chainsafe/lodestar node packages/cli/manual-tests/voluntaryExit.writefile.test.js

## Expected Output:
✅ File created successfully: .../manual-tests/exit-test.json
📄 File content: { message: 'Mock voluntary exit data' }
📨 Mock beacon received voluntary exit: { message: 'Mock voluntary exit data' }
✅ Voluntary exit successfully submitted to mock beacon client.
🧹 Cleaned up test file.

## Why manual test included:
While authoring an automated Jest test I ran into some repository-specific Jest/ESM config complexity. The manual test is included to provide clear, reproducible proof of functionality . It also aims to:
(a) let reviewers run the feature instantly.
(b) improve it to adapt to the repo's CI.
 
## Assistance  needed:
I would appreciate guidance on:
- Correct integration testing pattern for Lodestar CLI commands.(I am happy to follow maintainers' suggestions to convert into an automated test).
- Ensuring that my local Jest configuration aligns with Lodestar’s monorepo test standards.

## To Do.
- Convert manual test to an automated Jest integration test in packages/cli/test/validator.
- Add any required test harness / mocks used by repo CI.

## Additional Notes
I’m learning to contribute to Ethereum core tooling via Lodestar, and this PR forms part of my contribution proof and learning process.

Thank you for reviewing, I look forward to reading  your feedbacks.

