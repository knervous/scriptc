// @options: {"interfaceClassArms": true}
// A narrower record that reaches its wider interface through its own fields (TaskBase -> Owner -> Frame -> Task[]) is
// an arm of that interface however the program reaches the two types. Here TaskBase is mapped first (the signature of
// the first function), so `Task` resolves its arms from inside TaskBase's still-open mapping; the arms are decided
// when TaskBase closes, not against its unfinished shape (which made the guard's narrowing refuse with SC2003).
interface Owner { frame: Frame; label: string }
interface Frame { tasks: Task[] }
interface Task {
  readonly name: string;
  readonly owner?: Owner | undefined;
  passes: number[];
  record(): void;
  execute?: () => number;
}
interface FullTask extends Task {
  config: number;
  hidden: number;
  extra: number;
}
type TaskBase = Omit<FullTask, "hidden">;

function createTask(name: string): TaskBase {
  const task: TaskBase = { name, owner: undefined, passes: [], config: 1, extra: name.length, record: () => {}, execute: undefined };
  task.execute = () => task.extra;
  return task;
}

const first = createTask("first");
const owner: Owner = { frame: { tasks: [] }, label: "o" };

function isFull(task: Task): task is TaskBase {
  return "config" in task && "extra" in task;
}
function defaultTask(o: Owner): TaskBase | undefined {
  for (const task of o.frame.tasks) {
    if (isFull(task) && task.config === 1) return task;
  }
  return undefined;
}
owner.frame.tasks.push(first);
owner.frame.tasks.push({ name: "plain", owner, passes: [1], record: () => {} });
const found = defaultTask(owner);
console.log(owner.frame.tasks.length, found ? found.name : "none", found?.owner?.label, found?.execute?.());
