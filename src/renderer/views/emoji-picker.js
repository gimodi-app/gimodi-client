/**
 * Generic emoji picker component.
 * Used for both message composition and reactions.
 *
 * @example
 * // Anchored to a button (message input)
 * showEmojiPicker({ anchor: btnEmoji, onSelect: (emoji) => insertEmoji(emoji) });
 *
 * // Positioned at coordinates (reactions)
 * showEmojiPicker({ x: 100, y: 200, onSelect: (emoji) => react(emoji) });
 */

/** @type {Map<string, string>} */
const EMOJI_NAMES = new Map(
  Object.entries({
    '😀': 'grinning face happy',
    '😃': 'smiley happy',
    '😄': 'smile happy',
    '😁': 'grin beaming',
    '😆': 'laughing satisfied',
    '😅': 'sweat smile nervous',
    '🤣': 'rofl rolling floor laughing',
    '😂': 'joy tears laughing cry',
    '🙂': 'slightly smiling',
    '🙃': 'upside down',
    '😉': 'wink',
    '😊': 'blush happy shy',
    '😇': 'innocent angel halo',
    '🥰': 'smiling hearts love',
    '😍': 'heart eyes love',
    '🤩': 'star struck excited',
    '😘': 'kissing heart blow kiss',
    '😗': 'kissing',
    '😚': 'kissing closed eyes',
    '😙': 'kissing smiling',
    '🥲': 'smiling tear sad happy',
    '😋': 'yum delicious tongue',
    '😛': 'tongue out',
    '😜': 'wink tongue crazy',
    '🤪': 'zany crazy wild',
    '😝': 'squinting tongue',
    '🤑': 'money mouth rich',
    '🤗': 'hugging hug',
    '🤭': 'hand over mouth oops giggle',
    '🤫': 'shushing quiet secret',
    '🤔': 'thinking hmm',
    '🫡': 'salute',
    '🤐': 'zipper mouth shut up',
    '🤨': 'raised eyebrow skeptical',
    '😐': 'neutral face',
    '😑': 'expressionless',
    '😶': 'no mouth silent',
    '🫥': 'dotted line face hidden',
    '😏': 'smirk',
    '😒': 'unamused annoyed',
    '🙄': 'rolling eyes',
    '😬': 'grimacing awkward',
    '🤥': 'lying pinocchio',
    '😌': 'relieved peaceful',
    '😔': 'pensive sad thoughtful',
    '😪': 'sleepy tired',
    '🤤': 'drooling',
    '😴': 'sleeping zzz',
    '😷': 'mask sick medical',
    '🤒': 'thermometer fever sick',
    '🤕': 'bandage hurt injured',
    '🤢': 'nauseated sick green',
    '🤮': 'vomiting sick throw up',
    '🥵': 'hot face sweating',
    '🥶': 'cold face freezing',
    '🥴': 'woozy drunk',
    '😵': 'dizzy knocked out',
    '🤯': 'exploding head mind blown',
    '🤠': 'cowboy hat',
    '🥳': 'party celebration',
    '🥸': 'disguise glasses nose',
    '😎': 'sunglasses cool',
    '🤓': 'nerd glasses',
    '🧐': 'monocle curious',
    '😕': 'confused',
    '🫤': 'diagonal mouth',
    '😟': 'worried',
    '🙁': 'slightly frowning',
    '☹️': 'frowning sad',
    '😮': 'open mouth surprised wow',
    '😯': 'hushed',
    '😲': 'astonished shocked',
    '😳': 'flushed embarrassed',
    '🥺': 'pleading puppy eyes',
    '🥹': 'holding back tears',
    '😦': 'frowning open mouth',
    '😧': 'anguished',
    '😨': 'fearful scared',
    '😰': 'anxious sweat',
    '😥': 'sad relieved',
    '😢': 'crying tear sad',
    '😭': 'sobbing crying loud',
    '😱': 'screaming fear horror',
    '😖': 'confounded',
    '😣': 'persevering determined',
    '😞': 'disappointed sad',
    '😓': 'downcast sweat',
    '😩': 'weary tired',
    '😫': 'tired exhausted',
    '🥱': 'yawning bored tired',
    '😤': 'huffing angry triumph',
    '😡': 'pouting angry mad',
    '😠': 'angry mad',
    '🤬': 'swearing cursing symbols',
    '😈': 'smiling devil horns',
    '👿': 'angry devil',
    '💀': 'skull dead death',
    '☠️': 'skull crossbones death poison',
    '💩': 'poop poo shit',
    '🤡': 'clown',
    '👹': 'ogre monster',
    '👺': 'goblin tengu',
    '👻': 'ghost boo halloween',
    '👽': 'alien ufo',
    '👾': 'space invader game alien',
    '🤖': 'robot',
    '😺': 'smiling cat',
    '😸': 'grinning cat',
    '😹': 'cat joy tears',
    '😻': 'heart eyes cat love',
    '😼': 'smirk cat',
    '😽': 'kissing cat',
    '🙀': 'weary cat shocked',
    '😿': 'crying cat sad',
    '😾': 'pouting cat angry',
    '👋': 'wave hello hi bye',
    '🤚': 'raised back hand',
    '🖐️': 'hand splayed fingers',
    '✋': 'raised hand stop high five',
    '🖖': 'vulcan spock',
    '👌': 'ok okay perfect',
    '🤌': 'pinched fingers italian',
    '🤏': 'pinching small tiny',
    '✌️': 'peace victory two',
    '🤞': 'crossed fingers luck hope',
    '🤟': 'love you gesture rock',
    '🤘': 'rock on horns metal',
    '🤙': 'call me shaka hang loose',
    '👈': 'pointing left',
    '👉': 'pointing right',
    '👆': 'pointing up',
    '🖕': 'middle finger',
    '👇': 'pointing down',
    '☝️': 'index pointing up',
    '👍': 'thumbs up like good yes',
    '👎': 'thumbs down dislike bad no',
    '✊': 'raised fist power',
    '👊': 'fist bump punch',
    '🤛': 'left fist bump',
    '🤜': 'right fist bump',
    '👏': 'clap clapping applause bravo',
    '🙌': 'raising hands celebration hooray',
    '👐': 'open hands',
    '🤲': 'palms up together',
    '🤝': 'handshake deal agreement',
    '🙏': 'pray please thank you folded hands',
    '💪': 'muscle strong bicep flex',
    '❤️': 'red heart love',
    '🧡': 'orange heart',
    '💛': 'yellow heart',
    '💚': 'green heart',
    '💙': 'blue heart',
    '💜': 'purple heart',
    '🖤': 'black heart',
    '🤍': 'white heart',
    '🤎': 'brown heart',
    '💔': 'broken heart',
    '❤️‍🔥': 'heart fire burning',
    '❤️‍🩹': 'mending heart healing',
    '❣️': 'heart exclamation',
    '💕': 'two hearts love',
    '💞': 'revolving hearts',
    '💓': 'beating heart',
    '💗': 'growing heart',
    '💖': 'sparkling heart',
    '💘': 'heart arrow cupid',
    '💝': 'heart ribbon gift',
    '💟': 'heart decoration',
    '🐶': 'dog puppy',
    '🐱': 'cat kitty',
    '🐭': 'mouse',
    '🐹': 'hamster',
    '🐰': 'rabbit bunny',
    '🦊': 'fox',
    '🐻': 'bear',
    '🐼': 'panda',
    '🐨': 'koala',
    '🐯': 'tiger',
    '🦁': 'lion',
    '🐮': 'cow',
    '🐷': 'pig',
    '🐸': 'frog',
    '🐵': 'monkey',
    '🙈': 'see no evil monkey',
    '🙉': 'hear no evil monkey',
    '🙊': 'speak no evil monkey',
    '🐔': 'chicken',
    '🐧': 'penguin',
    '🐦': 'bird',
    '🦅': 'eagle',
    '🦉': 'owl',
    '🐺': 'wolf',
    '🐴': 'horse',
    '🦄': 'unicorn magic',
    '🐝': 'bee honey',
    '🦋': 'butterfly',
    '🐢': 'turtle tortoise',
    '🐍': 'snake',
    '🐙': 'octopus',
    '🐬': 'dolphin',
    '🐳': 'whale',
    '🦈': 'shark',
    '🐘': 'elephant',
    '🦒': 'giraffe',
    '🌵': 'cactus',
    '🎄': 'christmas tree',
    '🌲': 'evergreen tree',
    '🌳': 'tree',
    '🌴': 'palm tree',
    '🌱': 'seedling sprout',
    '🌿': 'herb leaf',
    '🍀': 'four leaf clover lucky',
    '🌺': 'hibiscus flower',
    '🌻': 'sunflower',
    '🌹': 'rose flower',
    '🌷': 'tulip',
    '🌼': 'blossom',
    '🌸': 'cherry blossom sakura',
    '💐': 'bouquet flowers',
    '🌈': 'rainbow',
    '🍇': 'grapes',
    '🍉': 'watermelon',
    '🍊': 'orange tangerine',
    '🍋': 'lemon',
    '🍌': 'banana',
    '🍍': 'pineapple',
    '🍎': 'apple red',
    '🍏': 'apple green',
    '🍑': 'peach',
    '🍒': 'cherries',
    '🍓': 'strawberry',
    '🍔': 'hamburger burger',
    '🍟': 'fries french fries',
    '🍕': 'pizza',
    '🌭': 'hot dog',
    '🌮': 'taco',
    '🌯': 'burrito',
    '🍳': 'cooking egg fried',
    '🍲': 'pot food stew',
    '🍿': 'popcorn',
    '🍩': 'donut doughnut',
    '🍪': 'cookie',
    '🎂': 'birthday cake',
    '🍰': 'cake shortcake',
    '🍫': 'chocolate',
    '🍬': 'candy sweet',
    '🍭': 'lollipop',
    '🍦': 'ice cream',
    '☕': 'coffee hot beverage',
    '🍵': 'tea',
    '🍶': 'sake',
    '🍾': 'champagne bottle celebration',
    '🍷': 'wine glass',
    '🍸': 'cocktail martini',
    '🍺': 'beer mug',
    '🍻': 'clinking beers cheers',
    '🥂': 'clinking glasses champagne toast cheers',
    '⚽': 'soccer football',
    '🏀': 'basketball',
    '🏈': 'football american',
    '⚾': 'baseball',
    '🎾': 'tennis',
    '🏐': 'volleyball',
    '🏉': 'rugby',
    '🎱': 'billiards pool',
    '🏓': 'ping pong table tennis',
    '⛳': 'golf',
    '🏹': 'bow arrow archery',
    '🎣': 'fishing',
    '🥊': 'boxing glove',
    '🎽': 'running shirt',
    '🛹': 'skateboard',
    '⛸️': 'ice skating',
    '🎿': 'skiing',
    '🏂': 'snowboard',
    '🏆': 'trophy winner champion',
    '🥇': 'gold medal first',
    '🥈': 'silver medal second',
    '🥉': 'bronze medal third',
    '🏅': 'medal sports',
    '🎪': 'circus tent',
    '🎭': 'theater drama masks',
    '🎨': 'art palette painting',
    '🎬': 'movie clapper film',
    '🎤': 'microphone karaoke sing',
    '🎧': 'headphones music',
    '🎼': 'music score',
    '🎹': 'piano keyboard',
    '🥁': 'drum',
    '🎷': 'saxophone jazz',
    '🎺': 'trumpet',
    '🎸': 'guitar rock',
    '🎻': 'violin',
    '🎲': 'dice game',
    '🎯': 'bullseye target dart',
    '🎮': 'video game controller',
    '🕹️': 'joystick arcade',
    '🧩': 'puzzle piece jigsaw',
    '🚗': 'car automobile',
    '🚕': 'taxi cab',
    '🚌': 'bus',
    '🏎️': 'racing car',
    '🚓': 'police car',
    '🚑': 'ambulance',
    '🚒': 'fire truck',
    '🚚': 'delivery truck',
    '🚜': 'tractor',
    '🏍️': 'motorcycle',
    '🚲': 'bicycle bike',
    '✈️': 'airplane plane',
    '🚀': 'rocket space launch',
    '🛸': 'ufo flying saucer',
    '🚁': 'helicopter',
    '⛵': 'sailboat',
    '🚤': 'speedboat',
    '🚢': 'ship',
    '🏠': 'house home',
    '🏢': 'office building',
    '🏥': 'hospital',
    '🏫': 'school',
    '🏰': 'castle',
    '⛪': 'church',
    '📱': 'phone mobile smartphone',
    '💻': 'laptop computer',
    '⌨️': 'keyboard',
    '🖥️': 'desktop computer monitor',
    '🖨️': 'printer',
    '📷': 'camera photo',
    '📹': 'video camera',
    '📺': 'television tv',
    '📻': 'radio',
    '⏰': 'alarm clock time',
    '⌛': 'hourglass time',
    '💡': 'light bulb idea',
    '🔋': 'battery',
    '🔌': 'plug electric',
    '💰': 'money bag rich',
    '💳': 'credit card',
    '💎': 'gem diamond jewel',
    '🔧': 'wrench tool',
    '🔨': 'hammer tool',
    '🔩': 'nut bolt',
    '⚙️': 'gear settings',
    '🔫': 'gun water pistol',
    '💣': 'bomb explosive',
    '🔪': 'knife',
    '🛡️': 'shield',
    '🔮': 'crystal ball magic',
    '🧿': 'evil eye nazar',
    '💊': 'pill medicine',
    '💉': 'syringe needle vaccine',
    '🧬': 'dna',
    '🔬': 'microscope science',
    '🔭': 'telescope',
    '🧹': 'broom',
    '🚽': 'toilet',
    '🛁': 'bathtub bath',
    '🎉': 'party popper tada celebration confetti',
    '🔥': 'fire hot lit flame',
    '✨': 'sparkles stars magic glitter',
    '⭐': 'star',
    '🌟': 'glowing star',
    '💫': 'dizzy star',
    '☀️': 'sun sunny',
    '🌙': 'moon crescent night',
    '💤': 'sleeping zzz',
    '🏁': 'checkered flag finish race',
    '🚩': 'red flag',
    '🏴': 'black flag',
    '🏳️': 'white flag',
    '🏳️‍🌈': 'rainbow flag pride lgbtq',
    '🏴‍☠️': 'pirate flag',
    '🇩🇪': 'germany flag de',
    '🇦🇹': 'austria flag at',
    '🇨🇭': 'switzerland flag ch',
    '🇺🇸': 'usa america flag us',
    '🇬🇧': 'uk britain flag gb',
    '🇫🇷': 'france flag fr',
    '🇪🇸': 'spain flag es',
    '🇮🇹': 'italy flag it',
    '🇯🇵': 'japan flag jp',
    '🇨🇳': 'china flag cn',
    '🇷🇺': 'russia flag ru',
    '🇧🇷': 'brazil flag br',
    '🇮🇳': 'india flag in',
    '🇦🇺': 'australia flag au',
    '🇨🇦': 'canada flag ca',
    '🇺🇦': 'ukraine flag ua',
    '✅': 'check mark yes done',
    '❌': 'cross mark no wrong',
    '⭕': 'circle',
    '🛑': 'stop sign',
    '⛔': 'no entry forbidden',
    '🚫': 'prohibited banned',
    '💯': 'hundred perfect score',
    '♻️': 'recycling recycle',
    '⚠️': 'warning caution',
    ℹ️: 'information info',
    '❗': 'exclamation mark important',
    '❓': 'question mark',
    '👀': 'eyes looking watching',
    '👁️': 'eye',
    '👅': 'tongue',
    '👄': 'mouth lips',
    '👶': 'baby',
    '🧑': 'person adult',
    '👨': 'man',
    '👩': 'woman',
    '🧓': 'older person',
    '👴': 'old man',
    '👵': 'old woman',
    '🫶': 'heart hands love',
    '🫵': 'pointing at you',
    '⚔️': 'crossed swords battle fight',
    '🗡️': 'dagger knife sword',
    '🪙': 'coin money',
    '💵': 'dollar money bill',
    '💶': 'euro money',
    '💷': 'pound money',
    '🎫': 'ticket',
    '🎟️': 'admission ticket',
    '🎗️': 'ribbon awareness',
    '🎖️': 'military medal',
    '🏵️': 'rosette flower',
  }),
);

/** @type {Array<{id: string, icon: string, name: string, emojis: string[]}>} */
const EMOJI_CATEGORIES = [
  {
    id: 'smileys',
    icon: '😀',
    name: 'Smileys',
    emojis: [
      '😀',
      '😃',
      '😄',
      '😁',
      '😆',
      '😅',
      '🤣',
      '😂',
      '🙂',
      '🙃',
      '😉',
      '😊',
      '😇',
      '🥰',
      '😍',
      '🤩',
      '😘',
      '😗',
      '😚',
      '😙',
      '🥲',
      '😋',
      '😛',
      '😜',
      '🤪',
      '😝',
      '🤑',
      '🤗',
      '🤭',
      '🤫',
      '🤔',
      '🫡',
      '🤐',
      '🤨',
      '😐',
      '😑',
      '😶',
      '🫥',
      '😏',
      '😒',
      '🙄',
      '😬',
      '🤥',
      '😌',
      '😔',
      '😪',
      '🤤',
      '😴',
      '😷',
      '🤒',
      '🤕',
      '🤢',
      '🤮',
      '🥵',
      '🥶',
      '🥴',
      '😵',
      '🤯',
      '🤠',
      '🥳',
      '🥸',
      '😎',
      '🤓',
      '🧐',
      '😕',
      '🫤',
      '😟',
      '🙁',
      '☹️',
      '😮',
      '😯',
      '😲',
      '😳',
      '🥺',
      '🥹',
      '😦',
      '😧',
      '😨',
      '😰',
      '😥',
      '😢',
      '😭',
      '😱',
      '😖',
      '😣',
      '😞',
      '😓',
      '😩',
      '😫',
      '🥱',
      '😤',
      '😡',
      '😠',
      '🤬',
      '😈',
      '👿',
      '💀',
      '☠️',
      '💩',
      '🤡',
      '👹',
      '👺',
      '👻',
      '👽',
      '👾',
      '🤖',
      '😺',
      '😸',
      '😹',
      '😻',
      '😼',
      '😽',
      '🙀',
      '😿',
      '😾',
    ],
  },
  {
    id: 'people',
    icon: '👋',
    name: 'People',
    emojis: [
      '👋',
      '🤚',
      '🖐️',
      '✋',
      '🖖',
      '🫱',
      '🫲',
      '🫳',
      '🫴',
      '👌',
      '🤌',
      '🤏',
      '✌️',
      '🤞',
      '🫰',
      '🤟',
      '🤘',
      '🤙',
      '👈',
      '👉',
      '👆',
      '🖕',
      '👇',
      '☝️',
      '🫵',
      '👍',
      '👎',
      '✊',
      '👊',
      '🤛',
      '🤜',
      '👏',
      '🙌',
      '🫶',
      '👐',
      '🤲',
      '🤝',
      '🙏',
      '✍️',
      '💅',
      '🤳',
      '💪',
      '🦾',
      '🦿',
      '🦵',
      '🦶',
      '👂',
      '🦻',
      '👃',
      '🧠',
      '🫀',
      '🫁',
      '🦷',
      '🦴',
      '👀',
      '👁️',
      '👅',
      '👄',
      '🫦',
      '👶',
      '🧒',
      '👦',
      '👧',
      '🧑',
      '👱',
      '👨',
      '🧔',
      '👩',
      '🧓',
      '👴',
      '👵',
    ],
  },
  {
    id: 'animals',
    icon: '🐶',
    name: 'Animals & Nature',
    emojis: [
      '🐶',
      '🐱',
      '🐭',
      '🐹',
      '🐰',
      '🦊',
      '🐻',
      '🐼',
      '🐻‍❄️',
      '🐨',
      '🐯',
      '🦁',
      '🐮',
      '🐷',
      '🐽',
      '🐸',
      '🐵',
      '🙈',
      '🙉',
      '🙊',
      '🐒',
      '🐔',
      '🐧',
      '🐦',
      '🐤',
      '🐣',
      '🐥',
      '🦆',
      '🦅',
      '🦉',
      '🦇',
      '🐺',
      '🐗',
      '🐴',
      '🦄',
      '🐝',
      '🪱',
      '🐛',
      '🦋',
      '🐌',
      '🐞',
      '🐜',
      '🪲',
      '🪳',
      '🦟',
      '🦗',
      '🕷️',
      '🕸️',
      '🦂',
      '🐢',
      '🐍',
      '🦎',
      '🦖',
      '🦕',
      '🐙',
      '🦑',
      '🦐',
      '🦞',
      '🦀',
      '🐡',
      '🐠',
      '🐟',
      '🐬',
      '🐳',
      '🐋',
      '🦈',
      '🪸',
      '🐊',
      '🐅',
      '🐆',
      '🦓',
      '🦍',
      '🦧',
      '🐘',
      '🦛',
      '🦏',
      '🐪',
      '🐫',
      '🦒',
      '🦘',
      '🌵',
      '🎄',
      '🌲',
      '🌳',
      '🌴',
      '🪵',
      '🌱',
      '🌿',
      '☘️',
      '🍀',
      '🎍',
      '🪴',
      '🎋',
      '🍃',
      '🍂',
      '🍁',
      '🌾',
      '🌺',
      '🌻',
      '🌹',
      '🥀',
      '🌷',
      '🌼',
      '🌸',
      '💐',
      '🍄',
      '🌰',
      '🎃',
      '🐚',
      '🪨',
      '🌎',
      '🌍',
      '🌏',
      '🌕',
      '🌙',
      '⭐',
      '🌟',
      '💫',
      '✨',
      '☀️',
      '🌈',
    ],
  },
  {
    id: 'food',
    icon: '🍕',
    name: 'Food & Drink',
    emojis: [
      '🍇',
      '🍈',
      '🍉',
      '🍊',
      '🍋',
      '🍌',
      '🍍',
      '🥭',
      '🍎',
      '🍏',
      '🍐',
      '🍑',
      '🍒',
      '🍓',
      '🫐',
      '🥝',
      '🍅',
      '🫒',
      '🥥',
      '🥑',
      '🍆',
      '🥔',
      '🥕',
      '🌽',
      '🌶️',
      '🫑',
      '🥒',
      '🥬',
      '🥦',
      '🧄',
      '🧅',
      '🍄',
      '🥜',
      '🫘',
      '🌰',
      '🍞',
      '🥐',
      '🥖',
      '🫓',
      '🥨',
      '🥯',
      '🥞',
      '🧇',
      '🧀',
      '🍖',
      '🍗',
      '🥩',
      '🥓',
      '🍔',
      '🍟',
      '🍕',
      '🌭',
      '🥪',
      '🌮',
      '🌯',
      '🫔',
      '🥙',
      '🧆',
      '🥚',
      '🍳',
      '🥘',
      '🍲',
      '🫕',
      '🥣',
      '🥗',
      '🍿',
      '🧈',
      '🧂',
      '🥫',
      '🍱',
      '🍘',
      '🍙',
      '🍚',
      '🍛',
      '🍜',
      '🍝',
      '🍠',
      '🍢',
      '🍣',
      '🍤',
      '🍥',
      '🥮',
      '🍡',
      '🥟',
      '🥠',
      '🥡',
      '🦀',
      '🦞',
      '🦐',
      '🦑',
      '🦪',
      '🍦',
      '🍧',
      '🍨',
      '🍩',
      '🍪',
      '🎂',
      '🍰',
      '🧁',
      '🥧',
      '🍫',
      '🍬',
      '🍭',
      '🍮',
      '🍯',
      '🍼',
      '🥛',
      '☕',
      '🫖',
      '🍵',
      '🍶',
      '🍾',
      '🍷',
      '🍸',
      '🍹',
      '🍺',
      '🍻',
      '🥂',
      '🥃',
      '🫗',
      '🥤',
      '🧋',
      '🧃',
      '🧉',
      '🧊',
    ],
  },
  {
    id: 'hearts',
    icon: '❤️',
    name: 'Hearts & Symbols',
    emojis: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '🤎',
      '💔',
      '❤️‍🔥',
      '❤️‍🩹',
      '❣️',
      '💕',
      '💞',
      '💓',
      '💗',
      '💖',
      '💘',
      '💝',
      '💟',
      '💋',
      '💯',
      '💢',
      '💥',
      '💫',
      '💦',
      '💨',
      '💬',
      '💭',
      '💤',
      '✅',
      '❌',
      '⭕',
      '🛑',
      '⛔',
      '🚫',
      '💯',
      '♻️',
      '⚠️',
      'ℹ️',
      '❗',
      '❓',
      '⭐',
      '🌟',
      '✨',
      '🔥',
      '🎉',
      '🎊',
    ],
  },
  {
    id: 'activities',
    icon: '⚽',
    name: 'Activities',
    emojis: [
      '⚽',
      '🏀',
      '🏈',
      '⚾',
      '🥎',
      '🎾',
      '🏐',
      '🏉',
      '🥏',
      '🎱',
      '🪀',
      '🏓',
      '🏸',
      '🏒',
      '🥍',
      '🏑',
      '🥅',
      '⛳',
      '🪃',
      '🏹',
      '🎣',
      '🤿',
      '🥊',
      '🥋',
      '🎽',
      '🛹',
      '🛼',
      '🛷',
      '⛸️',
      '🥌',
      '🎿',
      '⛷️',
      '🏂',
      '🪂',
      '🏋️',
      '🤼',
      '🤸',
      '⛹️',
      '🤺',
      '🤾',
      '🏇',
      '🧘',
      '🏄',
      '🏊',
      '🤽',
      '🚣',
      '🧗',
      '🚵',
      '🚴',
      '🏆',
      '🥇',
      '🥈',
      '🥉',
      '🏅',
      '🎖️',
      '🏵️',
      '🎗️',
      '🎫',
      '🎟️',
      '🎪',
      '🤹',
      '🎭',
      '🩰',
      '🎨',
      '🎬',
      '🎤',
      '🎧',
      '🎼',
      '🎹',
      '🥁',
      '🪘',
      '🎷',
      '🎺',
      '🪗',
      '🎸',
      '🪕',
      '🎻',
      '🎲',
      '♟️',
      '🎯',
      '🎳',
      '🎮',
      '🕹️',
      '🧩',
    ],
  },
  {
    id: 'travel',
    icon: '🚗',
    name: 'Travel',
    emojis: [
      '🚗',
      '🚕',
      '🚙',
      '🚌',
      '🚎',
      '🏎️',
      '🚓',
      '🚑',
      '🚒',
      '🚐',
      '🛻',
      '🚚',
      '🚛',
      '🚜',
      '🏍️',
      '🛵',
      '🚲',
      '🛴',
      '🛺',
      '✈️',
      '🛫',
      '🛬',
      '🚀',
      '🛸',
      '🚁',
      '⛵',
      '🚤',
      '🚢',
      '🏠',
      '🏡',
      '🏢',
      '🏥',
      '🏫',
      '🏰',
      '⛪',
      '🗽',
      '🗼',
      '🎡',
      '🎢',
      '⛲',
      '🏖️',
      '🏝️',
      '⛰️',
      '🏔️',
      '🌋',
      '🏕️',
    ],
  },
  {
    id: 'objects',
    icon: '💡',
    name: 'Objects',
    emojis: [
      '📱',
      '💻',
      '⌨️',
      '🖥️',
      '🖨️',
      '🖱️',
      '💽',
      '💾',
      '💿',
      '📀',
      '📷',
      '📸',
      '📹',
      '🎥',
      '📺',
      '📻',
      '🎙️',
      '🎚️',
      '🎛️',
      '⏰',
      '⌛',
      '📡',
      '🔋',
      '🔌',
      '💡',
      '🔦',
      '🕯️',
      '💰',
      '💵',
      '💶',
      '💷',
      '🪙',
      '💳',
      '💎',
      '📧',
      '📨',
      '📩',
      '📦',
      '📋',
      '📎',
      '🔏',
      '🔐',
      '🔑',
      '🗝️',
      '🔧',
      '🔨',
      '🔩',
      '⚙️',
      '🛠️',
      '⛏️',
      '🗡️',
      '⚔️',
      '🛡️',
      '🔫',
      '💣',
      '🔮',
      '🧿',
      '💊',
      '💉',
      '🧬',
      '🔬',
      '🔭',
      '🧹',
      '🚽',
      '🛁',
    ],
  },
  {
    id: 'flags',
    icon: '🏁',
    name: 'Flags',
    emojis: [
      '🏁',
      '🚩',
      '🎌',
      '🏴',
      '🏳️',
      '🏳️‍🌈',
      '🏳️‍⚧️',
      '🏴‍☠️',
      '🇩🇪',
      '🇦🇹',
      '🇨🇭',
      '🇺🇸',
      '🇬🇧',
      '🇫🇷',
      '🇪🇸',
      '🇮🇹',
      '🇵🇹',
      '🇧🇷',
      '🇯🇵',
      '🇰🇷',
      '🇨🇳',
      '🇷🇺',
      '🇮🇳',
      '🇦🇺',
      '🇨🇦',
      '🇲🇽',
      '🇳🇱',
      '🇧🇪',
      '🇸🇪',
      '🇳🇴',
      '🇩🇰',
      '🇫🇮',
      '🇵🇱',
      '🇨🇿',
      '🇭🇺',
      '🇷🇴',
      '🇬🇷',
      '🇹🇷',
      '🇮🇱',
      '🇸🇦',
      '🇦🇪',
      '🇿🇦',
      '🇪🇬',
      '🇳🇬',
      '🇰🇪',
      '🇦🇷',
      '🇨🇴',
      '🇨🇱',
      '🇵🇪',
      '🇻🇪',
      '🇹🇭',
      '🇻🇳',
      '🇵🇭',
      '🇮🇩',
      '🇲🇾',
      '🇸🇬',
      '🇳🇿',
      '🇮🇪',
      '🇺🇦',
      '🇭🇷',
    ],
  },
];

const MAX_FREQUENT = 24;
const MAX_FREQUENT_STORED = 32;

let frequentCache = [];
let pickerEl = null;
let closeHandler = null;

/**
 * @returns {Promise<void>}
 */
async function loadFrequent() {
  const settings = (await window.gimodi.settings.load()) || {};
  frequentCache = Array.isArray(settings.emojiFrequent) ? settings.emojiFrequent : [];
}

/**
 * @param {string} emoji
 * @returns {Promise<void>}
 */
async function trackUsage(emoji) {
  frequentCache = frequentCache.filter((e) => e !== emoji);
  frequentCache.unshift(emoji);
  frequentCache = frequentCache.slice(0, MAX_FREQUENT_STORED);
  const settings = (await window.gimodi.settings.load()) || {};
  settings.emojiFrequent = frequentCache;
  window.gimodi.settings.save(settings);
}

loadFrequent();

/**
 * @param {HTMLElement} container
 * @param {HTMLElement} target
 */
function scrollToCategory(container, target) {
  target.style.position = 'relative';
  const top = target.offsetTop;
  target.style.position = '';
  container.scrollTop = top;
}

/**
 * @param {function(string): void} onSelect
 * @returns {HTMLElement}
 */
function buildPicker(onSelect) {
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';

  const searchRow = document.createElement('div');
  searchRow.className = 'emoji-picker-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search emoji...';
  searchInput.className = 'emoji-picker-search-input';
  searchRow.appendChild(searchInput);
  picker.appendChild(searchRow);

  const tabBar = document.createElement('div');
  tabBar.className = 'emoji-picker-tabs';

  const contentArea = document.createElement('div');
  contentArea.className = 'emoji-picker-content';

  const frequentEmojis = frequentCache.slice(0, MAX_FREQUENT);

  /**
   * @param {string} [filter]
   */
  function renderAll(filter) {
    contentArea.innerHTML = '';

    if (filter) {
      const grid = document.createElement('div');
      grid.className = 'emoji-picker-grid';
      let found = 0;
      const seen = new Set();
      if (frequentEmojis.length > 0) {
        for (const emoji of frequentEmojis) {
          if (found >= 80 || seen.has(emoji)) {
            continue;
          }
          const names = EMOJI_NAMES.get(emoji) || '';
          if (names.includes(filter) || emoji.includes(filter)) {
            seen.add(emoji);
            grid.appendChild(makeEmojiBtn(emoji, onSelect));
            found++;
          }
        }
      }
      for (const cat of EMOJI_CATEGORIES) {
        for (const emoji of cat.emojis) {
          if (found >= 80 || seen.has(emoji)) {
            continue;
          }
          const names = EMOJI_NAMES.get(emoji) || '';
          if (names.includes(filter) || emoji.includes(filter)) {
            seen.add(emoji);
            grid.appendChild(makeEmojiBtn(emoji, onSelect));
            found++;
          }
        }
      }
      if (found === 0) {
        contentArea.innerHTML = '<div class="emoji-picker-empty">No emojis found</div>';
      } else {
        contentArea.appendChild(grid);
      }
      return;
    }

    if (frequentEmojis.length > 0) {
      const recentsLabel = document.createElement('div');
      recentsLabel.className = 'emoji-picker-cat-label';
      recentsLabel.textContent = 'Recents';
      recentsLabel.dataset.catId = 'recents';
      contentArea.appendChild(recentsLabel);
      const grid = document.createElement('div');
      grid.className = 'emoji-picker-grid';
      for (const emoji of frequentEmojis) {
        grid.appendChild(makeEmojiBtn(emoji, onSelect));
      }
      contentArea.appendChild(grid);
    }

    for (const cat of EMOJI_CATEGORIES) {
      const label = document.createElement('div');
      label.className = 'emoji-picker-cat-label';
      label.textContent = cat.name;
      label.dataset.catId = cat.id;
      contentArea.appendChild(label);

      const grid = document.createElement('div');
      grid.className = 'emoji-picker-grid';
      for (const emoji of cat.emojis) {
        grid.appendChild(makeEmojiBtn(emoji, onSelect));
      }
      contentArea.appendChild(grid);
    }
  }

  if (frequentEmojis.length > 0) {
    const recentsTab = document.createElement('button');
    recentsTab.className = 'emoji-picker-tab';
    recentsTab.textContent = '🕒';
    recentsTab.title = 'Recents';
    recentsTab.addEventListener('click', () => {
      const target = contentArea.querySelector('[data-cat-id="recents"]');
      if (target) {
        scrollToCategory(contentArea, target);
      }
    });
    tabBar.appendChild(recentsTab);
  }

  for (const cat of EMOJI_CATEGORIES) {
    const tab = document.createElement('button');
    tab.className = 'emoji-picker-tab';
    tab.textContent = cat.icon;
    tab.title = cat.name;
    tab.addEventListener('click', () => {
      const target = contentArea.querySelector(`[data-cat-id="${cat.id}"]`);
      if (target) {
        scrollToCategory(contentArea, target);
      }
    });
    tabBar.appendChild(tab);
  }

  picker.appendChild(tabBar);
  picker.appendChild(contentArea);

  renderAll();

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    renderAll(q || undefined);
  });

  setTimeout(() => searchInput.focus(), 0);

  return picker;
}

/**
 * @param {string} emoji
 * @param {function(string): void} onSelect
 * @returns {HTMLButtonElement}
 */
function makeEmojiBtn(emoji, onSelect) {
  const btn = document.createElement('button');
  btn.className = 'emoji-picker-emoji';
  btn.textContent = emoji;
  btn.addEventListener('click', () => {
    trackUsage(emoji);
    onSelect(emoji);
  });
  return btn;
}

/**
 * Shows the emoji picker.
 * @param {object} options
 * @param {HTMLElement} [options.anchor] - Anchor element to position relative to (bottom-right aligned)
 * @param {number} [options.x] - X position (used if no anchor)
 * @param {number} [options.y] - Y position (used if no anchor)
 * @param {function(string): void} options.onSelect - Called with the selected emoji
 * @param {boolean} [options.closeOnSelect=true] - Whether to close the picker after selection
 */
export function showEmojiPicker({ anchor, x, y, onSelect, closeOnSelect = true }) {
  closeEmojiPicker();

  const wrappedOnSelect = (emoji) => {
    onSelect(emoji);
    if (closeOnSelect) {
      closeEmojiPicker();
    }
  };

  pickerEl = buildPicker(wrappedOnSelect);
  document.body.appendChild(pickerEl);

  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    pickerEl.style.bottom = window.innerHeight - rect.top + 6 + 'px';
    pickerEl.style.right = window.innerWidth - rect.right + 'px';
  } else {
    pickerEl.style.left = x + 'px';
    pickerEl.style.top = y + 'px';
  }

  // Adjust for viewport overflow (only for absolute-positioned pickers)
  if (!anchor) {
    const pickerRect = pickerEl.getBoundingClientRect();
    if (pickerRect.right > window.innerWidth) {
      pickerEl.style.left = window.innerWidth - pickerRect.width - 8 + 'px';
    }
    if (pickerRect.bottom > window.innerHeight) {
      pickerEl.style.top = y - pickerRect.height - 8 + 'px';
    }
    if (pickerRect.left < 0) {
      pickerEl.style.left = '8px';
    }
  }

  setTimeout(() => {
    closeHandler = (e) => {
      if (pickerEl && !pickerEl.contains(e.target) && !e.target.closest('.btn-emoji')) {
        closeEmojiPicker();
      }
    };
    document.addEventListener('mousedown', closeHandler);
  }, 0);
}

/**
 * Closes the emoji picker if open.
 */
export function closeEmojiPicker() {
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
  if (closeHandler) {
    document.removeEventListener('mousedown', closeHandler);
    closeHandler = null;
  }
}

/**
 * @returns {boolean}
 */
export function isPickerOpen() {
  return !!pickerEl;
}
