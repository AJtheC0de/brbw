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
  "siemens.com",
  "smartrecruiters.com",
  "softgarden.io",
  "successfactors.com",
  "successfactors.eu",
  "talent.com",
  "workable.com",
  "workday.com",
  "xing.com",
] as const;

export function isAllowedJobHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return DEFAULT_JOB_HOSTS
    .some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
