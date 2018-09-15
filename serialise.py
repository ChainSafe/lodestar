import collections


def serialize(val, typ=None):
    if typ is None and hasattr(val, 'fields'):
        typ = type(val)
    if typ in ('hash32', 'address'):
        print(len(val))
        assert len(val) == 20 if typ == 'address' else len(val) == 32
        return val
    elif isinstance(typ, str) and typ[:3] == 'int':
        length = int(typ[3:])
        assert length % 8 == 0
        return val.to_bytes(length // 8, 'big')
    elif typ == 'bytes':
        return len(val).to_bytes(4, 'big') + val
    elif isinstance(typ, list):
        assert len(typ) == 1
        sub = b''.join([serialize(x, typ[0]) for x in val])
        return len(sub).to_bytes(4, 'big') + sub
    elif isinstance(typ, type):
        sub = b''.join(
            [serialize(getattr(val, k), typ.fields[k]) for k in sorted(typ.fields.keys())]
        )
        return len(sub).to_bytes(4, 'big') + sub
    raise Exception("Cannot serialize", val, typ)

print(serialize(b'\x00'*32, 'hash32'))
print(serialize(b'\x00'*20, 'address'))
