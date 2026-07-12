import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { colors, font, space, type } from '@/theme';

export default function Welcome() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.mark}>♥</Text>
        <Text style={styles.title}>Ours</Text>
        <Text style={styles.promise}>
          A quiet little corner of the internet{'\n'}for just the two of you.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button title="Create your account" onPress={() => router.push('/sign-up')} />
        <View style={{ height: space(3) }} />
        <Button title="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cream,
    paddingHorizontal: space(7),
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    fontSize: 28,
    color: colors.rose,
    marginBottom: space(4),
  },
  title: {
    fontFamily: font.display,
    fontSize: 56,
    color: colors.ink,
    letterSpacing: -1,
  },
  promise: {
    marginTop: space(4),
    fontFamily: font.serifItalic,
    fontSize: type.heading,
    lineHeight: 30,
    color: colors.inkSoft,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    paddingBottom: space(12),
  },
});
