import {assert} from "chai";
import fs from "fs";
import path from "path";
import {describe, it} from "mocha";
import {types as sszTypes} from "../../src/presets/mainnet";

describe("@chainsafe/eth2.0-types", () => {
  // interfaces are not available at run time, so we must parse our interface
  // files ourselves in order to retrieve their information


  // put interfaces and types into objects
  const interfaces = {};
  const types = {};
  const typesDir = path.join(__dirname, "/../../../eth2.0-types/src/");
  // Get all ts files in our types directory
  const typeFiles = fs.readdirSync(typesDir).filter((s) => s.endsWith(".ts"));
  typeFiles.map((file) => {
    // Read file contents as a string
    const fileStr = fs.readFileSync(typesDir + file, "utf-8")
      // remove line comments
      .replace(/\/\/.*\n/g, "")
      // remove multiline comments
      .replace(/\/\*[\s\S]*?\*\//mg, "");
    let match;
    // extract interface definitions
    const interfaceRe = /export interface (.*) {([\s\S]*?)}/g;
    while (match = interfaceRe.exec(fileStr)) {
      const name = match[1];
      const fields = match[2]
        // remove newlines
        .replace(/\n/g, "")
        // remove spaces
        .replace(/ /g, "")
        // split fields by ;
        .split(";")
        // remove blank matches
        .filter((s) => s)
        // separate the field name from type
        .map((s) => {
          let [name, type] = s.split(":");
          // replace string [] with real []
          // allowing for nested arrays
          let nArr = 0;
          while (type.match(/\[\]/)) {
            type = type.replace("[]", "");
            nArr++;
          }
          for (let i = 0; i < nArr; i++) {
            type = [type];
          }
          // organize interface field name and type similarly to our runtime types
          return [name, type];
        });
      interfaces[name] = {
        name,
        fields,
      };
    }
    // extract type definitions
    const typeRe = /export type (.*) = (\S+);/g;
    while (match = typeRe.exec(fileStr)) {
      const name = match[1];
      const t = match[2];
      types[name] = t;
    }
  });
  //
  // put runtime type variables into an object
  const vars = {};
  for (const name in sszTypes) {
    vars[name] = sszTypes[name];
  }
  // Now that we have an object of interfaces and and object of runtime type variables, we can perform our tests
  it("Every runtime type variable should have a corresponding interface", () => {
    Object.keys(vars)
      .map((name) => {
        assert(
          !!interfaces[name] || !!types[name],
          `interface ${name} does not exist`);
      });
  });
  it("Every interface field name/type should have the corresponding runtime type field name/type in the same order", () => {
    // Utility function to check interface field type (parsed by hand to either an array or a string)
    // against runtime type field type (parsed normally, as an array, object, or string)
    const checkType = (ifaceName, ifaceFieldName, ifaceFieldType, rtFieldType) => {
      if (Array.isArray(rtFieldType)) {
        assert.isTrue(
          Array.isArray(ifaceFieldType),
          `field type mismatch in ${ifaceName}, field ${ifaceFieldName}:
             interface field type is an array but corresponding interface field is not`);
        return checkType(ifaceName, ifaceFieldName, ifaceFieldType[0], rtFieldType[0]);
      } else if (typeof rtFieldType === "object" && rtFieldType.name) {
        assert.equal(
          ifaceFieldType, rtFieldType.name,
          `field type mismatch in ${ifaceName}, field ${ifaceFieldName}:
             interface field type: ${ifaceFieldType}, runtime type field name: ${rtFieldType.name}`);
      } else {
        let ifaceInferredFieldType = ifaceFieldType;
        // recursively traverse type aliases
        while (ifaceInferredFieldType) {
          // if their is a variable whose name is the interface field type and it is the same object thats passed in
          if (sszTypes[ifaceInferredFieldType] === rtFieldType) {
            return;
          }
          ifaceInferredFieldType = types[ifaceInferredFieldType];
        }
        assert.fail(
          `field type mismatch in ${ifaceName}, field ${ifaceFieldName}:
             interface field type: ${ifaceFieldType}, runtime type field name: ${rtFieldType}`);
      }
    };
    Object.values(vars)
      .forEach((rtVar: any) => {
        const iface = interfaces[rtVar.name];
        if (!iface) return;

        assert.equal(
          rtVar.fields.length, iface.fields.length,
          `interface and runtime type ${iface.name} have a differing number of fields`);
        for (let ix = 0; ix < iface.fields.length; ix++) {
          const [ifaceFieldName, ifaceFieldType] = iface.fields[ix];
          const [rtVarFieldName, rtVarFieldType] = rtVar.fields[ix];
          assert.equal(
            ifaceFieldName, rtVarFieldName,
            `field name mismatch in ${iface.name}:
               interface field name: ${ifaceFieldName}, runtime type field name: ${rtVarFieldName}`);
          checkType(iface.name, ifaceFieldName, ifaceFieldType, rtVarFieldType);
        }
      });
  });
});
