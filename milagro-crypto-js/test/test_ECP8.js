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


/* Test ECP8 ARITHMETICS - test driver and function exerciser for ECP8 API Functions */

var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var pf_curves = ['BLS48'];

describe('TEST ECP8 ARITHMETIC', function() {

    pf_curves.forEach(function(curve) {

        it('test '+curve, function(done) {
            this.timeout(0);

            var ctx = new CTX(curve);
            var vectors = require('../testVectors/ecp8/'+curve+'.json');

            var F = ctx.ECP8.frob_constants();

            var k, i = 0;
            vectors.forEach(function(vector) {
                var ecp8frobs = [ctx.ECP8.fromBytes(Buffer.from(vector.ECP81,"hex"))];
                var ecp81 = ecp8frobs[0];
                var ecp8aux1 = new ctx.ECP8();

                // Test infinity
                expect(ecp8aux1.is_infinity()).to.be.true;
                expect(ecp8frobs[0].is_infinity()).to.be.false;
                expect(ecp8aux1.toString()).to.equal("infinity");

                // Test copy and equals
                expect(ecp8aux1.equals(ecp81)).to.be.false;
                ecp8aux1.copy(ecp81);
                expect(ecp8aux1.equals(ecp81)).to.be.true;

                // Test setxy
                var x = new ctx.FP8(0),
                    y = new ctx.FP8(0);
                x.copy(ecp81.getX());
                y.copy(ecp81.getY());
                ecp8aux1.setxy(x,y);
                expect(ecp8aux1.toString()).to.equal(ecp81.toString());

                // Test that y^2 = RHS
                y.sqr();
                var res = ctx.ECP8.RHS(x);
                expect(res.toString()).to.equal(y.toString());

                // Compute frobenius constants and repeated frob actions over ecp81
                if (i === 0) {
                    for (k=1; k<16; k++) {
                        var t = new ctx.ECP8();
                        t.copy(ecp8frobs[k-1]);
                        t.frob(F,1); 
                        ecp8frobs[k] = t; 
                    }
                } else {
                    var t = new ctx.ECP8();
                    t.copy(ecp81);
                    t.frob(F,3);
                    ecp8frobs[3] = t;
                }
                var BIGsc = [];
                if (i===0){
                    for (k=1; k<=16; k++) {
                        BIGsc[k-1] = ctx.BIG.fromBytes(Buffer.from(vector["BIGscalar" + k],"hex"));
                    }
                } else {
                    BIGsc[0] = ctx.BIG.fromBytes(Buffer.from(vector.BIGscalar1,"hex"));
                }

                // Test commutativity of the sum
                var ecp82 = ctx.ECP8.fromBytes(Buffer.from(vector.ECP82,"hex"));
                var ecp8sum = ctx.ECP8.fromBytes(Buffer.from(vector.ECP8sum,"hex"));
                var ecp8aux2 = new ctx.ECP8();
                ecp8aux1.copy(ecp81);
                ecp8aux2.copy(ecp82);
                ecp8aux1.add(ecp82);
                ecp8aux2.add(ecp81);
                expect(ecp8aux1.toString()).to.equal(ecp8sum.toString());
                expect(ecp8aux2.toString()).to.equal(ecp8sum.toString());

                // Test associativity of the sum
                ecp8aux2.copy(ecp81);
                ecp8aux2.add(ecp82);
                ecp8aux2.add(ecp8sum);
                ecp8aux1.add(ecp8sum)
                expect(ecp8aux1.toString()).to.equal(ecp8aux2.toString());

                // Test negative of a point
                var ecp8neg = ctx.ECP8.fromBytes(Buffer.from(vector.ECP8neg,"hex"));
                ecp8aux1.copy(ecp81);
                ecp8aux1.neg();
                expect(ecp8aux1.toString()).to.equal(ecp8neg.toString());

                // Test subtraction between points
                var ecp8sub = ctx.ECP8.fromBytes(Buffer.from(vector.ECP8sub,"hex"));
                ecp8aux1.copy(ecp81);
                ecp8aux1.sub(ecp82);
                expect(ecp8aux1.toString()).to.equal(ecp8sub.toString());

                // Test doubling
                var ecp8dbl = ctx.ECP8.fromBytes(Buffer.from(vector.ECP8dbl,"hex"));
                ecp8aux1.copy(ecp81);
                ecp8aux1.dbl();
                expect(ecp8aux1.toString()).to.equal(ecp8dbl.toString());

                // Test scalar multiplication
                var ecp8mul = ctx.ECP8.fromBytes(Buffer.from(vector.ECP8mul,"hex"));
                ecp8aux1.copy(ecp81);
                ecp8aux1 = ecp8aux1.mul(BIGsc[0]);
                expect(ecp8aux1.toString()).to.equal(ecp8mul.toString());
                ecp8aux1.inf();
                ecp8aux1 = ecp8aux1.mul(BIGsc[0]);
                expect(ecp8aux1.is_infinity()).to.be.true;

                // Test linear mul16, linear combination of 4 points
                if (i===0) {
                    var ecp8mul8 = ctx.ECP8.fromBytes(Buffer.from(vector.ECP8mul16,"hex"));
                    ecp8aux1 = ctx.ECP8.mul16(ecp8frobs,BIGsc);
                    expect(ecp8aux1.toString()).to.equal(ecp8mul8.toString());
                    i++;
                }

                // Test frobenius actions
                var ecp8frob = ctx.ECP8.fromBytes(Buffer.from(vector.ECP8frob,"hex"));
                expect(ecp8frobs[3].toString()).to.equal(ecp8frob.toString());

                // Test wrong coordinates
                var ecp8wrong = ctx.ECP8.fromBytes(Buffer.from(vector.ECP8wrong,"hex"));
                expect(ecp8wrong.is_infinity()).to.be.true;

            });
            done();
        });
    });
});