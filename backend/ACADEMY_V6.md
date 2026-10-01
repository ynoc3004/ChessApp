# Academy v6 — Teacher Portal

Academy v6 separates teacher access from both Admin RBAC and student sessions.

## Authentication

Teacher profiles remain in `academy_teachers`. Login credentials are stored separately:

- `academy_teacher_accounts`
- `academy_teacher_sessions`

Passwords use the same PBKDF2-SHA256 helper as student Academy accounts. Raw session tokens are never stored; only SHA-256 token hashes are persisted.

Default teacher session lifetime is 168 hours and can be changed with:

```text
CHESSAPP_TEACHER_SESSION_HOURS
```

Changing username/password, disabling an account, or disabling the teacher invalidates/blocks existing access.

## Authorization boundary

Teacher APIs never trust a client-supplied teacher ID. The teacher identity always comes from the authenticated teacher session.

A teacher may:

- view only active classes assigned to them;
- view only active students enrolled in those classes;
- inspect those students' training + Practical Profile;
- create assignments only for their own class/student scope;
- update only assignments they created;
- see Academy-wide tournaments plus tournaments for their own classes.

Teachers do not receive Admin permissions.

## Admin account provisioning

Admin routes:

- `GET /api/admin/academy/teacher-accounts`
- `POST /api/admin/academy/teacher-accounts`
- `PATCH /api/admin/academy/teacher-accounts/{teacherId}`

UI:

```text
/admin/academy/teacher-accounts
```

## Teacher API

Authentication:

- `POST /api/teacher/auth/login`
- `POST /api/teacher/auth/logout`
- `GET /api/teacher/me`

Portal:

- `GET /api/teacher/dashboard`
- `GET /api/teacher/assignments`
- `POST /api/teacher/assignments`
- `PATCH /api/teacher/assignments/{assignmentId}`
- `GET /api/teacher/students/{studentId}`
- `GET /api/teacher/tournaments`

UI:

```text
/teacher
/teacher/students/{studentId}
```

## AI teacher bridge

`academy_teachers.ai_profile_id` is returned in the authenticated Teacher Portal identity and dashboard. Academy v6 does not implement chatbot inference. The field is intentionally preserved as the integration point for the teacher-specific AI supplied later.

## Tests

`tests/test_academy_teacher_portal.py` covers:

- teacher account login/session;
- teacher/student ownership scope;
- assignment target isolation between teachers;
- Teacher Portal route registration.
