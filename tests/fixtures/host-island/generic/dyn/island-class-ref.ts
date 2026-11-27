// A class instance handed to the island (an untyped global, as `window.soundService = SoundService`) crosses by
// reference: it comes back as the same object, its fields and methods intact, and its private graph is never copied.
class Graph { nodes = [1, 2, 3]; }
class Service {
  graph = new Graph();
  count = 2;
  bump(): number { return ++this.count; }
}
const service = new Service();
const g: any = globalThis;
g.svc = service;
const back: Service = g.svc;
console.log(back === service, back.bump(), service.count, back.graph.nodes.length, typeof g.svc, !!g.svc);
