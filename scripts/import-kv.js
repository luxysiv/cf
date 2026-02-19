import fetch from "node-fetch";

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const API_TOKEN = process.env.CF_API_TOKEN;

const SOURCES = [
  "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
  "https://big.oisd.nl/domainswild"
];

async function fetchLists() {
  let domains = new Set();

  for (const url of SOURCES) {
    const res = await fetch(url);
    const text = await res.text();

    text.split("\n").forEach(line => {
      if (line && !line.startsWith("#")) {
        const parts = line.trim().split(/\s+/);
        const domain = parts.length > 1 ? parts[1] : parts[0];
        if (domain.includes(".")) domains.add(domain);
      }
    });
  }

  return Array.from(domains);
}

function chunk(arr, size) {
  return Array.from({ length: Math.ceil(arr.length / size) },
    (_, i) => arr.slice(i * size, i * size + size));
}

async function upload(batch) {
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/bulk`,
    {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        batch.map(d => ({ key: d, value: "1" }))
      )
    }
  );
}

async function main() {
  const domains = await fetchLists();
  const batches = chunk(domains, 1000);

  for (const batch of batches) {
    await upload(batch);
  }

  console.log("Import complete:", domains.length);
}

main();
