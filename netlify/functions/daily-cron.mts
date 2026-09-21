// Netlify scheduled function: fires the app's daily lifecycle run
// (src/app/api/cron/daily) once a day. Kept to a fetch so the app's own
// code and Prisma client never have to be bundled a second time here.
// 22:00 UTC = 3pm Pacific / 6pm Eastern — after school, before dinner.
// Netlify sets URL to the site's primary URL; CRON_SECRET is the shared
// secret from the site's environment variables.
const dailyCron = async () => {
  const base = process.env.URL ?? "https://prephubtp.com";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("daily-cron: CRON_SECRET is not set; skipping");
    return;
  }
  const res = await fetch(`${base}/api/cron/daily`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  console.log(`daily-cron: ${res.status} ${await res.text()}`);
};

export default dailyCron;
export const config = { schedule: "0 22 * * *" };
