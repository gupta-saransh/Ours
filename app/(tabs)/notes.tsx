import { Redirect } from 'expo-router';

// Notes merged into the Timeline tab. Kept as a redirect (not deleted) so a
// stale cached push notification or an old bookmark still lands somewhere real.
export default function NotesRedirect() {
  return <Redirect href="/timeline" />;
}
