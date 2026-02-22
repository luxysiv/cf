export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Hỗ trợ cả GET (JSON/Base64) và POST (Binary)
    if (url.pathname === "/dns-query") {
      return handleDNS(request, env, ctx);
    }

    return new Response("DNS Adblocker is Active", { status: 200 });
  }
};

async function handleDNS(request, env, ctx) {
  let queryBuffer;
  
  // Xử lý cả 2 phương thức: POST (binary) và GET (base64)
  if (request.method === "POST") {
    queryBuffer = await request.arrayBuffer();
  } else {
    const url = new URL(request.url);
    const dnsParam = url.searchParams.get("dns");
    if (!dnsParam) return new Response("Missing DNS param", { status: 400 });
    // Giải mã base64url
    const binary = atob(dnsParam.replace(/-/g, "+").replace(/_/g, "/"));
    queryBuffer = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
  }

  const query = new Uint8Array(queryBuffer);
  const domain = extractDomain(query);

  // Kiểm tra blacklist (Dùng Cache API hoặc KV)
  const isBlocked = await env.BLACKLIST_KV.get(domain);

  if (isBlocked) {
    return new Response(
      buildBlockedResponse(query),
      { headers: { "Content-Type": "application/dns-message" } }
    );
  }

  // Chuyển tiếp đến Cloudflare DNS gốc
  return fetch("https://1.1.1.1/dns-query", {
    method: "POST",
    headers: { "Content-Type": "application/dns-message" },
    body: query
  });
}

function extractDomain(buf) {
  let domain = [];
  let i = 12; // Nhảy qua Header (12 bytes)
  while (i < buf.length && buf[i] !== 0) {
    const len = buf[i];
    if (i + 1 + len > buf.length) break;
    domain.push(new TextDecoder().decode(buf.slice(i + 1, i + 1 + len)));
    i += len + 1;
  }
  return domain.join(".").toLowerCase();
}

function buildBlockedResponse(query) {
  // Tạo bản sao header từ query
  const response = new Uint8Array(query.length + 16);
  response.set(query);

  // QR = 1 (Response), Opcode = 0, AA = 1, TC = 0, RD = 1
  response[2] = 0x81; 
  // RA = 1, Z = 0, RCODE = 0 (NoError)
  response[3] = 0x80; 

  // Thiết lập số lượng câu trả lời (Answer Count = 1)
  response[6] = 0;
  response[7] = 1;

  // Answer Section:
  // Offset tới domain name (thường là 0xc00c cho domain đầu tiên)
  const answer = [
    0xc0, 0x0c,       // Name (Pointer tới domain trong query)
    0x00, 0x01,       // Type: A
    0x00, 0x01,       // Class: IN
    0x00, 0x00, 0x00, 0x3c, // TTL: 60s
    0x00, 0x04,       // Data length: 4 bytes
    0x00, 0x00, 0x00, 0x00  // IP: 0.0.0.0
  ];

  response.set(answer, query.length);
  return response.slice(0, query.length + 16);
}
