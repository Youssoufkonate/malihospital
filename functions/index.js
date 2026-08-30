const admin = require("firebase-admin");
admin.initializeApp();

const staff = require("./lib/staff");
const hospitals = require("./lib/hospitals");
const tickets = require("./lib/tickets");
const stats = require("./lib/stats");
const notifications = require("./lib/notifications");
const patients = require("./lib/patients");
const facilities = require("./lib/facilities");
const prescriptions = require("./lib/prescriptions");
const loginSecurity = require("./lib/loginSecurity");
const backup = require("./lib/backup");
const mfaConfig = require("./lib/mfaConfig");
const recaptcha = require("./lib/recaptcha");
const passwordHistory = require("./lib/passwordHistory");
const accountRecovery = require("./lib/accountRecovery");
const loginContext = require("./lib/loginContext");
// scheduleCleanup abandoned — require("firebase-functions/v2/scheduler")
// crashes every function's shared container in this environment, even
// with corrected syntax. See conversation notes: auto-expiry is instead
// handled as a lazy client-side cleanup in Supervisor.jsx.

// Staff lifecycle (Create doctor / Delete doctor rows — generic across
// doctor/nurse/accueil, since they share the same underlying operations)
exports.createStaffAccount = staff.createStaffAccount;
exports.deleteStaffAccount = staff.deleteStaffAccount;
exports.setStaffDisabled = staff.setStaffDisabled;

// Hospital lifecycle (Approve hospital row)
exports.createHospital = hospitals.createHospital;
exports.setHospitalActive = hospitals.setHospitalActive;
exports.deleteHospital = hospitals.deleteHospital;

// Managing hospital admins for an EXISTING hospital — distinct from
// createHospital above, which bundles a brand-new hospital with its
// first admin in one step.
exports.addHospitalAdmin = hospitals.addHospitalAdmin;
exports.deleteHospitalAdmin = hospitals.deleteHospitalAdmin;

// Ticket-level privileged actions
exports.callNextPatient = tickets.callNextPatient;
exports.saveDiagnosis = tickets.saveDiagnosis;
exports.updatePatientRecord = tickets.updatePatientRecord;
exports.acquirePatientRecordLock = tickets.acquirePatientRecordLock;
exports.releasePatientRecordLock = tickets.releasePatientRecordLock;
exports.forceUnlockPatientRecord = tickets.forceUnlockPatientRecord;

// Statistics / reporting (server-side aggregation)
exports.getDiseaseStatistics = stats.getDiseaseStatistics;
exports.getDoctorStatistics = stats.getDoctorStatistics;
exports.generateAdminReport = stats.generateAdminReport;

// Broadcast notifications (in-app)
exports.broadcastNotification = notifications.broadcastNotification;

// Patients — Phase 1 of the full platform build
exports.registerPatient = patients.registerPatient;

// Pharmacies & Labs — standalone facility entities, same generic
// implementation shared by both (see functions/lib/facilities.js)
exports.createFacility = facilities.createFacility;
exports.setFacilityActive = facilities.setFacilityActive;
exports.deleteFacility = facilities.deleteFacility;
exports.createFacilityStaff = facilities.createFacilityStaff;
exports.deleteFacilityStaff = facilities.deleteFacilityStaff;
exports.setFacilityStaffDisabled = facilities.setFacilityStaffDisabled;
exports.bulkImportPharmacies = facilities.bulkImportPharmacies;
exports.claimFacility = facilities.claimFacility;
exports.bulkSetFacilitiesActive = facilities.bulkSetFacilitiesActive;

// Prescriptions — doctor writes, routes directly to a chosen pharmacy
exports.createPrescription = prescriptions.createPrescription;

// Account-level login lockout — server-side, keyed by email, so it
// follows the account across any browser/device rather than resetting
// the moment someone switches to a new one.
exports.checkLoginLock = loginSecurity.checkLoginLock;
exports.recordFailedLogin = loginSecurity.recordFailedLogin;
exports.clearLoginAttempts = loginSecurity.clearLoginAttempts;

// Manual Firestore backup trigger — see functions/lib/backup.js for the
// full setup requirements (Cloud Storage bucket, IAM roles) and why this
// is a manual button rather than a scheduled function.
exports.triggerBackup = backup.triggerBackup;

// One-time project-level TOTP enablement — see functions/lib/mfaConfig.js
exports.enableTotpMfa = mfaConfig.enableTotpMfa;

// reCAPTCHA v2 (visible checkbox on login) server-side verification
exports.verifyRecaptcha = recaptcha.verifyRecaptcha;

// Password history — no reuse of the last 10 passwords
exports.checkPasswordNotReused = passwordHistory.checkPasswordNotReused;
exports.recordPasswordChange = passwordHistory.recordPasswordChange;

// Secure account recovery — verified email + reCAPTCHA + rate limiting
exports.requestPasswordReset = accountRecovery.requestPasswordReset;

// Records IP + approximate city/country onto a session document, called
// once right after that session is first created (see SessionGuard.jsx)
exports.recordLoginContext = loginContext.recordLoginContext;

// Note: cleanupExpiredSchedules (scheduled function) was removed — see
// comment above. Auto-expiry now lives in Supervisor.jsx as a lazy
// client-side cleanup instead.

// Audit logs: not a separate callable function — every function above
// writes its own entry via the shared writeAuditLog() helper as part of
// the same operation, so logging can't be skipped or faked by the client.