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


/* Test ECP ARITHMETICS - test driver and function exerciser for ECP API Functions */

var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var ecp_curves = ['ED25519', 'GOLDILOCKS', 'NIST256', 'BRAINPOOL', 'ANSSI', 'HIFIVE', 'C25519', 'SECP256K1', 'NIST384', 'C41417',
     'NIST521', 'NUMS256W', 'NUMS384W', 'NUMS512W', 'BN254', 'BN254CX', 'BLS383', 'BLS461', 'FP256BN', 'FP512BN', 'BLS24', 'BLS48'
];

var readBIG = function(string, ctx) {
    while (string.length != ctx.BIG.MODBYTES*2){string = "00"+string;}
    return ctx.BIG.fromBytes(Buffer.from(string, "hex"));
}

var readPoint = function(string, ctx) {
    var P = new ctx.ECP(),
        X,Y;

    string = string.split(":");

    X = readBIG(string[0],ctx);
    Y = readBIG(string[1],ctx);
    P.setxy(X,Y);

    return P;
}

describe('TEST ECP ARITHMETIC', function() {

    ecp_curves.forEach(function(curve) {

        it('test '+ curve, function(done) {
            this.timeout(0);

            var ctx = new CTX(curve);
            var vectors = require('../testVectors/ecp/'+curve+'.json');

            vectors.forEach(function(vector) {
                var P1 = readPoint(vector.ECP1,ctx);
                var Paux1 = new ctx.ECP(0);

                // test copy and equals
                Paux1.copy(P1);
                expect(Paux1.equals(P1)).to.equal(true);

                if (ctx.ECP.CURVETYPE != ctx.ECP.MONTGOMERY) {
                    // test that y^2 = RHS
                    var x = Paux1.getx();
                    var y = Paux1.gety();
                    y.sqr();
                    x = ctx.ECP.RHS(x);

                    expect(x.toString()).to.equal(y.toString());

		            // test commutativity of the sum
		            var P2 = readPoint(vector.ECP2,ctx);
		            var Psum = readPoint(vector.ECPsum,ctx);
		            var Paux2 = new ctx.ECP(0);
		            Paux1.copy(P1);
		            Paux2.copy(P2);
		            Paux1.add(P2);
		            Paux2.add(P1);
		            expect(Paux1.toString()).to.equal(Psum.toString());
		            expect(Paux2.toString()).to.equal(Psum.toString());

		            // test associativity of the sum
		            Paux2.copy(P2);
		            Paux2.add(Psum);
		            Paux2.add(P1);
		            Paux1.add(Psum)
		            expect(Paux1.toString()).to.equal(Paux2.toString());

                    // Test sum with infinity
                    Paux1.copy(P1);
                    Paux2.inf();
                    Paux1.add(Paux2);
                    expect(Paux1.toString()).to.equal(P1.toString());
                    Paux2.add(Paux1);
                    expect(Paux2.toString()).to.equal(P1.toString());

	                // test negative of a point
	                var Pneg = readPoint(vector.ECPneg,ctx);
	                Paux1.copy(P1);
	                Paux1.neg();
	                expect(Paux1.toString()).to.equal(Pneg.toString());

	                // test subtraction between points
	                var Psub = readPoint(vector.ECPsub,ctx);
	                Paux1.copy(P1);
	                Paux1.sub(P2);
	                expect(Paux1.toString()).to.equal(Psub.toString());
            	}

                // test doubling
                var Pdbl = readPoint(vector.ECPdbl,ctx);
                Paux1.copy(P1);
                Paux1.dbl();
                expect(Paux1.toString()).to.equal(Pdbl.toString());

                // test scalar multiplication
                var Pmul = readPoint(vector.ECPmul,ctx);
                var Scalar1 = readBIG(vector.BIGscalar1, ctx);
                Paux1.copy(P1);
                Paux1 = Paux1.mul(Scalar1);
                expect(Paux1.toString()).to.equal(Pmul.toString());

                if (ctx.ECP.CURVETYPE != ctx.ECP.MONTGOMERY) {
	                // test multiplication by small integer
	                var Ppinmul = readPoint(vector.ECPpinmul,ctx);
	                Paux1.copy(P1);
	                Paux1 = Paux1.pinmul(1234,14);
	                expect(Paux1.toString()).to.equal(Ppinmul.toString());

	                // test mul2
	                var Pmul2 = readPoint(vector.ECPmul2,ctx);
                    var Scalar1 = readBIG(vector.BIGscalar1, ctx);
	                var Scalar2 = readBIG(vector.BIGscalar2, ctx);
	                Paux1.copy(P1);
	                Paux2.copy(P2);
	                Paux1 = Paux1.mul2(Scalar1,Paux2,Scalar2);
	                expect(Paux1.toString()).to.equal(Pmul2.toString());
	            }

                // test wrong coordinates and infinity point
                var Pwrong = readPoint(vector.ECPwrong,ctx);
                var Pinf = readPoint(vector.ECPinf,ctx);
                // test copy and equals
                expect(Pwrong.is_infinity()).to.equal(true);
                expect(Pinf.is_infinity()).to.equal(true);
                expect(Pwrong.equals(Pinf)).to.equal(true);
            });
            done();
        });
    });
});