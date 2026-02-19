export class StatsCounter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/increment") {
      let count = (await this.state.storage.get("blocked")) || 0;
      count++;
      await this.state.storage.put("blocked", count);
      return new Response("OK");
    }

    if (url.pathname === "/get") {
      const count = (await this.state.storage.get("blocked")) || 0;
      return new Response(JSON.stringify({ blocked: count }));
    }

    return new Response("Stats Object");
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/dns-query") {
      return handleDNS(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/")) {
      return apiHandler(request, env);
    }

    if (url.pathname === "/dashboard") {
      return dashboard();
    }

    return new Response("DNS Adblock Pro Running");
  }
};

async function handleDNS(request, env, ctx) {
  const query = new Uint8Array(await request.arrayBuffer());
  const domain = extractDomain(query);

  const white = await env.WHITELIST_KV.get(domain);
  if (white) {
    return forward(query);
  }

  const blocked = await env.BLACKLIST_KV.get(domain);

  if (blocked) {
    const id = env.STATS.idFromName("global");
    const obj = env.STATS.get(id);
    ctx.waitUntil(obj.fetch("https://stats/increment"));

    return new Response(
      buildBlockedResponse(query),
      { headers: { "Content-Type": "application/dns-message" } }
    );
  }

  return forward(query);
}

async function forward(query) {
  return fetch("https://cloudflare-dns.com/dns-query", {
    method: "POST",
    headers: { "Content-Type": "application/dns-message" },
    body: query
  });
}

async function apiHandler(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/stats") {
    const id = env.STATS.idFromName("global");
    const obj = env.STATS.get(id);
    return obj.fetch("https://stats/get");
  }

  if (url.pathname === "/api/add" && request.method === "POST") {
    const { domain } = await request.json();
    await env.BLACKLIST_KV.put(domain, "1");
    return json({ success: true });
  }

  if (url.pathname === "/api/whitelist" && request.method === "POST") {
    const { domain } = await request.json();
    await env.WHITELIST_KV.put(domain, "1");
    return json({ success: true });
  }

  return json({ error: "Invalid API" });
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" }
  });
}

function extractDomain(buf) {
  let domain = "";
  let i = 12;
  while (buf[i] !== 0) {
    const len = buf[i];
    domain += new TextDecoder().decode(buf.slice(i + 1, i + 1 + len)) + ".";
    i += len + 1;
  }
  return domain.slice(0, -1);
}

function buildBlockedResponse(query) {
  const response = new Uint8Array(query);
  response[2] = 0x81;
  response[3] = 0x80;
  response[7] = 1;

  const answerA = [
    0xc0, 0x0c,
    0x00, 0x01,
    0x00, 0x01,
    0x00, 0x00, 0x00, 0x3c,
    0x00, 0x04,
    0x00, 0x00, 0x00, 0x00
  ];

  return new Uint8Array([...response, ...answerA]);
}

function dashboard() {
  return new Response(`
  <html>
  <head>
    <title>DNS Dashboard</title>
    <style>
      body { font-family: Arial; padding: 40px; }
      input { padding:8px; width:300px; }
      button { padding:8px; margin-left:5px; }
      .card { margin-bottom:20px; padding:20px; border:1px solid #ccc; }
    </style>
  </head>
  <body>
    <h1>DNS Adblock Pro</h1>

    <div class="card">
      <h2>Blocked Requests</h2>
      <h3 id="stats">Loading...</h3>
    </div>

    <div class="card">
      <h2>Add Block Domain</h2>
      <input id="blockDomain" placeholder="ads.example.com"/>
      <button onclick="add()">Add</button>
    </div>

    <div class="card">
      <h2>Add Whitelist Domain</h2>
      <input id="whiteDomain" placeholder="safe.example.com"/>
      <button onclick="white()">Whitelist</button>
    </div>

    <script>
      async function loadStats(){
        const res = await fetch('/api/stats');
        const data = await res.json();
        document.getElementById('stats').innerText = data.blocked;
      }

      async function add(){
        const domain = document.getElementById('blockDomain').value;
        await fetch('/api/add',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({domain})
        });
        alert("Added to blacklist");
      }

      async function white(){
        const domain = document.getElementById('whiteDomain').value;
        await fetch('/api/whitelist',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({domain})
        });
        alert("Added to whitelist");
      }

      loadStats();
      setInterval(loadStats, 5000);
    </script>
  </body>
  </html>
  `, {
    headers: { "Content-Type": "text/html" }
  });
}






















