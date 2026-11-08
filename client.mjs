// node client.mjs https://<worker>.workers.dev [rooms=20] [idleSeconds=90] [warm=0]
// Opens one WebSocket per room for each kind, sends one message, stays idle,
// then sends another and reports which sockets were closed or did not answer.
// warm=1 first sends a plain HTTP request to the room (through the parent's
// facets.get) right before the second message.
const [base, rooms = "20", idle = "90", warm = "0"] = process.argv.slice(2);
const run = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function one(kind, i) {
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/${kind}/${run}-${i}`);
  const replies = [];
  let closed = null;
  ws.onmessage = (m) => replies.push(m.data);
  ws.onclose = (c) => (closed ??= { code: c.code, reason: c.reason, wasClean: c.wasClean, afterSeconds: (Date.now() - openedAt) / 1000 });
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
  const openedAt = Date.now();
  ws.send("first");
  await sleep(2000);
  await sleep(Number(idle) * 1000);
  if (warm === "1" && !closed) await (await fetch(`${base}/${kind}/${run}-${i}`)).text();
  if (!closed) ws.send("second");
  await sleep(5000);
  const ok = !closed && replies.includes("echo:second");
  if (!closed) ws.close(1000);
  return { kind, i, ok, closed, replies };
}

const results = await Promise.all(
  ["native", "facet"].flatMap((kind) => Array.from({ length: Number(rooms) }, (_, i) => one(kind, i))),
);
for (const kind of ["native", "facet"]) {
  const rs = results.filter((r) => r.kind === kind);
  const failed = rs.filter((r) => !r.ok);
  console.log(`${kind}${warm === "1" ? " (warmed through the parent first)" : ""}: ${failed.length}/${rs.length} sockets lost after ${idle}s idle`, failed.slice(0, 3).map((r) => r.closed));
}
