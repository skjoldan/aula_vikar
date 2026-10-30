// SPDX-License-Identifier: GPL-3.0-only
function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

export function normalizeLessons(lessons) {
  return lessons.map((lesson) => ({
    id: lesson.id,
    date: lesson.date,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    subject: lesson.subject,
    teacher: lesson.teacher,
    substitute: Boolean(lesson.substitute),
    className: lesson.class,
    childId: lesson.childId,
  }));
}

export function computeMetrics(lessons) {
  const totalLessons = lessons.length;
  const substituteLessons = lessons.filter((lesson) => lesson.substitute).length;
  const substitutePercent = totalLessons
    ? Math.round((substituteLessons / totalLessons) * 1000) / 10
    : 0;

  const subjectCounts = {};
  const subjectSubstitutes = {};
  const monthCounts = {};
  const monthSubstitutes = {};

  lessons.forEach((lesson) => {
    subjectCounts[lesson.subject] = (subjectCounts[lesson.subject] || 0) + 1;
    if (lesson.substitute) {
      subjectSubstitutes[lesson.subject] =
        (subjectSubstitutes[lesson.subject] || 0) + 1;
    }
    const key = monthKey(lesson.date);
    monthCounts[key] = (monthCounts[key] || 0) + 1;
    if (lesson.substitute) {
      monthSubstitutes[key] = (monthSubstitutes[key] || 0) + 1;
    }
  });

  const perSubject = Object.keys(subjectCounts).map((subject) => {
    const total = subjectCounts[subject];
    const subs = subjectSubstitutes[subject] || 0;
    return {
      subject,
      totalLessons: total,
      substituteLessons: subs,
      substitutePercent: total ? Math.round((subs / total) * 1000) / 10 : 0,
    };
  });

  const perMonth = Object.keys(monthCounts)
    .sort()
    .map((key) => {
      const total = monthCounts[key];
      const subs = monthSubstitutes[key] || 0;
      return {
        month: key,
        totalLessons: total,
        substituteLessons: subs,
        substitutePercent: total ? Math.round((subs / total) * 1000) / 10 : 0,
      };
    });

  const longestSubstituteStreak = computeLongestStreak(lessons);

  return {
    totalLessons,
    substituteLessons,
    substitutePercent,
    perSubject,
    perMonth,
    longestSubstituteStreak,
  };
}

function computeLongestStreak(lessons) {
  const sorted = [...lessons].sort((a, b) => {
    if (a.date === b.date) return a.startTime.localeCompare(b.startTime);
    return a.date.localeCompare(b.date);
  });
  let longest = 0;
  let current = 0;
  let streakStart = null;
  let longestRange = null;
  sorted.forEach((lesson) => {
    if (lesson.substitute) {
      current += 1;
      if (current === 1) streakStart = lesson.date;
      if (current > longest) {
        longest = current;
        longestRange = { start: streakStart, end: lesson.date };
      }
    } else {
      current = 0;
      streakStart = null;
    }
  });
  return { lessons: longest, range: longestRange };
}
