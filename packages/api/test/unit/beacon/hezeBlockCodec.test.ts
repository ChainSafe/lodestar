import {describe, expect, it} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, ForkPostGloas} from "@lodestar/params";
import {SignedBlockContents, ssz} from "@lodestar/types";
import {BroadcastValidation, getDefinitions} from "../../../src/beacon/routes/beacon/block.js";
import {getDefinitions as getLodestarDefinitions} from "../../../src/beacon/routes/lodestar.js";
import {MetaHeader} from "../../../src/utils/metadata.js";

describe("post-Gloas block codecs", () => {
  for (const fork of [ForkName.gloas, ForkName.heze] as const) {
    it(`round-trips ${fork} signed blocks through JSON and SSZ`, () => {
      const config = getConfig(fork);
      const signedBlock = ssz[fork].SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = 1;
      signedBlock.message.body.graffiti.fill(1);
      signedBlock.message.body.signedExecutionPayloadBid.message.blockHash.fill(2);
      const {publishBlockV2, getBlockV2} = getDefinitions(config);
      const args = {
        signedBlockContents: {signedBlock} as SignedBlockContents<ForkPostGloas>,
        broadcastValidation: BroadcastValidation.consensus,
        builderUrl: "https://builder.example.com",
      };
      const jsonRequest = publishBlockV2.req.writeReqJson(args);
      const sszRequest = publishBlockV2.req.writeReqSsz(args);
      const headers = {
        ...jsonRequest.headers,
        [MetaHeader.Version.toLowerCase()]: fork,
        [MetaHeader.BuilderUrl.toLowerCase()]: args.builderUrl,
      };
      expect(publishBlockV2.req.parseReqJson({...jsonRequest, headers})).toEqual(args);
      expect(publishBlockV2.req.parseReqSsz({...sszRequest, headers})).toEqual(args);
      if (fork === ForkName.heze) {
        expect(jsonRequest.body).not.toHaveProperty("message.body.eth1_data");
        expect(jsonRequest.body).not.toHaveProperty("message.body.deposits");
      }
      const meta = {version: fork, executionOptimistic: false, finalized: false};
      expect(getBlockV2.resp.data.fromJson(getBlockV2.resp.data.toJson(signedBlock, meta), meta)).toEqual(signedBlock);
      expect(getBlockV2.resp.data.deserialize(getBlockV2.resp.data.serialize(signedBlock, meta), meta)).toEqual(
        signedBlock
      );

      const {getAttesterSlashingsFromBlocks} = getLodestarDefinitions(config);
      const blocksArgs = {signedBlocks: [signedBlock]};
      const requestCodec = getAttesterSlashingsFromBlocks.req;
      expect(requestCodec.parseReqJson({...requestCodec.writeReqJson(blocksArgs), headers})).toEqual(blocksArgs);
      expect(requestCodec.parseReqSsz({...requestCodec.writeReqSsz(blocksArgs), headers})).toEqual(blocksArgs);
    });
  }
});
