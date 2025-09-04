import {describe, expect, it} from "vitest";
import {ClientCode} from "../../../src/execution/index.js";
import {getLodestarClientVersion} from "../../../src/util/metadata.js";
import {serializeCgc} from "../../../src/util/metadata.js";

describe("util / metadata", () => {
  describe("getLodestarClientVersion", () => {
    it("should return empty version and commit", () => {
      const expected = {code: ClientCode.LS, name: "Lodestar", version: "", commit: ""};
      expect(getLodestarClientVersion()).toEqual(expected);
    });
    it("should return full client info", () => {
      const info = {version: "v0.36.0/80c248b", commit: "80c248bb392f512cc115d95059e22239a17bbd7d"}; // Version and long commit from readAndGetGitData()
      const expected = {code: ClientCode.LS, name: "Lodestar", version: "v0.36.0/80c248b", commit: "80c248bb"};
      expect(getLodestarClientVersion(info)).toEqual(expected);
    });
  });

  describe("serializeCgc", () => {
    it("should serialize CGC value of 0", () => {
      const result = serializeCgc(0);
      expect(new Uint8Array(result)).toEqual(new Uint8Array([]));
    });

    it("should serialize CGC value of 4", () => {
      const result = serializeCgc(4);
      expect(new Uint8Array(result)).toEqual(new Uint8Array([4]));
    });

    it("should serialize CGC value of 512", () => {
      const result = serializeCgc(512);
      expect(new Uint8Array(result)).toEqual(new Uint8Array([2, 0]));
    });
  });
});
