Promise.resolve().then(() => { console.log('a'); Promise.resolve().then(() => console.log('c')); }); const h: any = globalThis; h.auditHostJob();
