#include "addon.h"
#include "blst.hpp"
#include "napi.h"

/**
 * @note The unique_ptr is used to hold the blst::P* object if a Uint8Array is
 *       being converted instead of a PublicKey or Signature object.
 */
template <typename T>
struct PointerGroup {
    std::unique_ptr<T> unique_ptr = std::make_unique<T>();
    T *raw_pointer = nullptr;
};

/**
 *  Unwraps a Napi::Value to a blst::P* object. If the value is a Uint8Array it
 *  will be converted to a blst object. If the value is a PublicKey or
 *  Signature the pointer will be copied from the object and reused to avoid
 *  duplication.
 *
 * @param[out] ptr_group PointerGroup<T> &
 * @param[in] env const Napi::Env &
 * @param[in] module const BlstTsAddon *
 * @param[in] value const Napi::Value &
 * @param[in] js_class_name const std::string &
 * @param[in] coord_type CoordType
 *
 * @note This can potentially segfault if incorrect CoordType is passed. There
 *       is a C-style cast to get this to compile as the raw pointer is set from
 *       two different types depending on which branch of the conditional is
 *       taken by the code. This is safe as long as the CoordType is correct for
 *       the type of PointerGroup that is used.
 *
 * @note This can potentially throw a BLST_ERROR. Must be in try/catch but is
 *       not in this function so a loop counter from the calling context can be
 *       used in the error message
 */
template <typename T>
bool unwrap_point_arg(
    PointerGroup<T> &ptr_group,
    const Napi::Env &env,
    const BlstTsAddon *module,
    const Napi::Value &value,
    const std::string &js_class_name,
    CoordType coord_type) {
    if (value.IsTypedArray()) {
        Napi::TypedArray untyped = value.As<Napi::TypedArray>();
        if (untyped.TypedArrayType() != napi_uint8_array) {
            Napi::TypeError::New(env, js_class_name + " must be a BlstBuffer")
                .ThrowAsJavaScriptException();
            return true;
        }
        Napi::Uint8Array typed = untyped.As<Napi::Uint8Array>();

        std::string err_out{js_class_name};
        if (strcmp(js_class_name.c_str(), "PublicKeyArg") == 0) {
            if (!is_valid_length(
                    err_out,
                    typed.ByteLength(),
                    BLST_TS_PUBLIC_KEY_LENGTH_COMPRESSED,
                    BLST_TS_PUBLIC_KEY_LENGTH_UNCOMPRESSED)) {
                Napi::TypeError::New(env, err_out).ThrowAsJavaScriptException();
                return true;
            }
            if (is_zero_bytes(typed.Data(), 0, typed.ByteLength())) {
                Napi::TypeError::New(env, "PublicKeyArg must not be zero key")
                    .ThrowAsJavaScriptException();
                return true;
            }
        } else {
            if (!is_valid_length(
                    err_out,
                    typed.ByteLength(),
                    BLST_TS_SIGNATURE_LENGTH_COMPRESSED,
                    BLST_TS_SIGNATURE_LENGTH_UNCOMPRESSED)) {
                Napi::TypeError::New(env, err_out).ThrowAsJavaScriptException();
                return true;
            }
        }
        ptr_group.unique_ptr.reset(new T{typed.Data(), typed.ByteLength()});
        ptr_group.raw_pointer = ptr_group.unique_ptr.get();

        /* Arg is a deserialized point */
    } else if (value.IsObject()) {
        Napi::Object wrapped = value.As<Napi::Object>();

        if (strcmp(js_class_name.c_str(), "PublicKeyArg") == 0) {
            if (!wrapped.CheckTypeTag(&module->_public_key_tag)) {
                Napi::TypeError::New(env, "publicKey must be a PublicKeyArg")
                    .ThrowAsJavaScriptException();
                return true;
            }
            PublicKey *pk = PublicKey::Unwrap(wrapped);

            /* Check that the required point type has been created */
            if (coord_type == CoordType::Jacobian) {
                if (!pk->_has_jacobian) {
                    if (!pk->_has_affine) {
                        Napi::Error::New(env, "publicKey not initialized")
                            .ThrowAsJavaScriptException();
                        return true;
                    }
                    pk->_jacobian.reset(
                        new blst::P1{pk->_affine->to_jacobian()});
                    pk->_has_jacobian = true;
                }
                ptr_group.raw_pointer = (T *)pk->_jacobian.get();
            } else {
                if (!pk->_has_affine) {
                    if (!pk->_has_jacobian) {
                        Napi::Error::New(env, "publicKey not initialized")
                            .ThrowAsJavaScriptException();
                        return true;
                    }
                    pk->_affine.reset(
                        new blst::P1_Affine{pk->_jacobian->to_affine()});
                    pk->_has_affine = true;
                }
                ptr_group.raw_pointer = (T *)pk->_affine.get();
            }
        } else {
            if (!wrapped.CheckTypeTag(&module->_signature_tag)) {
                Napi::TypeError::New(env, "signature must be a SignatureArg")
                    .ThrowAsJavaScriptException();
                return true;
            }
            Signature *sig = Signature::Unwrap(wrapped);

            /* Check that the required point type has been created */
            if (coord_type == CoordType::Jacobian) {
                if (!sig->_has_jacobian) {
                    if (!sig->_has_affine) {
                        Napi::Error::New(env, "signature not initialized")
                            .ThrowAsJavaScriptException();
                        return true;
                    }
                    sig->_jacobian.reset(
                        new blst::P2{sig->_affine->to_jacobian()});
                    sig->_has_jacobian = true;
                }
                ptr_group.raw_pointer = (T *)sig->_jacobian.get();
            } else {
                if (!sig->_has_affine) {
                    if (!sig->_has_jacobian) {
                        Napi::Error::New(env, "signature not initialized")
                            .ThrowAsJavaScriptException();
                        return true;
                    }
                    sig->_affine.reset(
                        new blst::P2_Affine{sig->_jacobian->to_affine()});
                    sig->_has_affine = true;
                }
                ptr_group.raw_pointer = (T *)sig->_affine.get();
            }
        }
    } else {
        std::string err = strcmp(js_class_name.c_str(), "PublicKeyArg") == 0
                              ? "publicKey must be a PublicKeyArg"
                              : "signature must be a SignatureArg";
        Napi::TypeError::New(env, err).ThrowAsJavaScriptException();
        return true;
    }
    return false;
}
