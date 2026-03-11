import chatService from '../services/chat.js';
import serverService from '../services/server.js';
import { escapeHtml } from './chat-markdown.js';

export const COMMON_REACTIONS = ['👍', '👎', '❤️', '😂', '😮', '😢', '🎉', '🔥'];

// Emoji name mapping for search
const EMOJI_NAMES = {
  '😀': 'grinning face happy', '😃': 'smiley happy', '😄': 'smile happy', '😁': 'grin beaming', '😆': 'laughing satisfied', '😅': 'sweat smile nervous',
  '🤣': 'rofl rolling floor laughing', '😂': 'joy tears laughing cry', '🙂': 'slightly smiling', '🙃': 'upside down', '😉': 'wink', '😊': 'blush happy shy',
  '😇': 'innocent angel halo', '🥰': 'smiling hearts love', '😍': 'heart eyes love', '🤩': 'star struck excited', '😘': 'kissing heart blow kiss',
  '😗': 'kissing', '😚': 'kissing closed eyes', '😙': 'kissing smiling', '🥲': 'smiling tear sad happy', '😋': 'yum delicious tongue',
  '😛': 'tongue out', '😜': 'wink tongue crazy', '🤪': 'zany crazy wild', '😝': 'squinting tongue', '🤑': 'money mouth rich',
  '🤗': 'hugging hug', '🤭': 'hand over mouth oops giggle', '🤫': 'shushing quiet secret', '🤔': 'thinking hmm', '🫡': 'salute',
  '🤐': 'zipper mouth shut up', '🤨': 'raised eyebrow skeptical', '😐': 'neutral face', '😑': 'expressionless', '😶': 'no mouth silent',
  '🫥': 'dotted line face hidden', '😏': 'smirk', '😒': 'unamused annoyed', '🙄': 'rolling eyes', '😬': 'grimacing awkward',
  '🤥': 'lying pinocchio', '😌': 'relieved peaceful', '😔': 'pensive sad thoughtful', '😪': 'sleepy tired', '🤤': 'drooling',
  '😴': 'sleeping zzz', '😷': 'mask sick medical', '🤒': 'thermometer fever sick', '🤕': 'bandage hurt injured', '🤢': 'nauseated sick green',
  '🤮': 'vomiting sick throw up', '🥵': 'hot face sweating', '🥶': 'cold face freezing', '🥴': 'woozy drunk', '😵': 'dizzy knocked out',
  '🤯': 'exploding head mind blown', '🤠': 'cowboy hat', '🥳': 'party celebration', '🥸': 'disguise glasses nose',
  '😎': 'sunglasses cool', '🤓': 'nerd glasses', '🧐': 'monocle curious', '😕': 'confused', '🫤': 'diagonal mouth',
  '😟': 'worried', '🙁': 'slightly frowning', '☹️': 'frowning sad', '😮': 'open mouth surprised wow', '😯': 'hushed',
  '😲': 'astonished shocked', '😳': 'flushed embarrassed', '🥺': 'pleading puppy eyes', '🥹': 'holding back tears',
  '😦': 'frowning open mouth', '😧': 'anguished', '😨': 'fearful scared', '😰': 'anxious sweat', '😥': 'sad relieved',
  '😢': 'crying tear sad', '😭': 'sobbing crying loud', '😱': 'screaming fear horror', '😖': 'confounded',
  '😣': 'persevering determined', '😞': 'disappointed sad', '😓': 'downcast sweat', '😩': 'weary tired', '😫': 'tired exhausted',
  '🥱': 'yawning bored tired', '😤': 'huffing angry triumph', '😡': 'pouting angry mad', '😠': 'angry mad',
  '🤬': 'swearing cursing symbols', '😈': 'smiling devil horns', '👿': 'angry devil', '💀': 'skull dead death',
  '☠️': 'skull crossbones death poison', '💩': 'poop poo shit', '🤡': 'clown', '👹': 'ogre monster', '👺': 'goblin tengu',
  '👻': 'ghost boo halloween', '👽': 'alien ufo', '👾': 'space invader game alien', '🤖': 'robot', '😺': 'smiling cat',
  '😸': 'grinning cat', '😹': 'cat joy tears', '😻': 'heart eyes cat love', '😼': 'smirk cat', '😽': 'kissing cat',
  '🙀': 'weary cat shocked', '😿': 'crying cat sad', '😾': 'pouting cat angry',
  '👋': 'wave hello hi bye', '🤚': 'raised back hand', '🖐️': 'hand splayed fingers', '✋': 'raised hand stop high five',
  '🖖': 'vulcan spock', '👌': 'ok okay perfect', '🤌': 'pinched fingers italian', '🤏': 'pinching small tiny',
  '✌️': 'peace victory two', '🤞': 'crossed fingers luck hope', '🤟': 'love you gesture rock',
  '🤘': 'rock on horns metal', '🤙': 'call me shaka hang loose', '👈': 'pointing left', '👉': 'pointing right',
  '👆': 'pointing up', '🖕': 'middle finger', '👇': 'pointing down', '☝️': 'index pointing up',
  '👍': 'thumbs up like good yes', '👎': 'thumbs down dislike bad no', '✊': 'raised fist power',
  '👊': 'fist bump punch', '🤛': 'left fist bump', '🤜': 'right fist bump', '👏': 'clap clapping applause bravo',
  '🙌': 'raising hands celebration hooray', '👐': 'open hands', '🤲': 'palms up together',
  '🤝': 'handshake deal agreement', '🙏': 'pray please thank you folded hands', '💪': 'muscle strong bicep flex',
  '❤️': 'red heart love', '🧡': 'orange heart', '💛': 'yellow heart', '💚': 'green heart', '💙': 'blue heart',
  '💜': 'purple heart', '🖤': 'black heart', '🤍': 'white heart', '🤎': 'brown heart', '💔': 'broken heart',
  '❤️‍🔥': 'heart fire burning', '❤️‍🩹': 'mending heart healing', '❣️': 'heart exclamation', '💕': 'two hearts love',
  '💞': 'revolving hearts', '💓': 'beating heart', '💗': 'growing heart', '💖': 'sparkling heart', '💘': 'heart arrow cupid',
  '💝': 'heart ribbon gift', '💟': 'heart decoration',
  '🐶': 'dog puppy', '🐱': 'cat kitty', '🐭': 'mouse', '🐹': 'hamster', '🐰': 'rabbit bunny', '🦊': 'fox',
  '🐻': 'bear', '🐼': 'panda', '🐨': 'koala', '🐯': 'tiger', '🦁': 'lion', '🐮': 'cow', '🐷': 'pig', '🐸': 'frog',
  '🐵': 'monkey', '🙈': 'see no evil monkey', '🙉': 'hear no evil monkey', '🙊': 'speak no evil monkey',
  '🐔': 'chicken', '🐧': 'penguin', '🐦': 'bird', '🦅': 'eagle', '🦉': 'owl', '🐺': 'wolf', '🐴': 'horse',
  '🦄': 'unicorn magic', '🐝': 'bee honey', '🦋': 'butterfly', '🐢': 'turtle tortoise', '🐍': 'snake',
  '🐙': 'octopus', '🐬': 'dolphin', '🐳': 'whale', '🦈': 'shark', '🐘': 'elephant', '🦒': 'giraffe',
  '🌵': 'cactus', '🎄': 'christmas tree', '🌲': 'evergreen tree', '🌳': 'tree', '🌴': 'palm tree',
  '🌱': 'seedling sprout', '🌿': 'herb leaf', '🍀': 'four leaf clover lucky', '🌺': 'hibiscus flower',
  '🌻': 'sunflower', '🌹': 'rose flower', '🌷': 'tulip', '🌼': 'blossom', '🌸': 'cherry blossom sakura',
  '💐': 'bouquet flowers', '🌈': 'rainbow',
  '🍇': 'grapes', '🍉': 'watermelon', '🍊': 'orange tangerine', '🍋': 'lemon', '🍌': 'banana', '🍍': 'pineapple',
  '🍎': 'apple red', '🍏': 'apple green', '🍑': 'peach', '🍒': 'cherries', '🍓': 'strawberry',
  '🍔': 'hamburger burger', '🍟': 'fries french fries', '🍕': 'pizza', '🌭': 'hot dog', '🌮': 'taco',
  '🌯': 'burrito', '🍳': 'cooking egg fried', '🍲': 'pot food stew', '🍿': 'popcorn', '🍩': 'donut doughnut',
  '🍪': 'cookie', '🎂': 'birthday cake', '🍰': 'cake shortcake', '🍫': 'chocolate', '🍬': 'candy sweet',
  '🍭': 'lollipop', '🍦': 'ice cream', '☕': 'coffee hot beverage', '🍵': 'tea', '🍶': 'sake',
  '🍾': 'champagne bottle celebration', '🍷': 'wine glass', '🍸': 'cocktail martini', '🍺': 'beer mug',
  '🍻': 'clinking beers cheers', '🥂': 'clinking glasses champagne toast cheers',
  '⚽': 'soccer football', '🏀': 'basketball', '🏈': 'football american', '⚾': 'baseball', '🎾': 'tennis',
  '🏐': 'volleyball', '🏉': 'rugby', '🎱': 'billiards pool', '🏓': 'ping pong table tennis',
  '⛳': 'golf', '🏹': 'bow arrow archery', '🎣': 'fishing', '🥊': 'boxing glove', '🎽': 'running shirt',
  '🛹': 'skateboard', '⛸️': 'ice skating', '🎿': 'skiing', '🏂': 'snowboard', '🏆': 'trophy winner champion',
  '🥇': 'gold medal first', '🥈': 'silver medal second', '🥉': 'bronze medal third', '🏅': 'medal sports',
  '🎪': 'circus tent', '🎭': 'theater drama masks', '🎨': 'art palette painting', '🎬': 'movie clapper film',
  '🎤': 'microphone karaoke sing', '🎧': 'headphones music', '🎼': 'music score', '🎹': 'piano keyboard',
  '🥁': 'drum', '🎷': 'saxophone jazz', '🎺': 'trumpet', '🎸': 'guitar rock', '🎻': 'violin',
  '🎲': 'dice game', '🎯': 'bullseye target dart', '🎮': 'video game controller', '🕹️': 'joystick arcade',
  '🧩': 'puzzle piece jigsaw',
  '🚗': 'car automobile', '🚕': 'taxi cab', '🚌': 'bus', '🏎️': 'racing car', '🚓': 'police car',
  '🚑': 'ambulance', '🚒': 'fire truck', '🚚': 'delivery truck', '🚜': 'tractor', '🏍️': 'motorcycle',
  '🚲': 'bicycle bike', '✈️': 'airplane plane', '🚀': 'rocket space launch', '🛸': 'ufo flying saucer',
  '🚁': 'helicopter', '⛵': 'sailboat', '🚤': 'speedboat', '🚢': 'ship', '🏠': 'house home',
  '🏢': 'office building', '🏥': 'hospital', '🏫': 'school', '🏰': 'castle', '⛪': 'church',
  '📱': 'phone mobile smartphone', '💻': 'laptop computer', '⌨️': 'keyboard', '🖥️': 'desktop computer monitor',
  '🖨️': 'printer', '📷': 'camera photo', '📹': 'video camera', '📺': 'television tv', '📻': 'radio',
  '⏰': 'alarm clock time', '⌛': 'hourglass time', '💡': 'light bulb idea', '🔋': 'battery',
  '🔌': 'plug electric', '💰': 'money bag rich', '💳': 'credit card', '💎': 'gem diamond jewel',
  '🔧': 'wrench tool', '🔨': 'hammer tool', '🔩': 'nut bolt', '⚙️': 'gear settings', '🔫': 'gun water pistol',
  '💣': 'bomb explosive', '🔪': 'knife', '🛡️': 'shield', '🔮': 'crystal ball magic', '🧿': 'evil eye nazar',
  '💊': 'pill medicine', '💉': 'syringe needle vaccine', '🧬': 'dna', '🔬': 'microscope science',
  '🔭': 'telescope', '🧹': 'broom', '🚽': 'toilet', '🛁': 'bathtub bath',
  '🎉': 'party popper tada celebration confetti', '🔥': 'fire hot lit flame', '✨': 'sparkles stars magic glitter',
  '⭐': 'star', '🌟': 'glowing star', '💫': 'dizzy star', '☀️': 'sun sunny', '🌙': 'moon crescent night',
  '💤': 'sleeping zzz', '🏁': 'checkered flag finish race', '🚩': 'red flag', '🏴': 'black flag',
  '🏳️': 'white flag', '🏳️‍🌈': 'rainbow flag pride lgbtq', '🏴‍☠️': 'pirate flag',
  '🇩🇪': 'germany flag de', '🇦🇹': 'austria flag at', '🇨🇭': 'switzerland flag ch', '🇺🇸': 'usa america flag us',
  '🇬🇧': 'uk britain flag gb', '🇫🇷': 'france flag fr', '🇪🇸': 'spain flag es', '🇮🇹': 'italy flag it',
  '🇯🇵': 'japan flag jp', '🇨🇳': 'china flag cn', '🇷🇺': 'russia flag ru', '🇧🇷': 'brazil flag br',
  '🇮🇳': 'india flag in', '🇦🇺': 'australia flag au', '🇨🇦': 'canada flag ca', '🇺🇦': 'ukraine flag ua',
  '✅': 'check mark yes done', '❌': 'cross mark no wrong', '⭕': 'circle', '🛑': 'stop sign',
  '⛔': 'no entry forbidden', '🚫': 'prohibited banned', '💯': 'hundred perfect score', '♻️': 'recycling recycle',
  '⚠️': 'warning caution', 'ℹ️': 'information info', '❗': 'exclamation mark important', '❓': 'question mark',
  '👀': 'eyes looking watching', '👁️': 'eye', '👅': 'tongue', '👄': 'mouth lips', '👶': 'baby',
  '🧑': 'person adult', '👨': 'man', '👩': 'woman', '🧓': 'older person', '👴': 'old man', '👵': 'old woman',
  '🫶': 'heart hands love', '🫵': 'pointing at you',
  '⚔️': 'crossed swords battle fight', '🗡️': 'dagger knife sword',
  '🪙': 'coin money', '💵': 'dollar money bill', '💶': 'euro money', '💷': 'pound money',
  '🎫': 'ticket', '🎟️': 'admission ticket', '🎗️': 'ribbon awareness', '🎖️': 'military medal',
  '🏵️': 'rosette flower'
};

const EMOJI_CATEGORIES = [
  { id: 'frequent', icon: '🕒', name: 'Frequently Used', emojis: [] },
  {
    id: 'smileys', icon: '😀', name: 'Smileys', emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
      '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑', '😶', '🫥', '😏', '😒',
      '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳',
      '🥸', '😎', '🤓', '🧐', '😕', '🫤', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '🥹', '😦', '😧', '😨', '😰', '😥',
      '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡',
      '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'
    ]
  },
  {
    id: 'people', icon: '👋', name: 'People', emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '🫳', '🫴', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉',
      '👆', '🖕', '👇', '☝️', '🫵', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝', '🙏', '✍️', '💅',
      '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄', '🫦',
      '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵'
    ]
  },
  {
    id: 'animals', icon: '🐶', name: 'Animals & Nature', emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊',
      '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌',
      '🐞', '🐜', '🪲', '🪳', '🦟', '🦗', '🕷️', '🕸️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡',
      '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🪸', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘',
      '🌵', '🎄', '🌲', '🌳', '🌴', '🪵', '🌱', '🌿', '☘️', '🍀', '🎍', '🪴', '🎋', '🍃', '🍂', '🍁', '🌾', '🌺', '🌻', '🌹',
      '🥀', '🌷', '🌼', '🌸', '💐', '🍄', '🌰', '🎃', '🐚', '🪨', '🌎', '🌍', '🌏', '🌕', '🌙', '⭐', '🌟', '💫', '✨', '☀️', '🌈'
    ]
  },
  {
    id: 'food', icon: '🍕', name: 'Food & Drink', emojis: [
      '🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🫐', '🥝', '🍅', '🫒', '🥥',
      '🥑', '🍆', '🥔', '🥕', '🌽', '🌶️', '🫑', '🥒', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🫘', '🌰', '🍞', '🥐', '🥖',
      '🫓', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🫔', '🥙',
      '🧆', '🥚', '🍳', '🥘', '🍲', '🫕', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝',
      '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦀', '🦞', '🦐', '🦑', '🦪', '🍦', '🍧', '🍨', '🍩',
      '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '🍼', '🥛', '☕', '🫖', '🍵', '🍶', '🍾', '🍷', '🍸',
      '🍹', '🍺', '🍻', '🥂', '🥃', '🫗', '🥤', '🧋', '🧃', '🧉', '🧊'
    ]
  },
  {
    id: 'activities', icon: '⚽', name: 'Activities', emojis: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🥍', '🏑', '🥅', '⛳', '🪃', '🏹',
      '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾',
      '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️',
      '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻', '🎲', '♟️',
      '🎯', '🎳', '🎮', '🕹️', '🧩'
    ]
  },
  {
    id: 'travel', icon: '🚗', name: 'Travel', emojis: [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🛺',
      '🚔', '🚍', '🚘', '🚖', '🛞', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊',
      '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '🪝',
      '⛽', '🚧', '🚦', '🚥', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️',
      '🌋', '⛰️', '🏔️', '🗻', '🏕️', '🛖', '🏠', '🏡', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒',
      '🏛️', '⛪', '🕌', '🕍', '🛕', '🕋', '⛩️'
    ]
  },
  {
    id: 'objects', icon: '💡', name: 'Objects', emojis: [
      '⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹',
      '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳',
      '📡', '🔋', '🪫', '🔌', '💡', '🔦', '🕯️', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️',
      '🪜', '🧰', '🪛', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓',
      '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '🪬', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩻',
      '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀',
      '🪥', '🪒', '🧴', '🧷', '🧹', '🧺', '🪣', '🧼', '🫧', '🪥', '🧽', '🧯', '🛒', '🚬'
    ]
  },
  {
    id: 'symbols', icon: '❤️', name: 'Symbols', emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝',
      '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎',
      '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮',
      '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯',
      '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸',
      '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗',
      '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠',
      '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢',
      '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️',
      '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🔚', '🔛', '🔜', '🔝'
    ]
  },
  {
    id: 'flags', icon: '🏁', name: 'Flags', emojis: [
      '🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️',
      '🇩🇪', '🇦🇹', '🇨🇭', '🇺🇸', '🇬🇧', '🇫🇷', '🇪🇸', '🇮🇹', '🇵🇹', '🇧🇷', '🇯🇵', '🇰🇷', '🇨🇳', '🇷🇺',
      '🇮🇳', '🇦🇺', '🇨🇦', '🇲🇽', '🇳🇱', '🇧🇪', '🇸🇪', '🇳🇴', '🇩🇰', '🇫🇮', '🇵🇱', '🇨🇿', '🇭🇺', '🇷🇴',
      '🇬🇷', '🇹🇷', '🇮🇱', '🇸🇦', '🇦🇪', '🇿🇦', '🇪🇬', '🇳🇬', '🇰🇪', '🇦🇷', '🇨🇴', '🇨🇱', '🇵🇪', '🇻🇪',
      '🇹🇭', '🇻🇳', '🇵🇭', '🇮🇩', '🇲🇾', '🇸🇬', '🇳🇿', '🇮🇪', '🇺🇦', '🇭🇷'
    ]
  }
];

let reactionFreqCache = [];

/**
 * @returns {Promise<void>}
 */
async function loadReactionFrequent() {
  const settings = await window.gimodi.settings.load() || {};
  reactionFreqCache = settings.reactionFrequentEmojis || [];
}

/** @returns {string[]} */
function getFrequentEmojis() {
  return reactionFreqCache.slice(0, 24);
}

/** @param {string} emoji */
async function trackEmojiUsage(emoji) {
  reactionFreqCache = reactionFreqCache.filter(e => e !== emoji);
  reactionFreqCache.unshift(emoji);
  reactionFreqCache = reactionFreqCache.slice(0, 32);
  const settings = await window.gimodi.settings.load() || {};
  settings.reactionFrequentEmojis = reactionFreqCache;
  window.gimodi.settings.save(settings);
}

loadReactionFrequent();

/**
 * Renders reaction buttons under a message element.
 * @param {HTMLElement} msgEl
 * @param {string} messageId
 * @param {Array} reactions
 */
export function renderReactions(msgEl, messageId, reactions) {
  let reactionsRow = msgEl.querySelector('.reactions-row');
  if (!reactionsRow) {
    reactionsRow = document.createElement('div');
    reactionsRow.className = 'reactions-row';
    // Insert after .chat-msg-body so it's visible below the message text
    const body = msgEl.querySelector('.chat-msg-body');
    if (body) {
      body.after(reactionsRow);
    } else {
      msgEl.appendChild(reactionsRow);
    }
  }

  reactionsRow.innerHTML = '';
  for (const r of reactions) {
    const btn = document.createElement('button');
    btn.className = `reaction-btn${r.currentUser ? ' current-user' : ''}`;
    btn.innerHTML = `${escapeHtml(r.emoji)} <span class="reaction-count">${r.count}</span>`;
    btn.title = r.userIds.length === 1 ? '1 person' : `${r.userIds.length} people`;
    btn.addEventListener('click', () => {
      if (r.currentUser) {
        chatService.unreact(messageId, r.emoji);
      } else {
        chatService.react(messageId, r.emoji);
      }
    });
    reactionsRow.appendChild(btn);
  }

  // Add a "+" button to add more reactions
  if (serverService.userId) {
    const addBtn = document.createElement('button');
    addBtn.className = 'reaction-btn reaction-add-btn';
    addBtn.title = 'Add Reaction';
    addBtn.innerHTML = '<i class="bi bi-plus"></i>';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = addBtn.getBoundingClientRect();
      showReactionPicker(rect.left, rect.bottom + 4, messageId);
    });
    reactionsRow.appendChild(addBtn);
  }
}

/**
 * Shows the emoji picker popup for reactions.
 * @param {number} x
 * @param {number} y
 * @param {string} messageId
 */
export function showReactionPicker(x, y, messageId) {
  // Remove any existing picker
  const existing = document.getElementById('reaction-picker');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.id = 'reaction-picker';
  picker.className = 'emoji-picker';

  // Search bar
  const searchRow = document.createElement('div');
  searchRow.className = 'emoji-picker-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search emoji...';
  searchInput.className = 'emoji-picker-search-input';
  searchRow.appendChild(searchInput);
  picker.appendChild(searchRow);

  // Quick reactions row
  const quickRow = document.createElement('div');
  quickRow.className = 'emoji-picker-quick';
  for (const emoji of COMMON_REACTIONS) {
    const btn = document.createElement('button');
    btn.className = 'emoji-picker-emoji';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      trackEmojiUsage(emoji);
      chatService.react(messageId, emoji);
      picker.remove();
    });
    quickRow.appendChild(btn);
  }
  picker.appendChild(quickRow);

  // Category tabs
  const tabBar = document.createElement('div');
  tabBar.className = 'emoji-picker-tabs';
  const categories = [...EMOJI_CATEGORIES];
  // Populate frequent
  categories[0].emojis = getFrequentEmojis();

  const contentArea = document.createElement('div');
  contentArea.className = 'emoji-picker-content';

  // Build full grid (all categories)
  function renderAll(filter) {
    contentArea.innerHTML = '';
    for (const cat of categories) {
      const emojis = filter
        ? cat.emojis.filter(e => e.includes(filter))
        : cat.emojis;
      if (emojis.length === 0) continue;

      const label = document.createElement('div');
      label.className = 'emoji-picker-cat-label';
      label.textContent = cat.name;
      label.dataset.catId = cat.id;
      contentArea.appendChild(label);

      const grid = document.createElement('div');
      grid.className = 'emoji-picker-grid';
      for (const emoji of emojis) {
        const btn = document.createElement('button');
        btn.className = 'emoji-picker-emoji';
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
          trackEmojiUsage(emoji);
          chatService.react(messageId, emoji);
          picker.remove();
        });
        grid.appendChild(btn);
      }
      contentArea.appendChild(grid);
    }
  }

  // Tab buttons
  for (const cat of categories) {
    if (cat.id === 'frequent' && cat.emojis.length === 0) continue;
    const tab = document.createElement('button');
    tab.className = 'emoji-picker-tab';
    tab.textContent = cat.icon;
    tab.title = cat.name;
    tab.addEventListener('click', () => {
      const target = contentArea.querySelector(`[data-cat-id="${cat.id}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    tabBar.appendChild(tab);
  }
  picker.appendChild(tabBar);
  picker.appendChild(contentArea);

  renderAll();

  // Search
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { renderAll(); return; }
    // Filter emojis by name/keywords
    contentArea.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'emoji-picker-grid';
    let found = 0;
    const seen = new Set();
    for (const cat of categories) {
      for (const emoji of cat.emojis) {
        if (found >= 80 || seen.has(emoji)) continue;
        const names = (EMOJI_NAMES[emoji] || '').toLowerCase();
        if (names.includes(q) || emoji.includes(q)) {
          seen.add(emoji);
          const btn = document.createElement('button');
          btn.className = 'emoji-picker-emoji';
          btn.textContent = emoji;
          btn.addEventListener('click', () => {
            trackEmojiUsage(emoji);
            chatService.react(messageId, emoji);
            picker.remove();
          });
          grid.appendChild(btn);
          found++;
        }
      }
    }
    if (found === 0) {
      contentArea.innerHTML = '<div class="emoji-picker-empty">No emojis found</div>';
    } else {
      contentArea.appendChild(grid);
    }
  });

  // Position
  picker.style.left = x + 'px';
  picker.style.top = y + 'px';
  document.body.appendChild(picker);

  // Adjust position if overflows viewport
  const pickerRect = picker.getBoundingClientRect();
  if (pickerRect.right > window.innerWidth) {
    picker.style.left = (window.innerWidth - pickerRect.width - 8) + 'px';
  }
  if (pickerRect.bottom > window.innerHeight) {
    picker.style.top = (y - pickerRect.height - 8) + 'px';
  }
  if (pickerRect.left < 0) {
    picker.style.left = '8px';
  }

  searchInput.focus();

  // Close picker on click outside
  setTimeout(() => {
    const closeHandler = (e) => {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 0);
}

/**
 * Handles reaction-update events from chatService.
 * @param {CustomEvent} e
 */
export function onReactionUpdate(e) {
  const { messageId, reactions } = e.detail;
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;
  const msgEl = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
  if (!msgEl) return;

  // Remove old reactions row if exists
  const oldRow = msgEl.querySelector('.reactions-row');
  if (oldRow) oldRow.remove();

  // Render new reactions if any
  if (reactions && reactions.length > 0) {
    renderReactions(msgEl, messageId, reactions);
  }
}
