# Assembly Room Scheduler

A browser-ready MVP for the Company Room Reservation System brief.

## Included in this MVP

- Dashboard with today’s reservations, live room occupancy, and approval counts
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
- In-app to-do list for the remaining production work
- Settings for report defaults and notification toggles
- Local browser persistence through `localStorage`

## Run it

Open `index.html` in a browser, or serve this folder with any static file server. The sample workspace is preloaded from the report in the project brief. Data is stored locally in the browser; use the browser’s site data controls to reset it.

## Next production steps

Replace the local storage adapter with PostgreSQL/Drizzle, add session authentication, connect SMTP or Microsoft Graph, and add PDF/Excel generation when the workflow is accepted by the team.

The current sample room names are placeholders. Replace them with the official meeting room names once they are provided.
