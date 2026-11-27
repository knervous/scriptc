// @known-defect(engine,native,native-any): widening Promise<null> into Promise<Atlas | null> (the dynCheck promise boundary) compiles but traps "illegal cast" / "not the expected compiled object" when the payload is awaited
// A promise of a narrower payload stored in a slot of a wider one.
class Atlas {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}
const later = <T>(value: T): Promise<T> => Promise.resolve(value);
async function main(): Promise<void> {
  const maybe: Promise<Atlas | null> = later(null);
  console.log((await maybe) === null);
}
void main();
