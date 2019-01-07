/*
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
*/


/* Test ECP2 ARITHMETICS - test driver and function exerciser for ECP2 API Functions */

var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var pf_curves = ['BN254', 'BN254CX', 'BLS381', 'BLS383', 'BLS461', 'FP256BN', 'FP512BN'];

var readBIG = function(string, ctx) {
    while (string.length != ctx.BIG.MODBYTES*2){string = "00"+string;}
    return ctx.BIG.fromBytes(Buffer.from(string, "hex"));
}

var readPoint2 = function(string, ctx) {
    var P = new ctx.ECP2(),
        X, Y;

    var coxy = string.split("&");
    var cox = coxy[0].split(":");
    var coy = coxy[1].split(":");

    var x1 = readBIG(cox[0],ctx);
    var x2 = readBIG(cox[1],ctx);
    var y1 = readBIG(coy[0],ctx);
    var y2 = readBIG(coy[1],ctx);

    X = new ctx.FP2(x1,x2);
    Y = new ctx.FP2(y1,y2);
    P.setxy(X,Y);

    return P;
}

describe('TEST ECP2 ARITHMETIC', function() {

    pf_curves.forEach(function(curve) {

        it('test '+curve, function(done) {
            this.timeout(0);

            var ctx = new CTX(curve);
            var vectors = require('../testVectors/ecp2/'+curve+'.json');

            var i = 0;
            vectors.forEach(function(vector) {
                var P1 = readPoint2(vector.ECP21,ctx);
                var Paux1 = new ctx.ECP2(0);

                // test copy and equals
                Paux1.copy(P1);
                expect(Paux1.equals(P1)).to.equal(true);

                // test that y^2 = RHS
                var x = Paux1.getx();
                var y = Paux1.gety();
                y.sqr();
                var res = ctx.ECP2.RHS(x);

                expect(res.toString()).to.equal(y.toString());

                // test commutativity of the sum
                var P2 = readPoint2(vector.ECP22,ctx);
                var Psum = readPoint2(vector.ECP2sum,ctx);
                var Paux2 = new ctx.ECP2(0);
                Paux1.copy(P1);
                Paux2.copy(P2);
                Paux1.add(P2);
                Paux2.add(P1);
                expect(Paux1.toString()).to.equal(Psum.toString());
                expect(Paux2.toString()).to.equal(Psum.toString());

                // test associativity of the sum
                Paux2.copy(P1);
                Paux2.add(P2);
                Paux2.add(Psum);
                Paux1.add(Psum)
                expect(Paux1.toString()).to.equal(Paux2.toString());

                // test negative of a point
                var Pneg = readPoint2(vector.ECP2neg,ctx);
                Paux1.copy(P1);
                Paux1.neg();
                expect(Paux1.toString()).to.equal(Pneg.toString());

                // test subtraction between points
                var Psub = readPoint2(vector.ECP2sub,ctx);
                Paux1.copy(P1);
                Paux1.sub(P2);
                expect(Paux1.toString()).to.equal(Psub.toString());

                // test doubling
                var Pdbl = readPoint2(vector.ECP2dbl,ctx);
                Paux1.copy(P1);
                Paux1.dbl();
                expect(Paux1.toString()).to.equal(Pdbl.toString());

                // test scalar multiplication
                var Pmul = readPoint2(vector.ECP2mul,ctx);
                var Scalar1 = readBIG(vector.BIGscalar1, ctx);
                Paux1.copy(P1);
                Paux1 = Paux1.mul(Scalar1);
                expect(Paux1.toString()).to.equal(Pmul.toString());

                // test linear mul4, linear combination of 4 points
                // Only executed once for timing reasons
                if (i===0){
                    i++;
                    var P3 = readPoint2(vector.ECP23,ctx);
                    var P4 = readPoint2(vector.ECP24,ctx);
                    var Scalar2 = readBIG(vector.BIGscalar2, ctx);
                    var Scalar3 = readBIG(vector.BIGscalar3, ctx);
                    var Scalar4 = readBIG(vector.BIGscalar4, ctx);
                    var Pmul4 = readPoint2(vector.ECP2mul4,ctx);
                    Paux1 = ctx.ECP2.mul4([P1,P2,P3,P4],[Scalar1,Scalar2,Scalar3,Scalar4]);
                    expect(Paux1.toString()).to.equal(Pmul4.toString());
                }

                // test wrong coordinates and infinity point
                var Pwrong = readPoint2(vector.ECP2wrong,ctx);
                var Pinf = readPoint2(vector.ECP2inf,ctx);
                expect(Pwrong.is_infinity()).to.equal(true);
                expect(Pinf.is_infinity()).to.equal(true);
                expect(Pwrong.equals(Pinf)).to.equal(true);
            });
            done();
        });
    });
});