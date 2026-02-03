# Aula Insights
### Product Requirements Document (PRD)
Version 1.0  
Status: MVP  
Author: Jonas Skjoldan Eskildsen  

---

## 1. Problem Statement

Parents in Denmark rely on Aula to see their children’s school schedule and communication.  
While Aula shows when a substitute teacher (“Vikar”) is used, it does not provide:

- Any statistics
- Any overview
- Any way to see patterns over time

This creates a major transparency gap.  
Parents cannot answer simple but important questions like:

> “How often does my child have a substitute teacher instead of their real teacher?”

This is especially critical when:
- A subject has frequent teacher absences
- Parents want to raise concerns with the school
- Municipalities want data-driven school quality insights

---

## 2. Solution

Aula Insights connects to a parent’s Aula account using an **unofficial Aula API wrapper** and extracts:

- Calendar
- Schedule
- Lesson metadata (including substitute flag)

It then converts this raw data into:

- Counts
- Percentages
- Trends
- Subject breakdowns

So parents can finally see:
> How stable their child’s teaching actually is.

---

## 3. Target Users

Primary:
- Danish parents with children in primary school (Folkeskolen)

Secondary:
- Parent councils
- Municipal education boards (future)

---

## 4. Core User Journey

1. Parent connects their Aula account with MitID
3. System syncs their child’s schedule
4. System extracts substitute (vikar) information
5. Parent sees dashboards:
   - Total substitute lessons
   - Per subject
   - Per time period

---

## 5. Data Source

The system uses:
- Unofficial Aula API wrapper
- Based on reverse-engineered Aula internal APIs

The wrapper handles:
- Authentication (MitID / UNI-login)
- Session cookies
- Aula endpoints for:
  - Calendar
  - Schedule
  - Teaching events

We do NOT scrape HTML.  
We rely on the same JSON endpoints the Aula frontend uses.

---

## 6. Key Data Model

### Lesson Event
| Field | Type |
|------|------|
| id | string |
| date | date |
| startTime | time |
| endTime | time |
| subject | string |
| teacher | string |
| substitute | boolean |
| class | string |
| childId | string |

---

## 7. Core Metrics

For each child:

- Total lessons
- Total substitute lessons
- % substitute coverage
- Substitute per subject
- Substitute per month
- Longest continuous substitute period

---

## 8. MVP Features

### 8.1 Account
- MitID-only login
- Connect Aula account

### 8.2 Aula Sync
- Log in via wrapper
- Fetch last 6 months of lessons
- Store normalized lesson data

### 8.3 Dashboard
- Overall substitute percentage
- Bar chart per subject
- Timeline view (vikar vs real teacher)

### 8.4 Child Selector
- If parent has multiple children

---

## 9. Technical Architecture

### Backend
- Node.js / Express
- Aula API wrapper module
- PostgreSQL (or Firestore)

### Frontend
- React or Vue
- Dashboard UI
- Secure token-based auth

### Sync Flow
1. User logs in with MitID
2. Credentials encrypted
3. Aula wrapper fetches data
4. Normalized into local DB
5. Dashboard queries local DB only

Aula is only hit during scheduled syncs.

---

## 10. Security & Compliance

- Credentials encrypted at rest
- GDPR: Data is only for the parent’s own children
- User can delete all data at any time
- No data shared with schools or third parties

---

## 11. Monetization (Future)

Freemium:
- Free: last 30 days
- Paid: full history, CSV export, alerts

Target: 29–49 DKK / month

---

## 12. Risks

| Risk | Mitigation |
|------|----------|
| Aula API changes | Wrapper abstraction |
| Legal concerns | Data belongs to the parent |
| MitID login flow | Use existing community wrapper |

---

## 13. Success Metrics

- 100 connected parents
- Avg > 3 months of data per user
- >20% discover high substitute rates
- 10% convert to paid

---

## 14. Expansion Ideas

- Alerts when substitute % spikes
- Compare with municipality average
- School-level reports
- Teacher stability scoring

---

## 15. MVP Definition

The MVP is successful when a parent can:
- Log in
- Connect Aula
- See how many times their child had a substitute teacher

That alone solves the core pain.
