import {Command} from "commander";
import sinon from "sinon";
import {generateCommanderOptions, optionsToConfig} from "../../src/util";
import {expect} from "chai";

describe('cli option generation', function () {

  it('should generate commander options', function () {
    const commandStub = sinon.createStubInstance(Command);
    generateCommanderOptions(
      commandStub as unknown as Command,
      {
        name: "test",
        fields: [
          {
            name: "module1",
            fields: [
              {
                name: "prop1",
                description: "prop1 description",
                type: String,
                configurable: true,
                cli: {
                  short: 'd',
                  flag: 'prop1Flag'
                }
              }
            ]
          },
          {
            name: "notConfigurable",
            type: Boolean,
            configurable: false
          }
        ]
      });
    expect(commandStub.option.calledOnceWith("-d, --prop1Flag <prop1>", "prop1 description", sinon.match.func)).to.be.true;
    expect(commandStub.option.callCount).to.be.equal(1);
  });

  it('should convert cli options to config', function () {
    const config = optionsToConfig<any>(
      {
        prop1Flag: "something",
        unsupportedOption: "oh well"
      },
      {
        name: "test",
        fields: [
          {
            name: "module1",
            fields: [
              {
                name: "prop1",
                description: "prop1 description",
                type: String,
                validation: (input) => input === "something",
                configurable: true,
                cli: {
                  short: 'd',
                  flag: 'prop1Flag'
                }
              }
            ]
          },
          {
            name: "notConfigurable",
            type: Boolean,
            configurable: false
          }
        ]
      }
    );
    expect(config.module1.prop1).to.be.equal("something");
    expect(config.unsupportedOption).to.be.undefined;
  });

});
