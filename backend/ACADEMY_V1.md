# ChessApp Academy v1

Academy v1 introduces a student-facing account system that is deliberately separate from Admin RBAC.

## Student lifecycle

1. Admin creates a teacher profile.
2. Admin creates one or more classes with a Step range and teacher.
3. Admin creates a student account. The student may be assigned immediately or left unassigned.
4. Student signs in at `/academy`.
5. If placement is pending, the student takes the configured Step by Step placement bank.
6. The engine stores overall score, score by Step and score by skill.
7. The highest consecutive Step scoring at least 70% becomes the initial recommendation.
8. If the student has no class, Academy automatically assigns the least-populated active class whose Step range contains the recommendation.
9. Dashboard shows Step, class, teacher and the future AI-teacher profile ID.

## Important: no fabricated Step by Step content

The repository does **not** seed proprietary or invented Step by Step questions. Admins enter the real question bank they are authorized to use through `/admin/academy`.

Each placement question currently stores:

- Step number
- skill name
- prompt
- 2–8 answer choices
- correct answer index
- explanation
- active/inactive status

A later assessment iteration can add FEN/image board prompts without changing student/class/enrollment identity.

## Data

`backend/data/academy.sqlite3`

Tables:

- `academy_teachers`
- `academy_classes`
- `academy_students`
- `academy_student_sessions`
- `academy_enrollments`
- `academy_placement_questions`
- `academy_placement_attempts`

The existing Backup system includes this SQLite database automatically because it snapshots all `.sqlite3` files in `backend/data/`.

## Authentication

Student bearer sessions are separate from Admin sessions and cannot be used against `/api/admin/*`.

Password storage: PBKDF2-SHA256 with per-account random salt. Student session tokens are stored only as SHA-256 hashes in SQLite.

Environment option:

```env
CHESSAPP_STUDENT_SESSION_HOURS=168
```

Default: 168 hours (7 days), capped at 720 hours.

## APIs

Student:

- `POST /api/academy/auth/login`
- `POST /api/academy/auth/logout`
- `GET /api/academy/me`
- `GET /api/academy/dashboard`
- `POST /api/academy/placement/start`
- `POST /api/academy/placement/submit`

Admin:

- `GET /api/admin/academy/overview`
- `GET|POST /api/admin/academy/teachers`
- `PATCH /api/admin/academy/teachers/{teacher_id}`
- `GET|POST /api/admin/academy/classes`
- `PATCH /api/admin/academy/classes/{class_id}`
- `GET|POST /api/admin/academy/students`
- `PATCH /api/admin/academy/students/{student_id}`
- `POST /api/admin/academy/students/{student_id}/assign`
- `GET|POST /api/admin/academy/placement/questions`
- `PATCH /api/admin/academy/placement/questions/{question_id}`

## Next Academy milestones

Academy v2 should connect the student's Step + skill scores to Bí Cảnh so puzzle selection, XP, mastery and spaced repetition are personalized. Teacher authentication/dashboard and the teacher-specific AI bot can follow once the external AI profile is ready.
