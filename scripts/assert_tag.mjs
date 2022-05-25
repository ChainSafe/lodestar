
/**
 * Assert tag version (must be semver-ish)
 *   release.mjs passes tagParam
 *   In CI, tagParam is undefined, get from proces.env instead
 */
export function assertTag(tagParam) {
  const tag = tagParam || process.env.TAG;
  const versionCaptureRegex=/^(v[0-9]+\.[0-9]+)\.[0-9]+(-beta\.[0-9]+)?$/
  const versionMatch = versionCaptureRegex.exec(tag);
  if (versionMatch == null) {
    console.log(`Tag must match ${versionCaptureRegex}`);
    process.exit(1);
  }
  return versionMatch;
}