import https from "node:https";
import http from "node:http";

const BING_API = "https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch";
const SITE_URL = process.env.SITE_URL?.replace(/\/$/, "");
if (!SITE_URL) {
  console.log("[skip] SITE_URL not set, skipping Bing sitemap submission.");
  process.exit(0);
}
const SITEMAP_URL = `${SITE_URL}/sitemap.xml`;

function request(url, body) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function submitToBing() {
  const apiKey = process.env.BING_API_KEY;
  if (!apiKey) {
    console.log("[skip] BING_API_KEY not set, skipping Bing sitemap submission.");
    return;
  }

  console.log(`[bing] Submitting sitemap: ${SITEMAP_URL}`);

  const body = {
    siteUrl: SITE_URL,
    urlList: [SITEMAP_URL],
  };

  const url = `${BING_API}?apikey=${encodeURIComponent(apiKey)}`;
  const result = await request(url, body);
  console.log(`[bing] Status: ${result.status}`);
  console.log(`[bing] Response: ${result.body}`);
}

submitToBing().catch((err) => {
  console.error("[bing] Failed:", err);
  process.exit(1);
});
