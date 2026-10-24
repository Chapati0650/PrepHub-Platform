// Netlify scheduled function: drains the app's outbound email queue
// (src/app/api/cron/email-queue). Kept to a fetch so the app's own code and
// Prisma client never have to be bundled a second time here, same as
// daily-cron.mts.
//
// Every five minutes rather than every minute: the request that publishes an
// announcement or sends roster invitations already drains for a few seconds
// itself, so this only has to finish what a district-sized send left behind.
// Five minutes keeps that within a sensible delay at roughly a tenth of the
// invocations.
const emailQueueCron = async () => {
  const base = process.env.URL ?? "https://prephubtp.com";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("email-queue-cron: CRON_SECRET is not set; skipping");
    return;
  }
  const res = await fetch(`${base}/api/cron/email-queue`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  console.log(`email-queue-cron: ${res.status} ${await res.text()}`);
};

export default emailQueueCron;
export const config = { schedule: "*/5 * * * *" };
