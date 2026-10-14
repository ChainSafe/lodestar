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

  it("records public metadata, hidden options, global options and overrides", () => {
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
    expect(manifest.commands.beacon[1]).toMatchObject({hidden: true, default: null});
    expect(manifest.commands.beacon[2]).toMatchObject({required: true, deprecated: "Use --network"});
    expect(manifest.commands.validator[0].default).toBe('"mainnet"');
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("keeps dynamic default descriptions and non-finite values readable", () => {
    expect(formatDefault({type: "number", default: 0, defaultDescription: "Depends on the network"})).toBe(
      "Depends on the network"
    );
    expect(formatDefault({type: "number", default: Infinity})).toBe("Infinity");
    expect(formatDefault({type: "array", defaultDescription: '"a", "b"'})).toBe('[ "a", "b" ]');
    expect(formatDefault({type: "boolean"})).toBeNull();
  });
});
