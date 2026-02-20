export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/dns-query") {
      return handleDNS(request, env, ctx);
    }

    return new Response("DNS Adblock Running");
  }
};

async function handleDNS(request, env, ctx) {
  const query = new Uint8Array(await request.arrayBuffer());
  const domain = extractDomain(query);

  const blocked = await env.BLACKLIST_KV.get(domain);

  if (blocked) {
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
