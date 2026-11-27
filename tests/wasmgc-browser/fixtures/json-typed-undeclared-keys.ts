// A record built from untyped data (typed JSON.parse, a cast) keeps the source's undeclared own keys, in the source's order.
const doc = '[{"id":0,"name":"user-0","score":7,"active":true},{"id":1,"name":"user-1","score":3,"active":false}]';
const rows: { score: number }[] = JSON.parse(doc);
let sum = 0;
for (let i = 0; i < rows.length; i++) sum += rows[i]!.score;
console.log(sum, JSON.stringify(rows), JSON.stringify(rows).length === doc.length);
const one = JSON.parse('{"b":1,"score":2,"a":[3,{"x":null}]}') as { score: number };
console.log(JSON.stringify(one), Object.keys(one).join(","));
one.score = 40;
console.log(JSON.stringify(one));
type Order = { total: number; customer: { name: string } };
const order: Order = JSON.parse('{"id":"o1","customer":{"name":"Ada","tier":"gold"},"total":12.5}');
order.customer.name = "Grace";
console.log(JSON.stringify(order));
console.log(JSON.stringify({ orders: [order] }, null, 2));
