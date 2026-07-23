export const environment = {
  production: false,

  // ── Google OAuth Client ID ───────────────────────────────────────────────
  // 1. Google Cloud Console → create/select a project
  // 2. APIs & Services → Library → enable "Google Drive API"
  // 3. APIs & Services → OAuth consent screen → External → add yourself as a
  //    Test user (keeps the app in testing mode, no verification needed)
  // 4. APIs & Services → Credentials → Create credentials → OAuth client ID →
  //    Application type: "Web application"
  //      Authorized JavaScript origins:
  //        http://localhost:8100   (ionic serve)
  //        http://localhost:4200   (ng serve)
  // 5. Copy the Client ID (…apps.googleusercontent.com) and paste it below.
  googleClientId:
    '239533953724-leumjtiqc5363167tq6sbh28gpbj028e.apps.googleusercontent.com',
};
