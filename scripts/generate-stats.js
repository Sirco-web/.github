// Full script: scripts/generate-stats.js
// Generates two SVG files: docs/stats.svg and docs/langs.svg
// Uses environment variables:
// - STATS_PAT : Personal Access Token (optional; if absent only public data will be available)
// - ORG_NAME : organization (default 'Sirco-web')
// - OUTPUT_DIR : folder to write SVGs (default 'docs')
// - INCLUDE_PRIVATE : "true" to include private repos (requires STATS_PAT with repo scope)

const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');

const ORG = process.env.ORG_NAME || 'Sirco-web';
const OUT_DIR = process.env.OUTPUT_DIR || 'docs';
const INCLUDE_PRIVATE = (process.env.INCLUDE_PRIVATE || 'false').toLowerCase() === 'true';
const TOKEN = process.env.STATS_PAT || '';

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const octokit = new Octokit({
  auth: TOKEN || undefined,
  userAgent: 'Sirco-web-stats-generator'
});

async function listAllOrgRepos(org, visibility = 'all') {
  const per_page = 100;
  let page = 1;
  const repos = [];
  while (true) {
    const res = await octokit.rest.repos.listForOrg({
      org,
      type: visibility, // all, public, private, forks, sources
      per_page,
      page
    });
    repos.push(...res.data);
    if (res.data.length < per_page) break;
    page++;
  }
  return repos;
}

async function fetchLanguages(owner, repo) {
  try {
    const res = await octokit.rest.repos.listLanguages({ owner, repo });
    return res.data;
  } catch (e) {
    // ignore languages failures for specific repos
    return {};
  }
}

function generateStatsSVG(stats) {
  // Simple SVG with key numbers
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="700" height="120" viewBox="0 0 700 120">
  <style>
    .title { font: 600 18px "Segoe UI", Roboto, Arial; fill:#fff; }
    .k { font: 700 28px "Segoe UI", Roboto, Arial; fill:#fffb; }
    .label { font: 400 12px "Segoe UI", Roboto, Arial; fill:#ddd; }
    svg { background: #0b1220; border-radius: 8px; }
  </style>
  <rect width="100%" height="100%" rx="8" fill="#0b1220" />
  <text x="20" y="28" class="title">Sirco Web — Organization summary (${stats.org})</text>

  <g transform="translate(20,48)">
    <text x="0" y="0" class="k">${stats.repos}</text>
    <text x="60" y="4" class="label">repositories</text>

    <text x="180" y="0" class="k">${stats.stars}</text>
    <text x="240" y="4" class="label">total stars</text>

    <text x="360" y="0" class="k">${stats.forks}</text>
    <text x="420" y="4" class="label">total forks</text>

    <text x="540" y="0" class="k">${stats.watchers}</text>
    <text x="600" y="4" class="label">total watchers</text>
  </g>
</svg>`;
  return svg;
}

function generateLangsSVG(topLangs) {
  const width = 700;
  const height = 80;
  const barWidth = Math.floor((width - 40) / Math.max(1, topLangs.length));
  const colors = [
    '#f1e05a', '#f34b7d', '#563d7c', '#3572A5', '#2b7489',
    '#b07219', '#e34c26', '#4F5D95', '#38A1DB', '#6f42c1'
  ];

  const bars = topLangs.map((l, i) => {
    const barH = Math.max(8, Math.round((l.percent / 100) * 48));
    const x = 20 + i * barWidth;
    const y = 30 + (48 - barH);
    const color = colors[i % colors.length];
    return `<g transform="translate(${x},0)">
      <rect x="0" y="${y}" width="${barWidth - 8}" height="${barH}" fill="${color}" rx="4" />
      <text x="0" y="${y + barH + 14}" font-size="12" fill="#ddd" font-family="Segoe UI, Roboto, Arial">${l.lang} (${l.percent.toFixed(0)}%)</text>
    </g>`;
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .title { font: 600 16px "Segoe UI", Roboto, Arial; fill:#fff; }
    text { font-family: "Segoe UI", Roboto, Arial; }
    svg { background: #081025; border-radius: 8px; }
  </style>
  <rect width="100%" height="100%" rx="8" fill="#081025" />
  <text x="20" y="20" class="title">Top languages (public only unless token provided)</text>
  ${bars}
</svg>`;
  return svg;
}

(async () => {
  try {
    // choose visibility based on INCLUDE_PRIVATE and whether token is provided
    let visibility = 'public';
    if (INCLUDE_PRIVATE && TOKEN) visibility = 'all';
    else if (INCLUDE_PRIVATE && !TOKEN) {
      console.warn('INCLUDE_PRIVATE requested but no STATS_PAT provided — falling back to public only.');
      visibility = 'public';
    }

    console.log(`Fetching repos for org=${ORG} (visibility=${visibility})...`);
    const repos = await listAllOrgRepos(ORG, visibility);

    // aggregate basic stats
    let totalStars = 0;
    let totalForks = 0;
    let totalWatchers = 0;
    const langsBytes = {};

    for (const r of repos) {
      totalStars += r.stargazers_count || 0;
      totalForks += r.forks_count || 0;
      totalWatchers += r.watchers_count || 0;

      // fetch languages
      const repoLangs = await fetchLanguages(ORG, r.name);
      for (const [lang, bytes] of Object.entries(repoLangs)) {
        langsBytes[lang] = (langsBytes[lang] || 0) + bytes;
      }
    }

    // compute top languages
    const totalBytes = Object.values(langsBytes).reduce((a,b) => a+b, 0) || 1;
    const topLangs = Object.entries(langsBytes)
      .map(([lang, bytes]) => ({ lang, bytes, percent: (bytes / totalBytes) * 100 }))
      .sort((a,b) => b.bytes - a.bytes)
      .slice(0, 7);

    // fallback if no language data
    if (topLangs.length === 0) {
      topLangs.push({ lang: 'None', percent: 100, bytes: 0 });
    }

    const stats = {
      org: ORG,
      repos: repos.length,
      stars: totalStars,
      forks: totalForks,
      watchers: totalWatchers
    };

    const statsSVG = generateStatsSVG(stats);
    const langsSVG = generateLangsSVG(topLangs);

    fs.writeFileSync(path.join(OUT_DIR, 'stats.svg'), statsSVG, 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, 'langs.svg'), langsSVG, 'utf8');

    console.log('Generated:', path.join(OUT_DIR, 'stats.svg'), path.join(OUT_DIR, 'langs.svg'));
  } catch (err) {
    console.error('ERROR generating stats:', err);
    process.exitCode = 1;
  }
})();
