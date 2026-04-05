require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const ALLOWED_USER = parseInt(process.env.TELEGRAM_ALLOWED_USER_ID);
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_USER = process.env.GITHUB_USERNAME;
const GH_REPO = process.env.GITHUB_REPO;
const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;

// State: tracks pending deploy/update waiting for HTML
const pending = {};

// ── Auth guard ──────────────────────────────────────────────────────────────
function isAllowed(msg) {
  return msg.from.id === ALLOWED_USER;
}

// ── GitHub helpers ──────────────────────────────────────────────────────────
async function ghGet(path) {
  const r = await fetch(`https://api.github.com/repos/${GH_USER}/${GH_REPO}/contents/${path}`, {
    headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  });
  return r.ok ? r.json() : null;
}

async function ghPut(path, content, message, sha) {
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
  };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${GH_USER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GH_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return r.json();
}

// ── Netlify helpers ─────────────────────────────────────────────────────────
async function getNetlifySites() {
  const r = await fetch('https://api.netlify.com/api/v1/sites', {
    headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` }
  });
  return r.ok ? r.json() : [];
}

async function getNetlifyUsage() {
  const r = await fetch('https://api.netlify.com/api/v1/accounts', {
    headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` }
  });
  if (!r.ok) return null;
  const accounts = await r.json();
  if (!accounts.length) return null;
  const slug = accounts[0].slug;
  const r2 = await fetch(`https://api.netlify.com/api/v1/accounts/${slug}/billing`, {
    headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` }
  });
  return r2.ok ? r2.json() : null;
}

// ── Deploy logic ────────────────────────────────────────────────────────────
async function deployApp(chatId, appName, html, isUpdate) {
  const filePath = `apps/${appName}/index.html`;
  const tomlPath = `apps/${appName}/netlify.toml`;
  const verb = isUpdate ? 'Updating' : 'Deploying';

  await bot.sendMessage(chatId, `⏳ ${verb} *${appName}*...`, { parse_mode: 'Markdown' });

  // Check if file exists (get SHA for update)
  const existing = await ghGet(filePath);

  if (!isUpdate && existing) {
    await bot.sendMessage(chatId, `⚠️ App *${appName}* already exists. Use /update ${appName} to overwrite it.`, { parse_mode: 'Markdown' });
    return;
  }

  if (isUpdate && !existing) {
    await bot.sendMessage(chatId, `⚠️ App *${appName}* doesn't exist yet. Use /deploy ${appName} to create it.`, { parse_mode: 'Markdown' });
    return;
  }

  const sha = existing ? existing.sha : undefined;

  // Push index.html
  await ghPut(filePath, html, `${verb} ${appName}`, sha);

  // Push netlify.toml only on new deploy
  if (!isUpdate) {
    const toml = `[build]\n  base    = "apps/${appName}"\n  publish = "apps/${appName}"\n`;
    const existingToml = await ghGet(tomlPath);
    await ghPut(tomlPath, toml, `Add netlify.toml for ${appName}`, existingToml?.sha);
  }

  const action = isUpdate ? 'updated' : 'deployed';
  const netlifyName = `wanz-${appName}`;

  await bot.sendMessage(chatId,
    `✅ *${appName}* ${action}!\n\n` +
    `🌐 URL: https://${netlifyName}.netlify.app\n\n` +
    (isUpdate ? '' : `⚠️ First deploy? Connect this app on Netlify:\n` +
    `netlify.com → Add new site → Import from GitHub\n` +
    `Set base dir: \`apps/${appName}\`\n` +
    `Site name: \`${netlifyName}\`\n\n`) +
    `Netlify will auto-deploy in ~30 seconds.`,
    { parse_mode: 'Markdown' }
  );
}

// ── Commands ────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  if (!isAllowed(msg)) return;
  bot.sendMessage(msg.chat.id,
    `👋 *Wanz Deploy Bot*\n\n` +
    `Commands:\n` +
    `/deploy appname — deploy new app\n` +
    `/update appname — update existing app\n` +
    `/list — show all live apps\n` +
    `/status — Netlify build minute usage\n` +
    `/cancel — cancel pending action\n\n` +
    `After /deploy or /update, paste your HTML in the next message.`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/deploy (.+)/, (msg, match) => {
  if (!isAllowed(msg)) return;
  const appName = match[1].trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  pending[msg.chat.id] = { type: 'deploy', appName };
  bot.sendMessage(msg.chat.id,
    `📋 Ready to deploy *${appName}*\n\nPaste your HTML now:`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/update (.+)/, (msg, match) => {
  if (!isAllowed(msg)) return;
  const appName = match[1].trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  pending[msg.chat.id] = { type: 'update', appName };
  bot.sendMessage(msg.chat.id,
    `📋 Ready to update *${appName}*\n\nPaste your HTML now:`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/cancel/, (msg) => {
  if (!isAllowed(msg)) return;
  delete pending[msg.chat.id];
  bot.sendMessage(msg.chat.id, '❌ Cancelled.');
});

bot.onText(/\/list/, async (msg) => {
  if (!isAllowed(msg)) return;
  const sites = await getNetlifySites();
  if (!sites.length) {
    bot.sendMessage(msg.chat.id, 'No Netlify sites found.');
    return;
  }
  const lines = sites.map(s => `• [${s.name}](${s.ssl_url})`).join('\n');
  bot.sendMessage(msg.chat.id, `🌐 *Your apps:*\n\n${lines}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
  if (!isAllowed(msg)) return;
  const usage = await getNetlifyUsage();
  if (!usage) {
    bot.sendMessage(msg.chat.id, '⚠️ Could not fetch Netlify usage. Check your NETLIFY_TOKEN.');
    return;
  }
  const mins = usage.minutes_used_this_period || 0;
  const limit = usage.included_minutes || 300;
  const pct = Math.round((mins / limit) * 100);
  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  bot.sendMessage(msg.chat.id,
    `📊 *Netlify build minutes*\n\n${bar} ${pct}%\n${mins} / ${limit} minutes used\n\n` +
    (pct > 80 ? '⚠️ Getting close to limit! Push carefully.' : '✅ You\'re well within limits.'),
    { parse_mode: 'Markdown' }
  );
});

// ── HTML message handler ────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (!isAllowed(msg)) return;
  if (msg.text && msg.text.startsWith('/')) return;

  const state = pending[msg.chat.id];
  if (!state) return;

  const html = msg.text || '';
  if (!html.includes('<') || !html.includes('>')) {
    bot.sendMessage(msg.chat.id, '⚠️ That doesn\'t look like HTML. Try again or /cancel.');
    return;
  }

  delete pending[msg.chat.id];
  await deployApp(msg.chat.id, state.appName, html, state.type === 'update');
});

console.log('Wanz Deploy Bot running...');
