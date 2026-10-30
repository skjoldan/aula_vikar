// SPDX-License-Identifier: GPL-3.0-only
import test from "node:test";
import assert from "node:assert/strict";
import { eventsToLessons } from "../src/aula_api.js";
import { computeMetrics, normalizeLessons } from "../src/metrics.js";

const children = [
  { id: "1", profileId: "11", instProfileId: "101", className: "5A" },
  { id: "2", profileId: "22", instProfileId: "202", className: "2B" },
];
const event = (patch = {}) => ({
  id: 42, type: "lesson", title: "Math",
  startDateTime: "2026-01-15T08:00:00Z", endDateTime: "2026-01-15T09:00:00Z",
  belongsToProfiles: [101],
  lesson: { participants: [{ participantRole: "substituteTeacher", teacherName: "Test substitute" }] },
  ...patch,
});

test("shared events count once per matching child, even across aliases and repeated batches", () => {
  const shared = event({ belongsToProfiles: [101, "11", 202] });
  const lessons = eventsToLessons([shared, shared], children);
  assert.deepEqual(lessons.map((l) => [l.childId, l.class]), [["1", "5A"], ["2", "2B"]]);
  const metrics = computeMetrics(normalizeLessons(lessons));
  assert.equal(metrics.totalLessons, 2);
  assert.equal(metrics.substitutePercent, 100);
});

test("unknown profiles are skipped; missing attribution is accepted only for one child", () => {
  assert.equal(eventsToLessons([event({ belongsToProfiles: [999] })], children).length, 0);
  assert.equal(eventsToLessons([event({ belongsToProfiles: [999] })], children.slice(0, 1)).length, 0);
  assert.equal(eventsToLessons([event({ belongsToProfiles: [] })], children).length, 0);
  assert.equal(eventsToLessons([event({ belongsToProfiles: [] })], children.slice(0, 1))[0].childId, "1");
  assert.equal(eventsToLessons([event({ belongsToProfiles: [], profileId: 22 })], children)[0].childId, "2");
  assert.equal(eventsToLessons([event({ belongsToProfiles: [999, 202] })], children)[0].childId, "2");
});

test("lesson dates and times use Copenhagen in winter, summer and across DST", () => {
  for (const [start, end, date, time] of [
    ["2026-01-15T08:00:00Z", "2026-01-15T09:00:00Z", "2026-01-15", "09:00"],
    ["2026-06-15T08:00:00Z", "2026-06-15T09:00:00Z", "2026-06-15", "10:00"],
    ["2026-06-15T23:30:00Z", "2026-06-16T00:30:00Z", "2026-06-16", "01:30"],
    ["2026-03-29T01:30:00Z", "2026-03-29T02:30:00Z", "2026-03-29", "03:30"],
    ["2026-10-25T01:30:00Z", "2026-10-25T02:30:00Z", "2026-10-25", "02:30"],
    ["2026-06-15T10:00:00+02:00", "2026-06-15T11:00:00+02:00", "2026-06-15", "10:00"],
  ]) {
    const lesson = eventsToLessons([event({ startDateTime: start, endDateTime: end })], children)[0];
    assert.equal(lesson.date, date);
    assert.equal(lesson.startTime, time);
  }
});

test("malformed or missing dates cannot crash sync or contaminate metrics", () => {
  const bad = ["garbage", "2026-02-30T08:00:00Z", "2026-13-01T08:00:00Z", "2026-01-15T25:00:00Z", "2026-01-15T08:00:00", "", null];
  const input = bad.flatMap((value) => [event({ startDateTime: value }), event({ endDateTime: value })]);
  input.push(event({ endDateTime: "2026-01-15T07:00:00Z" }));
  input.push(event({ endDateTime: "2026-01-15T08:00:00Z" }));
  input.push(event());
  assert.equal(eventsToLessons(input, children).length, 1);
});

test("substitute roles, flags and titles are recognized; ordinary lessons stay ordinary", () => {
  const ordinary = { lesson: {}, title: "Danish" };
  const lessons = eventsToLessons([
    event(), event({ ...ordinary, id: 43 }),
    event({ ...ordinary, id: 44, isSubstitute: true }),
    event({ ...ordinary, id: 45, title: "Danish - vikar" }),
    event({ id: 46, type: "meeting" }),
  ], children);
  assert.deepEqual(lessons.map((l) => l.substitute), [true, false, true, true]);
  const metrics = computeMetrics(normalizeLessons(lessons));
  assert.equal(metrics.substitutePercent, 75);
  assert.equal(metrics.perMonth[0].month, "2026-01");
});
