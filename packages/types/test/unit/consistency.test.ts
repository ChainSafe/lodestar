/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import {assert} from "chai";
import fs from "fs";
import path from "path";
import {types as sszTypes} from "../../src/presets/mainnet";
import * as primitiveTypes from "../../src/primitive/ssz";

const phase0Types = sszTypes.phase0;

describe("@chainsafe/lodestar-types phase0", () => {
  // interfaces are not available at run time, so we must parse our interface
  // files ourselves in order to retrieve their information

  // put interfaces and types into objects
  const interfaces = {};
  const types = {};
  const typesDir = path.join(__dirname, "/../../src/phase0/types/");
  // Get all ts files in our types directory
  const typeFiles = fs.readdirSync(typesDir).filter((s) => s.endsWith(".ts"));
  typeFiles.map((file) => {
    // Read file contents as a string
    const fileStr = fs
      .readFileSync(typesDir + file, "utf-8")
      // remove line comments
      .replace(/\/\/.*\n/g, "")
      // remove multiline comments
      .replace(/\/\*[\s\S]*?\*\//gm, "");
    let match: RegExpExecArray | null;
    // extract interface definitions
    const interfaceRe = /export interface (.*) {([\s\S]*?)}/g;
    // eslint-disable-next-line no-cond-assign
    while ((match = interfaceRe.exec(fileStr))) {
      const name = match[1];
      const fields = match[2]
        // remove newlines
        .replace(/\n/g, "")
        // remove spaces
        .replace(/ /g, "")
        // split fields by ;
        .split(";")
        // remove blank matches
        .filter((s: string) => s)
        // separate the field name from type
        .map((s: string) => {
          // eslint-disable-next-line prefer-const
          let [name, type] = s.split(":");
          // replace string [] with real []
          // allowing for nested arrays
          let nArr = 0;
          while (type.match(/\[\]/)) {
            type = type.replace("[]", "");
            nArr++;
          }
          for (let i = 0; i < nArr; i++) {
            // @ts-ignore
            type = [type];
          }
          // organize interface field name and type similarly to our runtime types
          return [name, type];
        });
      // @ts-ignore
      interfaces[name] = {
        name,
        fields,
      };
    }
    // extract type definitions
    const typeRe = /export type (.*) = (\S+);/g;
    while ((match = typeRe.exec(fileStr))) {
      const name = match[1];
      const t = match[2];
      // @ts-ignore
      types[name] = t;
    }
  });
  //
  // put runtime type variables into an object
  const vars: Record<string, any> = {};
  const blackList: Record<string, boolean> = {
    Boolean: true,
    CommitteeIndices: true,
    CommitteeBits: true,
    HistoricalBlockRoots: true,
    HistoricalStateRoots: true,
    DepositDataRootList: true,
    EpochAttestations: true,
  };
  for (const name in phase0Types) {
    if (!blackList[name] && !(primitiveTypes as any)[name]) {
      // @ts-ignore
      vars[name] = phase0Types[name];
    }
  }
  // Now that we have an object of interfaces and and object of runtime type variables, we can perform our tests
  it("Every runtime type variable should have a corresponding interface", () => {
    Object.keys(vars).map((name) => {
      if (!["phase1", "lightclient"].includes(name)) {
        assert(
          // @ts-ignore
          !!interfaces[name] || !!types[name],
          `interface ${name} does not exist`
        );
      }
    });
  });

  it("Every interface field name/type should have the corresponding runtime type field name/type in the same order", () => {
    // Utility function to check interface field type (parsed by hand to either an array or a string)
    // against runtime type field type (parsed normally, as an array, object, or string)
    const checkType = (ifaceName: any, ifaceFieldName: any, ifaceFieldType: any, rtFieldType: any): void => {
      if (Array.isArray(rtFieldType)) {
        assert.isTrue(
          Array.isArray(ifaceFieldType),
          `field type mismatch in ${ifaceName}, field ${ifaceFieldName}:
             interface field type is an array but corresponding interface field is not`
        );
        return checkType(ifaceName, ifaceFieldName, ifaceFieldType[0], rtFieldType[0]);
      } else if (typeof rtFieldType === "object" && rtFieldType.name) {
        assert.equal(
          ifaceFieldType,
          rtFieldType.name,
          `field type mismatch in ${ifaceName}, field ${ifaceFieldName}:
             interface field type: ${ifaceFieldType}, runtime type field name: ${rtFieldType.name}`
        );
      } else {
        let ifaceInferredFieldType = ifaceFieldType;
        // recursively traverse type aliases
        while (ifaceInferredFieldType) {
          // if their is a variable whose name is the interface field type and it is the same object thats passed in
          // @ts-ignore
          if (phase0Types[ifaceInferredFieldType] === rtFieldType) {
            return;
          }
          // @ts-ignore
          ifaceInferredFieldType = types[ifaceInferredFieldType];
        }
        assert.fail(
          `field type mismatch in ${ifaceName}, field ${ifaceFieldName}:
             interface field type: ${ifaceFieldType}, runtime type field name: ${rtFieldType}`
        );
      }
    };
    for (const rtVar of Object.values(vars)) {
      // @ts-ignore
      const iface = interfaces[rtVar.name];
      if (!iface) return;

      assert.equal(
        rtVar.fields.length,
        iface.fields.length,
        `interface and runtime type ${iface.name} have a differing number of fields`
      );
      for (let ix = 0; ix < iface.fields.length; ix++) {
        const [ifaceFieldName, ifaceFieldType] = iface.fields[ix];
        const [rtVarFieldName, rtVarFieldType] = rtVar.fields[ix];
        assert.equal(
          ifaceFieldName,
          rtVarFieldName,
          `field name mismatch in ${iface.name}:
               interface field name: ${ifaceFieldName}, runtime type field name: ${rtVarFieldName}`
        );
        checkType(iface.name, ifaceFieldName, ifaceFieldType, rtVarFieldType);
      }
    }
  });
});
