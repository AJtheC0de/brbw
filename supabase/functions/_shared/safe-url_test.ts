import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { assertSafePublicUrl } from "./safe-url.ts";

Deno.test("rejects local and private targets before fetching", async () => {
  for (const url of [
    "http://localhost/admin",
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://192.168.1.2/",
    "http://[::1]/",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
  ]) {
    await assertRejects(() => assertSafePublicUrl(url));
  }
});

Deno.test("keeps a valid public URL normalized", async () => {
  const url = await assertSafePublicUrl("https://example.com/jobs?id=42");
  assertEquals(url.href, "https://example.com/jobs?id=42");
});
