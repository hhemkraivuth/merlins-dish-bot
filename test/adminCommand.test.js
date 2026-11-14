const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

async function boot(runCommand) {
  process.env.ADMIN_API_TOKEN = "t0k";
  delete require.cache[require.resolve("../adminApi")];
  const adminApi = require("../adminApi");
  const app = express();
  adminApi.mount(app, { runCommand, persist: async () => true, state: () => ({}) });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, server };
}
const post = (base, body, token = "t0k") => fetch(`${base}/api/admin/command`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": token }, body: JSON.stringify(body) });

test("BOH can run an admin text command and get the replies back", async () => {
  const seen = [];
  const b = await boot(async (t) => { seen.push(t); return { handled: true, replies: ["Got it, closed on 15/11/2026."] }; });
  try {
    const r = await post(b.base, { text: "  close 15/11 holiday " });
    const j = await r.json();
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(seen, ["close 15/11 holiday"]);
    assert.deepStrictEqual(j, { ok: true, handled: true, replies: ["Got it, closed on 15/11/2026."] });
  } finally { b.server.close(); }
});
test("an empty command is refused and the wrong token is turned away", async () => {
  const b = await boot(async () => ({ handled: false, replies: [] }));
  try {
    assert.strictEqual((await post(b.base, { text: "" })).status, 400);
    assert.strictEqual((await post(b.base, { text: "close" }, "nope")).status, 401);
  } finally { b.server.close(); }
});
