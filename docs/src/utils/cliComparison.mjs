import semver from "semver";

export const commandPaths = {
  beacon: "run/beacon-management/beacon-cli",
  validator: "run/validator-management/validator-cli",
  builder: "run/builder-management/builder-cli",
};

export const builderSince = "1.46.0";

const legacyOmittedDefaults = ["false", "0", '""', "", "[]"];

export const fieldLabels = {
  description: "Description",
  type: "Type",
  default: "Documented default",
  choices: "Choices",
  aliases: "Aliases",
  required: "Required",
  deprecated: "Deprecated",
};

function normalizeText(value) {
  const entities = {"&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#123;": "{", "&#125;": "}"};
  return value
    .replace(/&(?:lt|gt|amp|quot|#123|#125);/g, (entity) => entities[entity])
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCliReference(markdown, command) {
  // Examples can contain headings and metadata-like lines. They are not option definitions.
  const withoutCode = markdown.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  const heading = `## \`${command}\` Options`;
  const start = withoutCode.indexOf(heading);
  if (start === -1) return null;
  const section = withoutCode.slice(start + heading.length).split(/^## /m)[0];
  return [...section.matchAll(/^#### `--([^`]+)`\s*\n([\s\S]*?)(?=^#### |$(?![\s\S]))/gm)].map(([, name, body]) => {
    const definition = body.split(/^example:/m)[0];
    const value = (key) => definition.match(new RegExp(`^${key}: (.+)$`, "m"))?.[1];
    const codeValue = (key) => {
      const raw = value(key);
      return raw === undefined ? null : raw.replace(/^`|`$/g, "");
    };
    return {
      name,
      description: normalizeText(definition.split(/^(?:type|default|choices|required):/m)[0]),
      type: codeValue("type"),
      default: codeValue("default"),
      choices: [...(value("choices") ?? "").matchAll(/"([^"]*)"/g)].map((match) => match[1]).sort(),
      aliases: null,
      required: value("required") === "true" ? true : null,
      deprecated: null,
      hidden: false,
    };
  });
}

export function compareOptions(before, after, {beforeLegacy = false, afterLegacy = false} = {}) {
  if (!before || !after) return null;
  const oldOptions = new Map(before.filter((option) => !option.hidden).map((option) => [option.name, option]));
  const newOptions = new Map(after.filter((option) => !option.hidden).map((option) => [option.name, option]));
  return [...new Set([...oldOptions.keys(), ...newOptions.keys()])].sort().flatMap((name) => {
    const oldOption = oldOptions.get(name);
    const newOption = newOptions.get(name);
    if (!oldOption || !newOption) {
      return [{name, status: oldOption ? "removed" : "added", before: oldOption, after: newOption, fields: []}];
    }
    const fields = Object.keys(fieldLabels).filter((field) => {
      // Old references do not record aliases, deprecation, or every required/default value.
      if (
        ["aliases", "required", "deprecated"].includes(field) &&
        (oldOption[field] === null || newOption[field] === null)
      )
        return false;
      // Old references omit false, 0 and empty defaults, so a missing one matches those manifest values.
      if (field === "default" && beforeLegacy !== afterLegacy) {
        const [legacyOption, manifestOption] = beforeLegacy ? [oldOption, newOption] : [newOption, oldOption];
        if (legacyOption.default === null && legacyOmittedDefaults.includes(manifestOption.default)) return false;
      }
      const normalized = (option) => (field === "description" ? normalizeText(option[field]) : option[field]);
      return JSON.stringify(normalized(oldOption)) !== JSON.stringify(normalized(newOption));
    });
    return fields.length ? [{name, status: "changed", before: oldOption, after: newOption, fields}] : [];
  });
}

export function sortVersions(versions) {
  return [...versions].sort((a, b) => semver.rcompare(a, b));
}

export function releasesBetween(versions, from, to) {
  if (from === to || !versions.includes(from) || !versions.includes(to)) return [];
  const low =
    from === "current"
      ? to
      : to === "current"
        ? from
        : semver.minSatisfying([from, to], "*", {includePrerelease: true});
  const high = from === "current" || to === "current" ? null : low === from ? to : from;
  return versions
    .filter((version) => version !== "current" && semver.gt(version, low) && (!high || semver.lte(version, high)))
    .sort(semver.compare);
}

export function cliReferenceUrl(baseUrl, defaultVersion, version, command, option) {
  const prefix = version === defaultVersion ? "" : version === "current" ? "next/" : `${version}/`;
  const anchor = option ? `#--${option.toLowerCase().replace(/[^a-z0-9_-]/g, "")}` : "";
  return `${baseUrl}${prefix}${commandPaths[command]}${anchor}`;
}

export function comparisonSelection(versions, search) {
  const params = new URLSearchParams(search);
  const releases = versions.filter((version) => version !== "current");
  const to = params.get("to") ?? releases.find((version) => !semver.prerelease(version)) ?? versions[0];
  const from = params.get("from") ?? releases[releases.indexOf(to) + 1] ?? to;
  const command = params.get("command") ?? "beacon";
  return {
    from,
    to,
    command,
    valid: versions.includes(from) && versions.includes(to) && Object.hasOwn(commandPaths, command),
  };
}
