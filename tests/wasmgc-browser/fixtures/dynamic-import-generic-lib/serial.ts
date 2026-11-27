export function X<T>(label: string, work: () => Promise<T>): Promise<T> {
  return work().then((value) => {
    console.log("ran " + label);
    return value;
  });
}
