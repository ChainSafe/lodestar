/**
 * Reads git data injected on the Dockerfile to the filepath `DOCKER_LODESTAR_GIT_DATA_FILEPATH`
 * ```js
 * {
 *   version: "0.16.0",
 *   branch: "developer/feature-1",
 *   commit: "4f816b16dfde718e2d74f95f2c8292596138c248"
 * }
 * ```
 */
export function readLodestarGitData(): string {
  try {
    const gitDataFilepath = process?.env?.DOCKER_LODESTAR_GIT_DATA_FILEPATH;
    if (!gitDataFilepath) return "unknown";

    // Lazy load fs module only if necessary
    // eslint-disable-next-line
    const fs = require("fs");
    const gitData = JSON.parse(fs.readFileSync(gitDataFilepath, "utf8"));
    const {version, branch, commit} = gitData;
    return `${version} ${branch} ${commit.slice(0, 8)}`;
  } catch (e) {
    return e.message;
  }
}
