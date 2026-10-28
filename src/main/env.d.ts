// Google OAuth "Desktop app" client, baked in at build time from .env
// (see .env.example). Desktop client secrets aren't confidential by Google's
// own definition; they only identify the app.
interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
