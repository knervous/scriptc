const a = new Uint8Array(1); const d = new DataView(a.buffer); d.setUint8(0, 7); console.log(d.getUint8(0.5));
