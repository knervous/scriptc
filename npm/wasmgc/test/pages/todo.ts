// A page program: builds a list in the document and counts clicks on a button.
interface Item { name: string; done: boolean }

const items: Item[] = [
  { name: "parse", done: true },
  { name: "check", done: true },
  { name: "emit", done: false },
];

const root = document.createElement("main");
root.id = "app";
const list = document.createElement("ul");
for (const item of items) {
  const li = document.createElement("li");
  li.textContent = `${item.done ? "[x]" : "[ ]"} ${item.name}`;
  list.appendChild(li);
}
root.appendChild(list);

const button = document.createElement("button");
let clicks = 0;
button.textContent = "clicks: 0";
button.addEventListener("click", () => {
  clicks++;
  button.textContent = `clicks: ${clicks}`;
});
root.appendChild(button);
document.body.appendChild(root);

setTimeout(() => {
  console.log("done", items.filter((i) => i.done).length, "of", items.length);
  document.title = "ready";
}, 1);
