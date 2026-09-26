import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  CreateAppointmentBody,
  CreateDoctorBody,
  LoginBody,
  RegisterPatientBody,
  UpdateDoctorBody,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";

type Role = "Admin" | "Doctor" | "Patient";
type UserRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
  specialization: string | null;
  isActive: boolean;
};
type SessionRequest = Request & { hmsUser?: UserRow };

const sessions = new Map<string, number>();
const allowedStatuses = new Set(["Pending", "Confirmed", "Completed", "Cancelled"]);
const editableDoctorStatuses = new Set(["Confirmed", "Completed", "Cancelled"]);

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(actual, expectedBuffer);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function dateFromString(date: string) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDayName(date: Date) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
}

function normalizeAvailableDays(days: string[]) {
  const aliases: Record<string, string> = {
    sunday: "Sun",
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
  };
  return days
    .map((day) => aliases[day.trim().toLowerCase()] ?? day.trim().slice(0, 3))
    .filter((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].includes(day));
}

function sessionUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    specialization: row.specialization,
  };
}

async function loadUser(id: number): Promise<UserRow | null> {
  const result = await pool.query<{
    id: number;
    name: string;
    email: string;
    role: Role;
    specialization: string | null;
    is_active: boolean;
  }>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active,
            d.specialization
       FROM hms_users u
       LEFT JOIN hms_doctors d ON d.user_id = u.id
      WHERE u.id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        specialization: row.specialization,
        isActive: row.is_active,
      }
    : null;
}

async function loadDoctorByUserId(userId: number) {
  const result = await pool.query<{
    id: number;
    user_id: number;
    name: string;
    email: string;
    specialization: string;
    available_days: string;
    is_active: boolean;
  }>(
    `SELECT d.id, d.user_id, u.name, u.email, d.specialization,
            d.available_days, u.is_active
       FROM hms_doctors d
       JOIN hms_users u ON u.id = d.user_id
      WHERE d.user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        email: row.email,
        specialization: row.specialization,
        availableDays: row.available_days.split(",").filter(Boolean),
        isActive: row.is_active,
      }
    : null;
}

function appointmentSelect() {
  return `SELECT a.id, a.patient_id, pu.name AS patient_name, pu.email AS patient_email,
                 a.doctor_id, du.name AS doctor_name, d.specialization,
                 a.appointment_date, a.appointment_time, a.status
            FROM hms_appointments a
            JOIN hms_users pu ON pu.id = a.patient_id
            JOIN hms_doctors d ON d.id = a.doctor_id
            JOIN hms_users du ON du.id = d.user_id`;
}

function appointmentRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    patientId: Number(row.patient_id),
    patientName: String(row.patient_name),
    patientEmail: String(row.patient_email),
    doctorId: Number(row.doctor_id),
    doctorName: String(row.doctor_name),
    specialization: String(row.specialization),
    date: String(row.appointment_date),
    time: String(row.appointment_time),
    status: String(row.status),
  };
}

async function getAppointment(id: number) {
  const result = await pool.query(appointmentSelect() + " WHERE a.id = $1", [id]);
  return result.rows[0] ? appointmentRow(result.rows[0]) : null;
}

function setSession(res: Response, userId: number) {
  const token = randomUUID();
  sessions.set(token, userId);
  res.cookie("hms_session", token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12,
  });
}

function clearSession(req: Request, res: Response) {
  const token = req.cookies?.hms_session as string | undefined;
  if (token) sessions.delete(token);
  res.clearCookie("hms_session", { path: "/" });
}

async function requireAuth(req: SessionRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.hms_session as string | undefined;
  const userId = token ? sessions.get(token) : undefined;
  const user = userId ? await loadUser(userId) : null;
  if (!user || !user.isActive) {
    clearSession(req, res);
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }
  req.hmsUser = user;
  next();
}

function requireRole(...roles: Role[]) {
  return (req: SessionRequest, res: Response, next: NextFunction) => {
    if (!req.hmsUser || !roles.includes(req.hmsUser.role)) {
      res.status(403).json({ error: "You do not have permission to access this area." });
      return;
    }
    next();
  };
}

function queryString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const router = Router();

router.get("/auth/me", requireAuth, (req: SessionRequest, res) => {
  res.json(sessionUser(req.hmsUser!));
});

router.post("/auth/register", async (req, res) => {
  const parsed = RegisterPatientBody.safeParse(req.body);
  if (!parsed.success || parsed.data.password !== parsed.data.confirmPassword) {
    res.status(400).json({ error: "Enter a valid name, email, and matching password." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const existing = await pool.query("SELECT id FROM hms_users WHERE lower(email) = $1", [email]);
  if (existing.rowCount) {
    res.status(400).json({ error: "Unable to create this account. Please try another email." });
    return;
  }
  const result = await pool.query<{ id: number }>(
    `INSERT INTO hms_users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'Patient') RETURNING id`,
    [parsed.data.name.trim(), email, hashPassword(parsed.data.password)],
  );
  const user = await loadUser(result.rows[0].id);
  setSession(res, result.rows[0].id);
  res.status(201).json(sessionUser(user!));
});

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  const result = await pool.query<{
    id: number;
    password_hash: string;
    is_active: boolean;
  }>(
    "SELECT id, password_hash, is_active FROM hms_users WHERE lower(email) = $1",
    [parsed.data.email.trim().toLowerCase()],
  );
  const row = result.rows[0];
  if (!row || !row.is_active || !verifyPassword(parsed.data.password, row.password_hash)) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  const user = await loadUser(row.id);
  setSession(res, row.id);
  res.json(sessionUser(user!));
});

router.post("/auth/logout", (req, res) => {
  clearSession(req, res);
  res.status(204).send();
});

router.get("/patient/dashboard", requireAuth, requireRole("Patient"), async (req: SessionRequest, res) => {
  const user = req.hmsUser!;
  const result = await pool.query(
    appointmentSelect() +
      " WHERE a.patient_id = $1 ORDER BY a.appointment_date ASC, a.appointment_time ASC",
    [user.id],
  );
  const appointments = result.rows.map(appointmentRow);
  const upcoming = appointments.filter(
    (appointment) =>
      appointment.date >= todayString() &&
      appointment.status !== "Cancelled" &&
      appointment.status !== "Completed",
  );
  res.json({
    user: sessionUser(user),
    upcomingCount: upcoming.length,
    nextAppointment: upcoming[0] ?? null,
    recentAppointments: appointments.slice(0, 5),
  });
});

router.get("/doctors", requireAuth, requireRole("Patient"), async (req, res) => {
  const search = queryString(req.query.search);
  const specialization = queryString(req.query.specialization);
  const params: string[] = [];
  const where = ["u.role = 'Doctor'", "u.is_active = true"];
  if (search) {
    params.push(`%${search}%`);
    where.push(`u.name ILIKE $${params.length}`);
  }
  if (specialization && specialization !== "all") {
    params.push(specialization);
    where.push(`d.specialization = $${params.length}`);
  }
  const result = await pool.query(
    `SELECT d.id, d.user_id, u.name, u.email, d.specialization,
            d.available_days, u.is_active
       FROM hms_doctors d JOIN hms_users u ON u.id = d.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY u.name`,
    params,
  );
  res.json(
    result.rows.map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      name: String(row.name),
      email: String(row.email),
      specialization: String(row.specialization),
      availableDays: String(row.available_days).split(",").filter(Boolean),
      isActive: Boolean(row.is_active),
    })),
  );
});

router.get("/patient/appointments", requireAuth, requireRole("Patient"), async (req: SessionRequest, res) => {
  const result = await pool.query(
    appointmentSelect() +
      " WHERE a.patient_id = $1 ORDER BY a.appointment_date ASC, a.appointment_time ASC",
    [req.hmsUser!.id],
  );
  res.json(result.rows.map(appointmentRow));
});

router.post("/patient/appointments", requireAuth, requireRole("Patient"), async (req: SessionRequest, res) => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a doctor, date, and valid time." });
    return;
  }
  const date = parsed.data.date;
  const appointmentDate = date.toISOString().slice(0, 10);
  if (!date || appointmentDate < todayString()) {
    res.status(400).json({ error: "Appointments cannot be booked in the past." });
    return;
  }
  const doctorResult = await pool.query<{
    id: number;
    specialization: string;
    available_days: string;
    is_active: boolean;
    user_id: number;
  }>(
    `SELECT d.id, d.specialization, d.available_days, u.is_active, d.user_id
       FROM hms_doctors d JOIN hms_users u ON u.id = d.user_id
      WHERE d.id = $1 AND u.role = 'Doctor'`,
    [parsed.data.doctorId],
  );
  const doctor = doctorResult.rows[0];
  if (!doctor || !doctor.is_active) {
    res.status(400).json({ error: "This doctor is not currently accepting appointments." });
    return;
  }
  if (!doctor.available_days.split(",").includes(getDayName(date))) {
    res.status(400).json({ error: "The selected doctor is not available on that day." });
    return;
  }
  const time = parsed.data.time;
  if (time < "08:00" || time > "18:00" || Number(time.slice(3)) % 30 !== 0) {
    res.status(400).json({ error: "Choose a time between 08:00 and 18:00 in 30-minute intervals." });
    return;
  }
  const conflict = await pool.query(
    `SELECT id FROM hms_appointments
      WHERE doctor_id = $1 AND appointment_date = $2
        AND appointment_time = $3 AND status <> 'Cancelled'`,
    [doctor.id, appointmentDate, time],
  );
  if (conflict.rowCount) {
    res.status(400).json({ error: "This time slot is already booked. Please choose another time." });
    return;
  }
  const duplicate = await pool.query(
    `SELECT id FROM hms_appointments
      WHERE patient_id = $1 AND doctor_id = $2 AND appointment_date = $3
        AND appointment_time = $4 AND status <> 'Cancelled'`,
    [req.hmsUser!.id, doctor.id, appointmentDate, time],
  );
  if (duplicate.rowCount) {
    res.status(400).json({ error: "You already have an appointment at this time." });
    return;
  }
  const created = await pool.query<{ id: number }>(
    `INSERT INTO hms_appointments
      (patient_id, doctor_id, appointment_date, appointment_time, status)
     VALUES ($1, $2, $3, $4, 'Pending') RETURNING id`,
    [req.hmsUser!.id, doctor.id, appointmentDate, time],
  );
  res.status(201).json(await getAppointment(created.rows[0].id));
});

router.post("/patient/appointments/:id/cancel", requireAuth, requireRole("Patient"), async (req: SessionRequest, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Appointment not found." });
    return;
  }
  const existing = await pool.query<{
    status: string;
    appointment_date: string;
    appointment_time: string;
  }>(
    `SELECT status, appointment_date, appointment_time FROM hms_appointments
      WHERE id = $1 AND patient_id = $2`,
    [id, req.hmsUser!.id],
  );
  const appointment = existing.rows[0];
  if (!appointment) {
    res.status(404).json({ error: "Appointment not found." });
    return;
  }
  const appointmentDateTime = new Date(`${appointment.appointment_date}T${appointment.appointment_time}:00`);
  if (
    !["Pending", "Confirmed"].includes(appointment.status) ||
    Number.isNaN(appointmentDateTime.getTime()) ||
    appointmentDateTime.getTime() <= Date.now()
  ) {
    res.status(400).json({ error: "This appointment can no longer be cancelled." });
    return;
  }
  await pool.query(
    "UPDATE hms_appointments SET status = 'Cancelled', updated_at = NOW() WHERE id = $1",
    [id],
  );
  res.json(await getAppointment(id));
});

router.get("/doctor/dashboard", requireAuth, requireRole("Doctor"), async (req: SessionRequest, res) => {
  const doctor = await loadDoctorByUserId(req.hmsUser!.id);
  if (!doctor) {
    res.status(404).json({ error: "Doctor profile not found." });
    return;
  }
  const result = await pool.query(
    appointmentSelect() +
      " WHERE a.doctor_id = $1 AND a.status <> 'Cancelled' ORDER BY a.appointment_date ASC, a.appointment_time ASC",
    [doctor.id],
  );
  const appointments = result.rows.map(appointmentRow);
  const today = todayString();
  res.json({
    doctor,
    todayCount: appointments.filter((appointment) => appointment.date === today).length,
    upcomingCount: appointments.filter((appointment) => appointment.date >= today).length,
    todayAppointments: appointments.filter((appointment) => appointment.date === today),
  });
});

router.get("/doctor/appointments", requireAuth, requireRole("Doctor"), async (req: SessionRequest, res) => {
  const doctor = await loadDoctorByUserId(req.hmsUser!.id);
  if (!doctor) {
    res.status(404).json({ error: "Doctor profile not found." });
    return;
  }
  const date = queryString(req.query.date);
  const params: (number | string)[] = [doctor.id];
  const where = ["a.doctor_id = $1"];
  if (date) {
    params.push(date);
    where.push(`a.appointment_date = $${params.length}`);
  }
  const result = await pool.query(
    appointmentSelect() +
      ` WHERE ${where.join(" AND ")} ORDER BY a.appointment_date ASC, a.appointment_time ASC`,
    params,
  );
  res.json(result.rows.map(appointmentRow));
});

router.patch("/doctor/appointments/:id/status", requireAuth, requireRole("Doctor"), async (req: SessionRequest, res) => {
  const id = parseId(req.params.id);
  const status = typeof req.body?.status === "string" ? req.body.status : "";
  if (!id || !editableDoctorStatuses.has(status)) {
    res.status(400).json({ error: "Choose a valid appointment status." });
    return;
  }
  const doctor = await loadDoctorByUserId(req.hmsUser!.id);
  const result = await pool.query(
    `UPDATE hms_appointments a SET status = $1, updated_at = NOW()
      FROM hms_doctors d
     WHERE a.id = $2 AND a.doctor_id = d.id AND d.user_id = $3
     RETURNING a.id`,
    [status, id, req.hmsUser!.id],
  );
  if (!doctor || !result.rowCount) {
    res.status(403).json({ error: "You cannot modify this appointment." });
    return;
  }
  res.json(await getAppointment(id));
});

router.get("/admin/dashboard", requireAuth, requireRole("Admin"), async (_req, res) => {
  const result = await pool.query<{
    patients: string;
    doctors: string;
    appointments: string;
    pending: string;
    confirmed: string;
    completed: string;
    cancelled: string;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM hms_users WHERE role = 'Patient' AND is_active = true) AS patients,
      (SELECT COUNT(*) FROM hms_users WHERE role = 'Doctor' AND is_active = true) AS doctors,
      COUNT(*) AS appointments,
      COUNT(*) FILTER (WHERE status = 'Pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'Confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE status = 'Completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'Cancelled') AS cancelled
    FROM hms_appointments
  `);
  const row = result.rows[0];
  res.json(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])));
});

router.get("/admin/doctors", requireAuth, requireRole("Admin"), async (_req, res) => {
  const result = await pool.query(
    `SELECT d.id, d.user_id, u.name, u.email, d.specialization,
            d.available_days, u.is_active
       FROM hms_doctors d JOIN hms_users u ON u.id = d.user_id
      ORDER BY u.name`,
  );
  res.json(
    result.rows.map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      name: String(row.name),
      email: String(row.email),
      specialization: String(row.specialization),
      availableDays: String(row.available_days).split(",").filter(Boolean),
      isActive: Boolean(row.is_active),
    })),
  );
});

router.post("/admin/doctors", requireAuth, requireRole("Admin"), async (req, res) => {
  const parsed = CreateDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter complete doctor account details." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const existing = await pool.query("SELECT id FROM hms_users WHERE lower(email) = $1", [email]);
  if (existing.rowCount) {
    res.status(400).json({ error: "A user with this email already exists." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query<{ id: number }>(
      `INSERT INTO hms_users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'Doctor') RETURNING id`,
      [parsed.data.name.trim(), email, hashPassword(parsed.data.password)],
    );
    await client.query(
      `INSERT INTO hms_doctors (user_id, specialization, available_days)
       VALUES ($1, $2, $3)`,
      [
        user.rows[0].id,
        parsed.data.specialization.trim(),
        normalizeAvailableDays(parsed.data.availableDays).join(","),
      ],
    );
    await client.query("COMMIT");
    res.status(201).json(await doctorForResponse(user.rows[0].id));
  } catch {
    await client.query("ROLLBACK");
    res.status(400).json({ error: "Unable to create the doctor account." });
  } finally {
    client.release();
  }
});

async function doctorForResponse(userId: number) {
  return loadDoctorByUserId(userId);
}

router.patch("/admin/doctors/:id", requireAuth, requireRole("Admin"), async (req, res) => {
  const id = parseId(req.params.id);
  const parsed = UpdateDoctorBody.safeParse(req.body);
  if (!id || !parsed.success) {
    res.status(400).json({ error: "Enter complete doctor details." });
    return;
  }
  const result = await pool.query<{ user_id: number }>(
    "SELECT user_id FROM hms_doctors WHERE id = $1",
    [id],
  );
  const doctor = result.rows[0];
  if (!doctor) {
    res.status(404).json({ error: "Doctor not found." });
    return;
  }
  await pool.query(
    "UPDATE hms_users SET name = $1 WHERE id = $2",
    [parsed.data.name.trim(), doctor.user_id],
  );
  await pool.query(
    `UPDATE hms_doctors SET specialization = $1, available_days = $2
      WHERE id = $3`,
    [
      parsed.data.specialization.trim(),
      normalizeAvailableDays(parsed.data.availableDays).join(","),
      id,
    ],
  );
  res.json(await doctorForResponse(doctor.user_id));
});

router.patch("/admin/doctors/:id/active", requireAuth, requireRole("Admin"), async (req, res) => {
  const id = parseId(req.params.id);
  const isActive = typeof req.body?.isActive === "boolean" ? req.body.isActive : null;
  if (!id || isActive === null) {
    res.status(400).json({ error: "Choose an active state." });
    return;
  }
  const result = await pool.query<{ user_id: number }>(
    "SELECT user_id FROM hms_doctors WHERE id = $1",
    [id],
  );
  const doctor = result.rows[0];
  if (!doctor) {
    res.status(404).json({ error: "Doctor not found." });
    return;
  }
  await pool.query("UPDATE hms_users SET is_active = $1 WHERE id = $2", [
    isActive,
    doctor.user_id,
  ]);
  res.json(await doctorForResponse(doctor.user_id));
});

router.get("/admin/patients", requireAuth, requireRole("Admin"), async (req, res) => {
  const search = queryString(req.query.search);
  const params: string[] = [];
  const where = ["role = 'Patient'"];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  const result = await pool.query(
    `SELECT id, name, email, created_at, is_active
       FROM hms_users WHERE ${where.join(" AND ")} ORDER BY created_at DESC`,
    params,
  );
  res.json(
    result.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      email: String(row.email),
      createdAt: new Date(String(row.created_at)).toISOString(),
      isActive: Boolean(row.is_active),
    })),
  );
});

router.get("/admin/appointments", requireAuth, requireRole("Admin"), async (req, res) => {
  const params: (string | number)[] = [];
  const where: string[] = [];
  const search = queryString(req.query.search);
  const date = queryString(req.query.date);
  const status = queryString(req.query.status);
  const doctorId = parseId(req.query.doctorId);
  if (search) {
    params.push(`%${search}%`);
    where.push(`(pu.name ILIKE $${params.length} OR du.name ILIKE $${params.length})`);
  }
  if (date) {
    params.push(date);
    where.push(`a.appointment_date = $${params.length}`);
  }
  if (status && allowedStatuses.has(status)) {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  }
  if (doctorId) {
    params.push(doctorId);
    where.push(`a.doctor_id = $${params.length}`);
  }
  const result = await pool.query(
    appointmentSelect() +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY a.appointment_date ASC, a.appointment_time ASC",
    params,
  );
  res.json(result.rows.map(appointmentRow));
});

export async function ensureDemoData() {
  const demoUsers = [
    {
      name: "System Admin",
      email: "admin@example.com",
      password: "Admin@123",
      role: "Admin",
    },
    {
      name: "Demo Patient",
      email: "patient@example.com",
      password: "Patient@123",
      role: "Patient",
    },
  ];
  for (const demo of demoUsers) {
    await pool.query(
      `INSERT INTO hms_users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [demo.name, demo.email, hashPassword(demo.password), demo.role],
    );
  }
  const doctors = [
    ["Dr. Ananya Rao", "ananya.rao@example.com", "Cardiology", "Mon,Tue,Wed,Thu,Fri"],
    ["Dr. Rahul Mehta", "rahul.mehta@example.com", "Dermatology", "Mon,Wed,Fri"],
    ["Dr. Priya Shah", "priya.shah@example.com", "General Medicine", "Tue,Thu,Sat"],
  ];
  for (const [name, email, specialization, availableDays] of doctors) {
    const user = await pool.query<{ id: number }>(
      `INSERT INTO hms_users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'Doctor')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name, email, hashPassword("Doctor@123")],
    );
    await pool.query(
      `INSERT INTO hms_doctors (user_id, specialization, available_days)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [user.rows[0].id, specialization, availableDays],
    );
  }
}

export default router;