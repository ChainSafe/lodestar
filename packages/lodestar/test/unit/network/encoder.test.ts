import {ReqRespEncoder} from "../../../src/network/encoder";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Method, ReqRespEncoding} from "../../../src/constants";
import {expect} from "chai";
import pipe from "it-pipe";
import {ResponseChunk} from "../../../src/network";

describe("ReqResp encoder", function () {

    describe("ssz encoding", function () {

        const encoder = new ReqRespEncoder(config, ReqRespEncoding.SSZ);

        it("should be able to encode and decode request", function () {
            const request = BigInt(1);
            const encodedRequest = encoder.encodeRequest(Method.Goodbye, request);
            const result = encoder.decodeRequest(Method.Goodbye, encodedRequest);
            expect(result).to.be.deep.equal(request)
        });

        it("should be able to encode and decode stream", async function () {
            const source = [{output: 0n}, {output: 2n}, {output: 3n}, {output: 4n}];
            const result = await pipe(
                source,
                encoder.encodeResponse(Method.Goodbye),
                encoder.decodeResponse(Method.Goodbye),
                async function collect(source: AsyncIterable<ResponseChunk>) {
                    const result = [];
                    for await (const chunk of source) {
                        result.push(chunk);
                    }
                    return result;
                }
            );
            expect(result).to.be.deep.equal(source.map((val) => val.output));
        })

    });

    describe("ssz snappy encoding", function () {

        const encoder = new ReqRespEncoder(config, ReqRespEncoding.SSZ_SNAPPY);

        it("should be able to encode and decode request", function () {
            const request = BigInt(1);
            const encodedRequest = encoder.encodeRequest(Method.Goodbye, request);
            const result = encoder.decodeRequest(Method.Goodbye, encodedRequest);
            expect(result).to.be.deep.equal(request)
        })

        it("should be able to encode and decode stream", async function () {
            const source = [{output: 0n}, {output: 2n}, {output: 3n}, {output: 4n}];
            const result = await pipe(
                source,
                encoder.encodeResponse(Method.Goodbye),
                encoder.decodeResponse(Method.Goodbye),
                async function collect(source: AsyncIterable<ResponseChunk>) {
                    const result = [];
                    for await (const chunk of source) {
                        result.push(chunk);
                    }
                    return result;
                }
            );
            expect(result).to.be.deep.equal(source.map((val) => val.output));
        })

    });

});