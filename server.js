const express = require('express');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const clean = (s = '') => String(s)
  .replace(/\u00a0/g, ' ')
  .replace(/\u200b/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const isWolUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'wol.jw.org';
  } catch {
    return false;
  }
};

const headingKey = (s = '') => clean(s)
  .replace(/^\d+\.?\s*/, '')
  .replace(/[:：]+$/, '')
  .trim()
  .toUpperCase();

const SECTION_LABELS = new Map([
  ['FOR DISCUSSION', 'For discussion'],
  ['DIG DEEPER', 'Dig Deeper'],
  ['REFLECT ON THE LESSONS', 'Reflect on the Lessons'],
  ['MEDITATE ON THE BIGGER PICTURE', 'Meditate on the Bigger Picture']
]);

const STOP_HEADINGS = new Set(['LEARN MORE']);

function stripQuestionNoise(text = '') {
  return clean(text)
    .replace(/\s*Your answers?\s*$/i, '')
    // WOL ordered-list markup can expose the number twice (for example, "1. 1. What ...?").
    .replace(/^\s*(\d+)\.\s*\1\.\s*/, '$1. ')
    .replace(/^\s*[•▪◦]\s*/, '')
    .trim();
}

const looksLikeQuestion = (t = '') => /\?/.test(t);

// A citation/reference alone is NOT a read scripture. The word "Read" must
// explicitly precede a Bible citation in the same question/instruction.
function hasExplicitRead(text = '') {
  const t = clean(text);
  return /\bread\b[\s\S]{0,140}\b(?:[1-3]\s*)?[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+\d+(?::\d+)?(?:[-–—]\d+)?/i.test(t);
}

function parseWol(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript,header,footer,nav').remove();

  const title = clean($('h1').first().text()) ||
    clean($('title').text()).replace(/\s*[—|-].*$/, '');

  const rootCandidate = $('.bodyTxt, article, main, #content, .article').first();
  const root = rootCandidate.length ? rootCandidate : $('body');

  // Prefer semantic blocks. Include simple DIVs as a fallback because WOL has
  // used different markup across publications/versions.
  const blocks = root.find('h2,h3,h4,p,li,div').filter((_, el) => {
    const $el = $(el);
    if ($el.children('h2,h3,h4,p,li,div').length > 2) return false;
    const t = clean($el.text());
    return t && t.length < 2200;
  }).toArray();

  let started = false;
  let stopped = false;
  let currentSection = '';
  const units = [];
  const seenQuestions = new Set();

  for (const el of blocks) {
    if (stopped) break;

    const $el = $(el);
    const tag = (el.tagName || '').toLowerCase();
    let text = stripQuestionNoise($el.text());
    if (!text) continue;

    const key = headingKey(text);

    // Recognize section names regardless of a trailing colon and regardless of
    // whether WOL exposes them as an H2/H3/H4 or another simple block.
    if (SECTION_LABELS.has(key)) {
      currentSection = SECTION_LABELS.get(key);
      if (key === 'FOR DISCUSSION') started = true;
      continue;
    }

    if (started && STOP_HEADINGS.has(key)) {
      stopped = true;
      break;
    }

    if (!started) continue;

    // If a new short heading appears after For discussion, preserve it as the
    // section label unless it is a known stop heading.
    if (/^h[2-4]$/.test(tag) && !looksLikeQuestion(text)) {
      if (text.length <= 160) currentSection = text.replace(/[:：]+$/, '').trim();
      continue;
    }

    if (/^your answers?$/i.test(text)) continue;
    if (!looksLikeQuestion(text)) continue;

    // Parent DIVs can duplicate the exact question text found in a child P/LI.
    // Dedupe by normalized question + section.
    const dedupeKey = `${headingKey(currentSection)}|${text.toLowerCase()}`;
    if (seenQuestions.has(dedupeKey)) continue;
    seenQuestions.add(dedupeKey);

    units.push({
      label: String(units.length + 1),
      section: currentSection || 'For discussion',
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
    if (!isWolUrl(url)) {
      return res.status(400).json({ error: 'Enter a valid https://wol.jw.org URL.' });
    }

    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 BibleStudyPaceTimer/1.1',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });

    if (!response.ok) throw new Error(`WOL returned ${response.status}`);

    const html = await response.text();
    const parsed = parseWol(html);

    if (!parsed.units.length) {
      return res.status(422).json({
        error: 'No discussion questions were detected after the For discussion section.'
      });
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
if (require.main === module) {
  app.listen(port, '0.0.0.0', () => console.log(`Bible Study Pace Timer running on ${port}`));
}

module.exports = { app, parseWol, hasExplicitRead, headingKey };
