# Offline Study Planner — Full Stack College Project

**Frontend:** HTML, CSS, JavaScript  
**Backend:** Node.js + Express REST API  
**Database:** SQLite (`better-sqlite3`)

## Run on Windows
1. Install Node.js LTS from https://nodejs.org if needed.
2. Open the extracted `OfflineStudyPlanner_FullStack` folder in File Explorer. Use this folder, not its `OfflineStudyPlanner` subfolder.
3. Click the address bar, type `powershell`, and press Enter.
4. Install the dependencies once (internet is needed to download them):
   ```powershell
   npm.cmd install
   ```
5. Start the server:
   ```powershell
   npm.cmd start
   ```
6. Open http://localhost:3000 in Chrome or Edge.
Keep the PowerShell window open while using the app. Press Ctrl+C to stop it. Use `npm.cmd` in PowerShell to avoid changing Windows execution-policy settings.

## Features
- Add, edit, delete, complete, and filter study tasks by subject or status
- Organize by subject and topic; set priority, due date/time, and daily/weekly/monthly repeat
- Schedule exams and view tasks and exams together in a month calendar
- Use a pauseable focus timer; completed sessions are saved with all-time and daily study-time totals
- Set weekly study-hour goals and view seven-day study charts and streaks
- Organize student-created study materials, flashcards, revision flags, and MCQ question banks by subject and chapter
- Review flashcards with previous/next, shuffle, known/needs-practice actions, and locally saved review counts
- Take one-question-at-a-time quizzes; answers and position autosave locally, and completed attempts include per-question feedback
- Track Quiz/Practice Accuracy from actual submitted answers, including correct/incorrect counts, subject/topic breakdowns, recent quiz trends, strong topics, and repeated misses
- Get deterministic offline study recommendations based on saved incomplete topics, revision flags, exam dates, and daily availability
- Use the Offline AI Study Monitor for local activity analysis, prioritized study recommendations, persisted feedback, and a daily report; no cloud AI or external service is used
- View actual remaining/revision topics, the nearest saved exam, study time, quiz performance, and syllabus completion on the dashboard
- Save notes and all planner data in a local SQLite database
- Export/import a full JSON backup of tasks, exams, sessions, subjects, notes, and goals
- Install the planner as a progressive web app; the app shell is cached for offline use
- Optional browser notifications 15 minutes before a task or exam while the planner is open and notification permission is granted

## API endpoints
`/api/health`, task CRUD at `/api/tasks`, notes at `/api/notes`, subject management at `/api/subjects`, exam CRUD at `/api/exams`, study-session history at `/api/sessions`, weekly goals at `/api/settings`, study summaries at `/api/reports`, materials at `/api/materials`, flashcards at `/api/flashcards`, revision checklist at `/api/revision-checklist`, question bank at `/api/questions`, quiz questions, saved progress, and attempts under `/api/quizzes`, answer-level accuracy at `/api/quiz-accuracy`, and the local monitor at `/api/ai-monitor/summary`, `/api/ai-monitor/recommendations`, `/api/ai-monitor/daily-report`, and `/api/ai-monitor/feedback`.

## Offline behavior
After dependencies are installed, the app and SQLite database work without internet as long as the local Node server is running. Study materials, flashcard review state, active quiz answers, completed quiz attempts and answer-level accuracy, focus sessions, monitor feedback, revision-flag changes, and planner data stay in the local SQLite database. Quiz/Practice Accuracy uses only per-question answers recorded when quizzes are submitted; pre-existing score-only quiz attempts are retained but excluded because their individual answers cannot be recovered. Accuracy is a measure of saved practice performance, not complete knowledge or intelligence. Today's and all-time study totals are calculated from recorded sessions. The Offline AI Study Monitor uses deterministic local rules over saved study activity; it is not a cloud LLM or online AI service. Revision history records changes from the time this update is installed; existing revision flags remain intact and are analyzed as current state. Inactivity reminders use a three-day gap, and exam-risk checks look 14 days ahead when subject syllabus progress is below 60%. Browser reminders only work while the planner is open. Data is stored in `studyplanner.db` in this folder. Keep JSON backups.

## Publish for mobile access and search
The `render.yaml` blueprint deploys this project on Render, stores SQLite data on a persistent disk, and serves the app over a public HTTPS URL. To publish it, push the project to a GitHub repository, create a Render account, choose **New + → Blueprint**, and connect that repository. Render creates the service from `render.yaml`; its dashboard shows the public `onrender.com` URL after deployment.

**Public data warning:** this version has no sign-in. Anyone who knows or finds the public URL can view, add, change, and delete the tasks, notes, exams, and study data stored by that one deployment. Do not put private or sensitive information in it.

The app is responsive and can be opened on a phone using its public URL. The deployed site exposes `robots.txt` and `sitemap.xml` for search crawlers. After deployment, submit the public sitemap in Google Search Console to request crawling. Search results are controlled by Google and can take time; submission does not guarantee when or whether the site will appear. A domain name is optional; Render supplies a public URL.
