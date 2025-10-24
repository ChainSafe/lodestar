import {describe, expect, it} from "vitest";
import yargs from "yargs/yargs";
import {hideBin} from "yargs/helpers";
import {registerCommandToYargs, CliCommand} from "../../src/command.js";

describe("registerCommandToYargs", () => {
  describe("duplicate single-value flag validation", () => {
    it("Should accept single-value string flag with one value", async () => {
      const command: CliCommand<{url: string}> = {
        command: "test",
        describe: "Test command",
        options: {
          url: {
            type: "string",
            description: "Single value URL",
          },
        },
        handler: async (args) => {
          expect(args.url).toBe("https://example.com");
        },
      };

      const parser = yargs(hideBin(["node", "script", "test", "--url", "https://example.com"]));
      registerCommandToYargs(parser, command);

      // Should not throw
      await expect(parser.parse()).resolves.toBeDefined();
    });

    it("Should accept single-value number flag with one value", async () => {
      const command: CliCommand<{port: number}> = {
        command: "test",
        describe: "Test command",
        options: {
          port: {
            type: "number",
            description: "Port number",
          },
        },
        handler: async (args) => {
          expect(args.port).toBe(8080);
        },
      };

      const parser = yargs(hideBin(["node", "script", "test", "--port", "8080"]));
      registerCommandToYargs(parser, command);

      // Should not throw
      await expect(parser.parse()).resolves.toBeDefined();
    });

    it("Should accept single-value boolean flag with one value", async () => {
      const command: CliCommand<{verbose: boolean}> = {
        command: "test",
        describe: "Test command",
        options: {
          verbose: {
            type: "boolean",
            description: "Verbose output",
          },
        },
        handler: async (args) => {
          expect(args.verbose).toBe(true);
        },
      };

      const parser = yargs(hideBin(["node", "script", "test", "--verbose"]));
      registerCommandToYargs(parser, command);

      // Should not throw
      await expect(parser.parse()).resolves.toBeDefined();
    });

    it("Should accept array-type flag with multiple values", async () => {
      const command: CliCommand<{bootnodes: string[]}> = {
        command: "test",
        describe: "Test command",
        options: {
          bootnodes: {
            type: "array",
            description: "Multiple bootnodes",
          },
        },
        handler: async (args) => {
          expect(args.bootnodes).toEqual(["node1", "node2"]);
        },
      };

      const parser = yargs(hideBin(["node", "script", "test", "--bootnodes", "node1", "--bootnodes", "node2"]));
      registerCommandToYargs(parser, command);

      // Should not throw - arrays are allowed to have multiple values
      await expect(parser.parse()).resolves.toBeDefined();
    });

    it("Should throw error when single-value string flag is duplicated", () => {
      const command: CliCommand<{url: string}> = {
        command: "test",
        describe: "Test command",
        options: {
          url: {
            type: "string",
            description: "Single value URL",
          },
        },
        handler: async () => {
          // Should not reach here
          throw new Error("Handler should not be called");
        },
      };

      const parser = yargs(hideBin(["node", "script", "test", "--url", "https://example1.com", "--url", "https://example2.com"]));
      registerCommandToYargs(parser, command);

      // Should throw with descriptive error
      expect(() => parser.parseSync()).toThrow(
        "Option '--url' is a single-value flag but was provided multiple times"
      );
      expect(() => parser.parseSync()).toThrow("https://example1.com");
      expect(() => parser.parseSync()).toThrow("https://example2.com");
    });

    it("Should throw error when single-value number flag is duplicated", () => {
      const command: CliCommand<{port: number}> = {
        command: "test",
        describe: "Test command",
        options: {
          port: {
            type: "number",
            description: "Port number",
          },
        },
        handler: async () => {
          throw new Error("Handler should not be called");
        },
      };

      const parser = yargs(hideBin(["node", "script", "test", "--port", "8080", "--port", "9000"]));
      registerCommandToYargs(parser, command);

      // Should throw with descriptive error
      expect(() => parser.parseSync()).toThrow(
        "Option '--port' is a single-value flag but was provided multiple times"
      );
    });

    it("Should validate multiple flags independently", async () => {
      const command: CliCommand<{url: string; port: number; verbose: boolean}> = {
        command: "test",
        describe: "Test command",
        options: {
          url: {
            type: "string",
            description: "Single value URL",
          },
          port: {
            type: "number",
            description: "Port number",
          },
          verbose: {
            type: "boolean",
            description: "Verbose output",
          },
        },
        handler: async (args) => {
          expect(args.url).toBe("https://example.com");
          expect(args.port).toBe(8080);
          expect(args.verbose).toBe(true);
        },
      };

      const parser = yargs(
        hideBin(["node", "script", "test", "--url", "https://example.com", "--port", "8080", "--verbose"])
      );
      registerCommandToYargs(parser, command);

      // Should not throw when all flags have single values
      await expect(parser.parse()).resolves.toBeDefined();
    });

    it("Should throw error for the first duplicated flag encountered", () => {
      const command: CliCommand<{url: string; checkpointSyncUrl: string}> = {
        command: "test",
        describe: "Test command",
        options: {
          url: {
            type: "string",
            description: "URL",
          },
          checkpointSyncUrl: {
            type: "string",
            description: "Checkpoint sync URL",
          },
        },
        handler: async () => {
          throw new Error("Handler should not be called");
        },
      };

      const parser = yargs(
        hideBin([
          "node",
          "script",
          "test",
          "--url",
          "https://example1.com",
          "--url",
          "https://example2.com",
          "--checkpointSyncUrl",
          "https://checkpoint1.com",
          "--checkpointSyncUrl",
          "https://checkpoint2.com",
        ])
      );
      registerCommandToYargs(parser, command);

      // Should throw error mentioning at least one of the duplicated flags
      expect(() => parser.parseSync()).toThrow("is a single-value flag but was provided multiple times");
    });

    it("Should handle command with no options gracefully", async () => {
      const command: CliCommand = {
        command: "test",
        describe: "Test command",
        handler: async () => {
          // Empty handler
        },
      };

      const parser = yargs(hideBin(["node", "script", "test"]));
      registerCommandToYargs(parser, command);

      // Should not throw
      await expect(parser.parse()).resolves.toBeDefined();
    });

    it("Should reproduce the exact bug from the issue - checkpointSyncUrl", () => {
      const command: CliCommand<{checkpointSyncUrl: string}> = {
        command: "beacon",
        describe: "Run a beacon chain node",
        options: {
          checkpointSyncUrl: {
            type: "string",
            description: "Server url hosting Beacon Node APIs to fetch weak subjectivity state",
          },
        },
        handler: async () => {
          throw new Error("Handler should not be called");
        },
      };

      // Exact scenario from the bug report
      const parser = yargs(
        hideBin([
          "node",
          "lodestar",
          "beacon",
          "--checkpointSyncUrl",
          "https://checkpoint-sync.fusaka-devnet-4.ethpandaops.io",
          "--checkpointSyncUrl",
          "https://checkpoint-sync.fusaka-devnet-4.ethpandaops.io",
        ])
      );
      registerCommandToYargs(parser, command);

      // Should throw error instead of silently creating an array
      expect(() => parser.parseSync()).toThrow(
        "Option '--checkpointSyncUrl' is a single-value flag but was provided multiple times"
      );
      expect(() => parser.parseSync()).toThrow(
        "https://checkpoint-sync.fusaka-devnet-4.ethpandaops.io"
      );
    });
  });
});
