# Assembly Room Scheduler

A SQLite-backed room reservation system for the Company Room Reservation System brief.

## Included in this MVP

- Dashboard with today's reservations, live room occupancy, and approval counts
- Room management with room cards, approval rules, capacity, status, and equipment
- Reservation creation with whole-day, onwards, blocked, and time-range bookings
- Overlap and capacity conflict prevention
- Approval queue with approve-all, approve, reject, and reason capture
- User request page with advance booking and available-time lookup
- Admin assign/unassign controls, meeting deletion, and automatic end-date unassignment
- Daily room report preview filtered by date and room
- Today's schedule table with copy-to-clipboard action
- Weekly, monthly, and yearly CSV report exports
- Report email preview placeholder and `.txt` export
- Reservation list `.csv` export
- Login page with a seeded administrator account
- Admin account management with add and delete controls
- Calendar page with add-schedule entry points
- SQLite-only persistence through the local Python server
- Responsive mobile layout

## Run it

This version requires the SQLite server. Do not open `index.html` directly or use the GitHub repository page because those do not provide the `/api` endpoints used by login and data storage.

From this folder, run:

```powershell
python server.py
```

Then open [http://127.0.0.1:4173/](http://127.0.0.1:4173/) in your browser.

The SQLite database is created automatically at `data/assembly.db`.

Demo administrator:

- Email: `admin@assembly.local`
- Password: `admin123`

## Next production steps

The current server uses only Python's standard library and SQLite. Connect SMTP or Microsoft Graph, add PDF/Excel generation, and add production backup controls when the workflow is accepted by the team.

The current sample room names are placeholders. Replace them with the official meeting room names once they are provided.
