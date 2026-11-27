type Entry = { price: number; quantity: number; enabled: boolean };
const left: Entry = {price: 7, quantity: 2, enabled: true};
const right: Entry = {price: 3, quantity: 4, enabled: true};
export function total(): number {
  return (left.enabled ? left.price * left.quantity : 0) + (right.enabled ? right.price * right.quantity : 0);
}
export function update(id: number, quantity: number): number {
  if (id === 0) left.quantity = quantity;
  else right.quantity = quantity;
  return total();
}
export function enable(id: number, active: boolean): number {
  if (id === 0) left.enabled = active;
  else right.enabled = active;
  return total();
}

export function active(id: number): boolean { return id === 0 ? left.enabled : right.enabled; }
