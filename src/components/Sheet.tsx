import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors, motion, radius, sp, text } from '@/theme';

/**
 * The one modal surface. Native and narrow web: bottom sheet with a drag
 * handle, spring reveal. Web >= 900px: right side panel, 420 wide.
 * Backdrop dims to 40% ink; tap to dismiss.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  sealed = false,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  sealed?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;
  const slide = useRef(new Animated.Value(wide ? 420 : height)).current;

  useEffect(() => {
    if (visible) {
      slide.setValue(wide ? 420 : height);
      Animated.spring(slide, {
        toValue: 0,
        stiffness: motion.sheet.stiffness,
        damping: motion.sheet.damping,
        mass: 1,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, wide, height, slide]);

  if (!visible) return null;

  const surface = sealed ? colors.surfaceSealed : colors.surface;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        {wide ? (
          <Animated.View style={[styles.panel, { backgroundColor: surface, transform: [{ translateX: slide }] }]}>
            {title ? <Text style={[text.title, styles.panelTitle, sealed && { color: colors.onSealed }]}>{title}</Text> : null}
            <ScrollView contentContainerStyle={styles.panelBody} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </Animated.View>
        ) : (
          <Animated.View style={[styles.bottom, { backgroundColor: surface, transform: [{ translateY: slide }] }]}>
            <View style={[styles.handle, sealed && { backgroundColor: 'rgba(249, 239, 220, 0.35)' }]} />
            {title ? <Text style={[text.title, styles.bottomTitle, sealed && { color: colors.onSealed }]}>{title}</Text> : null}
            <ScrollView
              contentContainerStyle={styles.bottomBody}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(51, 36, 28, 0.4)',
  },
  bottom: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '88%',
    paddingTop: sp.sm,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: radius.hairline,
    backgroundColor: colors.inkFaint,
    alignSelf: 'center',
    marginBottom: sp.md,
  },
  bottomTitle: {
    paddingHorizontal: sp.xl,
    marginBottom: sp.md,
  },
  bottomBody: {
    paddingHorizontal: sp.xl,
    paddingBottom: sp.xxxl,
  },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 420,
    borderLeftWidth: 1,
    borderLeftColor: colors.hairline,
    paddingTop: sp.xxl,
  },
  panelTitle: {
    paddingHorizontal: sp.xl,
    marginBottom: sp.md,
  },
  panelBody: {
    paddingHorizontal: sp.xl,
    paddingBottom: sp.xxl,
  },
});
