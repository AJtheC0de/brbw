import { assertEquals } from "jsr:@std/assert@1";
import { isAllowedJobHost } from "../magic-import/_shared/job-hosts.ts";

Deno.test("accepts supported job platforms and their subdomains", () => {
  assertEquals(isAllowedJobHost("jobs.lever.co"), true);
  assertEquals(isAllowedJobHost("boards.greenhouse.io"), true);
  assertEquals(isAllowedJobHost("acme.jobs.smartrecruiters.com"), true);
  assertEquals(isAllowedJobHost("www.linkedin.com"), true);
  assertEquals(isAllowedJobHost("jobs.siemens.com"), true);
});

Deno.test("rejects suffix tricks, arbitrary hosts and local names", () => {
  assertEquals(isAllowedJobHost("lever.co.attacker.example"), false);
  assertEquals(isAllowedJobHost("evillever.co"), false);
  assertEquals(isAllowedJobHost("attacker.example"), false);
  assertEquals(isAllowedJobHost("localhost"), false);
});

Deno.test("does not allow runtime-configured or arbitrary career hosts", () => {
  assertEquals(isAllowedJobHost("careers.example.ch"), false);
  assertEquals(isAllowedJobHost("jobs.example.com"), false);
});
