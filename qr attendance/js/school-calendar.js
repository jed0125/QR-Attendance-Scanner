/**
 * School Calendar — Shared pure functions for late/absent logic and date helpers.
 * No Firebase dependencies. Can be imported as an ES module.
 */

export const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // +8 hours in ms
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Default settings used when settings/school document doesn't exist.
 */
export const DEFAULT_SETTINGS = {
  schoolYearStart: null, // YYYY-MM-DD string or null
  schoolYearEnd: null,   // YYYY-MM-DD string or null
  schoolDays: [1, 2, 3, 4, 5], // Monday-Friday (1=Monday, 7=Sunday)
  lateAfter: "08:00",    // HH:MM 24-hour
  absentAfter: "10:00",  // HH:MM 24-hour
  holidays: []           // array of YYYY-MM-DD strings
};

/**
 * Convert a logDay (days since epoch with Manila offset) to a YYYY-MM-DD date string.
 * logDay is computed as floor((millis + 28800000) / 86400000).
 * @param {number} logDay
 * @returns {string} YYYY-MM-DD
 */
export function dayToDateString(logDay) {
  // logDay * DAY_MS gives milliseconds since epoch in Manila time (because of the +8h offset)
  const date = new Date(logDay * DAY_MS);
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Get today's logDay (Manila calendar day).
 * @returns {number}
 */
export function todayLogDay() {
  return Math.floor((Date.now() + MANILA_OFFSET_MS) / DAY_MS);
}

/**
 * Get the weekday for a logDay where 1=Monday, 7=Sunday.
 * logDay 0 = 1970-01-01 (Thursday). Adding 3 makes Monday=1.
 * @param {number} logDay
 * @returns {number} 1=Monday ... 7=Sunday
 */
export function weekdayMon1(logDay) {
  return ((logDay + 3) % 7) + 1;
}

/**
 * Get minutes since midnight in Manila time from a UTC timestamp.
 * @param {number} millis - UTC milliseconds since epoch
 * @returns {number} Minutes since midnight (0-1439)
 */
export function manilaMinutes(millis) {
  return Math.floor(((millis + MANILA_OFFSET_MS) % DAY_MS) / 60000);
}

/**
 * Parse HH:MM time string to minutes since midnight.
 * @param {string} timeStr - HH:MM in 24-hour format
 * @returns {number} Minutes since midnight
 */
export function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Check if a date string (YYYY-MM-DD) is a holiday.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string[]} holidays - Array of YYYY-MM-DD strings
 * @returns {boolean}
 */
export function isHoliday(dateStr, holidays) {
  return holidays.includes(dateStr);
}

/**
 * Check if a logDay falls within the school year.
 * If schoolYearStart/End are not set, defaults to current calendar year.
 * @param {number} logDay
 * @param {Object} settings
 * @returns {boolean}
 */
export function isWithinSchoolYear(logDay, settings) {
  const dateStr = dayToDateString(logDay);
  const year = new Date().getFullYear();
  const start = settings.schoolYearStart || `${year}-01-01`;
  const end = settings.schoolYearEnd || `${year}-12-31`;
  return dateStr >= start && dateStr <= end;
}

/**
 * Determine the day status for a given calendar day.
 * @param {Object} params
 * @param {number} params.logDay - The logDay to check
 * @param {Object} params.settings - Settings object (or DEFAULT_SETTINGS)
 * @param {number} params.approvedLogDay - The logDay when student was approved
 * @param {number|null} params.timeInMillis - UTC milliseconds of time_in, or null
 * @param {number|null} params.timeOutMillis - UTC milliseconds of time_out, or null
 * @param {number} params.nowMillis - Current UTC milliseconds (for "today" logic)
 * @returns {Object} { status, missingTimeOut, isToday, isPast }
 *   status: 'no_class' | 'present' | 'late' | 'absent' | 'not_yet_in'
 *   missingTimeOut: boolean (true when past day has time_in but no time_out)
 */
export function getDayStatus({
  logDay,
  settings = DEFAULT_SETTINGS,
  approvedLogDay,
  timeInMillis = null,
  timeOutMillis = null,
  nowMillis = Date.now()
}) {
  const dateStr = dayToDateString(logDay);
  const todayLogDay = Math.floor((nowMillis + MANILA_OFFSET_MS) / DAY_MS);
  const isToday = logDay === todayLogDay;
  const isPast = logDay < todayLogDay;

  // Check if this day is a "no class" day
  const wd = weekdayMon1(logDay);
  const isSchoolDay = settings.schoolDays.includes(wd);
  const isHolidayFlag = isHoliday(dateStr, settings.holidays);
  const withinYear = isWithinSchoolYear(logDay, settings);
  const afterApproval = logDay >= approvedLogDay;
  const isFuture = logDay > todayLogDay;

  const noClass = !isSchoolDay || isHolidayFlag || !withinYear || !afterApproval || isFuture;

  if (noClass) {
    return {
      status: "no_class",
      missingTimeOut: false,
      isToday,
      isPast
    };
  }

  const lateAfterMinutes = parseTimeToMinutes(settings.lateAfter);
  const absentAfterMinutes = parseTimeToMinutes(settings.absentAfter);

  // School day with time-in
  if (timeInMillis !== null) {
    const inMinutes = manilaMinutes(timeInMillis);
    const isLate = inMinutes > lateAfterMinutes;
    const hasMissingTimeOut = isPast && timeOutMillis === null;

    return {
      status: isLate ? "late" : "present",
      missingTimeOut: hasMissingTimeOut,
      isToday,
      isPast
    };
  }

  // School day, no time-in
  if (isToday) {
    const nowMinutes = manilaMinutes(nowMillis);
    // Before absentAfter cutoff: not_yet_in
    // After absentAfter cutoff: absent
    return {
      status: nowMinutes >= absentAfterMinutes ? "absent" : "not_yet_in",
      missingTimeOut: false,
      isToday,
      isPast
    };
  }

  // Past school day with no time-in = absent
  return {
    status: "absent",
    missingTimeOut: false,
    isToday,
    isPast
  };
}

/**
 * Summarize attendance for a list of days.
 * @param {Object[]} days - Array of day status objects from getDayStatus
 * @returns {Object} { schoolDays, present, late, absent, missingTimeOut, attendanceRate }
 */
export function summarize(days) {
  const schoolDays = days.filter(d => d.status !== "no_class").length;
  const present = days.filter(d => d.status === "present" || d.status === "late").length;
  const late = days.filter(d => d.status === "late").length;
  const absent = days.filter(d => d.status === "absent").length;
  const missingTimeOut = days.filter(d => d.missingTimeOut).length;
  const attendanceRate = schoolDays > 0 ? Math.round((present / schoolDays) * 100) : 0;

  return {
    schoolDays,
    present,
    late,
    absent,
    missingTimeOut,
    attendanceRate
  };
}

/**
 * Get the first and last logDay of a given month/year.
 * @param {number} year - e.g., 2026
 * @param {number} month - 0-11 (JS month)
 * @returns {Object} { firstLogDay, lastLogDay }
 */
export function getMonthLogDayRange(year, month) {
  const firstDate = new Date(year, month, 1);
  const lastDate = new Date(year, month + 1, 0); // last day of month
  const firstLogDay = Math.floor((firstDate.getTime() + MANILA_OFFSET_MS) / DAY_MS);
  const lastLogDay = Math.floor((lastDate.getTime() + MANILA_OFFSET_MS) / DAY_MS);
  return { firstLogDay, lastLogDay };
}

/**
 * Format a logDay as a human-readable date string (e.g., "Mon, Jan 15").
 * @param {number} logDay
 * @returns {string}
 */
export function formatLogDay(logDay) {
  const date = new Date(logDay * DAY_MS);
  return date.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

/**
 * Format a UTC timestamp as HH:MM AM/PM in Manila time.
 * @param {number} millis
 * @returns {string}
 */
export function formatManilaTime(millis) {
  const date = new Date(millis);
  return date.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

/**
 * Get status display text and CSS class for a status.
 * @param {string} status
 * @returns {Object} { text, className }
 */
export function getStatusDisplay(status) {
  switch (status) {
    case "present":
      return { text: "Present", className: "status-chip--present" };
    case "late":
      return { text: "Late", className: "status-chip--late" };
    case "absent":
      return { text: "Absent", className: "status-chip--absent" };
    case "no_class":
      return { text: "No class", className: "status-chip--no-class" };
    case "not_yet_in":
      return { text: "Not yet in", className: "status-chip--not-yet-in" };
    default:
      return { text: "—", className: "status-chip--unknown" };
  }
}

/**
 * Convert UTC milliseconds to a Manila calendar logDay.
 * Mirrors the internal logDay calculation used across the app.
 * @param {number} millis - UTC milliseconds since epoch
 * @returns {number} Manila logDay
 */
export function logDayFromMillis(millis) {
  return Math.floor((millis + MANILA_OFFSET_MS) / DAY_MS);
}