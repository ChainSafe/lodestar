import assert from "node:assert/strict";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {loadComparisonData} from "../plugins/version-comparison/data.mjs";
import {
  cliReferenceUrl,
  compareOptions,
  comparisonSelection,
  parseCliReference,
  releasesBetween,
  sortVersions,
} from "../src/utils/cliComparison.mjs";

const reference = `# Validator
## \`validator\` Options
#### \`--network\`
Choose &lt;network&gt; with \`{name}\`.

type: \`string\`
choices: "mainnet", "hoodi"
default: \`"mainnet"\`
example: Ignore example edits
\`\`\`yaml
#### \`--fake\`
default: \`false\`
\`\`\`
#### \`--force\`
Force the action
type: \`boolean\`
## validator import
#### \`--import-only\`
Not a root option
type: \`string\`
`;

const option = (name, extra = {}) => ({
  name,
  description: "An option",
  type: "boolean",
  default: "false",
  choices: [],
  aliases: [],
  required: false,
  deprecated: false,
  hidden: false,
  ...extra,
});

test("legacy parsing excludes subcommands and examples and preserves unknown defaults", () => {
  const options = parseCliReference(reference, "validator");
  assert.deepEqual(
    options.map(({name}) => name),
    ["network", "force"]
  );
  assert.equal(options[0].description, "Choose <network> with `{name}`.");
  assert.equal(options[0].default, '"mainnet"');
  assert.deepEqual(options[0].choices, ["hoodi", "mainnet"]);
  assert.equal(options[1].default, null);
  assert.equal(options[1].aliases, null);
  assert.equal(parseCliReference(reference, "beacon"), null);
  assert.deepEqual(
    compareOptions(
      options,
      parseCliReference(reference.replace("Ignore example edits", "Different example"), "validator")
    ),
    []
  );
});

test("diff identifies fields, additions and removals and excludes hidden flags", () => {
  const changes = compareOptions(
    [option("changed"), option("removed"), option("hidden", {hidden: true})],
    [option("changed", {default: "true", aliases: ["c"]}), option("added")]
  );
  assert.deepEqual(
    changes.map(({name, status, fields}) => ({name, status, fields})),
    [
      {name: "added", status: "added", fields: []},
      {name: "changed", status: "changed", fields: ["default", "aliases"]},
      {name: "removed", status: "removed", fields: []},
    ]
  );
  assert.equal(compareOptions(null, []), null);
  assert.deepEqual(compareOptions([], []), []);
});

test("unknown legacy metadata does not become confirmed alias or deprecation changes", () => {
  const oldOption = option("flag", {aliases: null, deprecated: null, required: null, default: null});
  const changes = compareOptions([oldOption], [option("flag")]);
  assert.deepEqual(changes[0].fields, ["default"]);
  assert.equal(changes[0].before.default, null);
});

test("description wrapping and MDX escaping do not create artificial differences", () => {
  assert.deepEqual(
    compareOptions(
      [option("flag", {description: "Accepts &lt;value&gt;\n  and &#123;path&#125;"})],
      [option("flag", {description: "Accepts <value> and {path}"})]
    ),
    []
  );
});

test("versions and release ranges use semantic order including release candidates", () => {
  const versions = ["current", ...sortVersions(["1.9.0", "1.50.0-rc.2", "1.50.0-rc.10", "1.50.0", "1.43.0", "1.44.0"])];
  assert.deepEqual(versions, ["current", "1.50.0", "1.50.0-rc.10", "1.50.0-rc.2", "1.44.0", "1.43.0", "1.9.0"]);
  const range = ["1.44.0", "1.50.0-rc.2", "1.50.0-rc.10", "1.50.0"];
  assert.deepEqual(releasesBetween(versions, "1.43.0", "1.50.0"), range);
  assert.deepEqual(releasesBetween(versions, "1.50.0", "1.43.0"), range);
  assert.deepEqual(releasesBetween(versions, "1.43.0", "current"), range);
  assert.deepEqual(releasesBetween(versions, "1.43.0", "1.43.0"), []);
});

test("shareable selection validates missing versions and components", () => {
  const versions = ["current", "1.50.0", "1.43.0"];
  assert.deepEqual(comparisonSelection(versions, ""), {from: "1.43.0", to: "1.50.0", command: "beacon", valid: true});
  assert.deepEqual(comparisonSelection(versions, "?from=1.43.0&to=current&command=validator"), {
    from: "1.43.0",
    to: "current",
    command: "validator",
    valid: true,
  });
  assert.equal(comparisonSelection(versions, "?from=1.1.0").valid, false);
  assert.equal(comparisonSelection(versions, "?command=constructor").valid, false);
  assert.equal(comparisonSelection(["current"], "").valid, true);
});

test("reference links respect the docs base path, default release and heading anchors", () => {
  assert.equal(
    cliReferenceUrl("/lodestar/", "1.50.0", "1.43.0", "beacon", "chain.pruneHistory"),
    "/lodestar/1.43.0/run/beacon-management/beacon-cli#--chainprunehistory"
  );
  assert.equal(
    cliReferenceUrl("/lodestar/", "1.50.0", "1.50.0", "validator"),
    "/lodestar/run/validator-management/validator-cli"
  );
  assert.equal(
    cliReferenceUrl("/lodestar/", "1.50.0", "current", "beacon"),
    "/lodestar/next/run/beacon-management/beacon-cli"
  );
  assert.equal(
    cliReferenceUrl("/lodestar/", "current", "current", "beacon"),
    "/lodestar/run/beacon-management/beacon-cli"
  );
});

test("build data loads retained manifests, legacy references, and missing local versions", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lodestar-compare-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  assert.deepEqual((await loadComparisonData(directory)).snapshots[0].commands, {beacon: null, validator: null});
  await mkdir(path.join(directory, "pages"));
  const commands = {beacon: [option("flag")], validator: []};
  await writeFile(path.join(directory, "pages/cli-options.json"), JSON.stringify({schemaVersion: 1, commands}));
  await writeFile(path.join(directory, "versions.json"), '["1.43.0"]');
  const legacyDirectory = path.join(directory, "versioned_docs/version-1.43.0/run/validator-management");
  await mkdir(legacyDirectory, {recursive: true});
  await writeFile(path.join(legacyDirectory, "validator-cli.md"), reference);
  const {snapshots, defaultVersion} = await loadComparisonData(directory);
  assert.equal(defaultVersion, "1.43.0");
  assert.deepEqual(snapshots[0].commands, commands);
  assert.equal(snapshots[0].source, "definitions");
  assert.equal(snapshots[1].source, "reference");
  assert.equal(snapshots[1].commands.beacon, null);
  assert.equal(snapshots[1].commands.validator.length, 2);
  await writeFile(path.join(directory, "pages/cli-options.json"), '{"schemaVersion":2}');
  await assert.rejects(loadComparisonData(directory), /Unsupported CLI manifest/);
});

test("literal spaces in default values remain significant", () => {
  const before = option("graffiti", {type: "string", default: '"a  b"'});
  const after = option("graffiti", {type: "string", default: '"a b"'});
  assert.deepEqual(compareOptions([before], [after])[0].fields, ["default"]);
  assert.equal(
    parseCliReference(reference.replace('default: `"mainnet"`', 'default: `"a  b"`'), "validator")[0].default,
    '"a  b"'
  );
});

test("a later-published hotfix keeps the configured default documentation route", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lodestar-compare-hotfix-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  await writeFile(path.join(directory, "versions.json"), '["1.49.1", "1.50.0"]');
  const data = await loadComparisonData(directory);
  assert.deepEqual(
    data.snapshots.map(({id}) => id),
    ["current", "1.50.0", "1.49.1"]
  );
  assert.equal(data.defaultVersion, "1.49.1");
  assert.equal(
    cliReferenceUrl("/lodestar/", data.defaultVersion, "1.50.0", "beacon"),
    "/lodestar/1.50.0/run/beacon-management/beacon-cli"
  );
});
