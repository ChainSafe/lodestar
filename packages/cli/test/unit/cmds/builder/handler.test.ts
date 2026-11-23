import {describe, expect, it} from "vitest";
import {chainConfig} from "@lodestar/config/default";
import {MAX_BUILDER_AUTH_DATA_SIZE} from "@lodestar/params";
import {LogLevel} from "@lodestar/utils";
import {builderHandler, getBuilderApiAuthData} from "../../../../src/cmds/builder/handler.js";
import {IBuilderCliArgs} from "../../../../src/cmds/builder/options.js";
import {GlobalArgs} from "../../../../src/options/index.js";
import {testFilesDir} from "../../../utils.js";

describe("cmds / builder / args handler", () => {
  const ZERO_ADDRESS = "0x" + "0".repeat(40);
  const VALID_FEE_RECIPIENT = "0x" + "1".repeat(40);

  async function runBuilderHandler(
    args: Partial<IBuilderCliArgs & GlobalArgs> & Record<string, unknown>
  ): Promise<void> {
    return builderHandler({
      logLevel: LogLevel.info,
      logFileLevel: LogLevel.debug,
      dataDir: testFilesDir,
      executionFeeRecipient: VALID_FEE_RECIPIENT,
      ...args,
    } as unknown as IBuilderCliArgs & GlobalArgs);
  }

  it("Should reject unscheduled Gloas", async () => {
    await expect(runBuilderHandler({})).rejects.toThrow("Gloas must be scheduled via GLOAS_FORK_EPOCH");
  });

  it("Should reject zero executionFeeRecipient", async () => {
    // Rejecting with the fee recipient error rather than the Gloas error also proves the
    // fork guard read the epoch merged in from CLI args, not from the default config
    await expect(
      runBuilderHandler({
        "params.GLOAS_FORK_EPOCH": String(chainConfig.FULU_FORK_EPOCH + 1),
        executionFeeRecipient: ZERO_ADDRESS,
      })
    ).rejects.toThrow("Cannot put zero address as an executionFeeRecipient");
  });
});

describe("cmds / builder / getBuilderApiAuthData", () => {
  it("Should use the hostname of the public url", () => {
    const authData = getBuilderApiAuthData({"builderApi.publicUrl": "https://builder.example.com:18550/path"});

    expect(new TextDecoder().decode(authData)).toBe("builder.example.com");
  });

  it("Should prefer the configured auth data over the public url", () => {
    const authData = getBuilderApiAuthData({
      "builderApi.authData": "0x0102",
      "builderApi.publicUrl": "https://builder.example.com",
    });

    expect(authData).toEqual(new Uint8Array([1, 2]));
  });

  it.each([
    {id: "without a scheme", publicUrl: "builder.example.com:18550"},
    {id: "that is not a url", publicUrl: "builder.example.com"},
  ])("Should reject a public url $id", ({publicUrl}) => {
    expect(() => getBuilderApiAuthData({"builderApi.publicUrl": publicUrl})).toThrow(
      "--builderApi.publicUrl must be a URL with a scheme and a hostname"
    );
  });

  it("Should reject empty auth data", () => {
    expect(() => getBuilderApiAuthData({"builderApi.authData": "0x"})).toThrow(
      "--builderApi.authData must not be empty"
    );
  });

  it("Should accept auth data of the maximum size", () => {
    const authData = getBuilderApiAuthData({"builderApi.authData": "0x" + "01".repeat(MAX_BUILDER_AUTH_DATA_SIZE)});

    expect(authData).toHaveLength(MAX_BUILDER_AUTH_DATA_SIZE);
  });

  it("Should reject auth data proposers cannot sign", () => {
    const authData = "0x" + "01".repeat(MAX_BUILDER_AUTH_DATA_SIZE + 1);

    expect(() => getBuilderApiAuthData({"builderApi.authData": authData})).toThrow(
      `--builderApi.authData must not be longer than ${MAX_BUILDER_AUTH_DATA_SIZE} bytes`
    );
  });

  it("Should reject missing public url and auth data", () => {
    expect(() => getBuilderApiAuthData({})).toThrow(
      "--builderApi requires either --builderApi.publicUrl or --builderApi.authData"
    );
  });
});
