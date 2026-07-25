import React, { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Bell, Check } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { disableWebPush, enableWebPush } from '@/lib/push-web';
import { Card, FormError, ListRow, Screen, SecondaryButton, SubScreenHeader } from '@/components/kit';
import { colors, sp } from '@/theme';

/** What the server can see about this account's notification delivery. */
interface PushStatus {
  serverConfigured: boolean;
  notificationsEnabled: boolean;
  hasSubscription: boolean;
  endpointHost: string | null;
}

/** Turn the server's machine-readable failure into something a person can act on. */
function reasonCopy(reason?: string): string {
  switch (reason) {
    case 'notifications-off':
      return 'Notifications are turned off for your account.';
    case 'no-subscription':
      return 'This device has not signed up yet. Turn the switch off, then on again.';
    case 'vapid-not-configured':
      return 'The server is missing its notification keys.';
    case 'subscription-expired':
      return 'This device signed up a while ago and it has lapsed. Turn the switch off, then on again.';
    case 'send-failed':
      return 'The notification service turned it away. The logs have the details.';
    case 'native-not-provisioned':
      return 'This build cannot receive them. Use Ours from your home screen.';
    default:
      return 'Could not send it.';
  }
}

export default function NotificationSettings() {
  const { status, user, updateProfile } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [testingPush, setTestingPush] = useState(false);

  const loadPushStatus = useCallback(() => {
    api<PushStatus>('/api/push/subscribe')
      .then(setPushStatus)
      .catch(() => setPushStatus(null));
  }, []);
  useEffect(loadPushStatus, [loadPushStatus]);

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;

  const sendTestPush = async () => {
    setPushResult(null);
    setTestingPush(true);
    try {
      const result = await api<{ delivered: boolean; reason?: string }>('/api/push/subscribe', {
        method: 'POST',
        body: { test: true },
      });
      setPushResult(result.delivered ? 'Sent. It should arrive in a moment.' : reasonCopy(result.reason));
    } catch (err: any) {
      setPushResult(err?.message ?? 'Could not send it.');
    } finally {
      setTestingPush(false);
      loadPushStatus();
    }
  };

  // The switch must show DELIVERY, not intent (see notify.ts session-log notes).
  const notificationsOn =
    Platform.OS === 'web' && pushStatus
      ? pushStatus.notificationsEnabled && pushStatus.hasSubscription
      : user?.notifications_enabled ?? true;

  const pushLine =
    pushResult ??
    (pushStatus === null
      ? 'Checking this device.'
      : !pushStatus.serverConfigured
        ? 'Notifications are not set up on the server yet.'
        : !pushStatus.notificationsEnabled
          ? 'Turn the switch on to start getting them.'
          : !pushStatus.hasSubscription
            ? 'This device is not signed up yet. Turn the switch on, and allow notifications when your browser asks.'
            : 'This device is signed up. Send one to be sure.');

  const toggleNotifications = async (value: boolean) => {
    setError(null);
    setPushResult(null);
    try {
      await updateProfile({ notificationsEnabled: value });
      if (Platform.OS === 'web') {
        if (value) await enableWebPush();
        else await disableWebPush();
      }
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      loadPushStatus();
    }
  };

  return (
    <Screen>
      <SubScreenHeader title="Notifications" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <FormError message={error} />
        <Card>
          <ListRow
            leading={<Bell size={18} color={colors.inkMuted} strokeWidth={1.75} />}
            title="Nudges and new notes"
            caption="Get them even when Ours is closed. On iPhone, add Ours to your home screen first."
            trailing={
              <Switch
                value={notificationsOn}
                onValueChange={toggleNotifications}
                trackColor={{ true: colors.blush, false: colors.hairline }}
                thumbColor={notificationsOn ? colors.surfaceSealed : '#FFFFFF'}
              />
            }
          />
          {/* Delivery has several moving parts (server keys, browser
              permission, a subscription that can quietly expire). This asks
              the server what it sees, and can send a real one to prove it. */}
          <ListRow
            leading={<Check size={18} color={colors.inkMuted} strokeWidth={1.75} />}
            title="Check they are working"
            caption={pushLine}
            trailing={<SecondaryButton title="Send a test" onPress={sendTestPush} loading={testingPush} />}
            last
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: sp.lg,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
});
