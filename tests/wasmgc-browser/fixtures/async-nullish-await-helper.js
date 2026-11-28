// Untyped code: an option read whose fallback is awaited only when the option is absent.
async function createDevice(options) { console.log("create", options?.label ?? "none"); return { id: 7 }; }
export async function open(options) {
  const device = options?.device ?? await createDevice(options);
  let other = options?.other;
  other = other ?? await createDevice({ label: "second" });
  const both = (options?.flag && await createDevice({ label: "third" })) || null;
  return device.id + other.id + (both ? both.id : 0);
}
