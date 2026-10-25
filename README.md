# Assembly Room Scheduler

A SQLite-backed room reservation system for the Company Room Reservation System brief.

## Included in this MVP

- Dashboard with today's reservations, live room occupancy, and approval counts
- Room management with room cards, approval rules, capacity, status, and equipment
- Reservation creation with whole-day, onwards, blocked, and time-range bookings
- Overlap and capacity conflict prevention
- Live schedule updates across admin sessions and the public calendar every 3 seconds
- Concurrent-save revision checks to prevent stale sessions from silently overwriting bookings
- Approval queue with approve-all, approve, reject, and reason capture
- User request page with advance booking and available-time lookup
- Admin assign/unassign controls, meeting deletion, and automatic end-date unassignment
- Daily room report preview filtered by date and room
- Today's schedule table with copy-to-clipboard action
- Weekly, monthly, and yearly CSV report exports
- Report email preview placeholder and `.txt` export
- Reservation list `.csv` export
- Staff login with Super Admin and Admin access
- Admin account management and personal password changes
- Super Admin database viewer and editor; Admins can view database records only
- Public room calendar showing only department and occupied times
- Public room request form with approval workflow and a 30-minute urgent booking limit
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

Initial Super Admin:

- Email: `superadmin@stratastaff.com`
- Use the password supplied by the system owner, then change it from **Settings → Account security**.

## Public booking page

Open `/public.html`. Visitors can review confirmed bookings by department and time, then submit room requests for staff approval. Public calendar responses omit requester names, event titles, notes, and attendee details. Urgent bookings are limited to 30 minutes.

## Access roles

- **Super Admin:** Full access, including database record editing and account creation.
- **Admin:** Full workspace access, including account creation. The database page is read-only.
- Each account can change its own password from **Settings → Account security**.

## Deployment notes

The Vercel preview is a static UI preview. Its demo data and demo accounts are stored in the current browser only; separate visitors do not share changes. Shared logins, public requests, and SQLite data require the Python server and a persistent database.

The current server uses Python `http.server`, while cPanel Python Application Manager commonly expects a WSGI entry point. Confirm the hosting plan and Python app interface before uploading; the server entry point may need an adapter. The `data` directory must be writable and backed up. Uploading only HTML, CSS, and JavaScript will not provide login, shared reservations, or public request processing.

The current sample room names are placeholders. Replace them with the official meeting room names once they are provided.
