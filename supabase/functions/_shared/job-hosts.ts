export const DEFAULT_JOB_HOSTS = [
  "ashbyhq.com",
  "glassdoor.com",
  "greenhouse.io",
  "indeed.com",
  "jobup.ch",
  "jobs.ch",
  "join.com",
  "lever.co",
  "linkedin.com",
  "myworkdayjobs.com",
  "onlyfy.io",
  "personio.com",
  "personio.de",
  "recruitee.com",
  "smartrecruiters.com",
  "softgarden.io",
  "successfactors.com",
  "successfactors.eu",
  "talent.com",
  "workable.com",
  "workday.com",
  "xing.com",
] as const;

export function normalizedAllowedHosts(configured = "") {
  return [...DEFAULT_JOB_HOSTS, ...configured.split(",")]
    .map((host) => host.trim().toLowerCase().replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

export function isAllowedJobHost(hostname: string, configured = "") {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return normalizedAllowedHosts(configured)
    .some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
