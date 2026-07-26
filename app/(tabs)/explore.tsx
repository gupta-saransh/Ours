import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import {
  CalendarHeart,
  ChevronRight,
  Clapperboard,
  Flame,
  MessageCircleQuestion,
  Star,
} from 'lucide-react-native';
import { Card, ListRow, Screen, Section } from '@/components/kit';
import { colors, sp, text } from '@/theme';

/**
 * Explore: one page listing everything the app can do that is not a tab.
 *
 * Built as a flat list of single-line rows opening their own pages, exactly the
 * shape Settings uses, and for the same reason: several of these screens had no
 * permanent way in at all. Picture Night was reachable ONLY from a Home card,
 * so if that card was not showing there was genuinely no route to it. The
 * streak screen hid behind a small chip, milestones behind a Home link, and the
 * weekly recaps needed a Home row invented purely to get back to them.
 *
 * Today's Prompt and This or That KEEP their Home cards. This is a second door,
 * not a move: the daily cards are the point of Home, and the list is for when
 * you want to go looking rather than be shown.
 */
export default function Explore() {
  const router = useRouter();
  const chevron = <ChevronRight size={18} color={colors.inkFaint} strokeWidth={1.75} />;
  const icon = (Glyph: typeof Star) => <Glyph size={18} color={colors.inkMuted} strokeWidth={1.75} />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>Things to play, and everything worth keeping.</Text>

        <Section label="Play together">
          <Card>
            <ListRow
              leading={icon(Clapperboard)}
              title="Picture Night"
              caption="Two mystery movies a night, seven guesses between you"
              trailing={chevron}
              onPress={() => router.push('/picture-night')}
            />
            {/* Today's prompt already has the page shape we want for all of
                these: the live question on top, everything you have answered
                below. This or That has no page of its own yet, only its Home
                card, so it is deliberately NOT listed here rather than given a
                row that quietly lands you somewhere else. */}
            <ListRow
              leading={icon(MessageCircleQuestion)}
              title="Today's prompt"
              caption="One question a day, revealed once you both answer"
              trailing={chevron}
              onPress={() => router.push('/prompts')}
              last
            />
          </Card>
        </Section>

        <Section label="Look back">
          <Card>
            <ListRow
              leading={icon(Flame)}
              title="Your streak"
              caption="Every day you both answered, and the week's grace day"
              trailing={chevron}
              onPress={() => router.push('/streak')}
            />
            <ListRow
              leading={icon(CalendarHeart)}
              title="Weekly recaps"
              caption="The Sundays you kept"
              trailing={chevron}
              onPress={() => router.push('/reflections')}
            />
            <ListRow
              leading={icon(Star)}
              title="Milestones"
              caption="The days that matter, counting down"
              trailing={chevron}
              onPress={() => router.push('/milestones')}
              last
            />
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: sp.base,
    paddingBottom: sp.xxxl,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  intro: { ...text.bodySerif, color: colors.inkMuted, marginBottom: sp.lg },
});
