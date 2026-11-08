// GET /native/<room> and GET /facet/<room> upgrade to a WebSocket that echoes.
// Both run the same Room class; /facet runs it as a facet loaded with the
// Worker Loader, the way a platform hosts user code.
import { DurableObject } from "cloudflare:workers";

const ROOM_SOURCE = `
import { DurableObject } from "cloudflare:workers";
export class Room extends DurableObject {
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("warm");
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, message) {
    ws.send("echo:" + message);
  }
}
`;

export class NativeRoom extends DurableObject {
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("warm");
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, message) {
    ws.send("echo:" + message);
  }
}

export class FacetParent extends DurableObject {
  fetch(request) {
    const facet = this.ctx.facets.get("room", () => {
      const worker = this.env.LOADER.get("room-code-v1", () => ({
        compatibilityDate: "2026-11-04",
        mainModule: "room.js",
        modules: { "room.js": ROOM_SOURCE },
      }));
      return { class: worker.getDurableObjectClass("Room") };
    });
    return facet.fetch(request);
  }
}

export default {
  fetch(request, env) {
    const [, kind, room] = new URL(request.url).pathname.split("/");
    if (kind === "native") return env.NATIVE.getByName(room).fetch(request);
    if (kind === "facet") return env.PARENT.getByName(room).fetch(request);
    return new Response("GET /native/<room> or /facet/<room> with Upgrade: websocket", { status: 404 });
  },
};
