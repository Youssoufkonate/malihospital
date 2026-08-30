const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");

// How long a schedule entry stays around AFTER its own date has passed,
// sized by the cadence it was created with — matches the retention windows
// you specified: daily entries are cleaned up fast (next day), monthly
// ones are kept visible longer (a month) since they represent a longer
// planning horizon.
const RETENTION_DAYS = { daily: 1, weekly: 7, monthly: 30 };

/**
 * Runs once a day at 03:00 UTC. Firestore can't query on a computed "is
 * this expired" condition directly, so this bounds the read to only
 * past-dated entries (every retention window requires the date to have
 * already passed, so anything dated today or later can never be a
 * candidate yet), then computes each entry's actual expiry from its
 * stored cadence + date and deletes the ones past it, in batches.
 *
 * Entries from before this feature shipped won't have a `cadence` field —
 * those default to the shortest (daily/24h) retention window, so old,
 * un-tagged data gets cleaned up quickly rather than accumulating forever.
 *
 * Uses the explicit options-object form with a standard cron expression
 * (rather than the "every day 03:00" shorthand string) — this is the most
 * universally-compatible way to call onSchedule across firebase-functions
 * versions, since it doesn't depend on that shorthand's natural-language
 * parser being present in whatever version actually gets resolved.
 */
exports.cleanupExpiredSchedules = onSchedule(
  { schedule: "0 3 * * *", timeZone: "UTC" },
  async (event) => {
    const db = admin.firestore();
    const today = new Date().toISOString().slice(0, 10);

    const snap = await db.collection("schedules").where("date", "<", today).get();
    if (snap.empty) {
      console.log("No past-dated schedule entries to check.");
      return;
    }

    const now = Date.now();
    const toDelete = snap.docs.filter((d) => {
      const data = d.data();
      const retentionDays = RETENTION_DAYS[data.cadence] ?? RETENTION_DAYS.daily;
      const entryDateMs = new Date(data.date + "T00:00:00").getTime();
      const expiryMs = entryDateMs + retentionDays * 24 * 60 * 60 * 1000;
      return now >= expiryMs;
    });

    if (toDelete.length === 0) {
      console.log(`Checked ${snap.size} past-dated entr${snap.size === 1 ? "y" : "ies"}, none expired yet.`);
      return;
    }

    // Firestore batches cap at 500 ops.
    for (let i = 0; i < toDelete.length; i += 450) {
      const batch = db.batch();
      toDelete.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    console.log(`Deleted ${toDelete.length} expired schedule entr${toDelete.length === 1 ? "y" : "ies"}.`);
  }
);