# Wanz Deploy Bot — Setup Guide

## Step 1: Telegram — get your bot token + user ID

1. Open Telegram → message @BotFather → /newbot
2. Follow prompts → copy the token (looks like 123456:ABC-DEF...)
3. Get your Telegram user ID: message @userinfobot → it replies with your ID number

## Step 2: GitHub — get a personal access token

1. github.com → Settings (top right avatar) → Developer settings
2. Personal access tokens → Tokens (classic) → Generate new token
3. Name: "wanz-deploy-bot", tick only: repo (full control)
4. Copy the token (ghp_...)

## Step 3: Netlify — get an API token

1. netlify.com → top right avatar → User settings
2. Applications → Personal access tokens → New access token
3. Name: "wanz-deploy-bot" → copy the token

## Step 4: Deploy bot to Render (free)

1. Push this folder to a NEW GitHub repo (e.g. wanz-deploy-bot)
   - Keep it private — it will contain your .env secrets via Render dashboard
2. render.com → New → Web Service → connect your wanz-deploy-bot repo
3. Render auto-detects render.yaml
4. Add environment variables in Render dashboard:
   - TELEGRAM_BOT_TOKEN = your bot token
   - TELEGRAM_ALLOWED_USER_ID = your Telegram user ID number
   - GITHUB_TOKEN = your GitHub PAT
   - GITHUB_USERNAME = your GitHub username
   - GITHUB_REPO = hub-repo (or whatever you named it)
   - NETLIFY_TOKEN = your Netlify token
5. Deploy → done. Bot is live.

## Step 5: Test it

Open Telegram → your bot → /start
It should reply with the command list.

## Daily workflow

1. Claude builds your HTML app
2. Open Telegram → your bot
3. Send: /deploy invox  (or whatever the app name is)
4. Bot replies: "Ready, paste your HTML"
5. Copy HTML from Claude → paste into Telegram
6. Bot pushes to GitHub → Netlify deploys → bot sends you the live URL

For updates:
- Send: /update invox
- Paste new HTML
- Done

## Notes on Render free tier

- Free tier "sleeps" after 15 minutes of no messages
- First message after sleep takes ~30 seconds to wake up
- Subsequent messages are instant
- This is fine for your use case — you send the first command, wait 30s, then it's fast
- Render gives 750 free hours/month — more than enough for one always-on bot

## Netlify first-time connect (only once per new app)

When you /deploy a brand new app, you still need to connect it to Netlify once:
1. netlify.com → Add new site → Import from GitHub
2. Select hub-repo → Base directory: apps/appname
3. Site name: wanz-appname
4. Deploy

After that, every /update auto-deploys with no manual steps.
