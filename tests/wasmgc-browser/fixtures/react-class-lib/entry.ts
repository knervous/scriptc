import { Component, PureComponent } from "rcomp";
interface P { label: string }
interface S { n: number; err: string | null }
class Counter extends Component<P, S> {
  constructor(props: P) {
    super(props);
    this.state = { n: 0, err: null };
  }
  static getDerivedStateFromError(e: Error): Partial<S> { return { err: e.message }; }
  componentDidMount(): void { this.setState({ n: this.state.n + 1 }); }
  componentDidCatch(e: Error): void { console.log("caught " + e.message); }
  render(): string { return this.props.label + ":" + this.state.n + ":" + this.state.err; }
}
class Pure extends PureComponent<P, S> {
  render(): string { return "pure " + this.props.label; }
}
export function run(): void {
  const c = new Counter({ label: "a" });
  console.log(c.render());
  c.componentDidMount();
  c.setState((s: S) => ({ n: s.n * 10 }));
  console.log(c.render());
  const patch = Counter.getDerivedStateFromError(new Error("boom"));
  c.setState(patch);
  c.componentDidCatch(new Error("boom"));
  console.log(c.render());
  const any: any = c;
  console.log(c instanceof Counter, typeof any.isReactComponent, typeof any.setState, any.state.n);
  // The base's prototype is part of the instance's dyn view: reads, `in` and method calls through any.
  console.log((c as any).isReactComponent !== undefined, typeof (c as any).setState, typeof (c as any).forceUpdate);
  console.log("isReactComponent" in any, "setState" in (c as any), "state" in any, "props" in any, "componentDidCatch" in any, "nope" in any);
  (c as any).setState({ n: 99 });
  console.log(c.render(), any.hasOwnProperty("state"), any.hasOwnProperty("isReactComponent"));
  // Statics are live properties of the class value: a host (React) reads ctor.getDerivedStateFromError dynamically.
  const ctor: any = Counter;
  console.log(typeof ctor.getDerivedStateFromError, JSON.stringify(ctor.getDerivedStateFromError(new Error("dyn"))), "getDerivedStateFromError" in ctor);
  const p = new Pure({ label: "z" });
  console.log(p.render(), p instanceof Pure);
}
