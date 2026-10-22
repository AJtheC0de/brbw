import { assertEquals } from "jsr:@std/assert@1";
import { isAllowedJobHost } from "./job-hosts.ts";

Deno.test("accepts supported job platforms and their subdomains", () => {
  assertEquals(isAllowedJobHost("jobs.lever.co"), true);
  assertEquals(isAllowedJobHost("boards.greenhouse.io"), true);
  assertEquals(isAllowedJobHost("acme.jobs.smartrecruiters.com"), true);
  assertEquals(isAllowedJobHost("www.linkedin.com"), true);
});

Deno.test("rejects suffix tricks, arbitrary hosts and local names", () => {
  assertEquals(isAllowedJobHost("lever.co.attacker.example"), false);
  assertEquals(isAllowedJobHost("evillever.co"), false);
  assertEquals(isAllowedJobHost("attacker.example"), false);
  assertEquals(isAllowedJobHost("localhost"), false);
});

Deno.test("supports explicitly configured company career hosts", () => {
  const configured = " careers.example.ch, jobs.example.com. ";
  assertEquals(isAllowedJobHost("careers.example.ch", configured), true);
  assertEquals(isAllowedJobHost("eu.jobs.example.com", configured), true);
  assertEquals(
    isAllowedJobHost("jobs.example.com.attacker.test", configured),
    false,
  );
});
