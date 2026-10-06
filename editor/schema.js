/* TapDot Editor — block definitions, theme schema and starter templates.
   Plain script (no modules) so index.html also works when opened from disk. */
(function () {
  const TD = (window.TD = window.TD || {});

  // Any rgb()/rgba()/#rgb color → #rrggbb, or #rrggbbaa when see-through. Other text is returned as-is.
  TD.hex = (c) => {
    c = String(c == null ? '' : c).trim();
    let m = /^#?([0-9a-f]{3,4})$/i.exec(c);
    if (m) return '#' + m[1].split('').map((x) => x + x).join('').toLowerCase().replace(/ff$/, (x) => (m[1].length === 4 ? '' : x));
    m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
    if (m) return ('#' + m[1]).toLowerCase().replace(/^(#[0-9a-f]{6})ff$/, '$1');
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c);
    if (!m) return c;
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
    const hx = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + hx(+m[1]) + hx(+m[2]) + hx(+m[3]) + (a < 1 ? hx(a * 255) : '');
  };
  // Convert every rgb()/rgba() string in a project to hex (older saves used rgba).
  TD.hexAll = (o) => {
    if (Array.isArray(o)) o.forEach((v, i) => { if (typeof v === 'string' && /^rgba?\(/i.test(v)) o[i] = TD.hex(v); else if (v && typeof v === 'object') TD.hexAll(v); });
    else if (o && typeof o === 'object') Object.keys(o).forEach((k) => { const v = o[k]; if (typeof v === 'string' && /^rgba?\(/i.test(v)) o[k] = TD.hex(v); else if (v && typeof v === 'object') TD.hexAll(v); });
    return o;
  };

  // Icon as a short label for lists: the emoji, or 🖼️ for an uploaded image.
  TD.iconLabel = (v) => (!v ? '' : /^(https?:|data:image\/)/i.test(v) ? '🖼️ ' : v + ' ');

  TD.uid = (p) => (p || 'b') + Math.random().toString(36).slice(2, 8);
  TD.clone = (o) => JSON.parse(JSON.stringify(o));

  // ── Shared option lists ──────────────────────────────────────────────
  TD.ASPECTS = [
    ['16/9', 'Wide 16:9'], ['3/2', 'Photo 3:2'], ['4/3', 'Classic 4:3'], ['1/1', 'Square'],
    ['4/5', 'Portrait 4:5'], ['9/16', 'Tall 9:16'], ['21/9', 'Cinema 21:9'], ['auto', 'Original size'],
  ];
  TD.FONTS = [
    ['Inter', 'Inter'], ['system', 'System (San Francisco / Roboto)'], ['Poppins', 'Poppins'],
    ['Montserrat', 'Montserrat'], ['Nunito', 'Nunito'], ['Lato', 'Lato'], ['Roboto', 'Roboto'],
    ['Open Sans', 'Open Sans'], ['DM Sans', 'DM Sans'], ['Merriweather', 'Merriweather (serif)'],
    ['Playfair Display', 'Playfair Display (serif)'], ['Lora', 'Lora (serif)'],
  ];
  TD.TIMEZONES = [
    ['America/Chicago', 'Central'], ['America/New_York', 'Eastern'], ['America/Denver', 'Mountain'],
    ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'],
    ['Pacific/Honolulu', 'Hawaii'], ['Europe/London', 'London'], ['UTC', 'UTC'],
  ];
  TD.ACTIONS = [
    ['none', 'Does nothing'],
    ['link', 'Open a link'],
    ['popup', 'Open page in pop-up sheet'],
    ['sheet', 'Open one of my pop-up menus'],
    ['copy', 'Copy text to clipboard'],
    ['phone', 'Call a phone number'],
    ['sms', 'Send a text message'],
    ['email', 'Send an email'],
    ['scroll', 'Scroll to a block'],
    ['share', 'Share this page'],
  ];
  TD.EMOJIS = '🙏 ✚ 💵 👋 🚧 🤝 📖 💧 👥 📅 ⛪ ✝️ ❤️ 🎉 📣 🎵 🎤 📺 ▶️ 📍 📞 ✉️ 💬 🔗 📋 🍕 ☕ 🎁 🙌 👶 🎮 📚 👴 🏠 🚗 🕒 ⭐ 🔥 🌱 💡 ✅ 📷 🎬 🧭 🛐 🕊️ 🌎 💒'.split(' ');

  TD.newAction = (type) => ({ type: type || 'none', url: '', newTab: false, title: '', icon: '', sheet: '', text: '', toast: 'Copied!', phone: '', body: '', email: '', subject: '', target: '', direct: false });

  // ── Fields every block gets (style + visibility) ─────────────────────
  TD.COMMON_FIELDS = [
    { group: 'Style overrides', fields: [
      { k: 'style.card', t: 'color', l: 'Card color', hint: 'Blank uses the theme.' },
      { k: 'style.card2', t: 'color', l: 'Card pressed color' },
      { k: 'style.text', t: 'color', l: 'Text color' },
      { k: 'style.muted', t: 'color', l: 'Secondary text color' },
      { k: 'style.accent', t: 'color', l: 'Accent color' },
      { k: 'style.radius', t: 'range', l: 'Corner radius', min: -1, max: 40, unit: 'px', hint: 'Far left (−1) uses the theme.' },
      { k: 'style.mt', t: 'range', l: 'Space above', min: -1, max: 80, unit: 'px', hint: 'Far left (−1) uses the theme spacing.' },
      { k: 'style.side', t: 'range', l: 'Side margin', min: -1, max: 40, unit: 'px', hint: 'Far left (−1) uses the theme. 0 = edge to edge.' },
      { k: 'anchor', t: 'text', l: 'Anchor name', ph: 'e.g. events', hint: 'Lets buttons scroll to this block.' },
      { k: 'cssClass', t: 'text', l: 'Extra CSS class' },
    ] },
  ];

  const commonDefaults = () => ({
    hidden: false, anchor: '', cssClass: '',
    style: { card: '', card2: '', text: '', muted: '', accent: '', radius: -1, mt: -1, side: -1 },
    hideIn: [], // time tabs ('normal' or a time id) where this block is hidden
  });


  // ── Block types ──────────────────────────────────────────────────────
  TD.BLOCKS = {
    hero: {
      name: 'Hero', icon: '🖼️', desc: 'Large image or slideshow with a title card',
      fields: [
        { k: 'images', t: 'images', l: 'Images', hint: 'Add more than one to make a fading slideshow.' },
        { k: 'interval', t: 'range', l: 'Seconds per image', min: 2, max: 20, unit: 's', when: (b) => b.images.length > 1 },
        { k: 'aspect', t: 'select', l: 'Image shape', opts: TD.ASPECTS },
        { k: 'fit', t: 'select', l: 'Image fit', opts: [['cover', 'Fill (crop edges)'], ['contain', 'Fit (show whole image)']] },
        { k: 'textPos', t: 'select', l: 'Title position', opts: [['below', 'Below the image'], ['overlay', 'On top of the image'], ['none', 'No title']] },
        { k: 'title', t: 'text', l: 'Title', rich: true, when: (b) => b.textPos !== 'none' },
        { k: 'subtitle', t: 'text', l: 'Subtitle', when: (b) => b.textPos !== 'none', rich: true },
        { k: 'titleSize', t: 'range', l: 'Title size', min: 14, max: 44, unit: 'px', when: (b) => b.textPos !== 'none' },
        { k: 'align', t: 'select', l: 'Text alignment', opts: [['left', 'Left'], ['center', 'Center']], when: (b) => b.textPos !== 'none' },
        { k: 'action', t: 'action', l: 'When tapped' },
      ],
      defaults: () => ({ images: [], interval: 7, aspect: '16/9', fit: 'cover', textPos: 'below', title: '==Welcome== Home', subtitle: "We're glad you're here.", titleSize: 23, align: 'left', action: TD.newAction() }),
      summary: (b) => b.title,
    },
    heading: {
      name: 'Section heading', icon: '🔤', desc: 'Title with an optional “See all” link',
      fields: [
        { k: 'title', t: 'text', l: 'Heading', rich: true },
        { k: 'size', t: 'range', l: 'Size', min: 12, max: 36, unit: 'px' },
        { k: 'align', t: 'select', l: 'Alignment', opts: [['left', 'Left'], ['center', 'Center']] },
        { k: 'linkText', t: 'text', l: 'Link text', ph: 'See All' },
        { k: 'action', t: 'action', l: 'Link action', when: (b) => !!b.linkText },
      ],
      defaults: () => ({ title: 'Section', size: 18, align: 'left', linkText: '', action: TD.newAction() }),
      summary: (b) => b.title,
    },
    text: {
      name: 'Text', icon: '📝', desc: 'Paragraphs, plain or in a card',
      fields: [
        { k: 'body', t: 'textarea', l: 'Text', rich: true, hint: 'Blank line = new paragraph.' },
        { k: 'size', t: 'range', l: 'Text size', min: 11, max: 28, unit: 'px' },
        { k: 'align', t: 'select', l: 'Alignment', opts: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
        { k: 'muted', t: 'checkbox', l: 'Use secondary (dimmer) text color' },
        { k: 'card', t: 'checkbox', l: 'Show inside a card' },
      ],
      defaults: () => ({ body: 'Write something here.', size: 15, align: 'left', muted: false, card: false }),
      summary: (b) => b.body,
    },
    buttons: {
      name: 'Buttons', icon: '🔘', desc: 'Pill, block or grid buttons (links, pop-ups, copy…)',
      fields: [
        { k: 'layout', t: 'select', l: 'Layout', opts: [['scroll', 'Side-scrolling row'], ['wrap', 'Wrapping row'], ['grid2', 'Grid, 2 across'], ['grid3', 'Grid, 3 across'], ['stack', 'Full-width stack']] },
        { k: 'variant', t: 'select', l: 'Style', opts: [['card', 'Card color'], ['accent', 'Accent color'], ['outline', 'Outline']] },
        { k: 'shape', t: 'range', l: 'Button roundness', min: -1, max: 50, unit: 'px', hint: 'Far left (−1) uses the theme button roundness.' },
        { k: 'size', t: 'select', l: 'Size', opts: [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']] },
        { k: 'items', t: 'list', l: 'Buttons', itemName: 'Button', itemLabel: (i) => TD.iconLabel(i.icon) + (i.label || 'Button'),
          item: [
            { k: 'label', t: 'text', l: 'Label', rich: true },
            { k: 'icon', t: 'emoji', l: 'Icon (emoji)' },
            { k: 'iconBg', t: 'color', l: 'Icon circle color' },
            { k: 'bg', t: 'color', l: 'Button color' },
            { k: 'color', t: 'color', l: 'Label color' },
            { k: 'action', t: 'action', l: 'When tapped' },
          ],
          newItem: () => ({ label: 'Button', icon: '', iconBg: '', bg: '', color: '', action: TD.newAction('link') }) },
      ],
      defaults: () => ({ layout: 'scroll', variant: 'card', shape: -1, size: 'md', items: [{ label: 'Button', icon: '⭐', iconBg: '#3b7de133', bg: '', color: '', action: TD.newAction('link') }] }),
      summary: (b) => b.items.map((i) => i.label).join(' · '),
    },
    banner: {
      name: 'Banner card', icon: '🪧', desc: 'Tappable card with icon, eyebrow, title and arrow',
      fields: [
        { k: 'icon', t: 'emoji', l: 'Icon (emoji)' },
        { k: 'iconBg', t: 'color', l: 'Icon background' },
        { k: 'image', t: 'image', l: 'Image instead of icon' },
        { k: 'eyebrow', t: 'text', l: 'Small label above title', ph: 'New here?', rich: true },
        { k: 'title', t: 'text', l: 'Title', rich: true },
        { k: 'subtitle', t: 'text', l: 'Subtitle', rich: true },
        { k: 'arrow', t: 'checkbox', l: 'Show arrow ›' },
        { k: 'action', t: 'action', l: 'When tapped' },
      ],
      defaults: () => ({ icon: '👋', iconBg: '#3b7de133', image: '', eyebrow: '', title: 'Banner title', subtitle: 'A short description.', arrow: true, action: TD.newAction('link') }),
      summary: (b) => b.title,
    },
    cards: {
      name: 'Card row', icon: '🃏', desc: 'Image cards in a side-scroller or grid',
      fields: [
        { k: 'layout', t: 'select', l: 'Layout', opts: [['scroll', 'Side-scrolling row'], ['grid', 'Grid, 2 across'], ['list', 'Full-width list']] },
        { k: 'variant', t: 'select', l: 'Card style', opts: [['pill', 'Small image on the left'], ['tile', 'Image on top']] },
        { k: 'width', t: 'range', l: 'Card width (side-scroller)', min: 120, max: 320, unit: 'px', when: (b) => b.layout === 'scroll' },
        { k: 'imgSize', t: 'range', l: 'Image size', min: 40, max: 120, unit: 'px', when: (b) => b.variant === 'pill' },
        { k: 'aspect', t: 'select', l: 'Image shape', opts: TD.ASPECTS.filter((a) => a[0] !== 'auto'), when: (b) => b.variant === 'tile' },
        { k: 'items', t: 'list', l: 'Cards', itemName: 'Card', itemLabel: (i) => i.name || 'Card',
          item: [
            { k: 'image', t: 'image', l: 'Image' },
            { k: 'tag', t: 'text', l: 'Small label', rich: true },
            { k: 'name', t: 'text', l: 'Name', rich: true },
            { k: 'action', t: 'action', l: 'When tapped' },
          ],
          newItem: () => ({ image: '', tag: 'Label', name: 'Card', action: TD.newAction('popup') }) },
      ],
      defaults: () => ({ layout: 'scroll', variant: 'pill', width: 195, imgSize: 64, aspect: '4/3', items: [] }),
      summary: (b) => b.items.map((i) => i.name).join(' · '),
    },
    accordion: {
      name: 'Dropdowns', icon: '🔽', desc: 'Expandable questions / sections (FAQ style)',
      fields: [
        { k: 'single', t: 'checkbox', l: 'Only one open at a time' },
        { k: 'items', t: 'list', l: 'Dropdowns', itemName: 'Dropdown', itemLabel: (i) => TD.iconLabel(i.icon) + (i.title || 'Dropdown'),
          item: [
            { k: 'icon', t: 'emoji', l: 'Icon (emoji)' },
            { k: 'title', t: 'text', l: 'Title', rich: true },
            { k: 'body', t: 'textarea', l: 'Content', rich: true },
            { k: 'image', t: 'image', l: 'Image inside (optional)' },
            { k: 'btnLabel', t: 'text', l: 'Button inside (optional)', ph: 'Learn more' },
            { k: 'action', t: 'action', l: 'Button action', when: (i) => !!i.btnLabel },
            { k: 'open', t: 'checkbox', l: 'Open when page loads' },
          ],
          newItem: () => ({ icon: '', title: 'Question?', body: 'Answer.', image: '', btnLabel: '', action: TD.newAction('link'), open: false }) },
      ],
      defaults: () => ({ single: true, items: [{ icon: '', title: 'What time are services?', body: 'Sundays at **9:00** and **10:45 AM**.', image: '', btnLabel: '', action: TD.newAction('link'), open: false }] }),
      summary: (b) => b.items.map((i) => i.title).join(' · '),
    },
    slides: {
      name: 'Slides', icon: '🎞️', desc: 'Swipeable carousel with dots and autoplay',
      fields: [
        { k: 'aspect', t: 'select', l: 'Slide shape', opts: TD.ASPECTS.filter((a) => a[0] !== 'auto') },
        { k: 'captions', t: 'select', l: 'Captions', opts: [['overlay', 'On the image'], ['below', 'Below the image'], ['none', 'Hidden']] },
        { k: 'peek', t: 'checkbox', l: 'Show edge of next slide' },
        { k: 'dots', t: 'checkbox', l: 'Show dots' },
        { k: 'arrows', t: 'checkbox', l: 'Show arrows' },
        { k: 'autoplay', t: 'checkbox', l: 'Autoplay' },
        { k: 'interval', t: 'range', l: 'Seconds per slide', min: 2, max: 20, unit: 's', when: (b) => b.autoplay },
        { k: 'items', t: 'list', l: 'Slides', itemName: 'Slide', itemLabel: (i) => i.title || 'Slide',
          item: [
            { k: 'image', t: 'image', l: 'Image' },
            { k: 'title', t: 'text', l: 'Title', rich: true },
            { k: 'caption', t: 'text', l: 'Caption', rich: true },
            { k: 'action', t: 'action', l: 'When tapped' },
          ],
          newItem: () => ({ image: '', title: 'Slide', caption: '', action: TD.newAction() }) },
      ],
      defaults: () => ({ aspect: '16/9', captions: 'overlay', peek: true, dots: true, arrows: false, autoplay: true, interval: 5, items: [] }),
      summary: (b) => b.items.length + ' slides',
    },
    image: {
      name: 'Image', icon: '🏞️', desc: 'Single image with optional caption and link',
      fields: [
        { k: 'image', t: 'image', l: 'Image' },
        { k: 'alt', t: 'text', l: 'Description (for screen readers)' },
        { k: 'aspect', t: 'select', l: 'Shape', opts: TD.ASPECTS },
        { k: 'caption', t: 'text', l: 'Caption', rich: true },
        { k: 'action', t: 'action', l: 'When tapped' },
      ],
      defaults: () => ({ image: '', alt: '', aspect: 'auto', caption: '', action: TD.newAction() }),
      summary: (b) => b.caption || b.alt,
    },
    gallery: {
      name: 'Photo grid', icon: '🧩', desc: 'Grid of photos, tap to enlarge',
      fields: [
        { k: 'images', t: 'images', l: 'Photos' },
        { k: 'cols', t: 'range', l: 'Columns', min: 2, max: 4 },
        { k: 'aspect', t: 'select', l: 'Photo shape', opts: TD.ASPECTS.filter((a) => a[0] !== 'auto') },
        { k: 'gap', t: 'range', l: 'Gap', min: 0, max: 16, unit: 'px' },
        { k: 'zoom', t: 'checkbox', l: 'Tap a photo to view it full screen' },
      ],
      defaults: () => ({ images: [], cols: 3, aspect: '1/1', gap: 4, zoom: true }),
      summary: (b) => b.images.length + ' photos',
    },
    copy: {
      name: 'Copy boxes', icon: '📋', desc: 'Info rows with a Copy button (Wi-Fi, address, giving info…)',
      fields: [
        { k: 'title', t: 'text', l: 'Card title (optional)', rich: true },
        { k: 'btnLabel', t: 'text', l: 'Button label' },
        { k: 'items', t: 'list', l: 'Rows', itemName: 'Row', itemLabel: (i) => i.label || 'Row',
          item: [
            { k: 'label', t: 'text', l: 'Label', rich: true },
            { k: 'value', t: 'textarea', l: 'Text shown and copied' },
            { k: 'toast', t: 'text', l: 'Message after copying', ph: 'Copied!' },
          ],
          newItem: () => ({ label: 'Label', value: 'Text to copy', toast: '' }) },
      ],
      defaults: () => ({ title: '', btnLabel: 'Copy', items: [{ label: 'Wi-Fi password', value: 'welcome123', toast: 'Wi-Fi password copied' }] }),
      summary: (b) => b.items.map((i) => i.label).join(' · '),
    },
    events: {
      name: 'Upcoming events', icon: '📅', desc: 'Live list from a Squarespace events page',
      fields: [
        { k: 'url', t: 'text', l: 'Squarespace events page JSON', hint: 'Your events collection URL with ?format=json on the end.' },
        { k: 'max', t: 'range', l: 'How many events', min: 1, max: 10 },
        { k: 'tz', t: 'select', l: 'Time zone', opts: TD.TIMEZONES },
        { k: 'detail', t: 'checkbox', l: 'Tap opens event details sheet' },
        { k: 'proxies', t: 'checkbox', l: 'Retry through public proxies if blocked', hint: 'Needed when the page is not on the same Squarespace site.' },
        { k: 'loading', t: 'text', l: 'Loading message' },
        { k: 'error', t: 'text', l: 'Error message' },
      ],
      defaults: () => ({ url: 'https://www.example.com/events?format=json', max: 3, tz: 'America/Chicago', detail: true, proxies: true, loading: 'Loading events…', error: 'Could not load upcoming events.' }),
      summary: (b) => b.url,
    },
    video: {
      name: 'Video', icon: '▶️', desc: 'YouTube or Vimeo embed',
      fields: [
        { k: 'url', t: 'text', l: 'YouTube or Vimeo link' },
        { k: 'aspect', t: 'select', l: 'Shape', opts: TD.ASPECTS.filter((a) => a[0] !== 'auto') },
      ],
      defaults: () => ({ url: '', aspect: '16/9' }),
      summary: (b) => b.url,
    },
    countdown: {
      name: 'Countdown', icon: '⏳', desc: 'Live countdown to a date',
      fields: [
        { k: 'label', t: 'text', l: 'Label', rich: true },
        { k: 'sub', t: 'text', l: 'Subheading (optional)', rich: true, hint: 'With a subheading, the label shows as a bold heading above it.' },
        { k: 'target', t: 'datetime', l: 'Counts down to' },
        { k: 'cdStyle', t: 'select', l: 'Number style', opts: [['boxes', 'Boxes'], ['slot', 'Slot machine (numbers roll up, no boxes)']] },
        { k: 'tz', t: 'select', l: 'Time zone', opts: TD.TIMEZONES },
        { k: 'done', t: 'text', l: 'Text when finished' },
        { k: 'hideDone', t: 'checkbox', l: 'Hide the block when finished' },
        { k: 'btnLabel', t: 'text', l: 'Button text', ph: 'Learn more' },
        { k: 'action', t: 'action', l: 'Button action', hint: 'The button shows once this does something.' },
        { k: 'image', t: 'image', l: 'Photo (optional)' },
        { k: 'imgLayout', t: 'select', l: 'Photo placement', opts: [['top', 'Above the countdown'], ['bg', 'Behind the countdown']], when: (b) => !!b.image },
        { k: 'aspect', t: 'select', l: 'Photo shape', opts: TD.ASPECTS.filter((a) => a[0] !== 'auto'), when: (b) => !!b.image && b.imgLayout !== 'bg' },
        { k: 'dim', t: 'range', l: 'Darken photo', min: 0, max: 90, unit: '%', when: (b) => !!b.image && b.imgLayout === 'bg', hint: 'Keeps the numbers readable on top of the photo.' },
      ],
      defaults: () => ({ label: 'Christmas Eve service starts in', target: '', tz: 'America/Chicago', done: 'Happening now!', hideDone: false, cdStyle: 'boxes', sub: '', btnLabel: 'Learn more', action: TD.newAction('link'), image: '', imgLayout: 'top', aspect: '16/9', dim: 50 }),
      summary: (b) => b.label,
    },
    spacer: {
      name: 'Spacer / divider', icon: '➖', desc: 'Empty space or a thin line',
      fields: [
        { k: 'height', t: 'range', l: 'Height', min: 0, max: 120, unit: 'px' },
        { k: 'line', t: 'checkbox', l: 'Draw a line' },
      ],
      defaults: () => ({ height: 16, line: false }),
      summary: (b) => b.height + 'px' + (b.line ? ' with line' : ''),
    },
    html: {
      name: 'Custom HTML', icon: '🧑‍💻', desc: 'Paste your own HTML/embed code',
      fields: [{ k: 'code', t: 'code', l: 'HTML', hint: 'Inserted as-is. Scripts run on the live page.' }],
      defaults: () => ({ code: '<p style="text-align:center">Custom HTML</p>' }),
      summary: (b) => b.code,
    },
  };

  TD.newBlock = (type) => Object.assign({ id: TD.uid('b'), type }, commonDefaults(), TD.BLOCKS[type].defaults());

  // Pop-up proxy used unless the project picks another (see worker/popup-proxy.js).
  TD.DEFAULT_PROXY = 'https://bethanynaz-proxy.cgoff.workers.dev';

  // Fill in any fields missing from older/imported projects.
  TD.normalize = (state) => {
    const base = TD.newProject();
    const s = Object.assign({}, base, state);
    s.theme = Object.assign({}, base.theme, state.theme || {});
    s.exp = Object.assign({}, base.exp, state.exp || {});
    // Blank proxy means the BFC worker, unless someone deliberately cleared it.
    if (!s.exp.proxy && !s.exp.proxyOff) s.exp.proxy = TD.DEFAULT_PROXY;
    s.exp.proxyHosts = Array.isArray(s.exp.proxyHosts) ? s.exp.proxyHosts.slice() : [];
    s.times = (state.times || []).map((t) => Object.assign(TD.newTime(), t));
    s.blocks = (state.blocks || []).filter((b) => TD.BLOCKS[b.type]).map((b) => {
      const d = TD.newBlock(b.type);
      const n = Object.assign(d, b);
      n.style = Object.assign(commonDefaults().style, b.style || {});
      n.hideIn = Array.isArray(b.hideIn) ? b.hideIn.slice() : [];
      if (b.schedule && b.schedule.on) {
        // Older projects stored a schedule on each block; turn it into a time tab.
        const w = { days: b.schedule.days || [], start: b.schedule.start || '', end: b.schedule.end || '', from: b.schedule.from || '', to: b.schedule.to || '', tz: b.schedule.tz || 'America/Chicago' };
        const key = JSON.stringify(w);
        let t = s.times.find((x) => JSON.stringify({ days: x.days, start: x.start, end: x.end, from: x.from, to: x.to, tz: x.tz }) === key);
        if (!t) { t = Object.assign(TD.newTime(), w, { name: 'Special time ' + (s.times.length + 1) }); s.times.push(t); }
        n.hideIn = b.schedule.mode === 'hide' ? [t.id] : ['normal'];
      }
      delete n.schedule;
      if (n.hidden) { n.hideIn = ['normal'].concat(s.times.map((t) => t.id)); n.hidden = false; }
      return n;
    });
    s.sheets = (state.sheets || []).map((sh) => Object.assign(TD.newSheet(), sh));
    return TD.hexAll(s);
  };

  // ── Time tabs (alternate versions of the page at certain times) ────
  TD.newTime = () => ({ id: TD.uid('t'), name: 'Special time', icon: '🕒', days: [], start: '', end: '', from: '', to: '', tz: 'America/Chicago' });
  TD.TIME_FIELDS = [
    { k: 'name', t: 'text', l: 'Tab name', ph: 'e.g. Chapel' },
    { k: 'icon', t: 'emoji', l: 'Tab icon' },
    { k: 'days', t: 'days', l: 'Days', hint: 'None checked = every day.' },
    { k: 'start', t: 'time', l: 'From' },
    { k: 'end', t: 'time', l: 'Until' },
    { k: 'from', t: 'date', l: 'Starting date (optional)', hint: 'Use dates for seasonal versions, like Christmas or VBS week.' },
    { k: 'to', t: 'date', l: 'Ending date (optional)' },
    { k: 'tz', t: 'select', l: 'Time zone', opts: TD.TIMEZONES },
  ];
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hm12 = (v) => { if (!v) return ''; const [H, M] = v.split(':').map(Number); return ((H % 12) || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H < 12 ? 'am' : 'pm'); };
  TD.describeTime = (t) => {
    const parts = [];
    if (t.days.length && t.days.length < 7) parts.push(t.days.map((d) => DAYN[d]).join('/'));
    if (t.start || t.end) parts.push((hm12(t.start) || '12am') + '–' + (hm12(t.end) || 'midnight'));
    if (t.from || t.to) parts.push((t.from || '…') + ' to ' + (t.to || '…'));
    return parts.join(' · ') || 'Always (set days or times)';
  };

  // ── Pop-up menus (bottom sheets, like “Next Steps”) ──────────────────
  TD.newSheet = () => ({ id: TD.uid('s'), title: 'Menu', subtitle: '', icon: '✚', items: [] });
  TD.SHEET_FIELDS = [
    { k: 'icon', t: 'emoji', l: 'Icon (emoji)' },
    { k: 'title', t: 'text', l: 'Title', rich: true },
    { k: 'subtitle', t: 'text', l: 'Subtitle', rich: true },
    { k: 'items', t: 'list', l: 'Menu items', itemName: 'Item', itemLabel: (i) => TD.iconLabel(i.icon) + (i.title || 'Item'),
      item: [
        { k: 'icon', t: 'emoji', l: 'Icon (emoji)' },
        { k: 'iconBg', t: 'color', l: 'Icon background' },
        { k: 'title', t: 'text', l: 'Title', rich: true },
        { k: 'desc', t: 'text', l: 'Description', rich: true },
        { k: 'action', t: 'action', l: 'When tapped', noSheet: true },
      ],
      newItem: () => ({ icon: '⭐', iconBg: '#3b7de133', title: 'Item', desc: '', action: TD.newAction('popup') }) },
  ];

  // ── Theme ─────────────────────────────────────────────────────────────
  TD.THEME_FIELDS = [
    { group: 'Colors', open: true, fields: [
      { k: 'bg', t: 'color', l: 'Page background' },
      { k: 'card', t: 'color', l: 'Card color' },
      { k: 'card2', t: 'color', l: 'Card pressed color' },
      { k: 'text', t: 'color', l: 'Text' },
      { k: 'muted', t: 'color', l: 'Secondary text' },
      { k: 'accent', t: 'color', l: 'Accent' },
      { k: 'accentText', t: 'color', l: 'Text on accent buttons' },
      { k: 'sheetBg', t: 'color', l: 'Pop-up sheet background' },
    ] },
    { group: 'Shape & spacing', open: true, fields: [
      { k: 'radius', t: 'range', l: 'Card corner radius', min: 0, max: 40, unit: 'px' },
      { k: 'btnRadius', t: 'range', l: 'Button roundness', min: 0, max: 50, unit: 'px' },
      { k: 'imgRadius', t: 'range', l: 'Small image / icon radius', min: 0, max: 40, unit: 'px' },
      { k: 'side', t: 'range', l: 'Side margin', min: 0, max: 40, unit: 'px' },
      { k: 'gap', t: 'range', l: 'Space between blocks', min: 0, max: 40, unit: 'px' },
      { k: 'padTop', t: 'range', l: 'Space at top of page', min: 0, max: 120, unit: 'px' },
      { k: 'padBottom', t: 'range', l: 'Space at bottom of page', min: 0, max: 120, unit: 'px' },
      { k: 'widthMode', t: 'select', l: 'Width on tablet and desktop', opts: [['column', 'Centered column (phone-like)'], ['full', 'Full width']] },
      { k: 'maxWidth', t: 'range', l: 'Column width', min: 320, max: 1200, unit: 'px', when: (t) => t.widthMode !== 'full' },
      { k: 'shadow', t: 'checkbox', l: 'Soft shadow under cards' },
    ] },
    { group: 'Text', open: true, fields: [
      { k: 'font', t: 'select', l: 'Font', opts: TD.FONTS },
      { k: 'headFont', t: 'select', l: 'Heading font', opts: [['', 'Same as body']].concat(TD.FONTS) },
      { k: 'fontSize', t: 'range', l: 'Base text size', min: 12, max: 20, unit: 'px' },
    ] },
    { group: 'Motion', fields: [
      { k: 'anim', t: 'select', l: 'Load animation', opts: [['slide', 'Slide up'], ['fade', 'Fade in'], ['none', 'None']] },
      { k: 'pressFx', t: 'checkbox', l: 'Shrink slightly when pressed' },
    ] },
  ];

  TD.PALETTES = {
    'Bethany dark': { bg: '#191818', card: '#3D3D3D', card2: '#484848', text: '#ffffff', muted: '#999999', accent: '#3b7de1', accentText: '#ffffff', sheetBg: '#1a1a1a' },
    Midnight: { bg: '#0b1020', card: '#172036', card2: '#1f2a45', text: '#f1f5ff', muted: '#8d9ab8', accent: '#6c8cff', accentText: '#ffffff', sheetBg: '#10172b' },
    Light: { bg: '#f4f4f6', card: '#ffffff', card2: '#ececf0', text: '#141418', muted: '#6b6b76', accent: '#2563eb', accentText: '#ffffff', sheetBg: '#ffffff' },
    Warm: { bg: '#faf6f0', card: '#ffffff', card2: '#f1e9dd', text: '#2b2118', muted: '#8a7a68', accent: '#c2410c', accentText: '#ffffff', sheetBg: '#fffaf3' },
    Forest: { bg: '#0f1a14', card: '#1b2b22', card2: '#24382c', text: '#eef6f0', muted: '#8fa898', accent: '#34c47c', accentText: '#06120b', sheetBg: '#13211a' },
    Plum: { bg: '#1a1020', card: '#2a1b33', card2: '#352240', text: '#fbf3ff', muted: '#a88fb5', accent: '#d36bff', accentText: '#1a0b22', sheetBg: '#21142a' },
  };

  TD.newProject = () => ({
    version: 1,
    title: 'My Page',
    theme: Object.assign({}, TD.PALETTES['Bethany dark'], {
      radius: 14, btnRadius: 50, imgRadius: 12, side: 14, gap: 10, padTop: 20, padBottom: 24, maxWidth: 480, widthMode: 'column',
      shadow: false, font: 'Inter', headFont: '', fontSize: 15, anim: 'slide', pressFx: false,
    }),
    exp: { squarespace: true, layout: 'app', fullDoc: true, embed: true, imgMax: 1400, imgQ: 0.82, proxy: TD.DEFAULT_PROXY, proxyHosts: [] },
    times: [],
    blocks: [],
    sheets: [],
  });

  // ── Templates ────────────────────────────────────────────────────────
  const act = (type, props) => Object.assign(TD.newAction(type), props);
  const blk = (type, props) => {
    const b = TD.newBlock(type);
    Object.keys(props || {}).forEach((k) => {
      if (k === 'style') Object.assign(b[k], props[k]);
      else b[k] = props[k];
    });
    return b;
  };
  const PROXY = 'https://bethanynaz-proxy.cgoff.workers.dev';

  TD.TEMPLATES = {
    bethany: {
      name: 'Bethany tap page (matches base html)',
      build: () => {
        const p = TD.newProject();
        p.title = 'Bethany First Church';
        const ns = Object.assign(TD.newSheet(), {
          id: 'nextsteps', title: 'Next Steps', subtitle: 'Grow in your faith journey.', icon: '✚',
          items: [
            { icon: '📖', iconBg: '#3b7de133', title: 'Discipleship Courses', desc: 'Short, weekly courses to help you follow Jesus and grow intentionally.', action: act('popup', { url: PROXY + '/next-steps', title: 'Discipleship Courses', icon: '📖' }) },
            { icon: '💧', iconBg: '#10b98133', title: 'Baptism', desc: 'Take the next step and make your faith public through baptism.', action: act('popup', { url: PROXY + '/baptism', title: 'Baptism', icon: '💧' }) },
            { icon: '👥', iconBg: '#fbbf2433', title: 'Group Life', desc: 'Do life with others in a Community Group that fits your season.', action: act('popup', { url: PROXY + '/group-life', title: 'Group Life', icon: '🤝' }) },
            { icon: '🤝', iconBg: '#10b98133', title: 'Serve', desc: 'Be part of what God is doing by serving others with your gifts.', action: act('popup', { url: 'https://tithelymedia.blob.core.windows.net/app-pages/41204/pg-117732.html', title: 'Serve', icon: '🤝' }) },
          ],
        });
        p.sheets = [ns];
        p.times = [Object.assign(TD.newTime(), { id: 'chapel', name: 'Chapel', icon: '🎓', days: [2, 4], start: '10:00', end: '11:30' })];
        const heroText = { textPos: 'below', title: '==Bethany First== Church', subtitle: "We're glad you're here.", style: { mt: 12 } };
        p.blocks = [
          blk('hero', Object.assign({ images: ['https://tithely-media-prod.s3.us-west-1.wasabisys.com/1153934/header.jpeg'], hideIn: ['chapel'] }, TD.clone(heroText))),
          blk('hero', Object.assign({ interval: 7, images: [
            'https://photos.smugmug.com/College/Tap-Tag-Photo-folder/i-xn8PcQP/0/NFCgzMC5pjxggWvsZCq8B9GDRsmdH3DMzpMsTtRxB/XL/2025%2011%2012-20-XL.png',
            'https://photos.smugmug.com/College/Tap-Tag-Photo-folder/i-VWLrSqS/0/KVDB34cSTSKLv68bwP6jCGJZkGxR9MZM4Jkhk7r2B/XL/2025%2011%2012-8-XL.png',
            'https://photos.smugmug.com/College/Tap-Tag-Photo-folder/i-JPMQDR6/0/KRKRpCSwC92BZ7JRcTg74cqj4NRGW5zbKvJJk7pMs/XL/GOFF%20-%202025%2008%2027%20Late%20Night%20-11-XL.jpg',
            'https://photos.smugmug.com/College/Tap-Tag-Photo-folder/i-rkm5mkx/0/LnmMHkrm8zpRwQBPFCkgT6d48hLcTGcxqHsP2TfDs/XL/GOFF%20-%202025%2008%2027%20Late%20Night%20-23-XL.jpg',
            'https://photos.smugmug.com/College/Tap-Tag-Photo-folder/i-9DGtSSd/0/L2xFpvwBmMVgSmBzPCHM5RtfxHhfxWdKmGmnQGRTb/XL/GOFF%20-%202025%2008%2027%20Late%20Night%20-38-XL.jpg',
            'https://photos.smugmug.com/College/Tap-Tag-Photo-folder/i-BQjSf37/0/MnvC2bdRRQDH6kMtNwCVqPLmj53mdktP4SC37xm4Q/XL/GOFF%20-%202025%2008%2027%20Late%20Night%20-51-XL.jpg',
            'https://photos.smugmug.com/College/Tap-Tag-Photo-folder/i-4kp5cZf/0/LXcWTdHX5mBhQDdvRxdHP936CmQhtzvt3KmzwBkGw/XL/GOFF%20-%202025%2008%2027%20Late%20Night%20-52-XL.jpg',
            'https://photos.smugmug.com/College/Tap-Tag-Photo-folder/i-qw3rZzw/0/KKctmfZMnCWLcD2Wtrj6H9Khs7jqhJxfbd4GhGJ6r/XL/2025%2001%2007%20-%20College-42-XL.jpg',
          ], hideIn: ['normal'] }, TD.clone(heroText))),
          blk('buttons', { layout: 'scroll', style: { mt: 14 }, items: [
            { label: 'Ask for Prayer', icon: '🙏', iconBg: '#fbbf2426', bg: '', color: '', action: act('popup', { url: PROXY + '/prayer', title: 'Prayer', icon: '🙏' }) },
            { label: 'Next Steps', icon: '✚', iconBg: '#3b7de133', bg: '', color: '', action: act('sheet', { sheet: 'nextsteps' }) },
            { label: 'Give', icon: '💵', iconBg: '#10b98126', bg: '', color: '', action: act('popup', { url: 'https://bethanynaz.org/give', title: 'Give', icon: '💵' }) },
          ] }),
          blk('banner', { icon: '👋', eyebrow: 'New Here?', title: 'Connect with Us', subtitle: 'Share your name with us and let us know you visited!', action: act('link', { url: 'http://bethanynaz.info/connect' }), style: { mt: 6 }, hideIn: ['chapel'] }),
          blk('banner', { icon: '', iconBg: '', title: 'Welcome, College Students!', subtitle: 'Learn more about BFC College', action: act('link', { url: 'https://bethanynaz.org/college' }), style: { mt: 6 }, hideIn: ['normal'] }),
          blk('banner', { icon: '🚧', eyebrow: 'Campus Renewal', title: 'Construction In Progress', subtitle: 'Learn more about what to expect.', action: act('link', { url: 'https://www.bethanynaz.org/construction' }), style: { mt: 6 } }),
          blk('banner', { icon: '🤝', title: 'Becoming Course Sign-Up', subtitle: 'Take the next step in becoming part of the BFC community.', action: act('link', { url: 'https://tsiems.wufoo.com/forms/m4s4eo50gl8kmd/' }), style: { mt: 6 } }),
          blk('heading', { title: 'Upcoming Events', linkText: 'See All', action: act('popup', { url: PROXY + '/events', title: 'Event Details', icon: '📅' }), style: { mt: 12 } }),
          blk('events', { url: 'https://www.bethanynaz.org/upcoming-source-page?format=json', style: { mt: 8 } }),
          blk('buttons', { layout: 'stack', variant: 'card', shape: 14, style: { mt: 6 }, items: [
            { label: 'View All Events', icon: '', iconBg: '', bg: '', color: '', action: act('popup', { url: PROXY + '/events', title: 'Event Details', icon: '📅' }) },
          ] }),
          blk('heading', { title: 'Ministries', linkText: 'See All', action: act('popup', { url: PROXY + '/ministries-menu', title: 'Ministries', icon: '⛪' }), style: { mt: 12 } }),
          blk('cards', { layout: 'scroll', variant: 'pill', style: { mt: 8 }, items: [
            { image: 'https://tithely-media-prod.s3.us-west-1.wasabisys.com/865937/Goff---BFC-Kids-1-7-24-29-%281%29.jpeg', tag: 'Kids', name: 'BFC Kids', action: act('popup', { url: PROXY + '/kids', title: 'BFC Kids', icon: '👶' }) },
            { image: 'https://tithely-media-prod.s3.us-west-1.wasabisys.com/860048/2025-05-04-6.jpg', tag: 'Grades 5-6', name: 'Preteens', action: act('popup', { url: PROXY + '/preteens', title: 'Preteens', icon: '🎮' }) },
            { image: 'https://tithely-media-prod.s3.us-west-1.wasabisys.com/1131059/2025-08-27-Catalyst-Course-4-1.jpeg', tag: 'Grades 6–12', name: 'Students', action: act('popup', { url: PROXY + '/students', title: 'Students', icon: '📚' }) },
            { image: 'https://tithely-media-prod.s3.us-west-1.wasabisys.com/1131067/2025-09-16---Ministers-Forum-141.jpg', tag: '55+', name: 'Senior Adults', action: act('popup', { url: PROXY + '/senior-adults', title: 'Senior Adults', icon: '👴' }) },
          ] }),
        ];
        return p;
      },
    },
    tour: {
      name: 'Feature tour (every block type)',
      build: () => {
        const p = TD.newProject();
        p.title = 'Feature Tour';
        p.sheets = [Object.assign(TD.newSheet(), { id: 'contact', title: 'Contact us', subtitle: 'We would love to hear from you', icon: '💬', items: [
          { icon: '📞', iconBg: '#10b98133', title: 'Call the office', desc: '(555) 010-2030', action: act('phone', { phone: '5550102030' }) },
          { icon: '💬', iconBg: '#3b7de133', title: 'Text us', desc: 'We reply within a day', action: act('sms', { phone: '5550102030', body: 'Hi! I have a question:' }) },
          { icon: '✉️', iconBg: '#fbbf2433', title: 'Email', desc: 'hello@example.com', action: act('email', { email: 'hello@example.com', subject: 'Hello' }) },
        ] })];
        const pic = (n) => 'https://picsum.photos/seed/tapdot' + n + '/900/600';
        p.blocks = [
          blk('hero', { images: [pic(1), pic(2), pic(3)], interval: 4, textPos: 'overlay', title: '==Feature== Tour', subtitle: 'Every block the editor can make', titleSize: 28, style: { mt: 0 } }),
          blk('buttons', { layout: 'grid2', variant: 'card', items: [
            { label: 'Contact', icon: '💬', iconBg: '#3b7de133', bg: '', color: '', action: act('sheet', { sheet: 'contact' }) },
            { label: 'Copy address', icon: '📍', iconBg: '#fbbf2433', bg: '', color: '', action: act('copy', { text: '123 Main St, Springfield', toast: 'Address copied' }) },
            { label: 'Jump to FAQ', icon: '🔽', iconBg: '#10b98133', bg: '', color: '', action: act('scroll', { target: 'faq' }) },
            { label: 'Share page', icon: '🔗', iconBg: '#d36bff33', bg: '', color: '', action: act('share', {}) },
          ] }),
          blk('banner', { icon: '🎉', eyebrow: 'This week', title: 'Family Night', subtitle: 'Tap to open the sign-up form in a pop-up', action: act('popup', { url: 'https://example.com', title: 'Sign up', icon: '🎉' }) }),
          blk('heading', { title: 'Slides' }),
          blk('slides', { items: [
            { image: pic(4), title: 'Swipe me', caption: 'Autoplays with dots', action: TD.newAction() },
            { image: pic(5), title: 'Second slide', caption: 'Captions can sit on the image', action: TD.newAction() },
            { image: pic(6), title: 'Third slide', caption: 'Each slide can link somewhere', action: TD.newAction() },
          ] }),
          blk('heading', { title: 'Cards', linkText: 'See All', action: act('link', { url: 'https://example.com' }) }),
          blk('cards', { layout: 'scroll', variant: 'tile', width: 180, items: [1, 2, 3, 4].map((n) => ({ image: pic(10 + n), tag: 'Group ' + n, name: 'Card ' + n, action: act('popup', { url: 'https://example.com', title: 'Card ' + n }) })) }),
          blk('heading', { title: 'FAQ', anchor: 'faq' }),
          blk('accordion', { anchor: 'faq', items: [
            { icon: '🕒', title: 'When are services?', body: 'Sundays at **9:00** and **10:45 AM**.', image: '', btnLabel: '', action: TD.newAction(), open: true },
            { icon: '👶', title: 'Is there something for kids?', body: 'Yes! Check in at the ==Kids== desk.', image: '', btnLabel: 'Kids info', action: act('link', { url: 'https://example.com' }), open: false },
            { icon: '🚗', title: 'Where do I park?', body: 'Visitor parking is by the main entrance.', image: '', btnLabel: '', action: TD.newAction(), open: false },
          ] }),
          blk('copy', { title: 'Guest Wi-Fi', items: [{ label: 'Network', value: 'Guest', toast: 'Network name copied' }, { label: 'Password', value: 'welcome123', toast: 'Password copied' }] }),
          blk('countdown', { label: 'Next big event in', target: '2026-12-24T18:00' }),
          blk('gallery', { images: [21, 22, 23, 24, 25, 26].map(pic) }),
          blk('text', { body: 'Text blocks support **bold**, *italic*, ==accent color== and [links](https://example.com).', card: true }),
          blk('spacer', { height: 8, line: true }),
          blk('text', { body: 'Made with the TapDot editor', size: 12, align: 'center', muted: true }),
        ];
        return p;
      },
    },
    blank: { name: 'Blank page', build: () => TD.newProject() },
  };
})();
