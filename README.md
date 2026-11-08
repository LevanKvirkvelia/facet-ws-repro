# Hibernated WebSockets in a Durable Object facet are dropped (1006) on wake

**Summary.** A hibernatable WebSocket (`ctx.acceptWebSocket`) accepted inside a
[Durable Object facet](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/)
whose class comes from the Worker Loader is closed with `1006` when a client
message wakes it after roughly 1–5 minutes of idle time. The same class run as a
plain Durable Object never loses a socket. No deploy happens during the test.

On the server side the dropped facet runs no code at all on wake: no
constructor, no `webSocketMessage`, no `webSocketClose`/`webSocketError`. The
client just sees an abnormal close (1006) right when it sends the message.

## Reproduce

```sh
npm install
npx wrangler deploy                      # needs a Workers Paid account (Worker Loader + facets)
node client.mjs https://facet-ws-repro.<your-subdomain>.workers.dev 20 180      # 20 rooms per kind, 180 s idle
node client.mjs https://facet-ws-repro.<your-subdomain>.workers.dev 20 180 1    # same, but "warm" the facet first
```

`worker.js` (~60 lines) runs the same `Room` class two ways:

- `/native/<room>`: `NativeRoom`, a regular Durable Object.
- `/facet/<room>`: `FacetParent` builds the facet with `ctx.facets.get("room", ...)`,
  loading `Room` from a string through `env.LOADER.get("room-code-v1", ...)`.

`client.mjs` opens one socket per room, sends `first`, idles, sends `second`
and checks for `echo:second`. With `warm=1` it sends one plain HTTP request to
the room right before `second`; that request goes through the parent's
`facets.get`.

## Results (2026-11-08, Node 26, wrangler 4.158.0, compatibility date 2026-11-04)

| Run | Native DO lost | Facet lost |
|---|---|---|
| 90 s idle | 0/20 | 13/20 |
| 180 s idle | 0/20 | 17/20 |
| 180 s idle, warmed through the parent first | 0/20 | 0/20 |

Larger soak on a dedicated Worker with no deploys during the run, two independent
clients on different networks (macOS laptop and a Linux VPS), both seeing the same:

| Idle before the wake message | Native DO lost | Facet lost |
|---|---|---|
| 15 s | 0/240 (15–300 s combined) | 1/80 |
| 60 s | | 10/80 |
| 300 s | | 54/80 |
| 300 s, facet accepts with `ws.accept()` (not hibernatable) | – | 0/180 |
| 300 s, facet woken by the parent's alarm via `facets.get` | – | 0/60 |

Whether the parent is busy and whether the Loader id is shared or fresh does not
change the pattern.

## Expected vs actual

- **Expected:** a message to a hibernated socket wakes the facet (rebuilding it
  from the parent's `facets.get` startup callback / Loader code if needed) and
  delivers `webSocketMessage`, exactly like a plain Durable Object.
- **Actual:** once the facet's Loader code has been unloaded, the wake message
  does not go through the parent and the runtime closes the socket with 1006.

## Our hypothesis

A socket message that wakes a hibernated facet bypasses the parent's
`facets.get`. If the facet's dynamic Worker isolate is still warm it works; once
the Worker Loader code has been evicted (after ~1–5 minutes idle) the runtime
cannot rebuild the facet and drops the socket instead. Any request that goes
through the parent first (HTTP or an alarm calling `facets.get`) avoids it.

## Why it matters

We host AI-generated apps whose Durable Objects run as facets (one parent DO per
instance, user code via Worker Loader). Multiplayer games and chats are the main
WebSocket users; players who stay quiet for a minute or more get disconnected on
their next message.
