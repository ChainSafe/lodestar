(module
 (type $FUNCSIG$v (func))
 (type $FUNCSIG$iiiii (func (param i32 i32 i32 i32) (result i32)))
 (type $FUNCSIG$ii (func (param i32) (result i32)))
 (type $FUNCSIG$vi (func (param i32)))
 (type $FUNCSIG$iiii (func (param i32 i32 i32) (result i32)))
 (type $FUNCSIG$viiii (func (param i32 i32 i32 i32)))
 (type $FUNCSIG$viii (func (param i32 i32 i32)))
 (type $FUNCSIG$iii (func (param i32 i32) (result i32)))
 (type $FUNCSIG$vii (func (param i32 i32)))
 (type $FUNCSIG$vij (func (param i32 i64)))
 (type $FUNCSIG$ji (func (param i32) (result i64)))
 (type $FUNCSIG$i (func (result i32)))
 (import "env" "abort" (func $~lib/env/abort (param i32 i32 i32 i32)))
 (memory $0 1)
 (data (i32.const 8) "\13\00\00\00~\00l\00i\00b\00/\00a\00r\00r\00a\00y\00b\00u\00f\00f\00e\00r\00.\00t\00s")
 (data (i32.const 56) "\1c\00\00\00~\00l\00i\00b\00/\00i\00n\00t\00e\00r\00n\00a\00l\00/\00a\00r\00r\00a\00y\00b\00u\00f\00f\00e\00r\00.\00t\00s")
 (data (i32.const 120) "\0d\00\00\00~\00l\00i\00b\00/\00a\00r\00r\00a\00y\00.\00t\00s")
 (table $0 2 funcref)
 (elem (i32.const 0) $null $assembly/index/Node#onRemoveWeight~anonymous|0)
 (global $~lib/allocator/arena/startOffset (mut i32) (i32.const 0))
 (global $~lib/allocator/arena/offset (mut i32) (i32.const 0))
 (global $~lib/argc (mut i32) (i32.const 0))
 (export "memory" (memory $0))
 (export "table" (table $0))
 (export "Node#get:slot" (func $Node#get:slot))
 (export "Node#set:slot" (func $Node#set:slot))
 (export "Node#get:blockRoot" (func $Node#get:blockRoot))
 (export "Node#set:blockRoot" (func $Node#set:blockRoot))
 (export "Node#get:weight" (func $Node#get:weight))
 (export "Node#set:weight" (func $Node#set:weight))
 (export "Node#get:parent" (func $Node#get:parent))
 (export "Node#set:parent" (func $Node#set:parent))
 (export "Node#get:bestChild" (func $~lib/map/Map<~lib/string/String,assembly/index/Node>#get:size))
 (export "Node#set:bestChild" (func $Node#set:bestChild))
 (export "Node#get:bestTarget" (func $Node#get:bestTarget))
 (export "Node#set:bestTarget" (func $Node#set:bestTarget))
 (export "Node#get:children" (func $Node#get:children))
 (export "Node#set:children" (func $Node#set:children))
 (export "Node#get:childValues" (func $Node#get:childValues))
 (export "Node#set:childValues" (func $Node#set:childValues))
 (export "Node#constructor" (func $assembly/index/Node#constructor))
 (export "Node#equals" (func $assembly/index/Node#equals))
 (export "Node#betterThan" (func $assembly/index/Node#betterThan))
 (export "Node#addChild" (func $assembly/index/Node#addChild))
 (export "Node#propogateWeightChange" (func $assembly/index/Node#propogateWeightChange))
 (export "memory.compare" (func $~lib/memory/memory.compare))
 (export "memory.allocate" (func $~lib/memory/memory.allocate))
 (export "memory.free" (func $~lib/memory/memory.free))
 (export "memory.reset" (func $~lib/memory/memory.reset))
 (start $start)
 (func $~lib/allocator/arena/__memory_allocate (; 1 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  (local $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  local.get $0
  i32.const 1073741824
  i32.gt_u
  if
   unreachable
  end
  local.get $0
  i32.const 1
  local.tee $1
  local.get $0
  local.get $1
  i32.gt_u
  select
  global.get $~lib/allocator/arena/offset
  local.tee $0
  i32.add
  i32.const 7
  i32.add
  i32.const -8
  i32.and
  local.tee $1
  current_memory
  local.tee $2
  i32.const 16
  i32.shl
  i32.gt_u
  if
   local.get $2
   local.get $1
   local.get $0
   i32.sub
   i32.const 65535
   i32.add
   i32.const -65536
   i32.and
   i32.const 16
   i32.shr_u
   local.tee $3
   local.tee $4
   local.get $2
   local.get $4
   i32.gt_s
   select
   grow_memory
   i32.const 0
   i32.lt_s
   if
    local.get $3
    grow_memory
    i32.const 0
    i32.lt_s
    if
     unreachable
    end
   end
  end
  local.get $1
  global.set $~lib/allocator/arena/offset
  local.get $0
 )
 (func $~lib/memory/memory.allocate (; 2 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  local.get $0
  call $~lib/allocator/arena/__memory_allocate
 )
 (func $~lib/internal/arraybuffer/computeSize (; 3 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  i32.const 1
  i32.const 32
  local.get $0
  i32.const 7
  i32.add
  i32.clz
  i32.sub
  i32.shl
 )
 (func $~lib/internal/arraybuffer/allocateUnsafe (; 4 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  (local $1 i32)
  local.get $0
  i32.const 1073741816
  i32.gt_u
  if
   i32.const 0
   i32.const 56
   i32.const 26
   i32.const 2
   call $~lib/env/abort
   unreachable
  end
  local.get $0
  call $~lib/internal/arraybuffer/computeSize
  call $~lib/allocator/arena/__memory_allocate
  local.tee $1
  local.get $0
  i32.store
  local.get $1
 )
 (func $~lib/internal/memory/memset (; 5 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  (local $2 i32)
  local.get $1
  i32.eqz
  if
   return
  end
  local.get $0
  i32.const 0
  i32.store8
  local.get $0
  local.get $1
  i32.add
  i32.const 1
  i32.sub
  i32.const 0
  i32.store8
  local.get $1
  i32.const 2
  i32.le_u
  if
   return
  end
  local.get $0
  i32.const 1
  i32.add
  i32.const 0
  i32.store8
  local.get $0
  i32.const 2
  i32.add
  i32.const 0
  i32.store8
  local.get $0
  local.get $1
  i32.add
  i32.const 2
  i32.sub
  i32.const 0
  i32.store8
  local.get $0
  local.get $1
  i32.add
  i32.const 3
  i32.sub
  i32.const 0
  i32.store8
  local.get $1
  i32.const 6
  i32.le_u
  if
   return
  end
  local.get $0
  i32.const 3
  i32.add
  i32.const 0
  i32.store8
  local.get $0
  local.get $1
  i32.add
  i32.const 4
  i32.sub
  i32.const 0
  i32.store8
  local.get $1
  i32.const 8
  i32.le_u
  if
   return
  end
  i32.const 0
  local.get $0
  i32.sub
  i32.const 3
  i32.and
  local.tee $2
  local.get $0
  i32.add
  local.tee $0
  i32.const 0
  i32.store
  local.get $1
  local.get $2
  i32.sub
  i32.const -4
  i32.and
  local.tee $1
  local.get $0
  i32.add
  i32.const 4
  i32.sub
  i32.const 0
  i32.store
  local.get $1
  i32.const 8
  i32.le_u
  if
   return
  end
  local.get $0
  i32.const 4
  i32.add
  i32.const 0
  i32.store
  local.get $0
  i32.const 8
  i32.add
  i32.const 0
  i32.store
  local.get $0
  local.get $1
  i32.add
  i32.const 12
  i32.sub
  i32.const 0
  i32.store
  local.get $0
  local.get $1
  i32.add
  i32.const 8
  i32.sub
  i32.const 0
  i32.store
  local.get $1
  i32.const 24
  i32.le_u
  if
   return
  end
  local.get $0
  i32.const 12
  i32.add
  i32.const 0
  i32.store
  local.get $0
  i32.const 16
  i32.add
  i32.const 0
  i32.store
  local.get $0
  i32.const 20
  i32.add
  i32.const 0
  i32.store
  local.get $0
  i32.const 24
  i32.add
  i32.const 0
  i32.store
  local.get $0
  local.get $1
  i32.add
  i32.const 28
  i32.sub
  i32.const 0
  i32.store
  local.get $0
  local.get $1
  i32.add
  i32.const 24
  i32.sub
  i32.const 0
  i32.store
  local.get $0
  local.get $1
  i32.add
  i32.const 20
  i32.sub
  i32.const 0
  i32.store
  local.get $0
  local.get $1
  i32.add
  i32.const 16
  i32.sub
  i32.const 0
  i32.store
  local.get $0
  i32.const 4
  i32.and
  i32.const 24
  i32.add
  local.tee $2
  local.get $0
  i32.add
  local.set $0
  local.get $1
  local.get $2
  i32.sub
  local.set $1
  loop $continue|0
   local.get $1
   i32.const 32
   i32.ge_u
   if
    local.get $0
    i64.const 0
    i64.store
    local.get $0
    i32.const 8
    i32.add
    i64.const 0
    i64.store
    local.get $0
    i32.const 16
    i32.add
    i64.const 0
    i64.store
    local.get $0
    i32.const 24
    i32.add
    i64.const 0
    i64.store
    local.get $1
    i32.const 32
    i32.sub
    local.set $1
    local.get $0
    i32.const 32
    i32.add
    local.set $0
    br $continue|0
   end
  end
 )
 (func $~lib/arraybuffer/ArrayBuffer#constructor (; 6 ;) (type $FUNCSIG$iii) (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  local.get $0
  i32.const 1073741816
  i32.gt_u
  if
   i32.const 0
   i32.const 8
   i32.const 47
   i32.const 40
   call $~lib/env/abort
   unreachable
  end
  local.get $0
  call $~lib/internal/arraybuffer/allocateUnsafe
  local.set $2
  local.get $1
  i32.eqz
  if
   local.get $2
   i32.const 8
   i32.add
   local.get $0
   call $~lib/internal/memory/memset
  end
  local.get $2
 )
 (func $~lib/map/Map<~lib/string/String,assembly/index/Node>#clear (; 7 ;) (type $FUNCSIG$vi) (param $0 i32)
  local.get $0
  i32.const 16
  i32.const 0
  call $~lib/arraybuffer/ArrayBuffer#constructor
  i32.store
  local.get $0
  i32.const 3
  i32.store offset=4
  local.get $0
  i32.const 48
  i32.const 1
  call $~lib/arraybuffer/ArrayBuffer#constructor
  i32.store offset=8
  local.get $0
  i32.const 4
  i32.store offset=12
  local.get $0
  i32.const 0
  i32.store offset=16
  local.get $0
  i32.const 0
  i32.store offset=20
 )
 (func $~lib/map/Map<~lib/string/String,assembly/index/Node>#constructor (; 8 ;) (type $FUNCSIG$i) (result i32)
  (local $0 i32)
  block (result i32)
   i32.const 24
   call $~lib/allocator/arena/__memory_allocate
   local.tee $0
   i32.const 0
   i32.store
   local.get $0
   i32.const 0
   i32.store offset=4
   local.get $0
   i32.const 0
   i32.store offset=8
   local.get $0
   i32.const 0
   i32.store offset=12
   local.get $0
   i32.const 0
   i32.store offset=16
   local.get $0
   i32.const 0
   i32.store offset=20
   local.get $0
  end
  call $~lib/map/Map<~lib/string/String,assembly/index/Node>#clear
  local.get $0
 )
 (func $assembly/index/Node#constructor (; 9 ;) (type $FUNCSIG$iiiii) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  local.get $0
  i32.eqz
  if
   i32.const 36
   call $~lib/allocator/arena/__memory_allocate
   local.set $0
  end
  local.get $0
  i32.const 0
  i32.store
  local.get $0
  i32.const 0
  i32.store offset=4
  local.get $0
  i64.const 0
  i64.store offset=8
  local.get $0
  i32.const 0
  i32.store offset=16
  local.get $0
  i32.const 0
  i32.store offset=20
  local.get $0
  i32.const 0
  i32.store offset=24
  local.get $0
  i32.const 0
  i32.store offset=28
  local.get $0
  i32.const 0
  i32.store offset=32
  local.get $0
  local.get $1
  i32.store
  local.get $0
  local.get $2
  i32.store offset=4
  local.get $0
  local.get $3
  i32.store offset=16
  local.get $0
  i64.const 0
  i64.store offset=8
  local.get $0
  i32.const 0
  i32.store offset=20
  local.get $0
  i32.const 0
  i32.store offset=24
  local.get $0
  call $~lib/map/Map<~lib/string/String,assembly/index/Node>#constructor
  i32.store offset=28
  local.get $0
 )
 (func $assembly/index/Node#equals (; 10 ;) (type $FUNCSIG$iii) (param $0 i32) (param $1 i32) (result i32)
  local.get $0
  i32.load offset=4
  local.get $1
  i32.load offset=4
  i32.eq
 )
 (func $~lib/internal/string/compareUnsafe (; 11 ;) (type $FUNCSIG$iiii) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
  (local $3 i32)
  loop $continue|0
   local.get $2
   if (result i32)
    local.get $0
    i32.load16_u offset=4
    local.get $1
    i32.load16_u offset=4
    i32.sub
    local.tee $3
    i32.eqz
   else    
    local.get $2
   end
   if
    local.get $2
    i32.const 1
    i32.sub
    local.set $2
    local.get $0
    i32.const 2
    i32.add
    local.set $0
    local.get $1
    i32.const 2
    i32.add
    local.set $1
    br $continue|0
   end
  end
  local.get $3
 )
 (func $~lib/string/String.__gt (; 12 ;) (type $FUNCSIG$iii) (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  (local $3 i32)
  block (result i32)
   local.get $0
   local.get $1
   i32.eq
   local.tee $2
   i32.eqz
   if
    local.get $0
    i32.eqz
    local.set $2
   end
   local.get $2
  end
  if (result i32)
   local.get $2
  else   
   local.get $1
   i32.eqz
  end
  if
   i32.const 0
   return
  end
  local.get $1
  i32.load
  local.set $2
  local.get $0
  i32.load
  local.tee $3
  i32.eqz
  if
   i32.const 0
   return
  end
  local.get $2
  i32.eqz
  if
   i32.const 1
   return
  end
  local.get $0
  local.get $1
  local.get $3
  local.get $2
  local.get $3
  local.get $2
  i32.lt_s
  select
  call $~lib/internal/string/compareUnsafe
  i32.const 0
  i32.gt_s
 )
 (func $assembly/index/Node#betterThan (; 13 ;) (type $FUNCSIG$iii) (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  local.get $0
  i64.load offset=8
  local.get $1
  i64.load offset=8
  i64.gt_u
  local.tee $2
  if (result i32)
   local.get $2
  else   
   local.get $0
   i64.load offset=8
   local.get $1
   i64.load offset=8
   i64.eq
   local.tee $2
   if (result i32)
    local.get $0
    i32.load offset=4
    local.get $1
    i32.load offset=4
    call $~lib/string/String.__gt
   else    
    local.get $2
   end
  end
 )
 (func $~lib/internal/hash/hashStr (; 14 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  (local $1 i32)
  (local $2 i32)
  (local $3 i32)
  i32.const -2128831035
  local.set $2
  local.get $0
  i32.load
  i32.const 1
  i32.shl
  local.set $3
  loop $repeat|0
   block $break|0
    local.get $1
    local.get $3
    i32.ge_u
    br_if $break|0
    local.get $2
    local.get $0
    local.get $1
    i32.add
    i32.load8_u offset=4
    i32.xor
    i32.const 16777619
    i32.mul
    local.set $2
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $repeat|0
   end
  end
  local.get $2
 )
 (func $~lib/string/String.__eq (; 15 ;) (type $FUNCSIG$iii) (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  local.get $0
  local.get $1
  i32.eq
  if
   i32.const 1
   return
  end
  local.get $0
  i32.eqz
  local.tee $2
  if (result i32)
   local.get $2
  else   
   local.get $1
   i32.eqz
  end
  if
   i32.const 0
   return
  end
  local.get $0
  i32.load
  local.tee $2
  local.get $1
  i32.load
  i32.ne
  if
   i32.const 0
   return
  end
  local.get $0
  local.get $1
  local.get $2
  call $~lib/internal/string/compareUnsafe
  i32.eqz
 )
 (func $~lib/map/Map<~lib/string/String,assembly/index/Node>#find (; 16 ;) (type $FUNCSIG$iiii) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
  local.get $0
  i32.load
  local.get $2
  local.get $0
  i32.load offset=4
  i32.and
  i32.const 2
  i32.shl
  i32.add
  i32.load offset=8
  local.set $0
  loop $continue|0
   local.get $0
   if
    local.get $0
    i32.load offset=8
    i32.const 1
    i32.and
    i32.eqz
    local.tee $2
    if (result i32)
     local.get $0
     i32.load
     local.get $1
     call $~lib/string/String.__eq
    else     
     local.get $2
    end
    if
     local.get $0
     return
    end
    local.get $0
    i32.load offset=8
    i32.const -2
    i32.and
    local.set $0
    br $continue|0
   end
  end
  i32.const 0
 )
 (func $~lib/map/Map<~lib/string/String,assembly/index/Node>#rehash (; 17 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  local.get $1
  i32.const 1
  i32.add
  local.tee $3
  i32.const 2
  i32.shl
  i32.const 0
  call $~lib/arraybuffer/ArrayBuffer#constructor
  local.set $5
  local.get $3
  f64.convert_i32_s
  f64.const 2.6666666666666665
  f64.mul
  i32.trunc_f64_s
  local.tee $7
  i32.const 12
  i32.mul
  i32.const 1
  call $~lib/arraybuffer/ArrayBuffer#constructor
  local.set $6
  local.get $0
  i32.load offset=8
  i32.const 8
  i32.add
  local.tee $3
  local.get $0
  i32.load offset=16
  i32.const 12
  i32.mul
  i32.add
  local.set $8
  local.get $6
  i32.const 8
  i32.add
  local.set $2
  loop $continue|0
   local.get $3
   local.get $8
   i32.ne
   if
    local.get $3
    local.tee $4
    i32.load offset=8
    i32.const 1
    i32.and
    i32.eqz
    if
     local.get $2
     local.get $4
     i32.load
     i32.store
     local.get $2
     local.get $4
     i32.load offset=4
     i32.store offset=4
     local.get $2
     local.get $5
     local.get $4
     i32.load
     call $~lib/internal/hash/hashStr
     local.get $1
     i32.and
     i32.const 2
     i32.shl
     i32.add
     local.tee $4
     i32.load offset=8
     i32.store offset=8
     local.get $4
     local.get $2
     i32.store offset=8
     local.get $2
     i32.const 12
     i32.add
     local.set $2
    end
    local.get $3
    i32.const 12
    i32.add
    local.set $3
    br $continue|0
   end
  end
  local.get $0
  local.get $5
  i32.store
  local.get $0
  local.get $1
  i32.store offset=4
  local.get $0
  local.get $6
  i32.store offset=8
  local.get $0
  local.get $7
  i32.store offset=12
  local.get $0
  local.get $0
  i32.load offset=20
  i32.store offset=16
 )
 (func $~lib/map/Map<~lib/string/String,assembly/index/Node>#set (; 18 ;) (type $FUNCSIG$viii) (param $0 i32) (param $1 i32) (param $2 i32)
  (local $3 i32)
  (local $4 i32)
  local.get $0
  local.get $1
  local.get $1
  call $~lib/internal/hash/hashStr
  local.tee $4
  call $~lib/map/Map<~lib/string/String,assembly/index/Node>#find
  local.tee $3
  if
   local.get $3
   local.get $2
   i32.store offset=4
  else   
   local.get $0
   i32.load offset=16
   local.get $0
   i32.load offset=12
   i32.eq
   if
    local.get $0
    local.get $0
    i32.load offset=20
    local.get $0
    i32.load offset=12
    f64.convert_i32_s
    f64.const 0.75
    f64.mul
    i32.trunc_f64_s
    i32.lt_s
    if (result i32)
     local.get $0
     i32.load offset=4
    else     
     local.get $0
     i32.load offset=4
     i32.const 1
     i32.shl
     i32.const 1
     i32.or
    end
    call $~lib/map/Map<~lib/string/String,assembly/index/Node>#rehash
   end
   local.get $0
   i32.load offset=8
   i32.const 8
   i32.add
   block (result i32)
    local.get $0
    local.get $0
    i32.load offset=16
    local.tee $3
    i32.const 1
    i32.add
    i32.store offset=16
    local.get $3
    i32.const 12
    i32.mul
   end
   i32.add
   local.tee $3
   local.get $1
   i32.store
   local.get $3
   local.get $2
   i32.store offset=4
   local.get $0
   local.get $0
   i32.load offset=20
   i32.const 1
   i32.add
   i32.store offset=20
   local.get $3
   local.get $0
   i32.load
   local.get $4
   local.get $0
   i32.load offset=4
   i32.and
   i32.const 2
   i32.shl
   i32.add
   local.tee $0
   i32.load offset=8
   i32.store offset=8
   local.get $0
   local.get $3
   i32.store offset=8
  end
 )
 (func $~lib/internal/memory/memcpy (; 19 ;) (type $FUNCSIG$viii) (param $0 i32) (param $1 i32) (param $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  loop $continue|0
   local.get $1
   i32.const 3
   i32.and
   local.get $2
   local.get $2
   select
   if
    local.get $0
    local.tee $3
    i32.const 1
    i32.add
    local.set $0
    local.get $3
    block (result i32)
     local.get $1
     local.tee $3
     i32.const 1
     i32.add
     local.set $1
     local.get $3
     i32.load8_u
    end
    i32.store8
    local.get $2
    i32.const 1
    i32.sub
    local.set $2
    br $continue|0
   end
  end
  local.get $0
  i32.const 3
  i32.and
  i32.eqz
  if
   loop $continue|1
    local.get $2
    i32.const 16
    i32.ge_u
    if
     local.get $0
     local.get $1
     i32.load
     i32.store
     local.get $0
     i32.const 4
     i32.add
     local.get $1
     i32.const 4
     i32.add
     i32.load
     i32.store
     local.get $0
     i32.const 8
     i32.add
     local.get $1
     i32.const 8
     i32.add
     i32.load
     i32.store
     local.get $0
     i32.const 12
     i32.add
     local.get $1
     i32.const 12
     i32.add
     i32.load
     i32.store
     local.get $1
     i32.const 16
     i32.add
     local.set $1
     local.get $0
     i32.const 16
     i32.add
     local.set $0
     local.get $2
     i32.const 16
     i32.sub
     local.set $2
     br $continue|1
    end
   end
   local.get $2
   i32.const 8
   i32.and
   if
    local.get $0
    local.get $1
    i32.load
    i32.store
    local.get $0
    i32.const 4
    i32.add
    local.get $1
    i32.const 4
    i32.add
    i32.load
    i32.store
    local.get $1
    i32.const 8
    i32.add
    local.set $1
    local.get $0
    i32.const 8
    i32.add
    local.set $0
   end
   local.get $2
   i32.const 4
   i32.and
   if
    local.get $0
    local.get $1
    i32.load
    i32.store
    local.get $1
    i32.const 4
    i32.add
    local.set $1
    local.get $0
    i32.const 4
    i32.add
    local.set $0
   end
   local.get $2
   i32.const 2
   i32.and
   if
    local.get $0
    local.get $1
    i32.load16_u
    i32.store16
    local.get $1
    i32.const 2
    i32.add
    local.set $1
    local.get $0
    i32.const 2
    i32.add
    local.set $0
   end
   local.get $2
   i32.const 1
   i32.and
   if
    local.get $0
    local.get $1
    i32.load8_u
    i32.store8
   end
   return
  end
  local.get $2
  i32.const 32
  i32.ge_u
  if
   block $break|2
    block $case2|2
     block $case1|2
      block $case0|2
       local.get $0
       i32.const 3
       i32.and
       i32.const 1
       i32.sub
       br_table $case0|2 $case1|2 $case2|2 $break|2
      end
      local.get $1
      i32.load
      local.set $4
      local.get $0
      local.get $1
      i32.load8_u
      i32.store8
      local.get $0
      i32.const 1
      i32.add
      local.tee $0
      i32.const 1
      i32.add
      local.set $3
      local.get $0
      block (result i32)
       local.get $1
       i32.const 1
       i32.add
       local.tee $0
       i32.const 1
       i32.add
       local.set $5
       local.get $0
       i32.load8_u
      end
      i32.store8
      local.get $3
      i32.const 1
      i32.add
      local.set $0
      local.get $5
      i32.const 1
      i32.add
      local.set $1
      local.get $3
      local.get $5
      i32.load8_u
      i32.store8
      local.get $2
      i32.const 3
      i32.sub
      local.set $2
      loop $continue|3
       local.get $2
       i32.const 17
       i32.ge_u
       if
        local.get $0
        local.get $1
        i32.const 1
        i32.add
        i32.load
        local.tee $3
        i32.const 8
        i32.shl
        local.get $4
        i32.const 24
        i32.shr_u
        i32.or
        i32.store
        local.get $0
        i32.const 4
        i32.add
        local.get $1
        i32.const 5
        i32.add
        i32.load
        local.tee $4
        i32.const 8
        i32.shl
        local.get $3
        i32.const 24
        i32.shr_u
        i32.or
        i32.store
        local.get $0
        i32.const 8
        i32.add
        local.get $1
        i32.const 9
        i32.add
        i32.load
        local.tee $3
        i32.const 8
        i32.shl
        local.get $4
        i32.const 24
        i32.shr_u
        i32.or
        i32.store
        local.get $0
        i32.const 12
        i32.add
        local.get $1
        i32.const 13
        i32.add
        i32.load
        local.tee $4
        i32.const 8
        i32.shl
        local.get $3
        i32.const 24
        i32.shr_u
        i32.or
        i32.store
        local.get $1
        i32.const 16
        i32.add
        local.set $1
        local.get $0
        i32.const 16
        i32.add
        local.set $0
        local.get $2
        i32.const 16
        i32.sub
        local.set $2
        br $continue|3
       end
      end
      br $break|2
     end
     local.get $1
     i32.load
     local.set $4
     local.get $0
     local.get $1
     i32.load8_u
     i32.store8
     local.get $0
     i32.const 1
     i32.add
     local.tee $3
     i32.const 1
     i32.add
     local.set $0
     local.get $3
     block (result i32)
      local.get $1
      i32.const 1
      i32.add
      local.tee $3
      i32.const 1
      i32.add
      local.set $1
      local.get $3
      i32.load8_u
     end
     i32.store8
     local.get $2
     i32.const 2
     i32.sub
     local.set $2
     loop $continue|4
      local.get $2
      i32.const 18
      i32.ge_u
      if
       local.get $0
       local.get $1
       i32.const 2
       i32.add
       i32.load
       local.tee $3
       i32.const 16
       i32.shl
       local.get $4
       i32.const 16
       i32.shr_u
       i32.or
       i32.store
       local.get $0
       i32.const 4
       i32.add
       local.get $1
       i32.const 6
       i32.add
       i32.load
       local.tee $4
       i32.const 16
       i32.shl
       local.get $3
       i32.const 16
       i32.shr_u
       i32.or
       i32.store
       local.get $0
       i32.const 8
       i32.add
       local.get $1
       i32.const 10
       i32.add
       i32.load
       local.tee $3
       i32.const 16
       i32.shl
       local.get $4
       i32.const 16
       i32.shr_u
       i32.or
       i32.store
       local.get $0
       i32.const 12
       i32.add
       local.get $1
       i32.const 14
       i32.add
       i32.load
       local.tee $4
       i32.const 16
       i32.shl
       local.get $3
       i32.const 16
       i32.shr_u
       i32.or
       i32.store
       local.get $1
       i32.const 16
       i32.add
       local.set $1
       local.get $0
       i32.const 16
       i32.add
       local.set $0
       local.get $2
       i32.const 16
       i32.sub
       local.set $2
       br $continue|4
      end
     end
     br $break|2
    end
    local.get $1
    i32.load
    local.set $4
    local.get $0
    local.tee $3
    i32.const 1
    i32.add
    local.set $0
    local.get $3
    block (result i32)
     local.get $1
     local.tee $3
     i32.const 1
     i32.add
     local.set $1
     local.get $3
     i32.load8_u
    end
    i32.store8
    local.get $2
    i32.const 1
    i32.sub
    local.set $2
    loop $continue|5
     local.get $2
     i32.const 19
     i32.ge_u
     if
      local.get $0
      local.get $1
      i32.const 3
      i32.add
      i32.load
      local.tee $3
      i32.const 24
      i32.shl
      local.get $4
      i32.const 8
      i32.shr_u
      i32.or
      i32.store
      local.get $0
      i32.const 4
      i32.add
      local.get $1
      i32.const 7
      i32.add
      i32.load
      local.tee $4
      i32.const 24
      i32.shl
      local.get $3
      i32.const 8
      i32.shr_u
      i32.or
      i32.store
      local.get $0
      i32.const 8
      i32.add
      local.get $1
      i32.const 11
      i32.add
      i32.load
      local.tee $3
      i32.const 24
      i32.shl
      local.get $4
      i32.const 8
      i32.shr_u
      i32.or
      i32.store
      local.get $0
      i32.const 12
      i32.add
      local.get $1
      i32.const 15
      i32.add
      i32.load
      local.tee $4
      i32.const 24
      i32.shl
      local.get $3
      i32.const 8
      i32.shr_u
      i32.or
      i32.store
      local.get $1
      i32.const 16
      i32.add
      local.set $1
      local.get $0
      i32.const 16
      i32.add
      local.set $0
      local.get $2
      i32.const 16
      i32.sub
      local.set $2
      br $continue|5
     end
    end
   end
  end
  local.get $2
  i32.const 16
  i32.and
  if
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
  end
  local.get $2
  i32.const 8
  i32.and
  if
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
  end
  local.get $2
  i32.const 4
  i32.and
  if
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
  end
  local.get $2
  i32.const 2
  i32.and
  if
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
   local.get $0
   i32.const 1
   i32.add
   local.tee $3
   i32.const 1
   i32.add
   local.set $0
   local.get $3
   block (result i32)
    local.get $1
    i32.const 1
    i32.add
    local.tee $3
    i32.const 1
    i32.add
    local.set $1
    local.get $3
    i32.load8_u
   end
   i32.store8
  end
  local.get $2
  i32.const 1
  i32.and
  if
   local.get $0
   local.get $1
   i32.load8_u
   i32.store8
  end
 )
 (func $~lib/internal/memory/memmove (; 20 ;) (type $FUNCSIG$viii) (param $0 i32) (param $1 i32) (param $2 i32)
  (local $3 i32)
  local.get $0
  local.get $1
  i32.eq
  if
   return
  end
  local.get $1
  local.get $2
  i32.add
  local.get $0
  i32.le_u
  local.tee $3
  if (result i32)
   local.get $3
  else   
   local.get $0
   local.get $2
   i32.add
   local.get $1
   i32.le_u
  end
  if
   local.get $0
   local.get $1
   local.get $2
   call $~lib/internal/memory/memcpy
   return
  end
  local.get $0
  local.get $1
  i32.lt_u
  if
   local.get $1
   i32.const 7
   i32.and
   local.get $0
   i32.const 7
   i32.and
   i32.eq
   if
    loop $continue|0
     local.get $0
     i32.const 7
     i32.and
     if
      local.get $2
      i32.eqz
      if
       return
      end
      local.get $2
      i32.const 1
      i32.sub
      local.set $2
      local.get $0
      local.tee $3
      i32.const 1
      i32.add
      local.set $0
      local.get $3
      block (result i32)
       local.get $1
       local.tee $3
       i32.const 1
       i32.add
       local.set $1
       local.get $3
       i32.load8_u
      end
      i32.store8
      br $continue|0
     end
    end
    loop $continue|1
     local.get $2
     i32.const 8
     i32.ge_u
     if
      local.get $0
      local.get $1
      i64.load
      i64.store
      local.get $2
      i32.const 8
      i32.sub
      local.set $2
      local.get $0
      i32.const 8
      i32.add
      local.set $0
      local.get $1
      i32.const 8
      i32.add
      local.set $1
      br $continue|1
     end
    end
   end
   loop $continue|2
    local.get $2
    if
     local.get $0
     local.tee $3
     i32.const 1
     i32.add
     local.set $0
     local.get $3
     block (result i32)
      local.get $1
      local.tee $3
      i32.const 1
      i32.add
      local.set $1
      local.get $3
      i32.load8_u
     end
     i32.store8
     local.get $2
     i32.const 1
     i32.sub
     local.set $2
     br $continue|2
    end
   end
  else   
   local.get $1
   i32.const 7
   i32.and
   local.get $0
   i32.const 7
   i32.and
   i32.eq
   if
    loop $continue|3
     local.get $0
     local.get $2
     i32.add
     i32.const 7
     i32.and
     if
      local.get $2
      i32.eqz
      if
       return
      end
      local.get $0
      local.get $2
      i32.const 1
      i32.sub
      local.tee $2
      i32.add
      local.get $1
      local.get $2
      i32.add
      i32.load8_u
      i32.store8
      br $continue|3
     end
    end
    loop $continue|4
     local.get $2
     i32.const 8
     i32.ge_u
     if
      local.get $2
      i32.const 8
      i32.sub
      local.tee $2
      local.get $0
      i32.add
      local.get $1
      local.get $2
      i32.add
      i64.load
      i64.store
      br $continue|4
     end
    end
   end
   loop $continue|5
    local.get $2
    if
     local.get $0
     local.get $2
     i32.const 1
     i32.sub
     local.tee $2
     i32.add
     local.get $1
     local.get $2
     i32.add
     i32.load8_u
     i32.store8
     br $continue|5
    end
   end
  end
 )
 (func $~lib/internal/arraybuffer/reallocateUnsafe (; 21 ;) (type $FUNCSIG$iii) (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  (local $3 i32)
  local.get $1
  local.get $0
  i32.load
  local.tee $2
  i32.gt_s
  if
   local.get $1
   i32.const 1073741816
   i32.gt_s
   if
    i32.const 0
    i32.const 56
    i32.const 40
    i32.const 4
    call $~lib/env/abort
    unreachable
   end
   local.get $1
   local.get $2
   call $~lib/internal/arraybuffer/computeSize
   i32.const 8
   i32.sub
   i32.le_s
   if
    local.get $0
    local.get $1
    i32.store
   else    
    local.get $1
    call $~lib/internal/arraybuffer/allocateUnsafe
    local.tee $3
    i32.const 8
    i32.add
    local.get $0
    i32.const 8
    i32.add
    local.get $2
    call $~lib/internal/memory/memmove
    local.get $3
    local.set $0
   end
   local.get $0
   i32.const 8
   i32.add
   local.get $2
   i32.add
   local.get $1
   local.get $2
   i32.sub
   call $~lib/internal/memory/memset
  else   
   local.get $1
   local.get $2
   i32.lt_s
   if
    local.get $1
    i32.const 0
    i32.lt_s
    if
     i32.const 0
     i32.const 56
     i32.const 62
     i32.const 4
     call $~lib/env/abort
     unreachable
    end
    local.get $0
    local.get $1
    i32.store
   end
  end
  local.get $0
 )
 (func $~lib/array/Array<assembly/index/Node>#push (; 22 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  local.get $0
  i32.load offset=4
  local.tee $2
  i32.const 1
  i32.add
  local.set $4
  local.get $2
  local.get $0
  i32.load
  local.tee $3
  i32.load
  i32.const 2
  i32.shr_u
  i32.ge_u
  if
   local.get $2
   i32.const 268435454
   i32.ge_u
   if
    i32.const 0
    i32.const 120
    i32.const 182
    i32.const 42
    call $~lib/env/abort
    unreachable
   end
   local.get $0
   local.get $3
   local.get $4
   i32.const 2
   i32.shl
   call $~lib/internal/arraybuffer/reallocateUnsafe
   local.tee $3
   i32.store
  end
  local.get $0
  local.get $4
  i32.store offset=4
  local.get $2
  i32.const 2
  i32.shl
  local.get $3
  i32.add
  local.get $1
  i32.store offset=8
 )
 (func $~lib/map/Map<~lib/string/String,assembly/index/Node>#get:size (; 23 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  local.get $0
  i32.load offset=20
 )
 (func $assembly/index/Node#addChild (; 24 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  (local $2 i32)
  local.get $0
  i32.load offset=28
  local.get $1
  i32.load offset=4
  local.get $1
  call $~lib/map/Map<~lib/string/String,assembly/index/Node>#set
  local.get $0
  i32.load offset=32
  local.get $1
  call $~lib/array/Array<assembly/index/Node>#push
  local.get $0
  i32.load offset=28
  i32.load offset=20
  i32.const 1
  i32.eq
  if
   local.get $0
   local.get $1
   i32.store offset=20
   local.get $1
   local.set $2
   loop $continue|0
    local.get $0
    if
     local.get $2
     local.get $0
     i32.load offset=20
     i32.eq
     if
      local.get $0
      local.get $1
      i32.load offset=24
      i32.store offset=24
      local.get $0
      local.set $2
      local.get $0
      i32.load offset=16
      local.set $0
      br $continue|0
     end
    end
   end
  end
 )
 (func $assembly/index/Node#onRemoveWeight~anonymous|0 (; 25 ;) (type $FUNCSIG$iiiii) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  local.get $1
  local.get $0
  call $assembly/index/Node#betterThan
  if (result i32)
   local.get $1
  else   
   local.get $0
  end
 )
 (func $~lib/array/Array<assembly/index/Node>#reduce<assembly/index/Node> (; 26 ;) (type $FUNCSIG$iii) (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  local.get $0
  i32.load offset=4
  local.set $3
  loop $repeat|0
   local.get $2
   local.get $3
   local.get $0
   i32.load offset=4
   local.tee $4
   local.get $3
   local.get $4
   i32.lt_s
   select
   i32.lt_s
   if
    i32.const 4
    global.set $~lib/argc
    local.get $1
    local.get $0
    i32.load
    local.get $2
    i32.const 2
    i32.shl
    i32.add
    i32.load offset=8
    local.get $2
    local.get $0
    i32.const 1
    call_indirect (type $FUNCSIG$iiiii)
    local.set $1
    local.get $2
    i32.const 1
    i32.add
    local.set $2
    br $repeat|0
   end
  end
  local.get $1
 )
 (func $assembly/index/Node#onRemoveWeight (; 27 ;) (type $FUNCSIG$vi) (param $0 i32)
  (local $1 i32)
  local.get $0
  local.get $0
  i32.load offset=16
  i32.load offset=20
  call $assembly/index/Node#equals
  if
   local.get $0
   local.get $0
   i32.load offset=32
   local.get $0
   call $~lib/array/Array<assembly/index/Node>#reduce<assembly/index/Node>
   local.tee $1
   call $assembly/index/Node#equals
   i32.eqz
   if
    local.get $0
    i32.load offset=16
    local.get $1
    i32.store offset=20
    local.get $0
    i32.load offset=16
    local.get $1
    i32.load offset=24
    i32.store offset=24
   end
  end
 )
 (func $assembly/index/Node#propogateWeightChange (; 28 ;) (type $FUNCSIG$vij) (param $0 i32) (param $1 i64)
  local.get $0
  local.get $0
  i64.load offset=8
  local.get $1
  i64.add
  i64.store offset=8
  local.get $0
  i32.load offset=16
  if
   local.get $1
   i64.const 0
   i64.le_u
   if
    local.get $0
    call $assembly/index/Node#onRemoveWeight
   else    
    local.get $0
    i32.load offset=16
    local.get $1
    call $assembly/index/Node#propogateWeightChange
   end
  end
 )
 (func $~lib/internal/memory/memcmp (; 29 ;) (type $FUNCSIG$iiii) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
  (local $3 i32)
  local.get $0
  local.get $1
  i32.eq
  if
   i32.const 0
   return
  end
  loop $continue|0
   local.get $2
   i32.const 0
   i32.ne
   local.tee $3
   if (result i32)
    local.get $0
    i32.load8_u
    local.get $1
    i32.load8_u
    i32.eq
   else    
    local.get $3
   end
   if
    local.get $2
    i32.const 1
    i32.sub
    local.set $2
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $continue|0
   end
  end
  local.get $2
  if (result i32)
   local.get $0
   i32.load8_u
   local.get $1
   i32.load8_u
   i32.sub
  else   
   i32.const 0
  end
 )
 (func $~lib/memory/memory.compare (; 30 ;) (type $FUNCSIG$iiii) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
  local.get $0
  local.get $1
  local.get $2
  call $~lib/internal/memory/memcmp
 )
 (func $~lib/memory/memory.free (; 31 ;) (type $FUNCSIG$vi) (param $0 i32)
  nop
 )
 (func $~lib/memory/memory.reset (; 32 ;) (type $FUNCSIG$v)
  global.get $~lib/allocator/arena/startOffset
  global.set $~lib/allocator/arena/offset
 )
 (func $start (; 33 ;) (type $FUNCSIG$v)
  i32.const 152
  global.set $~lib/allocator/arena/startOffset
  global.get $~lib/allocator/arena/startOffset
  global.set $~lib/allocator/arena/offset
 )
 (func $null (; 34 ;) (type $FUNCSIG$v)
  nop
 )
 (func $Node#get:slot (; 35 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  local.get $0
  i32.load
 )
 (func $Node#set:slot (; 36 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  local.get $0
  local.get $1
  i32.store
 )
 (func $Node#get:blockRoot (; 37 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  local.get $0
  i32.load offset=4
 )
 (func $Node#set:blockRoot (; 38 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  local.get $0
  local.get $1
  i32.store offset=4
 )
 (func $Node#get:weight (; 39 ;) (type $FUNCSIG$ji) (param $0 i32) (result i64)
  local.get $0
  i64.load offset=8
 )
 (func $Node#set:weight (; 40 ;) (type $FUNCSIG$vij) (param $0 i32) (param $1 i64)
  local.get $0
  local.get $1
  i64.store offset=8
 )
 (func $Node#get:parent (; 41 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  local.get $0
  i32.load offset=16
 )
 (func $Node#set:parent (; 42 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  local.get $0
  local.get $1
  i32.store offset=16
 )
 (func $Node#set:bestChild (; 43 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  local.get $0
  local.get $1
  i32.store offset=20
 )
 (func $Node#get:bestTarget (; 44 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  local.get $0
  i32.load offset=24
 )
 (func $Node#set:bestTarget (; 45 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  local.get $0
  local.get $1
  i32.store offset=24
 )
 (func $Node#get:children (; 46 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  local.get $0
  i32.load offset=28
 )
 (func $Node#set:children (; 47 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  local.get $0
  local.get $1
  i32.store offset=28
 )
 (func $Node#get:childValues (; 48 ;) (type $FUNCSIG$ii) (param $0 i32) (result i32)
  local.get $0
  i32.load offset=32
 )
 (func $Node#set:childValues (; 49 ;) (type $FUNCSIG$vii) (param $0 i32) (param $1 i32)
  local.get $0
  local.get $1
  i32.store offset=32
 )
)
