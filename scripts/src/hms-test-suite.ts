/**
 * Comprehensive Automated Test Suite for Health Management System (HMS)
 * 
 * Verifies:
 * 1. Authentication (Registration, validation, duplicate email rejection, login, session, logout)
 * 2. Role-Based Access Control (RBAC - patient, doctor, admin route guards)
 * 3. Object-Level Access Control (IDOR prevention - doctor modifying other doctor's appointment, patient cancelling other patient's appointment)
 * 4. Scheduling Engine (Conflict detection, weekday validation against doctor schedule, duplicate booking rejection, slot release on cancel)
 * 5. Doctor Workflows (Status updates: Pending -> Confirmed -> Completed, cancellation)
 * 6. Admin Workflows (Doctor creation, editing, status toggle, patient list, appointment filtering)
 */

export {};

const API = process.env.API_URL || "http://localhost:3000/api";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    process.stdout.write(`  [TEST] ${name} ... `);
    await fn();
    console.log("PASSED");
    testsPassed++;
  } catch (err: any) {
    console.log("FAILED");
    console.error(`         -> ${err?.message || err}`);
    testsFailed++;
  }
}

async function request(path: string, options: RequestInit = {}, cookie = "") {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

function sessionCookie(response: Response) {
  const raw = response.headers.get("set-cookie");
  return raw?.split(";")[0] ?? "";
}

async function login(email: string, password: string) {
  const { response, body } = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return {
    ok: response.ok,
    status: response.status,
    cookie: sessionCookie(response),
    user: body,
  };
}

function nextWeekday(day: number) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  const distance = (day - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + distance);
  return date.toISOString().slice(0, 10);
}

async function main() {
  console.log("====================================================================");
  console.log("Starting Health Management System (HMS) Full Test Suite");
  console.log(`Target API URL: ${API}`);
  console.log("====================================================================\n");

  console.log("1. AUTHENTICATION & SESSION MANAGEMENT");

  const testEmail = `test_patient_${Date.now()}@example.com`;

  await runTest("Patient registration with valid details succeeds", async () => {
    const res = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Patient",
        email: testEmail,
        password: "Patient@123",
        confirmPassword: "Patient@123",
      }),
    });
    assert(res.response.status === 201, `Expected 201, got ${res.response.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.role === "Patient", "Returned user should have role Patient");
    assert(!res.body.password && !res.body.passwordHash, "Password should not be returned in API response");
  });

  await runTest("Duplicate email registration is rejected", async () => {
    const res = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Patient Duplicate",
        email: testEmail,
        password: "Patient@123",
        confirmPassword: "Patient@123",
      }),
    });
    assert(res.response.status === 400, `Expected 400, got ${res.response.status}`);
  });

  await runTest("Mismatched password registration is rejected", async () => {
    const res = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Mismatch",
        email: `mismatch_${Date.now()}@example.com`,
        password: "Password@123",
        confirmPassword: "Password@456",
      }),
    });
    assert(res.response.status === 400, `Expected 400, got ${res.response.status}`);
  });

  await runTest("Login with invalid password is rejected", async () => {
    const res = await login(testEmail, "WrongPassword@123");
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest("Login with non-existent email is rejected generically", async () => {
    const res = await login("nonexistent_user@example.com", "SomePassword@123");
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    assert(res.user?.error === "Invalid email or password.", "Error message should not reveal email existence");
  });

  let patientCookie = "";
  await runTest("Login with valid patient credentials succeeds and sets session", async () => {
    const res = await login(testEmail, "Patient@123");
    assert(res.ok, "Login should succeed");
    assert(res.cookie.includes("hms_session"), "Session cookie should be set");
    patientCookie = res.cookie;
  });

  await runTest("/auth/me returns currently logged-in user", async () => {
    const res = await request("/auth/me", {}, patientCookie);
    assert(res.response.ok, "Expected 200 OK");
    assert(res.body.email.toLowerCase() === testEmail.toLowerCase(), "Email should match");
    assert(res.body.role === "Patient", "Role should be Patient");
  });

  console.log("\n2. ROLE-BASED ACCESS CONTROL (RBAC)");

  let doctorCookie = "";
  let adminCookie = "";

  await runTest("Demo doctor login succeeds", async () => {
    const res = await login("ananya.rao@example.com", "Doctor@123");
    assert(res.ok, "Doctor login failed");
    assert(res.user.role === "Doctor", "Role should be Doctor");
    doctorCookie = res.cookie;
  });

  await runTest("Demo admin login succeeds", async () => {
    const res = await login("admin@example.com", "Admin@123");
    assert(res.ok, "Admin login failed");
    assert(res.user.role === "Admin", "Role should be Admin");
    adminCookie = res.cookie;
  });

  await runTest("Patient is blocked from admin dashboard (403)", async () => {
    const res = await request("/admin/dashboard", {}, patientCookie);
    assert(res.response.status === 403, `Expected 403, got ${res.response.status}`);
  });

  await runTest("Patient is blocked from doctor dashboard (403)", async () => {
    const res = await request("/doctor/dashboard", {}, patientCookie);
    assert(res.response.status === 403, `Expected 403, got ${res.response.status}`);
  });

  await runTest("Doctor is blocked from admin dashboard (403)", async () => {
    const res = await request("/admin/dashboard", {}, doctorCookie);
    assert(res.response.status === 403, `Expected 403, got ${res.response.status}`);
  });

  await runTest("Doctor is blocked from patient dashboard (403)", async () => {
    const res = await request("/patient/dashboard", {}, doctorCookie);
    assert(res.response.status === 403, `Expected 403, got ${res.response.status}`);
  });

  await runTest("Unauthenticated request to dashboard is rejected (401)", async () => {
    const res = await request("/patient/dashboard", {});
    assert(res.response.status === 401, `Expected 401, got ${res.response.status}`);
  });

  console.log("\n3. APPOINTMENT SCHEDULING ENGINE & VALIDATION");

  const doctorsRes = await request("/doctors", {}, patientCookie);
  assert(doctorsRes.response.ok, "Doctor list should load for patient");
  const doctors = doctorsRes.body as Array<{ id: number; name: string; specialization: string; availableDays: string[] }>;
  assert(doctors.length >= 3, "Expected at least 3 doctors");

  const drAnanya = doctors.find((d) => d.name.includes("Ananya")) || doctors[0];
  const drRahul = doctors.find((d) => d.name.includes("Rahul")) || doctors[1];

  await runTest("Past date booking is rejected", async () => {
    const res = await request(
      "/patient/appointments",
      {
        method: "POST",
        body: JSON.stringify({ doctorId: drAnanya.id, date: "2020-01-01", time: "10:00" }),
      },
      patientCookie,
    );
    assert(res.response.status === 400, `Expected 400, got ${res.response.status}`);
  });

  await runTest("Invalid appointment time (outside 08:00-18:00 or not 30m) is rejected", async () => {
    const validDate = nextWeekday(2); // Tuesday
    const res = await request(
      "/patient/appointments",
      {
        method: "POST",
        body: JSON.stringify({ doctorId: drAnanya.id, date: validDate, time: "10:15" }),
      },
      patientCookie,
    );
    assert(res.response.status === 400, `Expected 400, got ${res.response.status}`);
  });

  await runTest("Booking on an unavailable weekday for doctor is rejected", async () => {
    // Dr. Rahul Mehta is Mon, Wed, Fri. Sunday (0) or Tuesday (2) or Thursday (4) should be rejected
    const tuesday = nextWeekday(2);
    const res = await request(
      "/patient/appointments",
      {
        method: "POST",
        body: JSON.stringify({ doctorId: drRahul.id, date: tuesday, time: "10:00" }),
      },
      patientCookie,
    );
    assert(res.response.status === 400, `Expected 400, got ${res.response.status}`);
    assert(res.body.error.includes("not available"), `Expected doctor unavailable error, got: ${res.body.error}`);
  });

  let bookedAppointmentId = 0;
  const bookingDate = nextWeekday(1); // Monday
  const bookingTime = "11:00";

  await runTest("Valid appointment booking succeeds with status 'Pending'", async () => {
    const res = await request(
      "/patient/appointments",
      {
        method: "POST",
        body: JSON.stringify({ doctorId: drAnanya.id, date: bookingDate, time: bookingTime }),
      },
      patientCookie,
    );
    assert(res.response.status === 201, `Expected 201, got ${res.response.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.status === "Pending", "Initial status must be Pending");
    bookedAppointmentId = res.body.id;
  });

  await runTest("Conflicting booking for same doctor, date, and time is rejected", async () => {
    // Another patient attempts to book the same slot
    const otherPatientRes = await login("patient@example.com", "Patient@123");
    const res = await request(
      "/patient/appointments",
      {
        method: "POST",
        body: JSON.stringify({ doctorId: drAnanya.id, date: bookingDate, time: bookingTime }),
      },
      otherPatientRes.cookie,
    );
    assert(res.response.status === 400, `Expected 400 conflict, got ${res.response.status}`);
    assert(res.body.error.includes("already booked"), "Conflict error should mention slot booked");
  });

  console.log("\n4. OBJECT-LEVEL AUTHORIZATION (IDOR CHECKS)");

  await runTest("Doctor B cannot modify appointment belonging to Doctor A", async () => {
    // drRahul logs in and attempts to update drAnanya's appointment
    const drRahulLogin = await login("rahul.mehta@example.com", "Doctor@123");
    const res = await request(
      `/doctor/appointments/${bookedAppointmentId}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "Confirmed" }),
      },
      drRahulLogin.cookie,
    );
    assert(res.response.status === 403, `Expected 403 Forbidden, got ${res.response.status}`);
  });

  await runTest("Patient B cannot cancel appointment belonging to Patient A", async () => {
    const demoPatientLogin = await login("patient@example.com", "Patient@123");
    const res = await request(
      `/patient/appointments/${bookedAppointmentId}/cancel`,
      { method: "POST" },
      demoPatientLogin.cookie,
    );
    assert(res.response.status === 404 || res.response.status === 400, `Expected 404/400, got ${res.response.status}`);
  });

  console.log("\n5. DOCTOR WORKFLOW & STATUS UPDATES");

  await runTest("Assigned doctor confirms the appointment", async () => {
    const res = await request(
      `/doctor/appointments/${bookedAppointmentId}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "Confirmed" }),
      },
      doctorCookie,
    );
    assert(res.response.ok, `Status update failed: ${JSON.stringify(res.body)}`);
    assert(res.body.status === "Confirmed", "Status should be Confirmed");
  });

  await runTest("Patient sees updated 'Confirmed' status", async () => {
    const res = await request("/patient/appointments", {}, patientCookie);
    assert(res.response.ok, "Patient appointments fetch failed");
    const item = (res.body as any[]).find((a) => a.id === bookedAppointmentId);
    assert(item && item.status === "Confirmed", "Patient must see Confirmed status");
  });

  await runTest("Assigned doctor completes the appointment", async () => {
    const res = await request(
      `/doctor/appointments/${bookedAppointmentId}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "Completed" }),
      },
      doctorCookie,
    );
    assert(res.response.ok, `Status update failed: ${JSON.stringify(res.body)}`);
    assert(res.body.status === "Completed", "Status should be Completed");
  });

  console.log("\n6. CANCELLATION & SLOT RE-AVAILABILITY");

  let appointment2Id = 0;
  const bookingTime2 = "14:00";

  await runTest("Book second appointment for cancellation test", async () => {
    const res = await request(
      "/patient/appointments",
      {
        method: "POST",
        body: JSON.stringify({ doctorId: drAnanya.id, date: bookingDate, time: bookingTime2 }),
      },
      patientCookie,
    );
    assert(res.response.status === 201, "Second booking failed");
    appointment2Id = res.body.id;
  });

  await runTest("Patient cancels eligible appointment", async () => {
    const res = await request(
      `/patient/appointments/${appointment2Id}/cancel`,
      { method: "POST" },
      patientCookie,
    );
    assert(res.response.ok, "Cancellation failed");
    assert(res.body.status === "Cancelled", "Status should be Cancelled");
  });

  await runTest("Cancelled appointment cannot be cancelled again", async () => {
    const res = await request(
      `/patient/appointments/${appointment2Id}/cancel`,
      { method: "POST" },
      patientCookie,
    );
    assert(res.response.status === 400, `Expected 400, got ${res.response.status}`);
  });

  await runTest("Cancelled slot becomes available for re-booking", async () => {
    const res = await request(
      "/patient/appointments",
      {
        method: "POST",
        body: JSON.stringify({ doctorId: drAnanya.id, date: bookingDate, time: bookingTime2 }),
      },
      patientCookie,
    );
    assert(res.response.status === 201, `Rebooking cancelled slot failed: ${JSON.stringify(res.body)}`);
  });

  console.log("\n7. ADMINISTRATOR WORKFLOWS & MANAGEMENT");

  await runTest("Admin views clinic dashboard metrics", async () => {
    const res = await request("/admin/dashboard", {}, adminCookie);
    assert(res.response.ok, "Admin dashboard failed");
    assert(typeof res.body.patients === "number", "patients metric should be number");
    assert(typeof res.body.doctors === "number", "doctors metric should be number");
    assert(typeof res.body.appointments === "number", "appointments metric should be number");
  });

  let createdDoctorId = 0;
  const newDoctorEmail = `new_doc_${Date.now()}@example.com`;

  await runTest("Admin creates a new doctor profile with linked account", async () => {
    const res = await request(
      "/admin/doctors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Dr. New Specialist",
          email: newDoctorEmail,
          password: "Doctor@123",
          specialization: "Neurology",
          availableDays: ["Monday", "Wednesday", "Friday"],
        }),
      },
      adminCookie,
    );
    assert(res.response.status === 201, `Doctor creation failed: ${JSON.stringify(res.body)}`);
    assert(res.body.specialization === "Neurology", "Specialization mismatch");
    createdDoctorId = res.body.id;
  });

  await runTest("Admin edits doctor profile details", async () => {
    const res = await request(
      `/admin/doctors/${createdDoctorId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Dr. Senior Specialist",
          specialization: "Pediatrics",
          availableDays: ["Tuesday", "Thursday"],
        }),
      },
      adminCookie,
    );
    assert(res.response.ok, "Doctor edit failed");
    assert(res.body.specialization === "Pediatrics", "Specialization not updated");
  });

  await runTest("Admin toggles doctor active status (pause)", async () => {
    const res = await request(
      `/admin/doctors/${createdDoctorId}/active`,
      {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      },
      adminCookie,
    );
    assert(res.response.ok, "Status toggle failed");
    assert(res.body.isActive === false, "Doctor should be inactive");
  });

  await runTest("Inactive doctor is hidden from patient search", async () => {
    const res = await request("/doctors?search=Specialist", {}, patientCookie);
    assert(res.response.ok, "Search failed");
    const found = (res.body as any[]).find((d) => d.id === createdDoctorId);
    assert(!found, "Inactive doctor should not appear in patient search");
  });

  await runTest("Admin reactivates doctor", async () => {
    const res = await request(
      `/admin/doctors/${createdDoctorId}/active`,
      {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      },
      adminCookie,
    );
    assert(res.response.ok, "Status toggle failed");
    assert(res.body.isActive === true, "Doctor should be active again");
  });

  await runTest("Admin searches patient directory", async () => {
    const res = await request(`/admin/patients?search=${testEmail}`, {}, adminCookie);
    assert(res.response.ok, "Patient directory fetch failed");
    assert(res.body.length >= 1, "Created test patient should be found");
  });

  await runTest("Admin filters clinic appointments", async () => {
    const res = await request("/admin/appointments?status=Confirmed", {}, adminCookie);
    assert(res.response.ok, "Appointments filter failed");
    assert(Array.isArray(res.body), "Should return array of appointments");
  });

  console.log("\n8. HEALTH CHECK & LOGOUT");

  await runTest("Root health check returns 200 and uptime", async () => {
    const res = await request("/../health");
    assert(res.response.ok, "Health check failed");
    assert(res.body.status === "ok", "Status must be 'ok'");
    assert(typeof res.body.uptime === "number", "Uptime must be a number");
  });

  await runTest("Logout successfully terminates session", async () => {
    const res = await request("/auth/logout", { method: "POST" }, patientCookie);
    assert(res.response.status === 204, "Logout should return 204");

    const meRes = await request("/auth/me", {}, patientCookie);
    assert(meRes.response.status === 401, "Session should be invalidated");
  });

  console.log("\n====================================================================");
  console.log(`Test Suite Completed: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log("====================================================================");

  if (testsFailed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exitCode = 1;
});
