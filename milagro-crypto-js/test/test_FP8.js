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


/* Test FP8 ARITHMETICS - test driver and function exerciser for FP8 API Functions */

var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var pf_curves = ['BLS24','BLS48'];

var readBIG = function(string, ctx) {
    while (string.length != ctx.BIG.MODBYTES*2){string = "00"+string;}
    return ctx.BIG.fromBytes(Buffer.from(string, "hex"));
}

var readFP2 = function(string, ctx) {
    string = string.split(",");
    var cox = string[0].slice(1);
    var coy = string[1].slice(0,-1);

    var x = readBIG(cox,ctx);
    var y = readBIG(coy,ctx);

    return new ctx.FP2(x,y);;
}

var readFP = function(string, ctx) {
    return new ctx.FP(readBIG(string, ctx));
}

var readFP4 = function(string, ctx) {
    var X, Y;

    string = string.split("],[");
    var cox = string[0].slice(1) + "]";
    var coy = "[" + string[1].slice(0,-1);

    X = readFP2(cox,ctx);
    Y = readFP2(coy,ctx);

    return new ctx.FP4(X,Y);
}

var readFP8 = function(string, ctx) {
    var X, Y;

    string = string.split("]],[[");
    var cox = string[0].slice(1) + "]]";
    var coy = "[[" + string[1].slice(0,-1);

    X = readFP4(cox,ctx);
    Y = readFP4(coy,ctx);

    return new ctx.FP8(X,Y);
}

describe('TEST FP8 ARITHMETIC', function() {

    pf_curves.forEach(function(curve){

        it('test '+ curve, function(done) {
            this.timeout(0);

            var ctx = new CTX(curve);
            var vectors = require('../testVectors/fp8/'+curve+'.json');

            var a1 = new ctx.FP8(0),
                a2 = new ctx.FP8(0),
                one = new ctx.FP8(1),
                zero = new ctx.FP8(0),
                fp4one = new ctx.FP4(1),
                fp4zero = new ctx.FP4(0);

            // Test iszilch and isunity
            expect(zero.iszilch()).to.be.true;
            expect(one.iszilch()).to.be.false;
            expect(zero.isunity()).to.be.false;
            expect(one.isunity()).to.be.true;

            // Test real/isreal
            expect(one.isreal()).to.be.true;
            expect(one.real().toString()).to.be.equal(fp4one.toString());
            one.times_i();
            expect(one.isreal()).to.be.false;
            expect(one.real().toString()).to.be.equal(fp4zero.toString());

            // Test set using FP4
            one.set(fp4one,fp4zero);
            expect(one.isunity()).to.be.true;
            one.seta(fp4one);
            expect(one.isunity()).to.be.true;

            // Test handling sqrt 0,1
            a1.zero();
            expect(a1.sqrt()).to.be.true;
            expect(a1.toString()).to.equal(zero.toString());
            a1.one();
            expect(a1.sqrt()).to.be.true;
            expect(a1.toString()).to.equal(one.toString());

            var i=0;
            vectors.forEach(function(vector){

                // test commutativity of addition
                var fp81 = readFP8(vector.FP81,ctx);
                var fp82 = readFP8(vector.FP82,ctx);
                var fp8add = readFP8(vector.FP8add,ctx);

                a1.copy(fp81);
                a1.add(fp82);
                expect(a1.toString()).to.equal(fp8add.toString());
                a2.copy(fp82);
                a2.add(fp81);
                expect(a2.toString()).to.equal(fp8add.toString());

                // test associativity of addition
                a2.add(fp8add);
                a1.copy(fp81);
                a1.add(fp8add);
                a1.add(fp82);
                expect(a1.toString()).to.equal(a2.toString());

                // test subtraction
                var fp8sub = readFP8(vector.FP8sub, ctx);
                a1.copy(fp81);
                a1.sub(fp82);
                expect(a1.toString()).to.equal(fp8sub.toString());
                a1.copy(fp82);
                a1.rsub(fp81);
                expect(a1.toString()).to.equal(fp8sub.toString());

                // test negative of a FP8
                var fp8neg = readFP8(vector.FP8neg, ctx);
                a1.copy(fp81);
                a1.neg();
                expect(a1.toString()).to.equal(fp8neg.toString());

                // test conjugate of a FP8
                var fp8conj = readFP8(vector.FP8conj, ctx);
                a1.copy(fp81);
                a1.conj();
                expect(a1.toString()).to.equal(fp8conj.toString());

                // test negative conjugate of a FP8
                var fp8nconj = readFP8(vector.FP8nconj, ctx);
                a1.copy(fp81);
                a1.nconj();
                expect(a1.toString()).to.equal(fp8nconj.toString());

                // test multiplication by FP
                var fp8tmul = readFP8(vector.FP8tmul, ctx);
                var fpsc = readFP(vector.FPsc, ctx);
                a1.copy(fp81);
                a1.tmul(fpsc);
                expect(a1.toString()).to.equal(fp8tmul.toString());

                // test multiplication by FP2
                var fp8qmul = readFP8(vector.FP8qmul, ctx);
                var fp2sc = readFP2(vector.FP2sc, ctx);
                a1.copy(fp81);
                a1.qmul(fp2sc);
                expect(a1.toString()).to.equal(fp8qmul.toString());

                // test multiplication by FP4
                var fp8pmul = readFP8(vector.FP8pmul, ctx);
                var fp4sc = readFP4(vector.FP4sc, ctx);
                a1.copy(fp81);
                a1.pmul(fp4sc);
                expect(a1.toString()).to.equal(fp8pmul.toString());

                // test small scalar multiplication
                var fp8imul = readFP8(vector.FP8imul, ctx);
                a1.copy(fp81);
                a1.imul(i);
                expect(a1.toString()).to.equal(fp8imul.toString());
                i++;

                // test square
                var fp8sqr = readFP8(vector.FP8sqr, ctx);
                a1.copy(fp81);
                a1.sqr();
                expect(a1.toString()).to.equal(fp8sqr.toString());

                // test multiplication
                var fp8mul = readFP8(vector.FP8mul, ctx);
                a1.copy(fp81);
                a1.mul(fp82);
                expect(a1.toString()).to.equal(fp8mul.toString());

                // test power
                var fp8pow = readFP8(vector.FP8pow, ctx);
                var BIGsc1 = readBIG(vector.BIGsc1, ctx);
                a1.copy(fp81);
                a1 = a1.pow(BIGsc1);
                expect(a1.toString()).to.equal(fp8pow.toString());

                // test inverse
                var fp8inv = readFP8(vector.FP8inv, ctx);
                a1.copy(fp81);
                a1.inverse();
                expect(a1.toString()).to.equal(fp8inv.toString());

                // test multiplication by sqrt(1+sqrt(-1))
                var fp8mulj = readFP8(vector.FP8mulj, ctx);
                a1.copy(fp81);
                a1.times_i();
                expect(a1.toString()).to.equal(fp8mulj.toString());

                // // test the XTR addition function r=w*x-conj(x)*y+z
                var fp8xtrA = readFP8(vector.FP8xtrA, ctx);
                a1.copy(fp82);
                a1.xtr_A(fp81,fp8add,fp8sub);
                expect(a1.toString()).to.equal(fp8xtrA.toString());

                // test the XTR addition function r=w*x-conj(x)*y+z
                var fp8xtrD = readFP8(vector.FP8xtrD, ctx);
                a1.copy(fp81);
                a1.xtr_D();
                expect(a1.toString()).to.equal(fp8xtrD.toString());

                // test the XTR single power r=Tr(x^e)
                var fp8xtrpow = readFP8(vector.FP8xtrpow, ctx);
                var fp241 = readFP8(vector.FP241, ctx);
                a1 = fp241.xtr_pow(BIGsc1);
                expect(a1.toString()).to.equal(fp8xtrpow.toString());

                // test the XTR double power r=Tr(x^e)
                var fp8xtrpow2 = readFP8(vector.FP8xtrpow2, ctx);
                var fp242 = readFP8(vector.FP242, ctx);
                var fp243 = readFP8(vector.FP243, ctx);
                var fp244 = readFP8(vector.FP244, ctx);
                var BIGsc2 = readBIG(vector.BIGsc2, ctx);
                a1 = fp241.xtr_pow2(fp242,fp243,fp244,BIGsc2,BIGsc1);
                expect(a1.toString()).to.equal(fp8xtrpow2.toString());

                // Test division by i
                var fp8divi = readFP8(vector.FP8divi, ctx);
                a1.copy(fp81);
                a1.div_i();
                expect(a1.toString()).to.equal(fp8divi.toString())

                // Test division by 2i
                var fp8div2i = readFP8(vector.FP8div2i, ctx);
                a1.copy(fp81);
                a1.div_2i();
                expect(a1.toString()).to.equal(fp8div2i.toString())

                // Test division by i two times
                var fp8divi2 = readFP8(vector.FP8divi2, ctx);
                a1.copy(fp81);
                a1.div_i2();
                expect(a1.toString()).to.equal(fp8divi2.toString());

                // Test square root
                var fp8sqrt = readFP8(vector.FP8sqrt, ctx);
                a1.copy(fp81);
                expect(a1.sqrt()).to.equal(true);
                expect(a1).to.satisfy(function(p) {
                    if(fp8sqrt.toString() === p.toString()) {
                        return true;
                    } else {
                        fp8sqrt.neg();
                    }
                    return fp8sqrt.toString() === p.toString();
                });

            });
            done();
        });
    });
});
