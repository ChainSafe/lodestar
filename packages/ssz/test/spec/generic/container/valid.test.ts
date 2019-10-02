/* eslint-disable */
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {
    IValidGenericSSZTestCase,
    parseBasicVectorType,
    IValidTestResult,
    parseBitListType,
    parseContainerType
} from "../utils";
import path from "path";
import {deserialize, hashTreeRoot, serialize, signingRoot, equals, Type, BitListType} from "../../../../src";
import {expect} from "chai";
import {TEST_CASE_LOCATION} from "../../../util/testCases";
import {fromYaml} from "@chainsafe/eth2.0-utils";

describeDirectorySpecTest<IValidGenericSSZTestCase, IValidTestResult>(
    "valid_container",
    path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/containers/valid"),
    ((testCase, directoryName) => {
        const containerType = parseContainerType(directoryName);
        return {
            decoded: deserialize(
                testCase.serialized_raw,
                containerType
            ),
            encoded: serialize(
                testCase.value,
                containerType
            ),
            root: hashTreeRoot(
                testCase.value,
                containerType
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
        // shouldSkip: (testCase, directory) => {
        //     return directory !== "VarTestStruct_zero_chaos_2";
        // },
        inputProcessing: {
            value: (value: any, directoryName: string) => {
                const containerType = parseContainerType(directoryName);
                return fromYaml(
                    value,
                    containerType
                );
            }
        },
        expectFunc: (testCase: IValidGenericSSZTestCase, expected: any, actual: IValidTestResult, directoryName: string) => {
            const containerType = parseContainerType(directoryName);
            expect(
                equals(
                    actual.decoded,
                    testCase.value,
                    containerType
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