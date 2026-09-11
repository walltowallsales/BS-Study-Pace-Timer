const express = require('express');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const clean = (s='') => String(s).replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const isWolUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'wol.jw.org';
  } catch { return false; }
};
const looksLikeQuestion = (t='') => /\?/.test(t);
const hasExplicitRead = (t='') => /\bread\b[^.?!\n]{0,80}(?:[1-3]?\s*[A-Z][a-z]+\s+\d+:\d+)/i.test(t);

function parseWol(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript,header,footer,nav').remove();
  const title = clean($('h1').first().text()) || clean($('title').text()).replace(/\s*[—|-].*$/, '');

  const root = $('.bodyTxt, article, main, #content, .article').first().length
    ? $('.bodyTxt, article, main, #content, .article').first()
    : $('body');

  const blocks = root.find('h2,h3,h4,p,li,div').filter((_, el) => {
    const $el = $(el);
    if ($el.children('h2,h3,h4,p,li,div').length > 3) return false;
    const t = clean($el.text());
    return t && t.length < 1800;
  }).toArray();

  let currentSection = '';
  let started = false;
  const units = [];
  let idx = 0;

  const sectionNames = [
    'FOR DISCUSSION',
    'DIG DEEPER',
    'REFLECT ON THE LESSONS',
    'MEDITATE ON THE BIGGER PICTURE'
  ];

  for (const el of blocks) {
    const $el = $(el);
    const tag = (el.tagName || '').toLowerCase();
    const text = clean($el.text());
    if (!text) continue;
    const upper = text.toUpperCase();

    if (/^h[2-4]$/.test(tag) || sectionNames.includes(upper)) {
      if (sectionNames.includes(upper)) {
        currentSection = text;
        if (upper === 'FOR DISCUSSION') started = true;
      } else if (started && text.length <= 140) {
        currentSection = text;
      }
      continue;
    }

    if (!started) continue;
    if (!looksLikeQuestion(text)) continue;

    idx += 1;
    units.push({
      label: String(idx),
      section: currentSection || 'For Discussion',
      q: text,
      weight: 'normal',
      read: hasExplicitRead(text),
      picture: false,
      box: false
    });
  }

  return { title, units, reviewQs: [] };
}

app.post('/api/import', async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (!isWolUrl(url)) return res.status(400).json({ error: 'Enter a valid https://wol.jw.org URL.' });

    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 BibleStudyPaceTimer/1.0',
        'accept-language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`WOL returned ${response.status}`);
    const html = await response.text();
    const parsed = parseWol(html);
    if (!parsed.units.length) {
      return res.status(422).json({ error: 'No discussion questions were detected after the For Discussion section.' });
    }
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Import failed.' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Bible Study Pace Timer running on ${port}`));
