/** @type {Array<{name: string, icon: string, emojis: string[]}>} */
const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    icon: '\u{1F600}',
    emojis: [
      '\u{1F600}','\u{1F603}','\u{1F604}','\u{1F601}','\u{1F606}','\u{1F605}','\u{1F602}','\u{1F923}',
      '\u{1F60A}','\u{1F607}','\u{1F642}','\u{1F643}','\u{1F609}','\u{1F60C}','\u{1F60D}','\u{1F970}',
      '\u{1F618}','\u{1F617}','\u{1F619}','\u{1F61A}','\u{1F60B}','\u{1F61B}','\u{1F61C}','\u{1F92A}',
      '\u{1F61D}','\u{1F911}','\u{1F917}','\u{1F92D}','\u{1F92B}','\u{1F914}','\u{1F910}','\u{1F928}',
      '\u{1F610}','\u{1F611}','\u{1F636}','\u{1F60F}','\u{1F612}','\u{1F644}','\u{1F62C}','\u{1F925}',
      '\u{1F60C}','\u{1F614}','\u{1F62A}','\u{1F924}','\u{1F634}','\u{1F637}','\u{1F912}','\u{1F915}',
      '\u{1F922}','\u{1F92E}','\u{1F927}','\u{1F975}','\u{1F976}','\u{1F974}','\u{1F635}','\u{1F929}',
      '\u{1F973}','\u{1F978}','\u{1F60E}','\u{1F913}','\u{1F9D0}','\u{1F615}','\u{1F61F}','\u{1F641}',
      '\u{2639}\u{FE0F}','\u{1F62E}','\u{1F62F}','\u{1F632}','\u{1F633}','\u{1F97A}','\u{1F626}','\u{1F627}',
      '\u{1F628}','\u{1F630}','\u{1F625}','\u{1F622}','\u{1F62D}','\u{1F631}','\u{1F616}','\u{1F623}',
      '\u{1F61E}','\u{1F613}','\u{1F629}','\u{1F62B}','\u{1F971}','\u{1F624}','\u{1F620}','\u{1F621}',
      '\u{1F92C}','\u{1F608}','\u{1F47F}','\u{1F480}','\u{2620}\u{FE0F}','\u{1F4A9}','\u{1F921}','\u{1F479}',
      '\u{1F47A}','\u{1F47B}','\u{1F47D}','\u{1F47E}','\u{1F916}','\u{1F63A}','\u{1F638}','\u{1F639}',
      '\u{1F63B}','\u{1F63C}','\u{1F63D}','\u{1F640}','\u{1F63F}','\u{1F63E}',
    ],
  },
  {
    name: 'Gestures',
    icon: '\u{1F44D}',
    emojis: [
      '\u{1F44B}','\u{1F91A}','\u{1F590}\u{FE0F}','\u{270B}','\u{1F596}','\u{1F44C}','\u{1F90C}',
      '\u{1F90F}','\u{270C}\u{FE0F}','\u{1F91E}','\u{1F91F}','\u{1F918}','\u{1F919}','\u{1F448}',
      '\u{1F449}','\u{1F446}','\u{1F595}','\u{1F447}','\u{261D}\u{FE0F}','\u{1F44D}','\u{1F44E}',
      '\u{270A}','\u{1F44A}','\u{1F91B}','\u{1F91C}','\u{1F44F}','\u{1F64C}','\u{1F450}','\u{1F932}',
      '\u{1F91D}','\u{1F64F}','\u{270D}\u{FE0F}','\u{1F485}','\u{1F933}','\u{1F4AA}','\u{1F9BE}',
      '\u{1F9BF}','\u{1F9B5}','\u{1F9B6}','\u{1F442}','\u{1F443}','\u{1F9E0}','\u{1FAC0}','\u{1FAC1}',
      '\u{1F9B7}','\u{1F9B4}','\u{1F440}','\u{1F441}\u{FE0F}','\u{1F445}','\u{1F444}',
    ],
  },
  {
    name: 'Hearts',
    icon: '\u{2764}\u{FE0F}',
    emojis: [
      '\u{2764}\u{FE0F}','\u{1F9E1}','\u{1F49B}','\u{1F49A}','\u{1F499}','\u{1F49C}','\u{1F5A4}',
      '\u{1FA76}','\u{1F90E}','\u{1F90D}','\u{1FA77}','\u{1F498}','\u{1F49D}','\u{1F496}','\u{1F497}',
      '\u{1F493}','\u{1F49E}','\u{1F495}','\u{1F49F}','\u{2763}\u{FE0F}','\u{1F494}','\u{2764}\u{FE0F}\u{200D}\u{1F525}',
      '\u{2764}\u{FE0F}\u{200D}\u{1FA79}','\u{1F48B}','\u{1F4AF}','\u{1F4A2}','\u{1F4A5}','\u{1F4AB}',
      '\u{1F4A6}','\u{1F4A8}','\u{1F573}\u{FE0F}','\u{1F4A3}','\u{1F4AC}','\u{1F4AD}','\u{1F4A4}',
    ],
  },
  {
    name: 'Animals',
    icon: '\u{1F436}',
    emojis: [
      '\u{1F435}','\u{1F412}','\u{1F98D}','\u{1F9A7}','\u{1F436}','\u{1F415}','\u{1F9AE}','\u{1F429}',
      '\u{1F43A}','\u{1F98A}','\u{1F99D}','\u{1F431}','\u{1F408}','\u{1F981}','\u{1F42F}','\u{1F405}',
      '\u{1F406}','\u{1F434}','\u{1F40E}','\u{1F984}','\u{1F993}','\u{1F98C}','\u{1F9AC}','\u{1F42E}',
      '\u{1F402}','\u{1F403}','\u{1F404}','\u{1F437}','\u{1F416}','\u{1F417}','\u{1F43D}','\u{1F40F}',
      '\u{1F411}','\u{1F410}','\u{1F42A}','\u{1F42B}','\u{1F999}','\u{1F992}','\u{1F418}','\u{1F9A3}',
      '\u{1F98F}','\u{1F99B}','\u{1F42D}','\u{1F401}','\u{1F400}','\u{1F439}','\u{1F430}','\u{1F407}',
      '\u{1F43F}\u{FE0F}','\u{1F9AB}','\u{1F994}','\u{1F987}','\u{1F43B}','\u{1F428}','\u{1F43C}',
      '\u{1F9A5}','\u{1F9A6}','\u{1F9A8}','\u{1F998}','\u{1F9A1}',
      '\u{1F43E}','\u{1F414}','\u{1F413}','\u{1F423}','\u{1F424}','\u{1F425}','\u{1F426}','\u{1F427}',
      '\u{1F54A}\u{FE0F}','\u{1F985}','\u{1F986}','\u{1F9A2}','\u{1F989}','\u{1F9A4}','\u{1FAB6}',
      '\u{1F9A9}','\u{1F99A}','\u{1F99C}',
      '\u{1F438}','\u{1F40A}','\u{1F422}','\u{1F98E}','\u{1F40D}','\u{1F432}','\u{1F409}','\u{1F995}','\u{1F996}',
      '\u{1F433}','\u{1F40B}','\u{1F42C}','\u{1F9AD}','\u{1F41F}','\u{1F420}','\u{1F421}','\u{1F988}',
      '\u{1F419}','\u{1F41A}','\u{1F40C}','\u{1F98B}','\u{1F41B}','\u{1F41C}','\u{1F41D}','\u{1FAB2}',
      '\u{1F41E}','\u{1F997}','\u{1FAB3}','\u{1F577}\u{FE0F}','\u{1F578}\u{FE0F}','\u{1F982}',
    ],
  },
  {
    name: 'Food',
    icon: '\u{1F354}',
    emojis: [
      '\u{1F347}','\u{1F348}','\u{1F349}','\u{1F34A}','\u{1F34B}','\u{1F34C}','\u{1F34D}','\u{1F96D}',
      '\u{1F34E}','\u{1F34F}','\u{1F350}','\u{1F351}','\u{1F352}','\u{1F353}','\u{1FAD0}','\u{1F95D}',
      '\u{1F345}','\u{1FAD2}','\u{1F965}','\u{1F951}','\u{1F346}','\u{1F954}','\u{1F955}','\u{1F33D}',
      '\u{1F336}\u{FE0F}','\u{1FAD1}','\u{1F952}','\u{1F96C}','\u{1F966}','\u{1F9C4}','\u{1F9C5}',
      '\u{1F344}','\u{1F95C}','\u{1FAD8}','\u{1F330}','\u{1F35E}','\u{1F950}','\u{1F956}','\u{1FAD3}',
      '\u{1F968}','\u{1F96F}','\u{1F95E}','\u{1F9C7}','\u{1F9C0}','\u{1F356}','\u{1F357}','\u{1F969}',
      '\u{1F953}','\u{1F354}','\u{1F35F}','\u{1F355}','\u{1F32D}','\u{1F96A}','\u{1F32E}','\u{1F32F}',
      '\u{1FAD4}','\u{1F959}','\u{1F9C6}','\u{1F95A}','\u{1F373}','\u{1F958}','\u{1F372}','\u{1FAD5}',
      '\u{1F963}','\u{1F957}','\u{1F37F}','\u{1F9C8}','\u{1F9C2}','\u{1F96B}',
      '\u{1F371}','\u{1F358}','\u{1F359}','\u{1F35A}','\u{1F35B}','\u{1F35C}','\u{1F35D}','\u{1F360}',
      '\u{1F362}','\u{1F363}','\u{1F364}','\u{1F365}','\u{1F96E}','\u{1F361}','\u{1F95F}','\u{1F960}',
      '\u{1F961}','\u{1F980}','\u{1F99E}','\u{1F990}','\u{1F991}','\u{1F9AA}',
      '\u{1F366}','\u{1F367}','\u{1F368}','\u{1F369}','\u{1F36A}','\u{1F382}','\u{1F370}','\u{1F9C1}',
      '\u{1F967}','\u{1F36B}','\u{1F36C}','\u{1F36D}','\u{1F36E}','\u{1F36F}',
      '\u{1F37C}','\u{1F95B}','\u{2615}','\u{1FAD6}','\u{1F375}','\u{1F376}','\u{1F37E}','\u{1F377}',
      '\u{1F378}','\u{1F379}','\u{1F37A}','\u{1F37B}','\u{1F942}','\u{1F943}','\u{1FAD7}','\u{1F964}',
      '\u{1F9CB}','\u{1F9C3}','\u{1F9C9}','\u{1F9CA}',
    ],
  },
  {
    name: 'Activities',
    icon: '\u{26BD}',
    emojis: [
      '\u{26BD}','\u{1F3C0}','\u{1F3C8}','\u{26BE}','\u{1F94E}','\u{1F3BE}','\u{1F3D0}','\u{1F3C9}',
      '\u{1F94F}','\u{1FA83}','\u{1F3B1}','\u{1FA80}','\u{1F3D3}','\u{1F3F8}','\u{1F3D2}','\u{1F3D1}',
      '\u{1F94D}','\u{1F3CF}','\u{1FA03}','\u{26F3}','\u{1FA81}','\u{1F3F9}','\u{1F3A3}','\u{1F94A}',
      '\u{1F94B}','\u{1F3BD}','\u{1F6F9}','\u{1F6FC}','\u{1F6F7}','\u{26F8}\u{FE0F}','\u{1F94C}',
      '\u{1F3BF}','\u{26F7}\u{FE0F}','\u{1F3C2}','\u{1FA82}','\u{1F3CB}\u{FE0F}','\u{1F93C}',
      '\u{1F938}','\u{26F9}\u{FE0F}','\u{1F93A}','\u{1F93E}','\u{1F3CC}\u{FE0F}','\u{1F3C7}',
      '\u{1F9D8}','\u{1F3C4}','\u{1F3CA}','\u{1F93D}','\u{1F6A3}','\u{1F9D7}','\u{1F6B5}','\u{1F6B4}',
      '\u{1F3C6}','\u{1F947}','\u{1F948}','\u{1F949}','\u{1F3C5}','\u{1F396}\u{FE0F}','\u{1F3F5}\u{FE0F}',
      '\u{1F397}\u{FE0F}','\u{1F3AB}','\u{1F3AA}','\u{1F939}',
      '\u{1F3AD}','\u{1F3A8}','\u{1F3AC}','\u{1F3A4}','\u{1F3A7}','\u{1F3BC}','\u{1F3B9}','\u{1F941}',
      '\u{1FA95}','\u{1F3B7}','\u{1FA97}','\u{1F3B8}','\u{1F3BB}','\u{1FA98}','\u{1F3BA}',
      '\u{1F3B2}','\u{265F}\u{FE0F}','\u{1F3AF}','\u{1F3B3}','\u{1F3AE}','\u{1F3B0}','\u{1F9E9}',
    ],
  },
  {
    name: 'Objects',
    icon: '\u{1F4A1}',
    emojis: [
      '\u{1F4F1}','\u{1F4BB}','\u{1F5A5}\u{FE0F}','\u{2328}\u{FE0F}','\u{1F5B1}\u{FE0F}','\u{1F4BD}',
      '\u{1F4BE}','\u{1F4BF}','\u{1F4C0}','\u{1F4FC}','\u{1F4F7}','\u{1F4F8}','\u{1F4F9}','\u{1F3A5}',
      '\u{1F4FD}\u{FE0F}','\u{1F4FA}','\u{1F4FB}','\u{1F399}\u{FE0F}','\u{1F39A}\u{FE0F}','\u{1F39B}\u{FE0F}',
      '\u{23F1}\u{FE0F}','\u{23F2}\u{FE0F}','\u{23F0}','\u{1F570}\u{FE0F}','\u{231B}','\u{23F3}',
      '\u{1F4E1}','\u{1F50B}','\u{1FAAB}','\u{1F50C}','\u{1F4A1}','\u{1F526}','\u{1F56F}\u{FE0F}',
      '\u{1FA99}','\u{1F4B0}','\u{1F4B4}','\u{1F4B5}','\u{1F4B6}','\u{1F4B7}','\u{1F4B8}','\u{1F4B3}',
      '\u{1F4E7}','\u{1F4E8}','\u{1F4E9}','\u{1F4E4}','\u{1F4E5}','\u{1F4E6}','\u{1F4EB}','\u{1F4EA}',
      '\u{1F4EC}','\u{1F4ED}','\u{1F4EE}','\u{1F4EF}','\u{1F4DC}','\u{1F4C3}','\u{1F4D1}','\u{1F4CA}',
      '\u{1F4C8}','\u{1F4C9}','\u{1F4C4}','\u{1F4C5}','\u{1F4C6}','\u{1F4CB}','\u{1F4CC}','\u{1F4CD}',
      '\u{1F4CE}','\u{1F587}\u{FE0F}','\u{1F4CF}','\u{1F4D0}','\u{2702}\u{FE0F}','\u{1F5C3}\u{FE0F}',
      '\u{1F5C4}\u{FE0F}','\u{1F5D1}\u{FE0F}','\u{1F512}','\u{1F513}','\u{1F50F}','\u{1F510}','\u{1F511}',
      '\u{1F5DD}\u{FE0F}','\u{1F528}','\u{1FA93}','\u{26CF}\u{FE0F}','\u{2692}\u{FE0F}','\u{1F6E0}\u{FE0F}',
      '\u{1F5E1}\u{FE0F}','\u{2694}\u{FE0F}','\u{1F52B}','\u{1FA83}','\u{1F6E1}\u{FE0F}','\u{1F527}',
      '\u{1FA9B}','\u{1F529}','\u{2699}\u{FE0F}','\u{1F9F2}','\u{1FA9C}',
      '\u{2696}\u{FE0F}','\u{1F517}','\u{26D3}\u{FE0F}','\u{1FA9D}','\u{1F9F0}','\u{1F9F2}',
    ],
  },
  {
    name: 'Symbols',
    icon: '\u{2705}',
    emojis: [
      '\u{2705}','\u{2714}\u{FE0F}','\u{274C}','\u{274E}','\u{2B50}','\u{1F31F}','\u{1F4A5}','\u{2728}',
      '\u{2757}','\u{2753}','\u{2755}','\u{2754}','\u{203C}\u{FE0F}','\u{2049}\u{FE0F}','\u{1F4A2}',
      '\u{1F6AB}','\u{1F198}','\u{1F4F4}','\u{1F4F3}','\u{1F508}','\u{1F509}','\u{1F50A}','\u{1F507}',
      '\u{1F514}','\u{1F515}','\u{1F3B5}','\u{1F3B6}','\u{1F4B2}','\u{1F4B1}','\u{00A9}\u{FE0F}',
      '\u{00AE}\u{FE0F}','\u{2122}\u{FE0F}','\u{1F51F}','\u{1F520}','\u{1F521}','\u{1F522}','\u{1F523}',
      '\u{1F524}','\u{1F170}\u{FE0F}','\u{1F18E}','\u{1F171}\u{FE0F}','\u{1F191}','\u{1F192}','\u{1F193}',
      '\u{2139}\u{FE0F}','\u{1F194}','\u{24C2}\u{FE0F}','\u{1F195}','\u{1F196}','\u{1F17E}\u{FE0F}',
      '\u{1F197}','\u{1F17F}\u{FE0F}','\u{1F199}','\u{1F19A}','\u{1F201}','\u{1F202}\u{FE0F}',
      '\u{25AA}\u{FE0F}','\u{25AB}\u{FE0F}','\u{25FB}\u{FE0F}','\u{25FC}\u{FE0F}','\u{25FD}','\u{25FE}',
      '\u{2B1B}','\u{2B1C}','\u{1F536}','\u{1F537}','\u{1F538}','\u{1F539}','\u{1F53A}','\u{1F53B}',
      '\u{1F4A0}','\u{1F518}','\u{1F533}','\u{1F532}',
      '\u{27A1}\u{FE0F}','\u{2B05}\u{FE0F}','\u{2B06}\u{FE0F}','\u{2B07}\u{FE0F}','\u{2197}\u{FE0F}',
      '\u{2198}\u{FE0F}','\u{2199}\u{FE0F}','\u{2196}\u{FE0F}','\u{2195}\u{FE0F}','\u{2194}\u{FE0F}',
      '\u{1F504}','\u{25B6}\u{FE0F}','\u{23E9}','\u{25C0}\u{FE0F}','\u{23EA}','\u{1F53C}','\u{1F53D}',
    ],
  },
  {
    name: 'Flags',
    icon: '\u{1F3C1}',
    emojis: [
      '\u{1F3C1}','\u{1F6A9}','\u{1F38C}','\u{1F3F4}','\u{1F3F3}\u{FE0F}',
      '\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}','\u{1F3F3}\u{FE0F}\u{200D}\u{26A7}\u{FE0F}',
      '\u{1F3F4}\u{200D}\u{2620}\u{FE0F}',
      '\u{1F1E9}\u{1F1EA}','\u{1F1E6}\u{1F1F9}','\u{1F1E8}\u{1F1ED}','\u{1F1EC}\u{1F1E7}',
      '\u{1F1FA}\u{1F1F8}','\u{1F1EB}\u{1F1F7}','\u{1F1EA}\u{1F1F8}','\u{1F1EE}\u{1F1F9}',
      '\u{1F1EF}\u{1F1F5}','\u{1F1E8}\u{1F1E6}','\u{1F1E6}\u{1F1FA}','\u{1F1E7}\u{1F1F7}',
      '\u{1F1F7}\u{1F1FA}','\u{1F1E8}\u{1F1F3}','\u{1F1EE}\u{1F1F3}','\u{1F1F0}\u{1F1F7}',
      '\u{1F1F2}\u{1F1FD}','\u{1F1F3}\u{1F1F1}','\u{1F1F5}\u{1F1F1}','\u{1F1F5}\u{1F1F9}',
      '\u{1F1F8}\u{1F1EA}','\u{1F1F9}\u{1F1F7}','\u{1F1FA}\u{1F1E6}','\u{1F1E7}\u{1F1EA}',
    ],
  },
];

/** @type {Map<string, string>} */
const EMOJI_KEYWORDS = new Map([
  ['\u{1F600}','grinning grin happy smile'],
  ['\u{1F603}','smiley happy smile open mouth'],
  ['\u{1F604}','smile happy eyes grin'],
  ['\u{1F601}','beaming grin smile eyes'],
  ['\u{1F606}','laughing laugh happy haha'],
  ['\u{1F605}','sweat smile nervous laugh'],
  ['\u{1F602}','joy laugh cry tears lol'],
  ['\u{1F923}','rofl rolling floor laughing lmao'],
  ['\u{1F60A}','blush happy smile shy'],
  ['\u{1F607}','innocent angel halo'],
  ['\u{1F642}','slight smile'],
  ['\u{1F643}','upside down silly'],
  ['\u{1F609}','wink ;)'],
  ['\u{1F60C}','relieved calm peaceful'],
  ['\u{1F60D}','heart eyes love crush'],
  ['\u{1F970}','smiling hearts love adore'],
  ['\u{1F618}','kiss blowing kiss love'],
  ['\u{1F617}','kissing lips'],
  ['\u{1F619}','kissing smiling eyes'],
  ['\u{1F61A}','kissing closed eyes'],
  ['\u{1F60B}','yummy delicious tongue tasty'],
  ['\u{1F61B}','tongue stuck out playful'],
  ['\u{1F61C}','wink tongue playful crazy'],
  ['\u{1F92A}','zany crazy wild goofy'],
  ['\u{1F61D}','squinting tongue disgusted playful'],
  ['\u{1F911}','money mouth dollar rich'],
  ['\u{1F917}','hugging hug'],
  ['\u{1F92D}','shushing quiet secret hand over mouth'],
  ['\u{1F92B}','shh quiet secret'],
  ['\u{1F914}','thinking think hmm'],
  ['\u{1F910}','zipper mouth shut secret quiet'],
  ['\u{1F928}','raised eyebrow suspicious skeptical'],
  ['\u{1F610}','neutral expressionless meh'],
  ['\u{1F611}','expressionless blank'],
  ['\u{1F636}','no mouth silent speechless'],
  ['\u{1F60F}','smirk smug'],
  ['\u{1F612}','unamused annoyed bored'],
  ['\u{1F644}','eye roll rolling eyes whatever'],
  ['\u{1F62C}','grimacing awkward cringe'],
  ['\u{1F925}','lying pinocchio liar'],
  ['\u{1F614}','pensive sad thoughtful'],
  ['\u{1F62A}','sleepy tired yawn'],
  ['\u{1F924}','drooling drool'],
  ['\u{1F634}','sleeping zzz sleep'],
  ['\u{1F637}','mask sick medical face'],
  ['\u{1F912}','thermometer sick fever ill'],
  ['\u{1F915}','bandage hurt injured'],
  ['\u{1F922}','nauseous sick gross'],
  ['\u{1F92E}','vomiting sick puke throw up'],
  ['\u{1F927}','sneezing sick cold'],
  ['\u{1F975}','hot warm heat sweating'],
  ['\u{1F976}','cold freezing frozen ice'],
  ['\u{1F974}','woozy dizzy drunk'],
  ['\u{1F635}','dizzy knocked out'],
  ['\u{1F929}','star struck starstruck excited wow'],
  ['\u{1F973}','party celebrate birthday hat'],
  ['\u{1F978}','disguised incognito'],
  ['\u{1F60E}','sunglasses cool'],
  ['\u{1F913}','nerd glasses geek'],
  ['\u{1F9D0}','monocle thinking curious'],
  ['\u{1F615}','confused unsure'],
  ['\u{1F61F}','worried anxious nervous'],
  ['\u{1F641}','slightly frowning sad'],
  ['\u{2639}\u{FE0F}','frowning sad unhappy'],
  ['\u{1F62E}','open mouth surprised wow'],
  ['\u{1F62F}','hushed surprised'],
  ['\u{1F632}','astonished shocked surprised'],
  ['\u{1F633}','flushed embarrassed red'],
  ['\u{1F97A}','pleading puppy eyes begging'],
  ['\u{1F626}','frowning open mouth worried'],
  ['\u{1F627}','anguished distressed'],
  ['\u{1F628}','fearful scared afraid'],
  ['\u{1F630}','anxious sweat nervous'],
  ['\u{1F625}','sad relieved disappointed'],
  ['\u{1F622}','crying cry sad tear'],
  ['\u{1F62D}','sobbing loud crying tears'],
  ['\u{1F631}','screaming fear horror omg'],
  ['\u{1F616}','confounded frustrated'],
  ['\u{1F623}','persevering determined'],
  ['\u{1F61E}','disappointed sad'],
  ['\u{1F613}','downcast sweat'],
  ['\u{1F629}','weary tired exhausted'],
  ['\u{1F62B}','tired exhausted'],
  ['\u{1F971}','yawning bored tired yawn'],
  ['\u{1F624}','triumph huff steam'],
  ['\u{1F620}','angry mad'],
  ['\u{1F621}','rage furious red angry'],
  ['\u{1F92C}','cursing swearing angry symbols'],
  ['\u{1F608}','smiling devil purple horns'],
  ['\u{1F47F}','imp devil angry'],
  ['\u{1F480}','skull dead death'],
  ['\u{2620}\u{FE0F}','skull crossbones death pirate poison'],
  ['\u{1F4A9}','poop poo shit'],
  ['\u{1F921}','clown'],
  ['\u{1F479}','ogre monster'],
  ['\u{1F47A}','goblin monster'],
  ['\u{1F47B}','ghost boo spooky'],
  ['\u{1F47D}','alien et ufo'],
  ['\u{1F47E}','alien monster space invader'],
  ['\u{1F916}','robot bot'],
  ['\u{1F63A}','cat grinning happy'],
  ['\u{1F638}','cat grin smile'],
  ['\u{1F639}','cat joy tears laugh'],
  ['\u{1F63B}','cat heart eyes love'],
  ['\u{1F63C}','cat smirk wry'],
  ['\u{1F63D}','cat kissing'],
  ['\u{1F640}','cat weary scared'],
  ['\u{1F63F}','cat crying sad'],
  ['\u{1F63E}','cat pouting angry'],
  ['\u{1F44B}','wave hello bye hand'],
  ['\u{1F91A}','raised back hand'],
  ['\u{1F590}\u{FE0F}','hand fingers splayed'],
  ['\u{270B}','raised hand stop high five'],
  ['\u{1F596}','vulcan spock'],
  ['\u{1F44C}','ok okay perfect'],
  ['\u{1F90C}','pinched fingers italian'],
  ['\u{1F90F}','pinching small'],
  ['\u{270C}\u{FE0F}','peace victory v'],
  ['\u{1F91E}','crossed fingers luck hope'],
  ['\u{1F91F}','love you gesture rock'],
  ['\u{1F918}','rock on horns metal'],
  ['\u{1F919}','call me hand shaka'],
  ['\u{1F448}','point left'],
  ['\u{1F449}','point right'],
  ['\u{1F446}','point up'],
  ['\u{1F595}','middle finger fuck'],
  ['\u{1F447}','point down'],
  ['\u{261D}\u{FE0F}','index point up'],
  ['\u{1F44D}','thumbs up yes good like'],
  ['\u{1F44E}','thumbs down no bad dislike'],
  ['\u{270A}','fist raised'],
  ['\u{1F44A}','fist bump punch'],
  ['\u{1F91B}','left fist bump'],
  ['\u{1F91C}','right fist bump'],
  ['\u{1F44F}','clap applause hands'],
  ['\u{1F64C}','raising hands celebrate hooray'],
  ['\u{1F450}','open hands'],
  ['\u{1F932}','palms up together'],
  ['\u{1F91D}','handshake deal agreement'],
  ['\u{1F64F}','pray please hope folded hands'],
  ['\u{270D}\u{FE0F}','writing hand'],
  ['\u{1F485}','nail polish nails'],
  ['\u{1F933}','selfie'],
  ['\u{1F4AA}','muscle strong flex bicep'],
  ['\u{1F9BE}','mechanical arm robot'],
  ['\u{1F9BF}','mechanical leg robot'],
  ['\u{1F9B5}','leg'],
  ['\u{1F9B6}','foot'],
  ['\u{1F442}','ear listen hear'],
  ['\u{1F443}','nose smell'],
  ['\u{1F9E0}','brain smart think'],
  ['\u{1FAC0}','anatomical heart organ'],
  ['\u{1FAC1}','lungs breathe'],
  ['\u{1F9B7}','tooth teeth'],
  ['\u{1F9B4}','bone skeleton'],
  ['\u{1F440}','eyes look see'],
  ['\u{1F441}\u{FE0F}','eye look see'],
  ['\u{1F445}','tongue lick taste'],
  ['\u{1F444}','lips mouth kiss'],
  ['\u{2764}\u{FE0F}','red heart love'],
  ['\u{1F9E1}','orange heart'],
  ['\u{1F49B}','yellow heart'],
  ['\u{1F49A}','green heart'],
  ['\u{1F499}','blue heart'],
  ['\u{1F49C}','purple heart'],
  ['\u{1F5A4}','black heart'],
  ['\u{1FA76}','grey heart'],
  ['\u{1F90E}','brown heart'],
  ['\u{1F90D}','white heart'],
  ['\u{1FA77}','pink heart'],
  ['\u{1F498}','cupid heart arrow'],
  ['\u{1F49D}','gift heart ribbon'],
  ['\u{1F496}','sparkling heart'],
  ['\u{1F497}','growing heart'],
  ['\u{1F493}','beating heart pulse'],
  ['\u{1F49E}','revolving hearts'],
  ['\u{1F495}','two hearts'],
  ['\u{1F49F}','heart decoration'],
  ['\u{2763}\u{FE0F}','heart exclamation'],
  ['\u{1F494}','broken heart'],
  ['\u{2764}\u{FE0F}\u{200D}\u{1F525}','heart fire burning'],
  ['\u{2764}\u{FE0F}\u{200D}\u{1FA79}','heart bandage mending healing'],
  ['\u{1F48B}','kiss mark lips'],
  ['\u{1F4AF}','100 hundred perfect score'],
  ['\u{1F4A2}','anger symbol'],
  ['\u{1F4A5}','boom collision explosion'],
  ['\u{1F4AB}','dizzy stars'],
  ['\u{1F4A6}','sweat droplets splash'],
  ['\u{1F4A8}','dash running wind'],
  ['\u{1F573}\u{FE0F}','hole'],
  ['\u{1F4A3}','bomb'],
  ['\u{1F4AC}','speech bubble chat talk'],
  ['\u{1F4AD}','thought bubble think'],
  ['\u{1F4A4}','zzz sleep'],
  ['\u{1F436}','dog face puppy'],
  ['\u{1F431}','cat face kitty'],
  ['\u{1F42D}','mouse face'],
  ['\u{1F439}','hamster face'],
  ['\u{1F430}','rabbit face bunny'],
  ['\u{1F98A}','fox face'],
  ['\u{1F43B}','bear face'],
  ['\u{1F43C}','panda face'],
  ['\u{1F428}','koala'],
  ['\u{1F42F}','tiger face'],
  ['\u{1F981}','lion face'],
  ['\u{1F42E}','cow face'],
  ['\u{1F437}','pig face'],
  ['\u{1F438}','frog face'],
  ['\u{1F435}','monkey face'],
  ['\u{1F648}','see no evil monkey'],
  ['\u{1F649}','hear no evil monkey'],
  ['\u{1F64A}','speak no evil monkey'],
  ['\u{1F412}','monkey'],
  ['\u{1F414}','chicken hen'],
  ['\u{1F427}','penguin'],
  ['\u{1F426}','bird'],
  ['\u{1F985}','eagle'],
  ['\u{1F986}','duck'],
  ['\u{1F989}','owl'],
  ['\u{1F987}','bat'],
  ['\u{1F43A}','wolf'],
  ['\u{1F417}','boar pig'],
  ['\u{1F434}','horse face'],
  ['\u{1F984}','unicorn horn'],
  ['\u{1F41D}','bee honeybee'],
  ['\u{1F41B}','bug caterpillar'],
  ['\u{1F98B}','butterfly'],
  ['\u{1F40C}','snail'],
  ['\u{1F41A}','shell'],
  ['\u{1F41E}','ladybug'],
  ['\u{1F997}','cricket'],
  ['\u{1F577}\u{FE0F}','spider'],
  ['\u{1F578}\u{FE0F}','spider web'],
  ['\u{1F982}','scorpion'],
  ['\u{1F40D}','snake'],
  ['\u{1F422}','turtle tortoise'],
  ['\u{1F98E}','lizard'],
  ['\u{1F40A}','crocodile alligator'],
  ['\u{1F433}','whale spouting'],
  ['\u{1F40B}','whale'],
  ['\u{1F42C}','dolphin'],
  ['\u{1F41F}','fish'],
  ['\u{1F420}','tropical fish'],
  ['\u{1F421}','blowfish puffer'],
  ['\u{1F988}','shark'],
  ['\u{1F419}','octopus'],
  ['\u{1F34E}','apple red'],
  ['\u{1F34F}','apple green'],
  ['\u{1F34A}','tangerine orange mandarin'],
  ['\u{1F34B}','lemon citrus'],
  ['\u{1F34C}','banana'],
  ['\u{1F349}','watermelon'],
  ['\u{1F347}','grapes'],
  ['\u{1F353}','strawberry'],
  ['\u{1FAD0}','blueberries'],
  ['\u{1F348}','melon'],
  ['\u{1F352}','cherries'],
  ['\u{1F351}','peach butt'],
  ['\u{1F96D}','mango'],
  ['\u{1F34D}','pineapple'],
  ['\u{1F965}','coconut'],
  ['\u{1F345}','tomato'],
  ['\u{1F346}','eggplant aubergine'],
  ['\u{1F951}','avocado'],
  ['\u{1F955}','carrot'],
  ['\u{1F33D}','corn'],
  ['\u{1F336}\u{FE0F}','hot pepper chili spicy'],
  ['\u{1F952}','cucumber pickle'],
  ['\u{1F96C}','leafy green salad lettuce'],
  ['\u{1F966}','broccoli'],
  ['\u{1F344}','mushroom'],
  ['\u{1F95C}','peanuts'],
  ['\u{1F950}','croissant bread french'],
  ['\u{1F35E}','bread loaf'],
  ['\u{1F956}','baguette french bread'],
  ['\u{1F968}','pretzel'],
  ['\u{1F9C0}','cheese wedge'],
  ['\u{1F356}','meat bone leg'],
  ['\u{1F357}','poultry leg chicken drumstick'],
  ['\u{1F969}','steak cut meat'],
  ['\u{1F953}','bacon'],
  ['\u{1F354}','hamburger burger'],
  ['\u{1F35F}','fries french fries'],
  ['\u{1F355}','pizza slice'],
  ['\u{1F32D}','hotdog sausage'],
  ['\u{1F96A}','sandwich'],
  ['\u{1F32E}','taco'],
  ['\u{1F32F}','burrito wrap'],
  ['\u{1F959}','stuffed flatbread pita'],
  ['\u{1F9C6}','falafel'],
  ['\u{1F95A}','egg'],
  ['\u{1F373}','cooking fried egg pan'],
  ['\u{1F372}','stew pot food'],
  ['\u{1F35D}','spaghetti pasta noodles'],
  ['\u{1F35C}','ramen noodle soup'],
  ['\u{1F363}','sushi'],
  ['\u{1F371}','bento box'],
  ['\u{1F364}','fried shrimp tempura'],
  ['\u{1F35B}','curry rice'],
  ['\u{1F35A}','rice bowl'],
  ['\u{1F358}','rice cracker'],
  ['\u{1F359}','rice ball onigiri'],
  ['\u{1F36A}','cookie'],
  ['\u{1F382}','birthday cake'],
  ['\u{1F370}','cake shortcake slice'],
  ['\u{1F9C1}','cupcake muffin'],
  ['\u{1F36B}','chocolate bar'],
  ['\u{1F36C}','candy sweet'],
  ['\u{1F36D}','lollipop'],
  ['\u{1F36E}','custard pudding flan'],
  ['\u{1F36F}','honey pot'],
  ['\u{1F37C}','baby bottle milk'],
  ['\u{1F95B}','glass milk'],
  ['\u{2615}','coffee hot beverage tea'],
  ['\u{1F375}','tea green teacup'],
  ['\u{1F376}','sake'],
  ['\u{1F37A}','beer mug'],
  ['\u{1F37B}','clinking beer mugs cheers'],
  ['\u{1F942}','clinking glasses champagne cheers toast'],
  ['\u{1F377}','wine glass red'],
  ['\u{1F943}','tumbler glass whiskey'],
  ['\u{1F378}','cocktail martini drink'],
  ['\u{1F379}','tropical drink'],
  ['\u{1F9CB}','bubble tea boba'],
  ['\u{1F9C3}','juice box'],
  ['\u{1F9C9}','mate'],
  ['\u{1F9CA}','ice cube'],
  ['\u{1F3B5}','music note'],
  ['\u{1F3B6}','music notes'],
  ['\u{1F3A4}','microphone karaoke sing'],
  ['\u{1F3A7}','headphone headphones music'],
  ['\u{1F3B8}','guitar music'],
  ['\u{1F3B9}','piano keyboard music'],
  ['\u{1F3BA}','trumpet music'],
  ['\u{1F3BB}','violin music'],
  ['\u{1FA95}','banjo music'],
  ['\u{1F941}','drum music'],
  ['\u{1F4F1}','phone mobile smartphone'],
  ['\u{1F4BB}','laptop computer'],
  ['\u{1F5A5}\u{FE0F}','desktop computer monitor screen'],
  ['\u{1F4F7}','camera photo'],
  ['\u{1F4F9}','video camera'],
  ['\u{1F3AC}','clapper board movie film'],
  ['\u{1F4FA}','television tv'],
  ['\u{1F4FB}','radio'],
  ['\u{1F50A}','speaker loud volume sound'],
  ['\u{1F514}','bell notification'],
  ['\u{1F4E3}','megaphone announcement'],
  ['\u{1F4E2}','loudspeaker'],
  ['\u{1F4A1}','light bulb idea'],
  ['\u{1F526}','flashlight torch'],
  ['\u{1F3AE}','video game controller gamepad'],
  ['\u{1F3B2}','dice game'],
  ['\u{1F3AF}','bullseye target dart'],
  ['\u{1F3B0}','slot machine casino'],
  ['\u{1F3B3}','bowling'],
  ['\u{1F52E}','crystal ball fortune'],
  ['\u{1F4B0}','money bag rich'],
  ['\u{1F4B3}','credit card'],
  ['\u{1F48E}','gem diamond jewel'],
  ['\u{1F527}','wrench tool'],
  ['\u{1F528}','hammer tool'],
  ['\u{1F529}','nut bolt'],
  ['\u{1F6E0}\u{FE0F}','hammer wrench tools'],
  ['\u{1F52A}','knife blade'],
  ['\u{1F4E6}','package box parcel'],
  ['\u{1F4E7}','email inbox'],
  ['\u{1F4E8}','incoming envelope email'],
  ['\u{1F4DD}','memo note write'],
  ['\u{1F4C4}','page document'],
  ['\u{1F4CB}','clipboard'],
  ['\u{1F4CE}','paperclip'],
  ['\u{1F512}','lock locked'],
  ['\u{1F513}','unlock unlocked open'],
  ['\u{1F511}','key'],
  ['\u{1F50D}','magnifying glass search left'],
  ['\u{1F50E}','magnifying glass search right'],
  ['\u{2705}','check mark green done yes'],
  ['\u{274C}','cross mark red no x'],
  ['\u{274E}','cross mark red square'],
  ['\u{2795}','plus add'],
  ['\u{2796}','minus subtract'],
  ['\u{2797}','divide division'],
  ['\u{2716}\u{FE0F}','multiply x'],
  ['\u{267B}\u{FE0F}','recycle recycling'],
  ['\u{269B}\u{FE0F}','atom science'],
  ['\u{1F525}','fire lit hot flame'],
  ['\u{1F4A7}','droplet water'],
  ['\u{1F30A}','wave ocean water'],
  ['\u{1F384}','christmas tree xmas'],
  ['\u{1F383}','jack o lantern halloween pumpkin'],
  ['\u{1F381}','gift present wrapped'],
  ['\u{1F389}','party popper tada celebration'],
  ['\u{1F38A}','confetti ball'],
  ['\u{1F3C6}','trophy winner cup award'],
  ['\u{1F3C5}','medal sports'],
  ['\u{1F947}','gold medal first place'],
  ['\u{1F948}','silver medal second place'],
  ['\u{1F949}','bronze medal third place'],
  ['\u{26BD}','soccer football'],
  ['\u{1F3C0}','basketball'],
  ['\u{1F3C8}','american football'],
  ['\u{26BE}','baseball'],
  ['\u{1F3BE}','tennis'],
  ['\u{1F3D0}','volleyball'],
  ['\u{26A0}\u{FE0F}','warning caution'],
  ['\u{1F6AB}','prohibited forbidden no'],
  ['\u{2B50}','star yellow gold'],
  ['\u{1F31F}','glowing star sparkle'],
  ['\u{2728}','sparkles magic shine'],
  ['\u{1F308}','rainbow'],
  ['\u{2600}\u{FE0F}','sun sunny weather'],
  ['\u{1F324}\u{FE0F}','sun cloud partly cloudy'],
  ['\u{26C5}','sun behind cloud cloudy'],
  ['\u{1F327}\u{FE0F}','rain cloud rainy'],
  ['\u{26C8}\u{FE0F}','thunder rain storm'],
  ['\u{1F329}\u{FE0F}','lightning bolt thunder'],
  ['\u{2744}\u{FE0F}','snowflake cold winter'],
  ['\u{1F4AA}','muscle strong flex'],
  ['\u{1F3C1}','checkered flag race finish'],
  ['\u{1F6A9}','triangular flag'],
  ['\u{1F38C}','crossed flags'],
  ['\u{1F3F4}','black flag'],
  ['\u{1F3F3}\u{FE0F}','white flag surrender'],
  ['\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}','rainbow flag pride lgbtq'],
  ['\u{1F3F3}\u{FE0F}\u{200D}\u{26A7}\u{FE0F}','transgender flag trans'],
  ['\u{1F3F4}\u{200D}\u{2620}\u{FE0F}','pirate flag skull'],
  ['\u{1F1E9}\u{1F1EA}','germany german de flag'],
  ['\u{1F1E6}\u{1F1F9}','austria flag at'],
  ['\u{1F1E8}\u{1F1ED}','switzerland swiss flag ch'],
  ['\u{1F1EC}\u{1F1E7}','uk united kingdom britain flag gb'],
  ['\u{1F1FA}\u{1F1F8}','usa united states america flag us'],
  ['\u{1F1EB}\u{1F1F7}','france french flag fr'],
  ['\u{1F1EA}\u{1F1F8}','spain spanish flag es'],
  ['\u{1F1EE}\u{1F1F9}','italy italian flag it'],
  ['\u{1F1EF}\u{1F1F5}','japan japanese flag jp'],
  ['\u{1F1E8}\u{1F1E6}','canada canadian flag ca'],
  ['\u{1F1E6}\u{1F1FA}','australia australian flag au'],
  ['\u{1F1E7}\u{1F1F7}','brazil brazilian flag br'],
  ['\u{1F1F7}\u{1F1FA}','russia russian flag ru'],
  ['\u{1F1E8}\u{1F1F3}','china chinese flag cn'],
  ['\u{1F1EE}\u{1F1F3}','india indian flag in'],
  ['\u{1F1F0}\u{1F1F7}','korea south korean flag kr'],
  ['\u{1F1F2}\u{1F1FD}','mexico mexican flag mx'],
  ['\u{1F1F3}\u{1F1F1}','netherlands dutch flag nl'],
  ['\u{1F1F5}\u{1F1F1}','poland polish flag pl'],
  ['\u{1F1F5}\u{1F1F9}','portugal portuguese flag pt'],
  ['\u{1F1F8}\u{1F1EA}','sweden swedish flag se'],
  ['\u{1F1F9}\u{1F1F7}','turkey turkish flag tr'],
  ['\u{1F1FA}\u{1F1E6}','ukraine ukrainian flag ua'],
  ['\u{1F1E7}\u{1F1EA}','belgium belgian flag be'],
]);

const MAX_FREQUENT = 24;

let pickerEl = null;
let onSelectCallback = null;
let frequentCache = {};

/**
 * @returns {Promise<object>}
 */
async function loadFrequent() {
  const settings = await window.gimodi.settings.load() || {};
  frequentCache = settings.emojiFrequent || {};
  return frequentCache;
}

/**
 * @returns {object}
 */
function getFrequent() {
  return frequentCache;
}

/**
 * @param {string} emoji
 */
async function recordUsage(emoji) {
  frequentCache[emoji] = (frequentCache[emoji] || 0) + 1;
  const settings = await window.gimodi.settings.load() || {};
  settings.emojiFrequent = frequentCache;
  window.gimodi.settings.save(settings);
}

/**
 * @returns {string[]}
 */
function getTopEmojis() {
  return Object.entries(frequentCache)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_FREQUENT)
    .map(([emoji]) => emoji);
}

loadFrequent();

function buildPicker() {
  const container = document.createElement('div');
  container.className = 'emoji-picker';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'emoji-search';
  searchInput.placeholder = 'Search...';
  container.appendChild(searchInput);

  const tabs = document.createElement('div');
  tabs.className = 'emoji-tabs';

  const freqTab = document.createElement('button');
  freqTab.className = 'emoji-tab active';
  freqTab.textContent = '\u{1F552}';
  freqTab.title = 'Frequently Used';
  freqTab.dataset.category = 'frequent';
  tabs.appendChild(freqTab);

  for (const cat of EMOJI_CATEGORIES) {
    const tab = document.createElement('button');
    tab.className = 'emoji-tab';
    tab.textContent = cat.icon;
    tab.title = cat.name;
    tab.dataset.category = cat.name;
    tabs.appendChild(tab);
  }
  container.appendChild(tabs);

  const gridContainer = document.createElement('div');
  gridContainer.className = 'emoji-grid-container';
  container.appendChild(gridContainer);

  renderCategory(gridContainer, null);

  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.emoji-tab');
    if (!tab) return;
    for (const t of tabs.querySelectorAll('.emoji-tab')) t.classList.remove('active');
    tab.classList.add('active');
    searchInput.value = '';
    const catName = tab.dataset.category;
    if (catName === 'frequent') {
      renderCategory(gridContainer, null);
    } else {
      const cat = EMOJI_CATEGORIES.find(c => c.name === catName);
      renderCategory(gridContainer, cat);
    }
  });

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      const activeTab = tabs.querySelector('.emoji-tab.active');
      const catName = activeTab?.dataset.category;
      if (catName === 'frequent') {
        renderCategory(gridContainer, null);
      } else {
        const cat = EMOJI_CATEGORIES.find(c => c.name === catName);
        renderCategory(gridContainer, cat);
      }
      return;
    }
    renderFilteredEmojis(gridContainer, query);
  });

  gridContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-btn');
    if (!btn) return;
    const emoji = btn.dataset.emoji;
    if (emoji && onSelectCallback) {
      recordUsage(emoji);
      onSelectCallback(emoji);
    }
  });

  return container;
}

function renderCategory(container, category) {
  container.innerHTML = '';

  if (!category) {
    const topEmojis = getTopEmojis();
    if (topEmojis.length > 0) {
      const label = document.createElement('div');
      label.className = 'emoji-category-label';
      label.textContent = 'Frequently Used';
      container.appendChild(label);
      container.appendChild(buildGrid(topEmojis));
    } else {
      const hint = document.createElement('div');
      hint.className = 'emoji-empty-hint';
      hint.textContent = 'Your frequently used emojis will appear here';
      container.appendChild(hint);
    }
    return;
  }

  const label = document.createElement('div');
  label.className = 'emoji-category-label';
  label.textContent = category.name;
  container.appendChild(label);
  container.appendChild(buildGrid(category.emojis));
}

function renderAllEmojis(container) {
  container.innerHTML = '';

  const topEmojis = getTopEmojis();
  if (topEmojis.length > 0) {
    const label = document.createElement('div');
    label.className = 'emoji-category-label';
    label.textContent = 'Frequently Used';
    container.appendChild(label);
    container.appendChild(buildGrid(topEmojis));
  }

  for (const cat of EMOJI_CATEGORIES) {
    const label = document.createElement('div');
    label.className = 'emoji-category-label';
    label.textContent = cat.name;
    container.appendChild(label);
    container.appendChild(buildGrid(cat.emojis));
  }
}

function renderFilteredEmojis(container, query) {
  container.innerHTML = '';
  const allEmojis = EMOJI_CATEGORIES.flatMap(c => c.emojis);
  const matched = allEmojis.filter(emoji => {
    const keywords = EMOJI_KEYWORDS.get(emoji);
    return keywords && keywords.includes(query);
  });

  if (matched.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'emoji-empty-hint';
    hint.textContent = 'No emojis found';
    container.appendChild(hint);
    return;
  }

  container.appendChild(buildGrid(matched));
}

function buildGrid(emojis) {
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  for (const emoji of emojis) {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.dataset.emoji = emoji;
    btn.textContent = emoji;
    grid.appendChild(btn);
  }
  return grid;
}

export function toggleEmojiPicker(anchorEl, onSelect) {
  if (pickerEl) {
    closePicker();
    return;
  }

  onSelectCallback = onSelect;
  pickerEl = buildPicker();
  document.body.appendChild(pickerEl);

  const rect = anchorEl.getBoundingClientRect();
  pickerEl.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
  pickerEl.style.right = (window.innerWidth - rect.right) + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick);
  }, 0);
}

function onOutsideClick(e) {
  if (pickerEl && !pickerEl.contains(e.target) && !e.target.closest('.btn-emoji')) {
    closePicker();
  }
}

function closePicker() {
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
  document.removeEventListener('mousedown', onOutsideClick);
  onSelectCallback = null;
}

export function isPickerOpen() {
  return !!pickerEl;
}
