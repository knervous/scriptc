// An array of page objects passed at a parameter lib.dom declares as
// Iterable<T> (GPUQueue.submit's WebIDL sequence<GPUCommandBuffer>): the page
// receives a real Array holding the elements in source order, from a literal,
// from a variable of T[], and from an empty literal.
const h: any = globalThis;
const gpu = h.auditGpu();
const encoder: GPUCommandEncoder = gpu.encoder;
const queue: GPUQueue = gpu.queue;
queue.submit([encoder.finish()]);
queue.submit([encoder.finish(), encoder.finish()]);
const batch: GPUCommandBuffer[] = [encoder.finish()];
batch.push(encoder.finish());
queue.submit(batch);
queue.submit([]);
export {};
