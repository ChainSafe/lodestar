import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import tmp from "tmp";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SignableENR} from "@chainsafe/enr";
import {LogLevel} from "@lodestar/utils";
import {initPrivateKeyAndEnr, overwriteEnrWithCliArgs} from "../../../src/cmds/beacon/initPeerIdAndEnr.js";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {testLogger} from "../../utils.js";

const logger = testLogger();

beforeEach(() => {
  vi.spyOn(os, "networkInterfaces").mockReturnValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("overwriteEnrWithCliArgs", () => {
  it("should set tcp and quic fields by default", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);

    overwriteEnrWithCliArgs(enr, {listenAddress: "0.0.0.0", port: 9000, nat: true} as unknown as BeaconArgs, logger);

    expect(enr.tcp).toBe(9000);
    expect(enr.quic).toBe(9001);
  });

  it("should set both tcp and quic fields when quic is true", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);

    overwriteEnrWithCliArgs(
      enr,
      {listenAddress: "0.0.0.0", port: 9000, quic: true, nat: true} as unknown as BeaconArgs,
      logger
    );

    expect(enr.tcp).toBe(9000);
    expect(enr.quic).toBe(9001);
  });

  it("should not set tcp fields when tcp is false", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);

    overwriteEnrWithCliArgs(
      enr,
      {listenAddress: "0.0.0.0", port: 9000, tcp: false, quic: true, nat: true} as unknown as BeaconArgs,
      logger
    );

    expect(enr.tcp).toBeUndefined();
    expect(enr.tcp6).toBeUndefined();
    expect(enr.quic).toBe(9001);
  });

  it("should not set quic fields when quic is false", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);

    overwriteEnrWithCliArgs(
      enr,
      {listenAddress: "0.0.0.0", port: 9000, quic: false, nat: true} as unknown as BeaconArgs,
      logger
    );

    expect(enr.tcp).toBe(9000);
    expect(enr.quic).toBeUndefined();
    expect(enr.quic6).toBeUndefined();
  });

  it("should clear pre-existing tcp fields when tcp is false", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    enr.tcp = 9000;

    overwriteEnrWithCliArgs(
      enr,
      {listenAddress: "0.0.0.0", port: 9000, tcp: false, nat: true} as unknown as BeaconArgs,
      logger
    );

    expect(enr.tcp).toBeUndefined();
  });

  it("should preserve existing enr quic port when no explicit quicPort given", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    // Simulate a persisted ENR that already had quic advertised
    enr.quic = 9001;

    // No quicPort arg, no enr.quic arg — should fall back to existing enr value
    overwriteEnrWithCliArgs(
      enr,
      {listenAddress: "0.0.0.0", port: 9000, quic: true, nat: true} as unknown as BeaconArgs,
      logger
    );

    expect(enr.quic).toBe(9001);
  });

  it.each([false, true])(
    "should clear persisted IPv6 fields without an IPv6 listener (bootnode=%s)",
    async (bootnode) => {
      const privateKey = await generateKeyPair("secp256k1");
      const enr = SignableENR.createFromPrivateKey(privateKey);
      enr.ip = "127.0.0.1";
      enr.ip6 = "::1";
      enr.udp6 = 9002;
      enr.tcp6 = 9002;
      enr.quic6 = 9003;

      const warn = vi.spyOn(logger, LogLevel.warn);
      const args = {listenAddress: "0.0.0.0", port: 9000, nat: true} as BeaconArgs;
      const seq = enr.seq;

      overwriteEnrWithCliArgs(enr, args, logger, {bootnode});

      expect(enr.ip).toBe("127.0.0.1");
      expect(enr.ip6).toBeUndefined();
      expect(enr.udp6).toBeUndefined();
      expect(enr.tcp6).toBeUndefined();
      expect(enr.quic6).toBeUndefined();
      expect(enr.seq).toBe(seq + 1n);
      expect(warn).toHaveBeenCalledOnce();

      warn.mockClear();
      overwriteEnrWithCliArgs(enr, args, logger, {bootnode});
      expect(enr.seq).toBe(seq + 1n);
      expect(warn).not.toHaveBeenCalled();
    }
  );

  it.each(["udp6", "tcp6", "quic6"] as const)("should warn when clearing a persisted %s without ip6", async (key) => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    enr[key] = 9002;
    const warn = vi.spyOn(logger, LogLevel.warn);

    overwriteEnrWithCliArgs(enr, {listenAddress: "0.0.0.0"} as BeaconArgs, logger);

    expect(enr[key]).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([{"enr.ip6": "2001:db8::1"}, {"enr.udp6": 9002}, {"enr.tcp6": 9002}, {"enr.quic6": 9003}])(
    "should keep persisted IPv6 fields with explicit %j",
    async (args) => {
      const privateKey = await generateKeyPair("secp256k1");
      const enr = SignableENR.createFromPrivateKey(privateKey);
      enr.ip6 = "2001:db8::1";
      enr.udp6 = 9002;
      enr.tcp6 = 9002;
      enr.quic6 = 9003;
      const warn = vi.spyOn(logger, LogLevel.warn);

      overwriteEnrWithCliArgs(enr, {...args, listenAddress: "0.0.0.0", nat: true} as BeaconArgs, logger);

      expect(enr.ip6).toBe("2001:db8::1");
      expect(enr.udp6).toBe(9002);
      expect(enr.tcp6).toBe(9002);
      expect(enr.quic6).toBe(9003);
      expect(warn).not.toHaveBeenCalled();
    }
  );

  it("should not warn about clearing IPv6 fields in a new ENR", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    const warn = vi.spyOn(logger, LogLevel.warn);

    overwriteEnrWithCliArgs(enr, {listenAddress: "0.0.0.0"} as BeaconArgs, logger);

    expect(warn).not.toHaveBeenCalled();
  });

  it("should keep persisted IPv6 fields when an IPv6 listener is configured", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    enr.ip6 = "::1";

    overwriteEnrWithCliArgs(
      enr,
      {listenAddress: "0.0.0.0", listenAddress6: "::", port: 9000, nat: true} as unknown as BeaconArgs,
      logger
    );

    expect(enr.ip6).toBe("::1");
    expect(enr.udp6).toBe(9000);
    expect(enr.tcp6).toBe(9000);
    expect(enr.quic6).toBe(9001);
  });

  it("should keep explicit enr IPv6 fields without an IPv6 listener", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);

    overwriteEnrWithCliArgs(
      enr,
      {
        listenAddress: "0.0.0.0",
        port: 9000,
        "enr.ip6": "2001:db8::1",
        "enr.udp6": 9002,
        nat: true,
      } as unknown as BeaconArgs,
      logger
    );

    expect(enr.ip6).toBe("2001:db8::1");
    expect(enr.udp6).toBe(9002);
  });
});

describe("initPeerIdAndEnr", () => {
  let tmpDir: tmp.DirResult;

  beforeEach(() => {
    tmpDir = tmp.dirSync();
  });

  afterEach(() => {
    fs.rmSync(tmpDir.name, {recursive: true});
  });

  it.each([
    {args: {}, shouldWarn: true},
    {args: {listenAddress: "0.0.0.0"}, shouldWarn: false},
    {args: {listenAddress6: "::"}, shouldWarn: false},
    {args: {listenAddress: "0.0.0.0", listenAddress6: "::"}, shouldWarn: false},
  ])("should warn=$shouldWarn without a global IPv6 address and args=$args", async ({args, shouldWarn}) => {
    const warn = vi.spyOn(logger, LogLevel.warn);

    await initPrivateKeyAndEnr(args as BeaconArgs, tmpDir.name, logger);

    expect(warn).toHaveBeenCalledTimes(shouldWarn ? 1 : 0);
  });

  it("should not warn when the host has a global IPv6 address", async () => {
    vi.mocked(os.networkInterfaces).mockReturnValue({
      eth0: [
        {
          address: "2a01:4ff:f4:3c4a::1",
          family: "IPv6",
          internal: false,
          netmask: "ffff:ffff:ffff:ffff::",
          mac: "00:00:00:00:00:00",
          cidr: "2a01:4ff:f4:3c4a::1/64",
          scopeid: 0,
        },
      ],
    });
    const warn = vi.spyOn(logger, LogLevel.warn);

    const {enr} = await initPrivateKeyAndEnr({} as BeaconArgs, tmpDir.name, logger);

    expect(enr.udp6).toBe(9000);
    expect(warn).not.toHaveBeenCalled();
  });

  it("should persist IPv6 cleanup when restarting on an IPv4-only host", async () => {
    const initial = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true, listenAddress6: "::", "enr.ip6": "2001:db8::1", nat: true} as BeaconArgs,
      tmpDir.name,
      logger
    );

    const {enr, privateKey} = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true} as BeaconArgs,
      tmpDir.name,
      logger
    );

    expect(privateKey.equals(initial.privateKey)).toBe(true);
    expect(enr.seq).toBe(initial.enr.seq + 1n);
    const persistedEnr = SignableENR.decodeTxt(fs.readFileSync(path.join(tmpDir.name, "enr"), "utf8"), privateKey.raw);
    expect(persistedEnr.encodeTxt()).toBe(enr.encodeTxt());
    expect(persistedEnr.ip6).toBeUndefined();
    expect(persistedEnr.udp6).toBeUndefined();
    expect(persistedEnr.tcp6).toBeUndefined();
    expect(persistedEnr.quic6).toBeUndefined();
  });

  it("first time should create a new enr and peer id", async () => {
    const {enr, privateKey} = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true} as unknown as BeaconArgs,
      tmpDir.name,
      logger,
      true
    );
    // "enr peer id doesn't equal the returned peer id"
    expect(enr.peerId.toString()).toBe(peerIdFromPrivateKey(privateKey).toString());
    expect(enr.seq).toBe(BigInt(1));
    expect(enr.tcp).toBeUndefined();
    expect(enr.tcp6).toBeUndefined();
  });

  it("second time should use ths existing enr and peer id", async () => {
    const run1 = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true} as unknown as BeaconArgs,
      tmpDir.name,
      logger,
      true
    );

    const run2 = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true} as unknown as BeaconArgs,
      tmpDir.name,
      logger,
      true
    );

    expect(run1.privateKey.equals(run2.privateKey)).toBe(true);
    expect(run1.enr.encodeTxt()).toBe(run2.enr.encodeTxt());
  });
});
