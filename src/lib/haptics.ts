import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** Selection tick: tab changes, segmented controls. Never on scroll or typing. */
export function tapHaptic() {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => {});
}

/** Success thud: submitting an answer, hearting, accepting a date, unsealing. */
export function successHaptic() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
