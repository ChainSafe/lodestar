import {describe, expect, it} from "vitest";
import {createCliManifest, formatDefault} from "../../../docsgen/manifest.js";
import {renderCommandPage} from "../../../docsgen/markdown.js";

describe("CLI documentation data", () => {
  it("preserves falsy defaults in both the reference and comparison data", () => {
    const command = {
      command: "beacon",
      describe: "Beacon node",
      options: {
        enabled: {type: "boolean" as const, default: false},
        count: {type: "number" as const, default: 0},
        name: {type: "string" as const, default: ""},
      },
    };
    const manifest = createCliManifest([command], {});
    const markdown = renderCommandPage(command, {});
    expect(manifest.commands.beacon.map((option) => option.default)).toEqual(["false", "0", '""']);
    for (const value of ["false", "0", '""']) {
      expect(markdown, `default ${value} must be documented`).toContain(`default: \`${value}\``);
    }
  });

  it("records public metadata, global options and overrides without hidden options", () => {
    const manifest = createCliManifest(
      [
        {
          command: "beacon",
          options: {
            network: {type: "string", default: "hoodi", alias: ["n", "chain"], choices: ["mainnet", "hoodi"]},
            internal: {type: "boolean", hidden: true},
            required: {type: "string", demandOption: true, deprecated: "Use --network"},
          },
        },
        {command: "validator", options: {}},
        {command: "dev", options: {}},
      ],
      {network: {type: "string", default: "mainnet"}}
    );
    expect(Object.keys(manifest.commands)).toEqual(["beacon", "validator"]);
    expect(manifest.commands.beacon[0]).toMatchObject({
      name: "network",
      default: '"hoodi"',
      aliases: ["chain", "n"],
      choices: ["hoodi", "mainnet"],
    });
    expect(manifest.commands.beacon.map(({name}) => name)).toEqual(["network", "required"]);
    expect(manifest.commands.beacon[1]).toMatchObject({required: true, deprecated: "Use --network"});
    expect(manifest.commands.validator[0].default).toBe('"mainnet"');
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("filters hidden options after applying command overrides", () => {
    const manifest = createCliManifest(
      [
        {
          command: "beacon",
          options: {
            visibleOverride: {type: "boolean", hidden: false},
            hiddenOverride: {type: "boolean", hidden: true},
          },
        },
        {command: "validator", options: {}},
      ],
      {
        hiddenGlobal: {type: "boolean", hidden: true},
        visibleOverride: {type: "boolean", hidden: true},
        hiddenOverride: {type: "boolean", default: false},
      }
    );
    expect(manifest.commands.beacon.map(({name}) => name)).toEqual(["visibleOverride"]);
    expect(manifest.commands.validator.map(({name}) => name)).toEqual(["hiddenOverride"]);
    for (const [command, options] of Object.entries(manifest.commands)) {
      for (const option of options) {
        expect(option, `${command} --${option.name} must omit hidden metadata`).not.toHaveProperty("hidden");
      }
    }
  });

  it("includes public builder options and globals while excluding unrelated commands", () => {
    const manifest = createCliManifest(
      [
        {
          command: "builder",
          options: {
            beaconNodeUrl: {type: "string", default: "http://localhost:9596"},
            internal: {type: "boolean", hidden: true},
          },
        },
        {command: "bootnode", options: {}},
        {command: "dev", options: {}},
      ],
      {network: {type: "string", default: "mainnet"}, hiddenGlobal: {type: "boolean", hidden: true}}
    );
    expect(Object.keys(manifest.commands)).toEqual(["builder"]);
    expect(manifest.commands.builder.map(({name, default: value}) => ({name, default: value}))).toEqual([
      {name: "network", default: '"mainnet"'},
      {name: "beaconNodeUrl", default: '"http://localhost:9596"'},
    ]);
  });

  it("keeps dynamic default descriptions and non-finite values readable", () => {
    expect(formatDefault({type: "number", default: 0, defaultDescription: "Depends on the network"})).toBe(
      "Depends on the network"
    );
    expect(formatDefault({type: "number", default: Infinity})).toBe("Infinity");
    expect(formatDefault({type: "array", defaultDescription: '"a", "b"'})).toBe('[ "a", "b" ]');
    expect(formatDefault({type: "boolean"})).toBeNull();
    expect(formatDefault({type: "array"})).toBeNull();
  });

  it.each([
    {label: "an empty array description", definition: {defaultDescription: "[]"}, expected: "[]"},
    {label: "an empty array value", definition: {default: []}, expected: "[]"},
    {label: "a bracketed array description", definition: {defaultDescription: '["peer"]'}, expected: '["peer"]'},
    {label: "a scalar array description", definition: {defaultDescription: "peer"}, expected: '[ "peer" ]'},
    {label: "a quoted array description", definition: {defaultDescription: '"a", "b"'}, expected: '[ "a", "b" ]'},
  ])("formats $label in references and comparison data", ({definition, expected}) => {
    const command = {
      command: "beacon",
      describe: "Beacon node",
      options: {
        directPeers: {type: "array" as const, ...definition},
      },
    };
    const manifest = createCliManifest([command], {});
    expect(manifest.commands.beacon[0].default).toBe(expected);
    expect(renderCommandPage(command, {})).toContain(`default: \`${expected}\``);
  });
});
