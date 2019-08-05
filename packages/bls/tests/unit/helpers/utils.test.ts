import {expect} from "chai";
import {padLeft} from "../../../src/helpers/utils";
import {G1point} from "../../../src/helpers/g1point";

describe('helpers tests', function() {

    describe('padLeft', function() {

        it('throw if source larger than target', () => {
           expect(
               () => padLeft(Buffer.alloc(2, 0), 1)
           ).to.throw;
        });

        it('pad one 0 on left side', () => {
            const result = padLeft(
                Buffer.alloc(1, 1),
                2
            );
            expect(result.length).to.be.equal(2);
            expect(result[0]).to.be.equal(0);
            expect(result[1]).to.be.equal(1);
        });

    });

});
