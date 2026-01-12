# PAI Notifier

A Telegram bot that monitors the PAI (Persatuan Aktuaris Indonesia) news website and sends notifications when new articles are published.

## Features

- 🔍 Automatically scrapes the PAI news page for updates
- 📱 Sends Telegram notifications when new articles are found
- ⏰ Configurable check interval (default: every 30 minutes)
- 💾 Persists seen articles to avoid duplicate notifications
- 🤖 Interactive Telegram commands

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the prompts
3. Copy the API token provided

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Edit `.env` and add your bot token:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
CHECK_INTERVAL_MINUTES=30
```

**To get your Chat ID:**
1. Start the bot with `npm start`
2. Send `/start` to your bot in Telegram
3. The bot will respond with your Chat ID

### 4. Test the Scraper

```bash
npm test
```

This runs the scraper in test mode to verify it can fetch articles without sending notifications.

### 5. Run the Bot

```bash
npm start
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and your Chat ID |
| `/check` | Manually check for new articles |
| `/latest` | Show the 5 latest articles |
| `/status` | Bot status and uptime |
| `/help` | Show available commands |

## How It Works

1. **Scheduled Polling**: The bot checks the news page every 30 minutes (configurable)
2. **HTML Parsing**: Uses Cheerio to parse the HTML and extract article links
3. **Change Detection**: Compares article IDs against stored IDs to detect new content
4. **Notifications**: Sends formatted Telegram messages with links to new articles
5. **Persistence**: Saves seen article IDs to `data/seen_articles.json`

## Running in Production

### Using PM2

```bash
npm install -g pm2
pm2 start src/index.js --name pai-notifier
pm2 save
```

### Using Docker (optional)

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t pai-notifier .
docker run -d --env-file .env --name pai-notifier pai-notifier
```

## License

MIT
