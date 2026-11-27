export abstract class ArenaFields {
  static readonly tag: string = "fields";
  count(): number { return this.size; }
  size = 0;
}
