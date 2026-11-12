// A stand-in for Razorpay's order API, for browser tests only. It checks the API key like the real one does (HTTP Basic auth)
// and remembers every order so tests can see exactly what the server asked for.
import { createServer } from "node:http";

const PORT = 3196;
const KEY_ID = "rzp_test_e2e12345";
const KEY_SECRET = "e2e_key_secret_0123456789";
const orders = [];
let seq = 0;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/health") { res.end("ok"); return; }
  if (url.pathname === "/debug") { res.end(JSON.stringify({ orders })); return; }
  if (url.pathname === "/v1/orders" && req.method === "POST") {
    const auth = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString();
    if (auth !== `${KEY_ID}:${KEY_SECRET}`) { res.statusCode = 401; res.end(JSON.stringify({ error: { description: "Authentication failed" } })); return; }
    let raw = "";
    for await (const c of req) raw += c;
    const b = JSON.parse(raw);
    if (!Number.isInteger(b.amount) || b.amount < 100 || b.currency !== "INR") { res.statusCode = 400; res.end(JSON.stringify({ error: { description: "bad request" } })); return; }
    const order = { id: `order_E2E${String(++seq).padStart(8, "0")}`, entity: "order", amount: b.amount, amount_paid: 0, currency: b.currency, receipt: String(b.receipt ?? "").slice(0, 40), status: "created", notes: b.notes ?? {} };
    orders.push(order);
    res.end(JSON.stringify(order));
    return;
  }
  res.statusCode = 404;
  res.end("{}");
}).listen(PORT, "127.0.0.1", () => console.log("fake razorpay on " + PORT));
