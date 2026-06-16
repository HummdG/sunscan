import { redirect } from 'next/navigation'

// Legacy shim: the old single-tenant /survey flow was replaced by the per-installer
// journey at /[installerSlug]/start. For this single-installer (HSEnergy) setup we
// redirect old links + muscle-memory to the live wizard.
export default function LegacySurveyRedirect() {
  redirect('/hsenergy/start')
}
