// Scanner page logic
(() => {
  async function init() {
    // Auth guard – if not teacher, will redirect
    const authorized = await window.qrAttendanceAuth.requireTeacher();
    if (!authorized) return;

    // Get teacher name for header
    const { data: sessionData } = await window.qrAttendanceAuth.supabaseClient.auth.getSession();
    const { data: teacher } = await window.qrAttendanceAuth.supabaseClient
      .from('teachers')
      .select('name')
      .eq('id', sessionData.session.user.id)
      .single();

    document.getElementById('teacher-name-sub').textContent =
      teacher && teacher.name ? teacher.name : 'Teacher';

    // Initialize mode
    let mode = 'time_in'; // default
    const modeInBtn = document.getElementById('mode-in');
    const modeOutBtn = document.getElementById('mode-out');

    function updateModeUI() {
      const inActive = mode === 'time_in';
      modeInBtn.setAttribute('aria-pressed', inActive);
      modeOutBtn.setAttribute('aria-pressed', !inActive);
      modeInBtn.classList.toggle('btn-primary', inActive);
      modeInBtn.classList.toggle('btn-secondary', !inActive);
      modeOutBtn.classList.toggle('btn-primary', !inActive);
      modeOutBtn.classList.toggle('btn-secondary', inActive);
    }

    modeInBtn.addEventListener('click', () => {
      mode = 'time_in';
      updateModeUI();
    });
    modeOutBtn.addEventListener('click', () => {
      mode = 'time_out';
      updateModeUI();
    });
    updateModeUI();

    // ---- NEW: Load today's logs from DB on page start ----
    async function loadTodaysLogs() {
      const { data: logs, error } = await window.qrAttendanceAuth.supabaseClient
        .from('attendance_logs')
        .select(`
          id,
          student_id,
          type,
          created_at,
          students!inner(student_name, guardian_name)
        `)
        .eq('scanned_by', sessionData.session.user.id)
        .order('created_at', { ascending: false });

      const listDiv = document.getElementById('scan-list');
      if (error) {
        console.error('Error loading logs:', error);
        listDiv.innerHTML = '<p class="hint error">Failed to load logs.</p>';
        return;
      }

      if (!logs || logs.length === 0) {
        listDiv.innerHTML = '<p class="hint">No scans yet.</p>';
        return;
      }

      listDiv.innerHTML = ''; // clear loading hint

      logs.forEach(log => {
        const student = log.students;
        const timeObj = new Date(log.created_at);
        // Format in 12‑hour Asia/Manila
        const options = { hour: '2-digit', minute: '2-digit', hour12: true };
        const timeStr = timeObj.toLocaleTimeString('en-PH', options);
        const dateStr = timeObj.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

        const item = document.createElement('div');
        item.className = 'scan-item';
        item.innerHTML = `
          <strong>${escapeHtml(student.student_name)}</strong> — ${log.type === 'time_in' ? 'In' : 'Out'} at ${timeStr} (${dateStr})
        `;
        listDiv.appendChild(item);
      });
    }

    // ---- QR scanner setup ----
    const html5QrCode = new Html5Qrcode('qr-reader');
    let isScanning = false;
    let useFront = false;
    const recentScans = new Map(); // debounce: code -> timestamp

    const scanConfig = { fps: 10, qrbox: 250 };

    async function onScanSuccess(decodedText) {
      // Debounce: ignore the same code within 3 seconds
      const now = Date.now();
      const lastSeen = recentScans.get(decodedText);
      if (lastSeen && now - lastSeen < 3000) {
        return;
      }
      recentScans.set(decodedText, now);
      // Prune old entries
      if (recentScans.size > 50) {
        for (const [key, ts] of recentScans.entries()) {
          if (now - ts > 60000) recentScans.delete(key);
        }
      }

      // Validate UUID format
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decodedText)) {
        showTempMessage('Not a valid student QR', 'error');
        return;
      }

      // Look up student
      const { data: student, error: lookupErr } = await window.qrAttendanceAuth.supabaseClient
        .from('students')
        .select('id, student_name, guardian_name, approved')
        .eq('id', decodedText)
        .single();

      if (lookupErr) {
        console.error('Lookup error:', lookupErr);
        showTempMessage('Error looking up student', 'error');
        return;
      }

      if (!student) {
        showTempMessage('Student not found', 'error');
        return;
      }

      if (!student.approved) {
        showTempMessage('Student is not approved yet', 'error');
        return;
      }

      // Try to insert into attendance_logs with duplicate guard
      const { error: insertErr, data: newLog } = await window.qrAttendanceAuth.supabaseClient
        .from('attendance_logs')
        .insert({
          student_id: decodedText,
          type: mode,
          scanned_by: sessionData.session.user.id,
        })
        .select()
        .single();

      if (insertErr) {
        // Unique constraint violation (23505): same student+type+log_date exists
        if (insertErr.code === '23505') {
          // Look up the existing log for today to show the current time
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date(todayStart);
          todayEnd.setHours(23, 59, 59, 999);

          const { data: existing, error: fetchErr } = await window.qrAttendanceAuth.supabaseClient
            .from('attendance_logs')
            .select('id, type, created_at')
            .eq('student_id', decodedText)
            .eq('type', mode)
            .gte('created_at', todayStart.toISOString())
            .lte('created_at', todayEnd.toISOString())
            .maybeSingle();

          if (fetchErr || !existing) {
            // Something else went wrong; inform the teacher
            console.error('Error fetching existing log:', fetchErr);
            showTempMessage('Duplicate error – please try again', 'error');
            return;
          }

          const existingTime = new Date(existing.created_at);
          const timeStr = existingTime.toLocaleTimeString('en-PH', {
            hour: '2-digit', minute: '2-digit', hour12: true,
          });
          const modeLabel = mode === 'time_in' ? 'Time In' : 'Time Out';

          showTempMessage(
            `Already ${modeLabel.toLowerCase()}d today at ${timeStr}`,
            'warning'
          );
          // Play beep for rejection
          playAudio('rejection');
          return;
        }

        // Other database error
        console.error('Insert error:', insertErr);
        showTempMessage('Database error – scan not recorded', 'error');
        playAudio('error');
        return;
      }

      // SUCCESS: insert returned a row
      const timeObj = new Date(newLog.created_at);
      const timeStr = timeObj.toLocaleTimeString('en-PH', {
        hour: '2-digit', minute: '2-digit', hour12: true,
      });
      const modeLabel = mode === 'time_in' ? 'Time In' : 'Time Out';

      // Show green result card with student name ONLY (no phone)
      const resultDiv = document.getElementById('scan-result-content');
      resultDiv.innerHTML = `
        <p><strong>${escapeHtml(student.student_name)}</strong>, ${modeLabel} recorded, ${timeStr}</p>
      `;
      document.getElementById('scan-result').hidden = false;

      // Append to today's session list
      await appendScanToList(student.student_name, mode, timeStr);

      // Play success beep
      playAudio('success');
    }

    function onScanError(error) {
      // Transient errors are normal while scanning; only update status
      document.getElementById('camera-status').textContent =
        'Scanning… (point camera at QR code)';
    }

    // ---- Append scan to the in‑memory list (kept in sync with DB) ----
    async function appendScanToList(name, mode, timeStr) {
      const listDiv = document.getElementById('scan-list');
      const item = document.createElement('div');
      item.className = 'scan-item';
      item.innerHTML = `<strong>${escapeHtml(name)}</strong> — ${mode === 'time_in' ? 'In' : 'Out'} at ${timeStr}`;
      listDiv.prepend(item);
      // Keep list to max 10
      if (listDiv.children.length > 10) {
        listDiv.removeChild(listDiv.lastChild);
      }
      // Remove empty‑state hint if it was there
      if (listDiv.classList.contains('empty-state')) {
        listDiv.classList.remove('empty-state');
        listDiv.innerHTML = '';
      }
    }

    // ---- Temp message helper ----
    function showTempMessage(msg, type = 'info') {
      const status = document.getElementById('camera-status');
      const prev = status.textContent;
      const prevClass = status.className;
      status.textContent = msg;
      status.className = `hint ${type}`;
      setTimeout(() => {
        status.textContent = prev;
        status.className = prevClass;
      }, 2500);
    }

    // ---- Audio helpers (Web Audio API + vibrate) ----
    function playAudio(kind) {
      // Vibrate
      if (navigator.vibrate) {
        const patterns = {
          success: [100, 50, 100],
          rejection: [200, 100, 200],
          error: [300, 200, 300],
        };
        const pattern = patterns[kind] || [200];
        navigator.vibrate(pattern);
      }
      // Optional simple beep via Web Audio (cross‑domain restrictions may limit this)
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.frequency.value = kind === 'success' ? 880 : 200;
        gain.gain.value = 0.3;
        oscillator.start();
        setTimeout(() => oscillator.stop(), 300);
      } catch (e) {
        // Ignore – beep is optional
      }
    }

    // ---- Start camera ----
    async function startScanning() {
      try {
        await html5QrCode.start(
          { facingMode: useFront ? 'user' : 'environment' },
          scanConfig,
          onScanSuccess,
          onScanError
        );
        isScanning = true;
        document.getElementById('camera-status').textContent =
          'Scanning… (point camera at QR code)';
        document.getElementById('camera-status').className = 'hint';
      } catch (err) {
        console.error('Unable to start scanning:', err);
        let helpText = 'Unable to access camera. ';
        if (err && /permission/i.test(err.message)) {
          helpText += 'Please allow camera permission for this site.';
        } else {
          helpText += 'Make sure a camera is connected and you are on HTTPS (or localhost).';
        }
        document.getElementById('camera-status').textContent = helpText;
        document.getElementById('camera-status').className = 'hint error';
      }
    }

    // Camera switch (front/rear)
    document.getElementById('toggle-camera-btn').addEventListener('click', async () => {
      if (!isScanning) return;
      try {
        await html5QrCode.stop();
        isScanning = false;
        useFront = !useFront;
        await html5QrCode.start(
          { facingMode: useFront ? 'user' : 'environment' },
          scanConfig,
          onScanSuccess,
          onScanError
        );
        isScanning = true;
        document.getElementById('camera-status').textContent =
          `Scanning… (${useFront ? 'front' : 'rear'} camera)`;
      } catch (err) {
        console.error('Switch camera error:', err);
        document.getElementById('camera-status').textContent =
          'Unable to switch camera.';
        document.getElementById('camera-status').className = 'hint error';
      }
    });

    // Sign out via the shared nav button
    document.getElementById('nav-sign-out').addEventListener('click', () => {
      window.qrAttendanceAuth.signOut();
    });

    // ---- Mode buttons already set up earlier ----
    // (updateModeUI was called above)

    await startScanning();

    // Load today's logs from DB
    await loadTodaysLogs();
  }

  // Initialize when ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();

// Helper: escape HTML
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({
    '&': '&', '<': '<', '>': '>',
    '"': '"', "'": '''
  })[m]);
}