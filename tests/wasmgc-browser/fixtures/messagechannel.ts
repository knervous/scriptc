const h: any = globalThis; const c = new h.MessageChannel(); console.log(typeof c); console.log(typeof c.port2); c.port1.close(); c.port2.close();
