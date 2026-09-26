# Health Management System (HMS)

## Purpose

HMS is an academic clinic administration and appointment management system for small clinics and hospitals. It replaces manual registers and phone-based scheduling with one place for patients, doctors, and administrators to manage appointments.

## Roles

- **Patient** — register, sign in, find active doctors, book appointments, view appointments, and cancel eligible bookings.
- **Doctor** — sign in, view assigned appointments, and update appointment status.
- **Administrator** — view clinic metrics, manage doctors, browse patients, and filter all appointments.

## Functional requirements

### Authentication and authorization

- Patient registration requires name, unique email, password, and confirmation.
- All passwords are stored as secure hashes; plaintext passwords are never returned.
- Session-based login and logout are provided for all three roles.
- Backend role checks protect every private route and record ownership is enforced server-side.

### Scheduling

- A patient chooses an active doctor, date, and time.
- The server rejects past dates, unavailable weekdays, invalid times, inactive doctors, duplicate bookings, and occupied slots.
- Cancelled appointments do not block a slot.
- New appointments start as `Pending`.
- Valid appointment statuses are `Pending`, `Confirmed`, `Completed`, and `Cancelled`.

### Patient experience

- Dashboard with upcoming count, next appointment, recent bookings, and profile identity.
- Searchable active doctor directory with specialization filtering.
- Appointment booking and patient-owned appointment list.
- Pending and confirmed future appointments can be cancelled.

### Doctor experience

- Dashboard with today's count, upcoming count, and today's schedule.
- Date-filtered schedule showing patient identity and appointment status.
- Status actions for `Confirmed`, `Completed`, and `Cancelled`.

### Administrator experience

- Metrics for patients, doctors, total appointments, and status counts.
- Doctor create, edit, activate, and deactivate operations.
- Patient search and basic information listing.
- Appointment search and filters for patient/doctor, date, doctor, and status.

## Technical approach

The workspace uses the provided TypeScript monorepo: React + Vite for the web application, Express for the API, PostgreSQL through the shared Drizzle database package, OpenAPI-generated client hooks, and secure session cookies. The API contract is maintained in `lib/api-spec/openapi.yaml`.

## Academic-project boundaries

This project does not claim HIPAA/GDPR compliance, medical certification, or production clinical safety. Future scope such as records, prescriptions, payments, reminders, and calendar integration is intentionally outside the core build.