/**
 * Google Apps Script web app for sending attendance notification emails.
 * Deploy as a Web App: Execute as Me, Who has access: Anyone.
 * Script Properties required:
 *   - FIREBASE_API_KEY: Web API key from Firebase project settings
 *   - FIREBASE_PROJECT_ID: Firebase project ID
 *   - EMAIL_DRY_RUN: 'true' to skip actual sending (for testing)
 *   - SCHOOL_NAME: Display name of the school (optional)
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'Missing request body' }, 400);
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const idToken = payload.idToken;
    const attendanceId = payload.attendanceId;

    if (!idToken || !attendanceId) {
      return jsonResponse({ ok: false, error: 'Missing idToken or attendanceId' }, 400);
    }

    // Verify the ID token and get the UID
    const userInfo = verifyIdToken(idToken);
    if (!userInfo || !userInfo.users || userInfo.users.length === 0) {
      return jsonResponse({ ok: false, error: 'Invalid token' }, 401);
    }

    const uid = userInfo.users[0].localId;

    // Verify staff document exists using Firestore REST API
    const staffDoc = getFirestoreDoc(uid, 'staff', idToken);
    if (!staffDoc || !staffDoc.fields) {
      return jsonResponse({ ok: false, error: 'Not authorized' }, 403);
    }

    // Read the attendance document
    const attendanceDoc = getFirestoreDoc(attendanceId, 'attendance', idToken);
    if (!attendanceDoc || !attendanceDoc.fields) {
      return jsonResponse({ ok: false, error: 'Attendance record not found' }, 404);
    }

    // Extract data from attendance document
    const studentName = getStringField(attendanceDoc, 'studentName');
    const guardianEmail = getStringField(attendanceDoc, 'guardianEmail');
    const type = getStringField(attendanceDoc, 'type');
    const createdAt = getTimestampField(attendanceDoc, 'createdAt');
    const studentId = getStringField(attendanceDoc, 'studentId');

    if (!studentName || !guardianEmail || !type || !createdAt) {
      return jsonResponse({ ok: false, error: 'Invalid attendance data' }, 500);
    }

    // Attempt to retrieve guardian name from student doc (fallback safely to 'Parent or Guardian')
    let guardianName = 'Parent or Guardian';
    if (studentId) {
      try {
        const studentDoc = getFirestoreDoc(studentId, 'students', idToken);
        if (studentDoc && studentDoc.fields) {
          const gName = getStringField(studentDoc, 'guardianName');
          if (gName) {
            guardianName = gName;
          }
        }
      } catch (err) {
        // Safe fallback
      }
    }

    // Claim or check the notification document
    const notificationResult = claimNotification(attendanceId, idToken);
    if (!notificationResult.ok) {
      return jsonResponse(notificationResult);
    }

    if (notificationResult.status === 'already') {
      return jsonResponse({ ok: true, status: 'already' });
    }

    const hadLastError = !!notificationResult.hadLastError;

    // Check daily email quota
    const remainingQuota = MailApp.getRemainingDailyQuota();
    if (remainingQuota <= 0) {
      commitNotificationUpdate(attendanceId, 'failed', 'Daily email limit reached', idToken, null, false);
      return jsonResponse({ ok: true, status: 'failed', reason: 'daily limit reached' });
    }

    // Check dry-run mode
    const dryRun = PropertiesService.getScriptProperties().getProperty('EMAIL_DRY_RUN') === 'true';
    if (dryRun) {
      commitNotificationUpdate(attendanceId, 'skipped', null, idToken, null, hadLastError);
      return jsonResponse({ ok: true, status: 'skipped' });
    }

    // Send the email
    const emailResult = sendAttendanceEmail(studentName, guardianEmail, type, createdAt, guardianName);
    if (emailResult.ok) {
      let updateSuccess = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const updateRes = commitNotificationUpdate(attendanceId, 'sent', null, idToken, null, hadLastError);
        if (updateRes.ok) {
          updateSuccess = true;
          break;
        }
        if (attempt < 3) {
          Utilities.sleep(500 * attempt);
        }
      }

      if (!updateSuccess) {
        console.error('Failed to update notification status after sending');
        return jsonResponse({ ok: false, status: 'status_update_failed', error: 'Email sent but status update failed' });
      }

      return jsonResponse({ ok: true, status: 'sent' });
    } else {
      commitNotificationUpdate(attendanceId, 'failed', emailResult.error, idToken, null, false);
      return jsonResponse({ ok: true, status: 'failed', reason: emailResult.error });
    }

  } catch (error) {
    // Never leak stack traces or tokens in responses
    console.error('doPost error: ' + error.message);
    return jsonResponse({ ok: false, error: 'Internal error' }, 500);
  }
}

/**
 * Verify Firebase ID token using Identity Toolkit API.
 * @param {string} idToken
 * @return {Object|null}
 */
function verifyIdToken(idToken) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('FIREBASE_API_KEY');
  if (!apiKey) {
    throw new Error('FIREBASE_API_KEY not configured');
  }

  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(apiKey);
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch (e) {
    return null;
  }
}

/**
 * Get a Firestore document using the REST API with Bearer token auth.
 * @param {string} docId
 * @param {string} collection
 * @param {string} idToken
 * @return {Object|null}
 */
function getFirestoreDoc(docId, collection, idToken) {
  const projectId = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID not configured');
  }

  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents/' + collection + '/' + encodeURIComponent(docId);

  const options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + idToken
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();

  if (responseCode !== 200) {
    return null;
  }

  try {
    return JSON.parse(response.getContentText());
  } catch (e) {
    return null;
  }
}

/**
 * Execute a commit write against Firestore documents:commit REST endpoint.
 * @param {string} projectId
 * @param {string} idToken
 * @param {Object} writeObj
 * @return {Object} {statusCode, ok, body}
 */
function executeCommit(projectId, idToken, writeObj) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents:commit';

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + idToken
    },
    payload: JSON.stringify({
      writes: [writeObj]
    }),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const contentText = response.getContentText();

  return {
    statusCode: responseCode,
    ok: responseCode === 200,
    body: contentText
  };
}

/**
 * Create a new notification document using documents:commit with REQUEST_TIME transform.
 * Precondition: currentDocument { exists: false }.
 * @param {string} attendanceId
 * @param {string} idToken
 * @return {Object} {ok, status, hadLastError}
 */
function commitNotificationCreate(attendanceId, idToken) {
  const projectId = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID not configured');
  }

  const docName = 'projects/' + projectId + '/databases/(default)/documents/notifications/' + attendanceId;

  const writeObj = {
    currentDocument: { exists: false },
    update: {
      name: docName,
      fields: {
        attendanceId: { stringValue: attendanceId },
        channel: { stringValue: 'email' },
        status: { stringValue: 'sending' },
        attempts: { integerValue: '1' }
      }
    },
    updateTransforms: [
      { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }
    ]
  };

  const res = executeCommit(projectId, idToken, writeObj);
  if (res.ok) {
    return { ok: true, status: 'claimed', hadLastError: false };
  }

  if (res.statusCode === 400 || res.statusCode === 409) {
    return { ok: false, status: 'exists' };
  }

  return { ok: false, status: 'error', error: 'Firestore write failed: ' + res.statusCode };
}

/**
 * Update notification status using documents:commit with REQUEST_TIME transform and updateMask.
 * Precondition: currentDocument { exists: true }.
 * @param {string} attendanceId
 * @param {string} status - 'sending' | 'sent' | 'failed' | 'skipped'
 * @param {string|null} lastError
 * @param {string} idToken
 * @param {number|null} [attempts]
 * @param {boolean} [clearLastError]
 * @return {Object} {ok, statusCode}
 */
function commitNotificationUpdate(attendanceId, status, lastError, idToken, attempts, clearLastError) {
  const projectId = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID not configured');
  }

  const docName = 'projects/' + projectId + '/databases/(default)/documents/notifications/' + attendanceId;

  const fields = {
    status: { stringValue: status }
  };
  const updateMask = ['status'];
  const updateTransforms = [
    { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }
  ];

  if (status === 'sent') {
    updateTransforms.push({ fieldPath: 'sentAt', setToServerValue: 'REQUEST_TIME' });
    updateMask.push('sentAt');
    if (clearLastError) {
      updateMask.push('lastError');
    }
  } else if (status === 'failed') {
    const errorMsg = String(lastError || 'Unknown error').substring(0, 500);
    fields.lastError = { stringValue: errorMsg };
    updateMask.push('lastError');
  } else if (status === 'sending' && attempts !== undefined && attempts !== null) {
    fields.attempts = { integerValue: String(attempts) };
    updateMask.push('attempts');
    if (clearLastError) {
      updateMask.push('lastError');
    }
  }

  updateMask.push('updatedAt');

  const writeObj = {
    currentDocument: { exists: true },
    updateMask: { fieldPaths: updateMask },
    update: {
      name: docName,
      fields: fields
    },
    updateTransforms: updateTransforms
  };

  const res = executeCommit(projectId, idToken, writeObj);
  return { ok: res.ok, statusCode: res.statusCode };
}

/**
 * Claim the notification document for processing.
 * Returns {ok: true, status: 'claimed', hadLastError} if we can proceed,
 * {ok: true, status: 'already'} if already sent/sending recently,
 * {ok: false, ...} on error.
 */
function claimNotification(attendanceId, idToken) {
  // First, try to read existing notification
  const existing = getFirestoreDoc(attendanceId, 'notifications', idToken);

  if (existing && existing.fields) {
    const status = getStringField(existing, 'status');
    const attempts = getNumberField(existing, 'attempts');
    const updatedAt = getTimestampField(existing, 'updatedAt');
    const hasLastError = !!existing.fields.lastError;

    // Already terminal
    if (status === 'sent' || status === 'skipped') {
      return { ok: true, status: 'already' };
    }

    // Currently sending and not stale (< 2 min)
    if (status === 'sending' && updatedAt) {
      const ageMs = Date.now() - updatedAt.getTime();
      if (ageMs < 120000) {
        return { ok: true, status: 'already' };
      }
    }

    // Retryable: failed with attempts < 3, or stale sending (> 2 min)
    const canRetry = (status === 'failed' && attempts < 3) ||
      (status === 'sending' && updatedAt && (Date.now() - updatedAt.getTime()) >= 120000);

    if (canRetry) {
      const newAttempts = attempts + 1;
      const result = commitNotificationUpdate(attendanceId, 'sending', null, idToken, newAttempts, hasLastError);
      if (result.ok) {
        return { ok: true, status: 'claimed', hadLastError: false };
      }
      return { ok: false, status: 'error', error: 'Failed to claim notification' };
    }

    // Not retryable
    return { ok: true, status: 'already' };
  }

  // No existing notification — create new one
  const result = commitNotificationCreate(attendanceId, idToken);
  if (result.ok) {
    return { ok: true, status: 'claimed', hadLastError: false };
  }

  if (result.status === 'exists') {
    // Race condition: another request created it concurrently. Read and evaluate.
    return claimNotification(attendanceId, idToken);
  }

  return { ok: false, status: 'error', error: 'Failed to create notification' };
}

/**
 * Send attendance notification email.
 * @param {string} studentName
 * @param {string} guardianEmail
 * @param {string} type - 'time_in' or 'time_out'
 * @param {Date} createdAt
 * @param {string} [guardianName]
 * @return {Object} {ok, error}
 */
function sendAttendanceEmail(studentName, guardianEmail, type, createdAt, guardianName) {
  try {
    const isTimeIn = type === 'time_in';
    const subject = isTimeIn
      ? 'Attendance Alert: Student Arrival'
      : 'Attendance Alert: Student Departure';

    // Format date and time in Asia/Manila
    const manilaDate = formatInTimeZone(createdAt, 'Asia/Manila', 'MMMM d, yyyy');
    const manilaTime = formatInTimeZone(createdAt, 'Asia/Manila', 'h:mm a');

    // Safe default for guardian name
    const effectiveGuardianName = guardianName || 'Parent or Guardian';

    // School name from script properties
    const schoolName = PropertiesService.getScriptProperties().getProperty('SCHOOL_NAME') || 'School';

    // Plain-text body
    const textBody = 'Dear ' + effectiveGuardianName + ',\n\n' +
      'This is to inform you that your child, ' + studentName + ', was recorded as having ' +
      (isTimeIn ? 'arrived at' : 'left') + ' school.\n\n' +
      'Date: ' + manilaDate + '\n' +
      'Time: ' + manilaTime + '\n\n' +
      'School Attendance Monitoring System';

    // HTML-escape all dynamic values
    const escapedStudent = escapeHtml(studentName);
    const escapedGuardian = escapeHtml(effectiveGuardianName);
    const escapedSchool = escapeHtml(schoolName);
    const escapedDate = escapeHtml(manilaDate);
    const escapedTime = escapeHtml(manilaTime);

    // Dynamic badge and text
    const badgeBg = isTimeIn ? '#0F7A61' : '#F2B15C';
    const badgeColor = isTimeIn ? '#FFFFFF' : '#12263A';
    const badgeText = isTimeIn ? 'ARRIVED' : 'LEFT SCHOOL';
    const actionPhrase = isTimeIn ? 'arrived at' : 'left';

    // 560px white card on a #F4F6F8 background with inline CSS only
    const htmlBody = '<!DOCTYPE html>' +
      '<html lang="en"><head><meta charset="utf-8"></head>' +
      '<body style="margin:0;padding:24px 12px;background-color:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#12263A;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      '<tr><td align="center">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border:1px solid #C3CEDA;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(18,38,58,0.08);">' +
      '<tr><td style="background-color:#12263A;padding:24px 28px;text-align:left;">' +
      '<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#7FD6BE;text-transform:uppercase;letter-spacing:0.16em;">' + escapedSchool + '</p>' +
      '<h1 style="margin:0;font-size:24px;font-weight:700;color:#FFFFFF;line-height:1.2;">Attendance Alert</h1>' +
      '</td></tr>' +
      '<tr><td style="padding:28px;text-align:left;line-height:1.5;">' +
      '<p style="margin:0 0 16px;font-size:16px;color:#12263A;">Dear ' + escapedGuardian + ',</p>' +
      '<p style="margin:0 0 20px;font-size:16px;color:#3A4E63;">Your child <strong>' + escapedStudent + '</strong> ' + actionPhrase + ' school.</p>' +
      '<div style="background-color:#F4F6F8;border:1px solid #C3CEDA;border-radius:10px;padding:18px 20px;margin-bottom:24px;">' +
      '<div style="margin-bottom:12px;">' +
      '<span style="display:inline-block;padding:5px 14px;border-radius:999px;background-color:' + badgeBg + ';color:' + badgeColor + ';font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">' + badgeText + '</span>' +
      '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:15px;line-height:1.5;">' +
      '<tr><td style="padding:4px 0;color:#55697E;width:64px;">Date:</td><td style="padding:4px 0;font-weight:600;color:#12263A;">' + escapedDate + '</td></tr>' +
      '<tr><td style="padding:4px 0;color:#55697E;width:64px;">Time:</td><td style="padding:4px 0;font-weight:600;color:#12263A;">' + escapedTime + '</td></tr>' +
      '</table>' +
      '</div>' +
      '<p style="margin:0;font-size:13px;color:#55697E;line-height:1.4;">This is an automated attendance alert.</p>' +
      '</td></tr>' +
      '<tr><td style="background-color:#F4F6F8;padding:16px 28px;text-align:center;border-top:1px solid #C3CEDA;">' +
      '<p style="margin:0;font-size:12px;color:#55697E;font-weight:500;">School Attendance Monitoring System</p>' +
      '</td></tr>' +
      '</table>' +
      '</td></tr>' +
      '</table>' +
      '</body></html>';

    MailApp.sendEmail({
      to: guardianEmail,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody,
      name: 'School Attendance Monitoring System'
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message.substring(0, 200) };
  }
}

/**
 * Format a Date in a specific time zone.
 * @param {Date} date
 * @param {string} timeZone
 * @param {string} format - simplified format: 'MMMM d, yyyy' or 'h:mm a'
 * @return {string}
 */
function formatInTimeZone(date, timeZone, format) {
  try {
    return Utilities.formatDate(date, timeZone, format);
  } catch (e) {
    return Utilities.formatDate(date, 'GMT+8', format);
  }
}

/**
 * HTML-escape a string.
 * @param {string} str
 * @return {string}
 */
function escapeHtml(str) {
  var AMP = '&' + 'amp;';
  var LT = '&' + 'lt;';
  var GT = '&' + 'gt;';
  var QUOT = '&' + 'quot;';
  var APOS = '&' + '#39;';
  return String(str)
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/"/g, QUOT)
    .replace(/'/g, APOS);
}

/**
 * Extract string value from Firestore document field.
 * @param {Object} doc
 * @param {string} fieldName
 * @return {string|null}
 */
function getStringField(doc, fieldName) {
  const field = doc.fields[fieldName];
  if (!field) return null;
  return field.stringValue || null;
}

/**
 * Extract number value from Firestore document field.
 * @param {Object} doc
 * @param {string} fieldName
 * @return {number}
 */
function getNumberField(doc, fieldName) {
  const field = doc.fields[fieldName];
  if (!field) return 0;
  return parseInt(field.integerValue || field.doubleValue || '0', 10);
}

/**
 * Extract timestamp value from Firestore document field.
 * @param {Object} doc
 * @param {string} fieldName
 * @return {Date|null}
 */
function getTimestampField(doc, fieldName) {
  const field = doc.fields[fieldName];
  if (!field || !field.timestampValue) return null;
  try {
    return new Date(field.timestampValue);
  } catch (e) {
    return null;
  }
}

/**
 * Create JSON response with proper headers.
 * @param {Object} data
 * @param {number} statusCode
 * @return {TextOutput}
 */
function jsonResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
