import path from "path";

// This test vectors are used to ensure network encoding is consistent
// version to version. Unit tests ensure that current version's decoder
// works with the current version's encoder.
//
// To generate new test vectors run
// ```
// npx mocha test/unit/network/spec-tests/generate/**/*.gen.test
// ```
//
// To run tests run
// ```
// npx mocha test/unit/network/spec-tests/run/**/*.test.test
// ```
// or just to yarn test:unit. Test are very fast (50ms-100ms) total

const testDataRootDir = path.join(__dirname, "vectors");
export const testDirResponse = path.join(testDataRootDir, "response");
export const testDirRequest = path.join(testDataRootDir, "request");
