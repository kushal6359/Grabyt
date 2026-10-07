Grab frontend
==============
Static single-page frontend for the Grab backend.

Backend:
https://grabyt-p39v.onrender.com

Files:
- index.html — complete frontend; CSS and JavaScript are included.

The page uses:
POST /api/info
POST /api/download
GET  /api/download/:id
POST /api/download/:id/cancel
GET  /api/download/:id/file
GET  /api/health

To put it in the repository:
1. Copy index.html into a frontend/ directory.
2. Commit and push to main.
3. If serving it as a static site, publish the frontend/ directory.

Note: the current Render backend can temporarily receive YouTube 403/429 responses. The UI shows a friendly message instead of exposing raw server errors.
