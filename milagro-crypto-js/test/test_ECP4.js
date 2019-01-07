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


/* Test ECP4 ARITHMETICS - test driver and function exerciser for ECP4 API Functions */

var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var pf_curves = ['BLS24'];

describe('TEST ECP4 ARITHMETIC', function() {

    pf_curves.forEach(function(curve) {

        it('test '+curve, function(done) {
            this.timeout(0);

            var ctx = new CTX(curve);
            var vectors = require('../testVectors/ecp4/'+curve+'.json');

            var F = ctx.ECP4.frob_constants();

            var k, i=0;
            vectors.forEach(function(vector) {
                var ecp4frobs = [ctx.ECP4.fromBytes(Buffer.from(vector.ECP41,"hex"))];
                var ecp41 = ecp4frobs[0];
                var ecp4aux1 = new ctx.ECP4();

                // Test infinity
                expect(ecp4aux1.is_infinity()).to.be.true;
                expect(ecp4frobs[0].is_infinity()).to.be.false;
                expect(ecp4aux1.toString()).to.equal("infinity");

                // Test copy and equals
                expect(ecp4aux1.equals(ecp41)).to.be.false;
                ecp4aux1.copy(ecp41);
                expect(ecp4aux1.equals(ecp41)).to.be.true;

                // Test setxy
                var x = new ctx.FP4(0),
                    y = new ctx.FP4(0);
                x.copy(ecp41.getX());
                y.copy(ecp41.getY());
                ecp4aux1.setxy(x,y);
                expect(ecp4aux1.toString()).to.equal(ecp41.toString());

                // Test that y^2 = RHS
                y.sqr();
                var res = ctx.ECP4.RHS(x);
                expect(res.toString()).to.equal(y.toString());

                // Compute frobenius constants and repeated frob actions over ecp41
                if (i===0) {
                    for (k=1; k<8; k++) {
                        var t = new ctx.ECP4();
                        t.copy(ecp4frobs[k-1]);
                        t.frob(F,1);
                        ecp4frobs[k] = t;
                    }
                } else {
                    var t = new ctx.ECP4();
                    t.copy(ecp41);
                    t.frob(F,3);
                    ecp4frobs[3] = t;
                }

                var BIGsc = [];
                if (i===0){
                    for (k=1; k<=8; k++) {
                        BIGsc[k-1] = ctx.BIG.fromBytes(Buffer.from(vector["BIGscalar" + k],"hex"));
                    }
                } else {
                    BIGsc[0] = ctx.BIG.fromBytes(Buffer.from(vector.BIGscalar1,"hex"));
                }
                // Test commutativity of the sum
                var ecp42 = ctx.ECP4.fromBytes(Buffer.from(vector.ECP42,"hex"));
                var ecp4sum = ctx.ECP4.fromBytes(Buffer.from(vector.ECP4sum,"hex"));
                var ecp4aux2 = new ctx.ECP4();
                ecp4aux1.copy(ecp41);
                ecp4aux2.copy(ecp42);
                ecp4aux1.add(ecp42);
                ecp4aux2.add(ecp41);
                expect(ecp4aux1.toString()).to.equal(ecp4sum.toString());
                expect(ecp4aux2.toString()).to.equal(ecp4sum.toString());

                // Test associativity of the sum
                ecp4aux2.copy(ecp41);
                ecp4aux2.add(ecp42);
                ecp4aux2.add(ecp4sum);
                ecp4aux1.add(ecp4sum)
                expect(ecp4aux1.toString()).to.equal(ecp4aux2.toString());

                // Test negative of a point
                var ecp4neg = ctx.ECP4.fromBytes(Buffer.from(vector.ECP4neg,"hex"));
                ecp4aux1.copy(ecp41);
                ecp4aux1.neg();
                expect(ecp4aux1.toString()).to.equal(ecp4neg.toString());

                // Test subtraction between points
                var ecp4sub = ctx.ECP4.fromBytes(Buffer.from(vector.ECP4sub,"hex"));
                ecp4aux1.copy(ecp41);
                ecp4aux1.sub(ecp42);
                expect(ecp4aux1.toString()).to.equal(ecp4sub.toString());

                // Test doubling
                var ecp4dbl = ctx.ECP4.fromBytes(Buffer.from(vector.ECP4dbl,"hex"));
                ecp4aux1.copy(ecp41);
                ecp4aux1.dbl();
                expect(ecp4aux1.toString()).to.equal(ecp4dbl.toString());

                // Test scalar multiplication
                var ecp4mul = ctx.ECP4.fromBytes(Buffer.from(vector.ECP4mul,"hex"));
                ecp4aux1.copy(ecp41);
                ecp4aux1 = ecp4aux1.mul(BIGsc[0]);
                expect(ecp4aux1.toString()).to.equal(ecp4mul.toString());
                ecp4aux1.inf();
                ecp4aux1 = ecp4aux1.mul(BIGsc[0]);
                expect(ecp4aux1.is_infinity()).to.be.true;

                // Test linear mul8, linear combination of 4 points
                // Tested only once for timing reasons
                if (i===0) {
                    var ecp4mul8 = ctx.ECP4.fromBytes(Buffer.from(vector.ECP4mul8,"hex"));
                    ecp4aux1 = ctx.ECP4.mul8(ecp4frobs,BIGsc);
                    expect(ecp4aux1.toString()).to.equal(ecp4mul8.toString());
                    i++;
                }

                // Test frobenius actions
                var ecp4frob = ctx.ECP4.fromBytes(Buffer.from(vector.ECP4frob,"hex"));
                expect(ecp4frobs[3].toString()).to.equal(ecp4frob.toString());

                // Test wrong coordinates
                var ecp4wrong = ctx.ECP4.fromBytes(Buffer.from(vector.ECP4wrong,"hex"));
                expect(ecp4wrong.is_infinity()).to.be.true;
            });
            done();
        });
    });
});