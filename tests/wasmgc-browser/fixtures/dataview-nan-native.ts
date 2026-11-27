const a = new Uint8Array(4); const d = new DataView(a.buffer); console.log(d.getUint8(NaN));
