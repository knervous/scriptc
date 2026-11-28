// Where the WasmGC threads=shared lanes keep the blur's buffers in the shared memory (shared-run.mjs under Node, web/
// in a browser). Each link export takes its byte spans as (address, length).
export const W = 1024, H = 768, ROUNDS = 8;
// The module's own heap starts at 1024 and this module never allocates (it has no bytesFree export, which the hosts
// check): the buffers start at 64 KiB.
const src = 65536, dst = src + W * H, tmp = dst + W * H, cells = tmp + W * H * 2;
export const pages = Math.ceil((cells + 64) / 65536);
export const memoryDescriptor = { initial: pages, maximum: pages, shared: true };
export const args = {
  fill: [src, W * H],
  reset: [cells, 4],
  work: [src, W * H, dst, W * H, tmp, W * H * 2, cells, 4],
  checksum: [dst, W * H],
};
