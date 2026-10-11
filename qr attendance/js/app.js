// QR Attendance System — Phase 1 registration app
// Uses Supabase JS client and QRCode library via CDN

(() => {
  let supabase;
  let QRCode;

  // Initialize when libraries are loaded
  function init() {
    supabase = supabaseJs.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    );
    QRCode = window.QRCode;

    setupForm();
  }

  // Philippine mobile number validation & normalization
  function normalizePhone(input) {
    // Remove spaces and dashes
    let phone = input.trim().replace(/[\s-]/g, '');

    // Already normalized: 639XXXXXXXXX (exactly 12 digits)
    if (/^639\d{9}$/.test(phone)) return phone;

    // Local format started with 0: 09XXXXXXXXX
    if (/^09\d{9}$/.test(phone)) return '63' + phone.slice(1);

    // With +63 prefix: +639XXXXXXXXX or +63 9XXXXXXXXX
    if (/^\+?639\d{9}$/.test(phone)) {
      return phone.replace(/^\+/, '');
    }

    // With just 63 prefix (no +): already 12 digits starting with 639
    if (/^639\d{9}$/.test(phone)) return phone;

    return null; // Invalid
  }

  function validatePhone(phone) {
    return normalizePhone(phone) !== null;
  }

  function setupForm() {
    const form = document.getElementById('reg-form');
    const studentNameInput = document.getElementById('student-name');
    const guardianNameInput = document.getElementById('guardian-name');
    const phoneInput = document.getElementById('guardian-phone');
    const consentInput = document.getElementById('consent');
    const submitBtn = document.getElementById('submit-btn');

    // Form fields reference for errors
    const errStudentName = document.getElementById('err-student-name');
    const errGuardianName = document.getElementById('err-guardian-name');
    const errPhone = document.getElementById('err-guardian-phone');
    const errConsent = document.getElementById('err-consent');

    function setError(elId, msg) {
      const el = document.getElementById(elId);
      if (el) el.textContent = msg;
    }

    function clearErrors() {
      errStudentName.textContent = '';
      errGuardianName.textContent = '';
      errPhone.textContent = '';
      errConsent.textContent = '';
    }

    // Enable button when all fields valid
    function updateButtonState() {
      const hasValues = studentNameInput.value.trim() &&
        guardianNameInput.value.trim() &&
        validatePhone(phoneInput.value) &&
        consentInput.checked;
      submitBtn.disabled = !hasValues;
    }

    // Real-time validation
    studentNameInput.addEventListener('input', () => {
      clearErrors();
      updateButtonState();
    });
    guardianNameInput.addEventListener('input', () => {
      clearErrors();
      updateButtonState();
    });
    phoneInput.addEventListener('input', () => {
      clearErrors();
      updateButtonState();
    });
    consentInput.addEventListener('change', () => {
      clearErrors();
      updateButtonState();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Reset errors
      clearErrors();

      // Check honeypot (should be empty)
      const honeypot = form.elements['website'];
      if (honeypot && honeypot.value) {
        console.warn('Spam detected (honeypot filled)');
        return;
      }

      const studentName = studentNameInput.value.trim();
      const guardianName = guardianNameInput.value.trim();
      const phoneRaw = phoneInput.value.trim();

      // Validate student name
      if (!studentName) {
        errStudentName.textContent = 'Student name is required';
        return;
      }

      // Validate guardian name
      if (!guardianName) {
        errGuardianName.textContent = 'Guardian name is required';
        return;
      }

      // Validate and normalize phone
      const phoneNorm = normalizePhone(phoneRaw);
      if (!phoneNorm) {
        errPhone.textContent = 'Invalid Philippine mobile number';
        return;
      }

      // Check consent
      if (!consentInput.checked) {
        errConsent.textContent = 'Consent is required';
        return;
      }

      // Disable button
      submitBtn.disabled = true;
      const originalText = submitBtn.querySelector('.btn-text').textContent;
      submitBtn.querySelector('.btn-text').hidden = true;
      submitBtn.querySelector('.btn-loading').hidden = false;

      try {
        const { data, error } = await supabase.from('students').insert({
          student_name: studentName,
          guardian_name: guardianName,
          guardian_phone: phoneNorm
        }).select('id').single();

        if (error) throw error;

        // Show QR code
        const studentId = data.id;
        showQRCode(studentId, studentName);

      } catch (err) {
        console.error('Registration error:', err);
        alert('Registration failed. Please try again.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.querySelector('.btn-text').hidden = false;
        submitBtn.querySelector('.btn-loading').hidden = true;
      }
    });

    // Reset button
    document.getElementById('new-btn').addEventListener('click', () => {
      document.getElementById('result-card').hidden = true;
      document.getElementById('registration-form').hidden = false;
      form.reset();
      updateButtonState();
    });
  }

  function showQRCode(studentId, studentName) {
    document.getElementById('registration-form').hidden = true;
    const resultCard = document.getElementById('result-card');
    const canvas = document.getElementById('qr-canvas');
    const infoDiv = document.getElementById('student-info');

    // Generate QR code with just the UUID
    QRCode.toCanvas(canvas, studentId, {
      width: 240,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    }, (err) => {
      if (err) console.error('QR generation error:', err);
    });

    // Display student info under QR
    infoDiv.innerHTML = `
      <p class="name">${escapeHtml(studentName)}</p>
      <p class="uuid">ID: ${studentId}</p>
    `;

    resultCard.hidden = false;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  // Download PNG handler
  document.getElementById('download-btn')?.addEventListener('click', () => {
    const canvas = document.getElementById('qr-canvas');
    const link = document.createElement('a');
    link.download = `qr-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  // Print handler
  document.getElementById('print-btn')?.addEventListener('click', () => {
    window.print();
  });

  // Start when DOM and libraries ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();