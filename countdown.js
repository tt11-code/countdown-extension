(function () {
  'use strict';

  function localDate(year, month, day, time) {
    const parts = (time || '00:00').split(':').map(Number);
    const result = new Date(year, month - 1, day, parts[0] || 0, parts[1] || 0, 0, 0);
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function parseDateOnly(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = localDate(year, month, day);
    return date && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? { year, month, day }
      : null;
  }

  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function nextBirthday(birthday, now) {
    const birth = parseDateOnly(birthday);
    if (!birth) return null;
    let year = now.getFullYear();
    let day = birth.month === 2 && birth.day === 29 && !isLeapYear(year) ? 28 : birth.day;
    let target = localDate(year, birth.month, day);
    if (target <= now) {
      year += 1;
      day = birth.month === 2 && birth.day === 29 && !isLeapYear(year) ? 28 : birth.day;
      target = localDate(year, birth.month, day);
    }
    return { target, age: year - birth.year };
  }

  function milestoneTarget(milestone) {
    const date = parseDateOnly(milestone.date);
    return date ? localDate(date.year, date.month, date.day, milestone.time) : null;
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${days} : ${String(hours).padStart(2, '0')} : ${String(minutes).padStart(2, '0')} : ${String(seconds).padStart(2, '0')}`;
  }

  window.CountdownLogic = {
    localDate,
    parseDateOnly,
    isLeapYear,
    nextBirthday,
    milestoneTarget,
    formatDuration
  };
}());
