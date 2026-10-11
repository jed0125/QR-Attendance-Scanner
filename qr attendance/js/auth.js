// Shared auth guard for protected pages (scanner.html, approvals.html).
// Redirects to login.html if the user is not authenticated or not a teacher.
// Exposes a sign-out helper and a current-user getter.

const supabaseClient = supabaseJs.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

// Returns true if the current session belongs to a teacher.
async function requireTeacher() {
  const { data: session } = await supabaseClient.auth.getSession();

  if (!session?.session) {
    window.location.href = 'login.html';
    return false;
  }

  const { data: teacher } = await supabaseClient
    .from('teachers')
    .select('id')
    .eq('id', session.session.user.id)
    .maybeSingle();

  if (!teacher) {
    // Not a teacher — sign out and redirect
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
    return false;
  }

  return true;
}

// Sign out the current user and redirect to login.
async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

// Expose helpers for other scripts
window.qrAttendanceAuth = {
  supabaseClient,
  requireTeacher,
  signOut,
};