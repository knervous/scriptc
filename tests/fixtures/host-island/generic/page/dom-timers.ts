const el = document.createElement("div");
el.textContent = "hello";
document.body.appendChild(el);
console.log(document.body.children.length, el.textContent);
setTimeout(() => console.log("tick", performance.now() > 0), 10);
