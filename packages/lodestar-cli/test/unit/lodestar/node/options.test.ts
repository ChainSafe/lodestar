import {expect} from "chai";
import { BeaconNodeOptions } from "../../../../src/lodestar/node/options";
import { getCliFields } from "../../../../src/lodestar/util/config";

describe('beacon node options', function () {

  it('should not have duplicate flags', function () {
    const fields = getCliFields(BeaconNodeOptions);
    expect(fields.every((field) => {
      const duplicates = fields.filter(
        value =>
          value.cli.flag === field.cli.flag
          || (value.cli.short && value.cli.short === field.cli.short)
      ).length;
      if(duplicates > 1) {
        console.log(`${field.cli.flag}/${field.cli.short} has ${duplicates} duplicates`);
        return false;
      } else {
        return true;
      }
    }
    )).to.be.true;
  });

});
