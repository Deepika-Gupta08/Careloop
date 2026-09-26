export {};

const API = process.env.API_URL || "http://localhost:3000/api";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function request(path: string, options: RequestInit = {}, cookie = "") {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const text = await response.text();
  let body: unknown = null;
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
  assert(response.ok, `Login failed for ${email}`);
  return { cookie: sessionCookie(response), user: body as { id: number; role: string } };
}

function nextWeekday(day: number) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  const distance = (day - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + distance);
  return date.toISOString().slice(0, 10);
}

async function main() {
  const admin = await login("admin@example.com", "Admin@123");
  assert(admin.user.role === "Admin", "Admin role was not returned");

  const patient = await login("patient@example.com", "Patient@123");
  assert(patient.user.role === "Patient", "Patient role was not returned");

  const doctorsResult = await request("/doctors", {}, patient.cookie);
  assert(doctorsResult.response.ok, "Patient doctor directory failed");
  const doctors = doctorsResult.body as Array<{ id: number }>;
  assert(doctors.length >= 3, "Seed doctors are missing");

  const date = nextWeekday(2);
  const bookingPayload = { doctorId: doctors[0].id, date, time: "14:00" };
  const booking = await request(
    "/patient/appointments",
    { method: "POST", body: JSON.stringify(bookingPayload) },
    patient.cookie,
  );
  assert(booking.response.status === 201, `Booking failed: ${JSON.stringify(booking.body)}`);
  const appointment = booking.body as { id: number };

  const duplicate = await request(
    "/patient/appointments",
    { method: "POST", body: JSON.stringify(bookingPayload) },
    patient.cookie,
  );
  assert(duplicate.response.status === 400, "Duplicate booking was not rejected");

  const forbidden = await request("/admin/dashboard", {}, patient.cookie);
  assert(forbidden.response.status === 403, "Patient reached an admin route");

  const doctor = await login("ananya.rao@example.com", "Doctor@123");
  const doctorAppointments = await request("/doctor/appointments", {}, doctor.cookie);
  assert(doctorAppointments.response.ok, "Doctor schedule failed");
  const statusUpdate = await request(
    `/doctor/appointments/${appointment.id}/status`,
    { method: "PATCH", body: JSON.stringify({ status: "Confirmed" }) },
    doctor.cookie,
  );
  assert(statusUpdate.response.ok, "Doctor status update failed");

  const refreshed = await request("/patient/appointments", {}, patient.cookie);
  const visible = (refreshed.body as Array<{ id: number; status: string }>).find(
    (item) => item.id === appointment.id,
  );
  assert(visible?.status === "Confirmed", "Patient did not see updated status");

  const cancelled = await request(
    `/patient/appointments/${appointment.id}/cancel`,
    { method: "POST" },
    patient.cookie,
  );
  assert(cancelled.response.ok, "Patient cancellation failed");

  const logout = await request("/auth/logout", { method: "POST" }, patient.cookie);
  assert(logout.response.status === 204, "Logout failed");
  const afterLogout = await request("/patient/dashboard", {}, patient.cookie);
  assert(afterLogout.response.status === 401, "Logout did not protect the dashboard");

  const adminDashboard = await request("/admin/dashboard", {}, admin.cookie);
  assert(adminDashboard.response.ok, "Admin dashboard failed");

  console.log("HMS smoke checks passed: auth, RBAC, booking conflict, status update, cancellation, logout.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});