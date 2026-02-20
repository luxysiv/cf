export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/dns-query") {
      return handleDNS(request, env, ctx);
    }

    if (url.pathname === "/dashboard") {
      return renderDashboard(env);
    }

    if (url.pathname === "/dashboard/add" && request.method === "POST") {
      const formData = await request.formData();
      const domain = formData.get("domain");
      if (domain) {
        await env.BLACKLIST_KV.put(domain, "1");
      }
      return Response.redirect("/dashboard", 302);
    }

    if (url.pathname === "/dashboard/remove" && request.method === "POST") {
      const formData = await request.formData();
      const domain = formData.get("domain");
      if (domain) {
        await env.BLACKLIST_KV.delete(domain);
      }
      return Response.redirect("/dashboard", 302);
    }

    return new Response("DNS Adblock Running");
  }
};

async function handleDNS(request, env, ctx) {
  const query = new Uint8Array(await request.arrayBuffer());
  const domain = extractDomain(query);

  const blocked = await env.BLACKLIST_KV.get(domain);

  if (blocked) {
    // tăng thống kê
    let count = await env.STATS_KV.get("blocked_count");
    count = count ? parseInt(count) + 1 : 1;
    await env.STATS_KV.put("blocked_count", count.toString());

    return new Response(
      buildBlockedResponse(query),
      { headers: { "Content-Type": "application/dns-message" } }
    );
  }

  return fetch("https://cloudflare-dns.com/dns-query", {
    method: "POST",
    headers: { "Content-Type": "application/dns-message" },
    body: query
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

  const answer = [
    0xc0, 0x0c,
    0x00, 0x01,
    0x00, 0x01,
    0x00, 0x00, 0x00, 0x3c,
    0x00, 0x04,
    0x00, 0x00, 0x00, 0x00
  ];

  return new Uint8Array([...response, ...answer]);
}

async function renderDashboard(env) {
  const count = await env.STATS_KV.get("blocked_count") || "0";

  // Lấy danh sách domain trong blacklist
  const list = await env.BLACKLIST_KV.list();
  const domains = list.keys.map(k => k.name);

  const html = `
    <html>
      <head>
        <title>DNS Adblock Dashboard</title>
      </head>
      <body>
        <h1>DNS Adblock Dashboard</h1>
        <p>Số domain bị block: <strong>${count}</strong></p>

        <h2>Danh sách domain bị block</h2>
        <ul>
          ${domains.map(d => `<li>${d}</li>`).join("")}
        </ul>

        <h2>Thêm domain vào blacklist</h2>
        <form method="POST" action="/dashboard/add">
          <input type="text" name="domain" placeholder="example.com" required />
          <button type="submit">Thêm</button>
        </form>

        <h2>Xóa domain khỏi blacklist</h2>
        <form method="POST" action="/dashboard/remove">
          <input type="text" name="domain" placeholder="example.com" required />
          <button type="submit">Xóa</button>
        </form>
      </body>
    </html>
  `;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}
