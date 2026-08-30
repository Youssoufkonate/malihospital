const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole, checkRateLimit } = require("./helpers");

/**
 * Triggers a full Firestore export to Cloud Storage — this IS what
 * "encrypted backup" means in practice here: Google encrypts all Cloud
 * Storage data at rest automatically, so a successful export already
 * satisfies that requirement without any extra encryption step on our
 * side. Disaster recovery = being able to restore from one of these.
 *
 * DELIBERATELY a manual onCall trigger, not a scheduled function. This
 * project already hit a real, documented issue where importing
 * "firebase-functions/v2/scheduler" crashes every function's SHARED
 * container in this environment, even with correct syntax (see
 * functions/index.js's own comments on cleanupExpiredSchedules). Rather
 * than risk that same crash taking down every other function again,
 * this stays a plain callable — Super Admin clicks "Sauvegarder
 * maintenant" to run one on demand.
 *
 * FOR GENUINE AUTOMATED SCHEDULING (recommended for real production
 * use, not just relying on someone remembering to click a button):
 * set up Cloud Scheduler directly through the Google Cloud Console,
 * completely outside the Functions SDK, calling this function's HTTPS
 * endpoint on a cron schedule. That sidesteps the SDK import that
 * crashes things, since Cloud Scheduler is just making an HTTP request
 * to an already-deployed function — the function itself doesn't need
 * to know it's being called on a schedule.
 *   1. Deploy this function normally (as any other onCall function).
 *   2. Google Cloud Console -> Cloud Scheduler -> Create Job.
 *   3. Frequency: e.g. "0 2 * * *" for daily at 2am.
 *   4. Target type: HTTP. URL: this function's Cloud Run URL (visible
 *      in Cloud Functions Console under this function's details).
 *   5. HTTP method: POST. Body: {"data":{}} (onCall functions expect
 *      this envelope). Auth header: use a service account with the
 *      "Cloud Functions Invoker" role, OIDC token -- Cloud Scheduler's
 *      job editor has a built-in "Add OIDC token" option for exactly
 *      this.
 *
 * REQUIRES a Cloud Storage bucket to already exist for exports to land
 * in (Google Cloud Console -> Cloud Storage -> Create Bucket -- a name
 * like "hospital-mali-backups" in the same region as your Firestore
 * database is the usual choice), and the Cloud Functions service
 * account needs "Cloud Datastore Import Export Admin" and "Storage
 * Object Admin" IAM roles granted on that bucket -- both one-time setup
 * steps in Google Cloud Console (IAM & Admin -> IAM), not something this
 * code can grant itself.
 */
exports.triggerBackup = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin"]);
  await checkRateLimit("triggerBackup", caller.uid, 5, 60 * 60 * 1000); // 5/hour -- a real backup is a heavy operation

  const bucketName = process.env.BACKUP_BUCKET;
  if (!bucketName) {
    throw new HttpsError(
      "failed-precondition",
      "Aucun bucket de sauvegarde configuré. Un administrateur doit définir la variable d'environnement BACKUP_BUCKET (voir les commentaires du code)."
    );
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputUriPrefix = `gs://${bucketName}/backups/${timestamp}`;

  try {
    const { GoogleAuth } = require("google-auth-library");
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/datastore"] });
    const client = await auth.getClient();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`;

    const response = await client.request({
      url,
      method: "POST",
      data: { outputUriPrefix },
    });

    return {
      message: `Sauvegarde lancée vers ${outputUriPrefix}. L'export s'exécute en arrière-plan -- vérifiez le bucket Cloud Storage dans quelques minutes pour confirmer qu'il s'est terminé.`,
      operationName: response.data?.name || null,
    };
  } catch (e) {
    throw new HttpsError(
      "internal",
      "Erreur lors du lancement de la sauvegarde: " + e.message +
      " -- vérifiez que le bucket existe et que les permissions IAM (Cloud Datastore Import Export Admin, Storage Object Admin) sont accordées au compte de service des Cloud Functions."
    );
  }
});