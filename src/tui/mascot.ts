// ASCII art mascots - cute anime characters for the agent
// "Hua" - the magical coding girl

export const mascots = {
  hua: `
         ✦
        /\\     ♡
       /  \\   /
      / ✦  \\ / ✧
     /______\\
    /  ◕   ◕  \\      Hua
   /     ▽      \\   "Code is
  /_____________\\    my magic!"
       |  |
      /|  |\\
     (_|  |_)`,

  huaHappy: `
    \\(^o^)/
     |∇|
   ✧ Code ✧
    Princess`,

  huaThinking: `
     (°▽°;)
     |  ?
   ...thinking...`,

  huaCoding: `
     (>ω<)つ
     |⌨|≡
   ✦ coding ✦
   !  FAST  !`,

  huaCasting: `
    ✧･ﾟ:*✧
    (✧◡✧)ノ
    ╰(☆‿☆)╯
   ~ Magic ~`,

  huaSuccess: `
    \\(★ω★)/
     ╰|─|╯
   ✦ SUCCESS! ✦`,

  huaError: `
    (；ω；)
     |╯╰|
    error...`,

  smallHua: '(◕‿◕)✧',
  winkHua: '(◕‵‿‵◕)♡',
  sleepHua: '(－ω－) zzZ',
  excitedHua: '☆*:.｡.o(≧▽≦)o.｡.:*☆',

  // Cute borders
  border1: '╭─────────────────────────────────────────────╮',
  border2: '│  ✦ hua-chan is online ✦                    │',
  border3: '╰─────────────────────────────────────────────╯',

  // Loading animations frames
  loadFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  sakuraFrames: ['🌸', '✨', '💖', '✿', '❀'],
  magicFrames: ['✦', '✧', '⋆', '✩', '✪'],
};

// Status emojis with anime flair
export const statusEmojis = {
  ready: '⚡',
  thinking: '🧠',
  coding: '⌨️',
  searching: '🔍',
  success: '✨',
  error: '💥',
  warning: '⚠️',
  info: '💡',
  magic: '✨',
  save: '💾',
  load: '📂',
  quest: '📜',
  level: '🌟',
};

// Cute tool icons
export const toolIcons: Record<string, string> = {
  read: '📖',
  write: '✏️',
  edit: '✂️',
  bash: '🖥️',
  search: '🔍',
  grep: '🔎',
  web: '🌐',
  fetch: '📡',
  memory: '🧠',
  plan: '📋',
  default: '⚙️',
};

export const getToolIcon = (name: string): string => {
  return toolIcons[name] || toolIcons.default;
};
