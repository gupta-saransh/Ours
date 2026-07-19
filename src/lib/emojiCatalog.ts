/**
 * The chat reaction/message emoji keyboard's data. Categorized for browsing
 * (every emoji below is real and pickable) plus a curated keyword index for
 * search covering the emoji people actually type "heart", "laugh", "pizza"
 * for; less common glyphs are still reachable by browsing their category even
 * though they are not in the search index. Framework-free so it stays cheap
 * to import from anywhere, including tests.
 */

export interface EmojiCategory {
  name: string;
  /** One representative glyph, used as the tab's own icon. */
  icon: string;
  emoji: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    name: 'Smileys',
    icon: '😀',
    emoji: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '😍', '🤩', '😘', '😗', '😚', '😙', '😋',
      '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐',
      '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌',
      '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧',
      '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐',
      '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧',
      '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓',
      '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀',
      '🤡', '👻', '👽', '🤖', '🙈', '🙉', '🙊',
    ],
  },
  {
    name: 'Hearts',
    icon: '❤️',
    emoji: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌',
      '💋', '🥰', '💑', '💏', '🌹',
    ],
  },
  {
    name: 'Gestures',
    icon: '👋',
    emoji: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞',
      '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎',
      '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🙏', '✍️',
      '💅', '🤳', '💪', '👂', '👃', '👀', '👄',
    ],
  },
  {
    name: 'Animals & Nature',
    icon: '🐶',
    emoji: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🐒', '🐔', '🐧', '🐦',
      '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝',
      '🐛', '🦋', '🐌', '🐞', '🐜', '🕷️', '🐢', '🐍', '🦎', '🐙',
      '🦑', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊',
      '🐅', '🐆', '🦓', '🐘', '🐪', '🦒', '🐕', '🐈', '🐓', '🦃',
      '🐇', '🐁', '🐿️', '🦔', '🌵', '🌲', '🌳', '🌴', '🌱', '🌿',
      '☘️', '🍀', '🍃', '🍂', '🍁', '🌾', '🌷', '🌺', '🌸', '🌼',
      '🌻', '🌞', '🌝', '🌙', '🌎', '⭐', '🌟', '✨', '⚡', '🔥',
      '🌈', '☀️', '⛅', '☁️', '❄️', '⛄', '💧', '☔',
    ],
  },
  {
    name: 'Food & Drink',
    icon: '🍏',
    emoji: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍈',
      '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦',
      '🥕', '🌽', '🥔', '🍠', '🥐', '🍞', '🥖', '🧀', '🥚', '🍳',
      '🥞', '🥓', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🥪', '🌮',
      '🌯', '🥗', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🍤', '🍙',
      '🍚', '🍘', '🍥', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁',
      '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰',
      '🥜', '🍯', '🥛', '☕', '🍵', '🥤', '🍶', '🍺', '🍻', '🥂',
      '🍷', '🥃', '🍸', '🍹', '🍾',
    ],
  },
  {
    name: 'Activities',
    icon: '⚽',
    emoji: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🎱', '🏓', '🏸',
      '🏒', '🏑', '🏏', '⛳', '🏹', '🎣', '🥊', '🥋', '🎽', '🛹',
      '🎿', '🏂', '🏋️', '🤸', '🤺', '🏌️', '🏇', '🧘', '🏄', '🏊',
      '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🎗️', '🎪', '🎭',
      '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸',
      '🎻', '🎲', '🎯', '🎳', '🎮', '🎰', '🧩',
    ],
  },
  {
    name: 'Travel & Places',
    icon: '🚗',
    emoji: [
      '🚗', '🚕', '🚙', '🚌', '🚓', '🚑', '🚒', '🚚', '🚲', '🛴',
      '🚨', '✈️', '🛫', '🛬', '🚀', '🛸', '🚁', '⛵', '🚢', '⚓',
      '🗺️', '🗽', '🗼', '🏰', '🎡', '🎢', '🎠', '⛲', '🏖️', '🏝️',
      '🏜️', '🌋', '⛰️', '🏔️', '⛺', '🏠', '🏡', '🏢', '🏥', '🏦',
      '🏨', '🏫', '⛪', '🕌', '🛕',
    ],
  },
  {
    name: 'Objects',
    icon: '📱',
    emoji: [
      '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💾', '💿', '📷', '📸',
      '📹', '🎥', '☎️', '📞', '📺', '📻', '⏰', '⏱️', '⌛', '⏳',
      '🔋', '🔌', '💡', '🔦', '🕯️', '💰', '💵', '💳', '💎', '🔧',
      '🔨', '🛠️', '🔩', '⚙️', '🔫', '🔪', '💊', '💉', '🧻', '🚽',
      '🚿', '🛁', '🔑', '🚪', '🛏️', '🎁', '🎈', '🎀', '🎊', '🎉',
      '✉️', '📧', '📦', '📅', '📌', '✂️', '📝', '✏️', '🔍', '🔒',
      '🔓', '📚', '📖', '🔖', '🔗',
    ],
  },
  {
    name: 'Symbols',
    icon: '✅',
    emoji: [
      '✅', '❌', '❓', '❗', '‼️', '💯', '🔴', '🟠', '🟡', '🟢',
      '🔵', '🟣', '⚪', '⚫', '🔶', '🔷', '🔺', '🔻', '♻️', '⚠️',
      '🚫', '♾️', '✳️', '✴️', '❇️', '💠', '🌀', '☯️', '☮️', '⛎',
      '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑',
      '♒', '♓',
    ],
  },
];

/** Common search terms -> emoji. Not exhaustive; the rest live in their category. */
const SEARCH_INDEX: { emoji: string; keywords: string }[] = [
  { emoji: '😀', keywords: 'grin happy smile' },
  { emoji: '😂', keywords: 'laugh lol funny crying laughing' },
  { emoji: '🤣', keywords: 'laugh rofl funny' },
  { emoji: '😍', keywords: 'love heart eyes crush' },
  { emoji: '🥰', keywords: 'love hearts adore smiling' },
  { emoji: '😘', keywords: 'kiss love' },
  { emoji: '😉', keywords: 'wink' },
  { emoji: '😊', keywords: 'smile happy blush' },
  { emoji: '🙂', keywords: 'smile slight' },
  { emoji: '😇', keywords: 'angel innocent halo' },
  { emoji: '🤗', keywords: 'hug' },
  { emoji: '🤔', keywords: 'think thinking hmm' },
  { emoji: '😴', keywords: 'sleep tired sleepy' },
  { emoji: '😷', keywords: 'sick mask ill' },
  { emoji: '🤒', keywords: 'sick fever ill' },
  { emoji: '🥳', keywords: 'party celebrate birthday' },
  { emoji: '😎', keywords: 'cool sunglasses' },
  { emoji: '😢', keywords: 'sad cry tear' },
  { emoji: '😭', keywords: 'sad cry sobbing bawling' },
  { emoji: '😱', keywords: 'shock scream scared' },
  { emoji: '😡', keywords: 'angry mad' },
  { emoji: '🤬', keywords: 'angry swearing furious' },
  { emoji: '😳', keywords: 'blush shocked embarrassed' },
  { emoji: '🥺', keywords: 'pleading puppy eyes please' },
  { emoji: '💀', keywords: 'skull dead dying' },
  { emoji: '👻', keywords: 'ghost spooky' },
  { emoji: '🤖', keywords: 'robot bot' },
  { emoji: '❤️', keywords: 'heart love red' },
  { emoji: '🧡', keywords: 'heart orange' },
  { emoji: '💛', keywords: 'heart yellow' },
  { emoji: '💚', keywords: 'heart green' },
  { emoji: '💙', keywords: 'heart blue' },
  { emoji: '💜', keywords: 'heart purple' },
  { emoji: '🖤', keywords: 'heart black' },
  { emoji: '🤍', keywords: 'heart white' },
  { emoji: '💔', keywords: 'heartbreak broken heart' },
  { emoji: '💕', keywords: 'love hearts two' },
  { emoji: '💖', keywords: 'heart sparkle love' },
  { emoji: '💘', keywords: 'heart arrow cupid' },
  { emoji: '💌', keywords: 'love letter' },
  { emoji: '💋', keywords: 'kiss lips' },
  { emoji: '💑', keywords: 'couple love' },
  { emoji: '🌹', keywords: 'rose flower love' },
  { emoji: '👋', keywords: 'wave hello hi bye' },
  { emoji: '👌', keywords: 'ok okay perfect' },
  { emoji: '✌️', keywords: 'peace victory' },
  { emoji: '🤞', keywords: 'fingers crossed hope luck' },
  { emoji: '👍', keywords: 'thumbs up yes good like' },
  { emoji: '👎', keywords: 'thumbs down no bad dislike' },
  { emoji: '👏', keywords: 'clap applause' },
  { emoji: '🙌', keywords: 'praise hooray celebrate raised hands' },
  { emoji: '🙏', keywords: 'pray please thanks thank you' },
  { emoji: '💪', keywords: 'muscle strong flex' },
  { emoji: '🐶', keywords: 'dog puppy' },
  { emoji: '🐱', keywords: 'cat kitten' },
  { emoji: '🐻', keywords: 'bear' },
  { emoji: '🦄', keywords: 'unicorn' },
  { emoji: '🐢', keywords: 'turtle slow' },
  { emoji: '🌵', keywords: 'cactus plant' },
  { emoji: '🌷', keywords: 'tulip flower' },
  { emoji: '🌸', keywords: 'blossom flower cherry' },
  { emoji: '🌻', keywords: 'sunflower flower' },
  { emoji: '⭐', keywords: 'star' },
  { emoji: '✨', keywords: 'sparkle shiny stars' },
  { emoji: '🔥', keywords: 'fire lit hot' },
  { emoji: '🌈', keywords: 'rainbow' },
  { emoji: '☀️', keywords: 'sun sunny' },
  { emoji: '☔', keywords: 'rain umbrella' },
  { emoji: '❄️', keywords: 'snow snowflake cold' },
  { emoji: '🍕', keywords: 'pizza food' },
  { emoji: '🍔', keywords: 'burger food' },
  { emoji: '🍟', keywords: 'fries food' },
  { emoji: '🌮', keywords: 'taco food' },
  { emoji: '🍜', keywords: 'noodles ramen food' },
  { emoji: '🍣', keywords: 'sushi food' },
  { emoji: '🍦', keywords: 'ice cream dessert' },
  { emoji: '🍰', keywords: 'cake slice dessert' },
  { emoji: '🎂', keywords: 'birthday cake' },
  { emoji: '🍫', keywords: 'chocolate' },
  { emoji: '🍿', keywords: 'popcorn movie' },
  { emoji: '☕', keywords: 'coffee' },
  { emoji: '🍵', keywords: 'tea' },
  { emoji: '🍺', keywords: 'beer drink' },
  { emoji: '🍷', keywords: 'wine drink' },
  { emoji: '🥂', keywords: 'cheers toast champagne celebrate' },
  { emoji: '⚽', keywords: 'soccer football' },
  { emoji: '🏀', keywords: 'basketball' },
  { emoji: '🏆', keywords: 'trophy win winner' },
  { emoji: '🎉', keywords: 'party celebrate confetti' },
  { emoji: '🎊', keywords: 'confetti party celebrate' },
  { emoji: '🎁', keywords: 'gift present' },
  { emoji: '🎈', keywords: 'balloon party' },
  { emoji: '🎮', keywords: 'game controller gaming' },
  { emoji: '🎵', keywords: 'music note' },
  { emoji: '🎸', keywords: 'guitar music' },
  { emoji: '📷', keywords: 'camera photo' },
  { emoji: '📱', keywords: 'phone mobile' },
  { emoji: '💻', keywords: 'laptop computer' },
  { emoji: '💰', keywords: 'money bag cash' },
  { emoji: '💎', keywords: 'diamond gem' },
  { emoji: '💡', keywords: 'idea light bulb' },
  { emoji: '🔒', keywords: 'lock locked secure' },
  { emoji: '🔑', keywords: 'key' },
  { emoji: '⏰', keywords: 'alarm clock time' },
  { emoji: '✅', keywords: 'check done yes correct' },
  { emoji: '❌', keywords: 'x no wrong cross' },
  { emoji: '❓', keywords: 'question mark' },
  { emoji: '❗', keywords: 'exclamation mark' },
  { emoji: '💯', keywords: 'hundred perfect' },
  { emoji: '⚠️', keywords: 'warning caution' },
  { emoji: '🚗', keywords: 'car' },
  { emoji: '✈️', keywords: 'plane flight travel' },
  { emoji: '🚀', keywords: 'rocket launch' },
  { emoji: '🏠', keywords: 'house home' },
  { emoji: '🏖️', keywords: 'beach vacation' },
  { emoji: '⛰️', keywords: 'mountain' },
];

/** Substring match over the curated index; returns unique emoji, best matches first. */
export function searchEmoji(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of SEARCH_INDEX) {
    if (entry.keywords.includes(q) && !seen.has(entry.emoji)) {
      seen.add(entry.emoji);
      out.push(entry.emoji);
    }
  }
  return out;
}
