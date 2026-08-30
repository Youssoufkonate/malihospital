/**
 * Firestore Security Rules test suite.
 *
 * WHAT THIS PROVES: not "does the code look right" (we've been burned by
 * that assumption plenty this project) but "if I actually try to read or
 * write data I shouldn't be able to, does Firestore actually stop me" —
 * tested against the REAL rules file, running in Google's own emulator,
 * not a guess about what the rules do.
 *
 * HOW TO RUN:
 *   1. cd into this firestore-tests folder
 *   2. npm install --save-dev @firebase/rules-unit-testing jest --break-system-packages (or without that flag on non-managed systems)
 *   3. From the PROJECT ROOT (where firebase.json lives), run:
 *        firebase emulators:exec --only firestore "cd firestore-tests && npx jest"
 *      This starts a real (local, disposable) Firestore emulator loaded
 *      with your actual rules file, runs the tests against it, then shuts
 *      it down — nothing here touches your real production data.
 *
 * WHAT'S COVERED: the tests below are representative, not exhaustive —
 * they demonstrate the pattern for the highest-value boundaries (cross-
 * hospital isolation, cross-facility isolation, disabled-account lockout,
 * department scoping, self-read). Extend this file with the same pattern
 * for any other collection/scenario you want proof for.
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const fs = require("fs");
const path = require("path");

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "hospital-mali-rules-test",
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, "../firestore/firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// Seeds a minimal, realistic set of documents for the two-hospital
// cross-isolation scenarios below: two hospitals, a doctor at each, and
// a patient at each.
async function seedTwoHospitalScenario() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection("users").doc("doctorA").set({
      role: "doctor", hospitalId: "hospitalA", department: "Cardiologie",
      firstName: "A", lastName: "Doctor", disabled: false, approved: true,
    });
    await db.collection("users").doc("doctorB").set({
      role: "doctor", hospitalId: "hospitalB", department: "Cardiologie",
      firstName: "B", lastName: "Doctor", disabled: false, approved: true,
    });
    await db.collection("users").doc("disabledDoctor").set({
      role: "doctor", hospitalId: "hospitalA", department: "Cardiologie",
      firstName: "Disabled", lastName: "Doctor", disabled: true, approved: true,
    });
    await db.collection("patients").doc("patientA").set({
      hospitalId: "hospitalA", patientId: "PAT-000001", firstName: "Patient", lastName: "A",
    });
    await db.collection("patients").doc("patientB").set({
      hospitalId: "hospitalB", patientId: "PAT-000001", firstName: "Patient", lastName: "B",
    });
    await db.collection("tickets").doc("ticketA").set({
      hospitalId: "hospitalA", department: "Cardiologie", patientName: "Patient A", status: "waiting",
    });
    await db.collection("tickets").doc("ticketB").set({
      hospitalId: "hospitalB", department: "Cardiologie", patientName: "Patient B", status: "waiting",
    });
  });
}

describe("Cross-hospital isolation — the core boundary this whole app depends on", () => {
  beforeEach(seedTwoHospitalScenario);

  test("a doctor CAN read a patient at their own hospital", async () => {
    const doctorA = testEnv.authenticatedContext("doctorA");
    await assertSucceeds(doctorA.firestore().collection("patients").doc("patientA").get());
  });

  test("a doctor CANNOT read a patient at a different hospital, even by guessing the document ID", async () => {
    const doctorA = testEnv.authenticatedContext("doctorA");
    await assertFails(doctorA.firestore().collection("patients").doc("patientB").get());
  });

  test("a doctor CANNOT update a patient at a different hospital", async () => {
    const doctorA = testEnv.authenticatedContext("doctorA");
    await assertFails(
      doctorA.firestore().collection("patients").doc("patientB").update({ firstName: "Tampered" })
    );
  });

  test("a doctor CAN read a ticket at their own hospital", async () => {
    const doctorA = testEnv.authenticatedContext("doctorA");
    await assertSucceeds(doctorA.firestore().collection("tickets").doc("ticketA").get());
  });

  test("a doctor CANNOT read a ticket at a different hospital", async () => {
    const doctorA = testEnv.authenticatedContext("doctorA");
    await assertFails(doctorA.firestore().collection("tickets").doc("ticketB").get());
  });

  test("an unauthenticated request CANNOT read patient data at all", async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(anon.firestore().collection("patients").doc("patientA").get());
  });
});

describe("Disabled accounts lose access immediately, not just at next login", () => {
  beforeEach(seedTwoHospitalScenario);

  test("a disabled doctor CANNOT read patients at their own hospital", async () => {
    const disabled = testEnv.authenticatedContext("disabledDoctor");
    await assertFails(disabled.firestore().collection("patients").doc("patientA").get());
  });

  test("a disabled doctor CANNOT read tickets at their own hospital", async () => {
    const disabled = testEnv.authenticatedContext("disabledDoctor");
    await assertFails(disabled.firestore().collection("tickets").doc("ticketA").get());
  });
});

describe("Self-read always works — the exact bug that caused real production pain earlier in this project", () => {
  beforeEach(seedTwoHospitalScenario);

  test("a user can always read their own profile document", async () => {
    const doctorA = testEnv.authenticatedContext("doctorA");
    await assertSucceeds(doctorA.firestore().collection("users").doc("doctorA").get());
  });

  test("a user CANNOT read another user's full profile if they're not an admin", async () => {
    const doctorA = testEnv.authenticatedContext("doctorA");
    await assertFails(doctorA.firestore().collection("users").doc("doctorB").get());
  });
});

describe("Department scoping for supervisors", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("users").doc("cardioSupervisor").set({
        role: "supervisor", hospitalId: "hospitalA", department: "Cardiologie",
        firstName: "Cardio", lastName: "Supervisor", disabled: false, approved: true,
      });
      await db.collection("users").doc("cardioNurse").set({
        role: "nurse", hospitalId: "hospitalA", department: "Cardiologie",
        firstName: "Cardio", lastName: "Nurse", disabled: false, approved: true,
      });
      await db.collection("users").doc("pediatricsNurse").set({
        role: "nurse", hospitalId: "hospitalA", department: "Pédiatrie",
        firstName: "Peds", lastName: "Nurse", disabled: false, approved: true,
      });
    });
  });

  test("a supervisor CAN read a staff member in their own department", async () => {
    const supervisor = testEnv.authenticatedContext("cardioSupervisor");
    await assertSucceeds(supervisor.firestore().collection("users").doc("cardioNurse").get());
  });

  test("a supervisor CANNOT read a staff member in a different department, same hospital", async () => {
    const supervisor = testEnv.authenticatedContext("cardioSupervisor");
    await assertFails(supervisor.firestore().collection("users").doc("pediatricsNurse").get());
  });
});

describe("Facility isolation — a pharmacy cannot see another pharmacy's inventory", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("users").doc("pharmacyStaffA").set({
        role: "pharmacy", facilityType: "pharmacy", facilityId: "pharmacyA",
        firstName: "Pharmacy", lastName: "A", disabled: false, approved: true,
      });
      await db.collection("inventory").doc("medA").set({
        facilityType: "pharmacy", facilityId: "pharmacyA", name: "Paracetamol", quantityAvailable: 100,
      });
      await db.collection("inventory").doc("medB").set({
        facilityType: "pharmacy", facilityId: "pharmacyB", name: "Ibuprofen", quantityAvailable: 50,
      });
    });
  });

  test("pharmacy staff CAN read their own facility's inventory", async () => {
    const staffA = testEnv.authenticatedContext("pharmacyStaffA");
    await assertSucceeds(staffA.firestore().collection("inventory").doc("medA").get());
  });

  test("pharmacy staff CANNOT read a different facility's inventory", async () => {
    const staffA = testEnv.authenticatedContext("pharmacyStaffA");
    await assertFails(staffA.firestore().collection("inventory").doc("medB").get());
  });

  test("pharmacy staff CANNOT write to a different facility's inventory", async () => {
    const staffA = testEnv.authenticatedContext("pharmacyStaffA");
    await assertFails(
      staffA.firestore().collection("inventory").doc("medB").update({ quantityAvailable: 9999 })
    );
  });
});

describe("Sessions — a device's own not-yet-existing record must read as checkable, not denied", () => {
  // Regression test for a real bug this project hit: requiring
  // "resource != null" before an ownership check makes the WHOLE clause
  // false when the doc doesn't exist, which Firestore treats as
  // permission-denied rather than "not found" — silently blocking every
  // non-superadmin from ever registering their first session/device.
  test("a signed-in user CAN check whether their own not-yet-created session exists", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection("users").doc("freshDoctor").set({
        role: "doctor", hospitalId: "hospitalA", department: "Cardiologie",
        firstName: "Fresh", lastName: "Doctor", disabled: false, approved: true,
      });
    });
    const fresh = testEnv.authenticatedContext("freshDoctor");
    // This session document has never been created — reading it should
    // succeed (and simply come back "does not exist"), not be denied.
    await assertSucceeds(fresh.firestore().collection("sessions").doc("brand-new-session-id").get());
  });
});