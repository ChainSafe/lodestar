const yaml = require('js-yaml');
const expect = require('chai').expect;
const fs = require('fs');

class Eth2TestSpec {

  constructor (testYaml, it) {
    this.testSpec = yaml.safeLoad(
      fs.readFileSync(
        testYaml,
        'utf8'
      )
    );
    this.it = it;
  }

  test (func, testCases, convertInput, convertOutput, convertExpected) {
    const that = this;
    this.testSpec[testCases].forEach((testCase, index) => {
      that.it(testCases+`[${index}]`, function () {
        const inputs = convertInput(testCase.input);
        const result = func(...inputs);
        let expected = testCase.output;
        if(convertExpected) {
          expected = convertExpected(testCase.output);
        }
        expect(convertOutput(result)).to.be.equal(expected);
      });
    });

  }
}

module.exports = Eth2TestSpec;
