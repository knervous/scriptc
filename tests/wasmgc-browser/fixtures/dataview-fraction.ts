const d = new DataView(new ArrayBuffer(1)); d.setUint8(0, 7); console.log(d.getUint8(0.5));
