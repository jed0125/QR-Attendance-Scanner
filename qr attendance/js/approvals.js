// Approvals page logic
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

    const pendingList = document.getElementById('pending-list');

    async function loadPending() {
      pendingList.innerHTML = '<p class="hint">Loading…</p>';
      const { data: students, error } = await window.qrAttendanceAuth.supabaseClient
        .from('students')
        .select('id, student_name, guardian_name, guardian_phone, created_at')
        .eq('approved', false)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading pending:', error);
        pendingList.innerHTML = '<p class="hint error">Failed to load pending registrations.</p>';
        return;
      }

      if (!students || students.length === 0) {
        pendingList.innerHTML = '<p class="hint">No pending registrations.</p>';
        return;
      }

      pendingList.innerHTML = ''; // clear loading message

      students.forEach(student => {
        const row = document.createElement('div');
        row.className = 'pending-row';

        const name = student.student_name || '(no name)';
        const guardian = student.guardian_name || '(no guardian)';
        const phone = student.guardian_phone || '(no phone)';
        const created = new Date(student.created_at);
        const dateStr = created.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const timeStr = created.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

        row.innerHTML = `
          <div class="name">${escapeHtml(name)}</div>
          <div class="meta">
            <span>Guardian: ${escapeHtml(guardian)}</span>
            <span>Phone: ${escapeHtml(phone)}</span>
            <span>Registered: ${dateStr} at ${timeStr}</span>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-primary approve-btn" data-id="${student.id}">Approve</button>
            <button type="button" class="btn btn-secondary reject-btn" data-id="${student.id}">Reject</button>
          </div>
        `;

        pendingList.appendChild(row);
      });

      // Attach event listeners to buttons
      pendingList.querySelectorAll('.approve-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = btn.dataset.id;
          if (!confirm(`Approve student ${escapeHtml(name)}?`)) return;
          btn.disabled = true;
          btn.textContent = 'Approving…';

          const { error } = await window.qrAttendanceAuth.supabaseClient
            .from('students')
            .update({ approved: true })
            .eq('id', id);

          if (error) {
            console.error('Approval error:', error);
            alert('Failed to approve student.');
          } else {
            // Remove the row from UI
            btn.closest('.pending-row').remove();
            // Re-check if list is now empty
            if (pendingList.children.length === 0) {
              pendingList.innerHTML = '<p class="hint">No pending registrations.</p>';
            }
          }
          btn.disabled = false;
          btn.textContent = 'Approve';
        });
      });

      pendingList.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = btn.dataset.id;
          if (!confirm(`Delete registration for ${escapeHtml(name)}? This cannot be undone.`)) return;
          btn.disabled = true;
          btn.textContent = 'Deleting…';

          const { error } = await window.qrAttendanceAuth.supabaseClient
            .from('students')
            .delete()
            .eq('id', id);

          if (error) {
            console.error('Rejection error:', error);
            alert('Failed to delete student.');
          } else {
            btn.closest('.pending-row').remove();
            if (pendingList.children.length === 0) {
              pendingList.innerHTML = '<p class="hint">No pending registrations.</p>';
            }
          }
          btn.disabled = false;
          btn.textContent = 'Reject';
        });
      });
    }

    // Initial load
    await loadPending();

    // Optionally, we could set up real-time subscription, but for Phase 2 we stick with polling on visible.
    // For simplicity, we'll just provide a refresh button? Actually, we can add a pull-to-refresh or a button.
    // Let's add a refresh button in the header.
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.className = 'btn btn-secondary';
    refreshBtn.style.marginLeft = '8px';
    refreshBtn.addEventListener('click', loadPending);
    // Insert into the header actions area
    const headerActions = document.querySelector('.actions');
    if (headerActions) {
      headerActions.insertBefore(refreshBtn, headerActions.firstChild);
    }

    // Sign out via the shared nav button
    document.getElementById('nav-sign-out').addEventListener('click', () => {
      window.qrAttendanceAuth.signOut();
    });
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
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  })[m]);
}