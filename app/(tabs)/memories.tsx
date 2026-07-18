import { Redirect } from 'expo-router';

// Memories merged into the Timeline tab. Kept as a redirect (not deleted) so a
// stale cached push notification or an old bookmark still lands somewhere real.
export default function MemoriesRedirect() {
  return <Redirect href="/timeline" />;
}
