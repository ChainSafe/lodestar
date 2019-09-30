/* eslint-disable */
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IValidGenericSSZTestCase, parseBitVectorType, IValidTestResult, parseBitListType} from "../utils";
import path from "path";
import {deserialize, hashTreeRoot, serialize, signingRoot, equals, Type, BitListType} from "../../../../src";
import {expect} from "chai";
import {TEST_CASE_LOCATION} from "../../../util/testCases";
import {fromYaml} from "@chainsafe/eth2.0-utils";

describeDirectorySpecTest<IValidGenericSSZTestCase, IValidTestResult>(
    "valid_bitlist",
    path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/bitlist/valid"),
    ((testCase, directoryName) => {
        const bitListType = {type: Type.bitList, maxLength: parseBitListType(directoryName).limit.toNumber()} as BitListType;
        return {
            decoded: deserialize(
                testCase.serialized_raw,
                bitListType
            ),
            encoded: serialize(
                testCase.value,
                bitListType
            ),
            root: hashTreeRoot(
                testCase.value,
                bitListType
            ),
            signingRoot: !testCase.meta.signingRoot ?
                null :
                // @ts-ignore
                signingRoot(testCase.value, bitListType),
        };
    }),
    {
        inputTypes: {
            meta: InputType.YAML,
            value: InputType.YAML,
            serialized_raw: InputType.SSZ
        },
        inputProcessing: {
            value: (value: any, directoryName: string) => {
                const bitListType = {type: Type.bitList, maxLength: parseBitListType(directoryName).limit.toNumber()} as BitListType;
                return fromYaml(
                    value,
                    bitListType
                );
            }
        },
        expectFunc: (testCase: IValidGenericSSZTestCase, expected: any, actual: IValidTestResult, directoryName: string) => {
            const bitListType = {type: Type.bitList, maxLength: parseBitListType(directoryName).limit.toNumber()} as BitListType;
            expect(
                equals(
                    actual.decoded,
                    testCase.value,
                    bitListType
                )
            ).to.be.true;
            expect(actual.encoded).to.be.deep.equal(testCase.serialized_raw);
            expect(actual.root)
                .to.be.deep.equal(Buffer.from(testCase.meta.root.replace("0x", ""), "hex"));
            if(testCase.meta.signingRoot) {
                expect(actual.signingRoot)
                    .to.be.deep.equal(
                    Buffer.from(
                        testCase.meta.signingRoot.replace("0x", ""),
                        "hex"
                    )
                );
            }
        },
        unsafeInput: false,
    }
);