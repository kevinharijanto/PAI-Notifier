# Deployment Guide - PAI Notifier with Instagram Fixes

## Summary of Changes

### ✅ Fixed Issues

1. **Instagram Rate Limiting (429 Errors)**
   - Removed stale hardcoded cookies
   - Implemented cookie caching with 1-hour expiry
   - Added persistent cookie storage to disk
   - Implemented request throttling (30s minimum between requests)
   - Increased retry attempts from 3 to 5 with longer delays
   - Retry delays: 10s → 30s → 1m → 2m → 5m

2. **Timezone Issue**
   - Fixed Instagram check schedule to run at 8 AM GMT+7 (Asia/Jakarta)
   - Previously ran at 8 AM UTC (1 AM GMT+7)

### 📝 Modified Files

- [`src/instagramMonitor.js`](../src/instagramMonitor.js) - Complete rewrite of cookie management
- [`src/index.js`](../src/index.js) - Fixed cron schedule timezone
- [`.gitignore`](../.gitignore) - Added cookie cache file to ignore list
- [`test-instagram.js`](../test-instagram.js) - Updated test script to use new API

## Bot Behavior

### On Deploy/Startup
- ✅ Runs initial Instagram check
- ✅ Sends the latest post from `@aktuarisindonesia` to all users with reminders enabled
- ✅ Marks all current posts as seen

### Daily Schedule
- ✅ Checks Instagram every day at **8 AM GMT+7** (Asia/Jakarta timezone)
- ✅ Only notifies users about **new posts** (posts not seen before)
- ✅ Uses cookie caching to avoid rate limiting

### Cookie Management
- ✅ Cookies are cached for 1 hour in memory
- ✅ Cookies are persisted to disk at `data/instagram_cookies.json`
- ✅ Automatic cookie refresh when cache expires
- ✅ 30-second minimum delay between requests to avoid rate limiting

## Pre-Deployment Testing

### Step 1: Test Locally

Run the test script to verify the fixes work:

```bash
node test-instagram.js
```

**Expected Results:**
- ✅ Test 1: Cookie refresh with caching should succeed
- ✅ Test 2: Single request should fetch posts successfully
- ✅ Test 3: Request with retries should succeed
- ✅ Test 4: Multiple requests should work with throttling

### Step 2: Test Full Bot

Test the complete bot locally:

```bash
npm start
```

Verify:
- Bot starts successfully
- Initial Instagram check runs
- Latest post is sent to your Telegram

## Deployment to VPS

### Option 1: Docker Deployment (Recommended)

1. **Prepare Environment Variables**
   ```bash
   # Create .env file on VPS
   nano .env
   ```

   Add your credentials:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   ADMIN_CHAT_ID=your_telegram_chat_id
   ```

2. **Build and Run with Docker Compose**
   ```bash
   docker-compose up -d
   ```

3. **View Logs**
   ```bash
   docker-compose logs -f
   ```

4. **Stop the Bot**
   ```bash
   docker-compose down
   ```

### Option 2: Direct Node.js Deployment

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Create .env File**
   ```bash
   nano .env
   ```

   Add your credentials:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   ADMIN_CHAT_ID=your_telegram_chat_id
   ```

3. **Start the Bot**
   ```bash
   npm start
   ```

4. **Run with PM2 (Recommended for Production)**
   ```bash
   # Install PM2 globally
   npm install -g pm2

   # Start the bot with PM2
   pm2 start src/index.js --name pai-notifier

   # View logs
   pm2 logs pai-notifier

   # Restart the bot
   pm2 restart pai-notifier

   # Stop the bot
   pm2 stop pai-notifier
   ```

## Monitoring

### Check Bot Status

**With Docker:**
```bash
docker-compose ps
docker-compose logs --tail=100
```

**With PM2:**
```bash
pm2 status
pm2 logs pai-notifier --lines=100
```

### Check Instagram Functionality

Look for these log messages:
- `[Instagram] Using cached cookies` - Cookie cache working
- `[Instagram] Fetching fresh cookies...` - Cookie refresh
- `[Instagram] Throttling: waiting Xs before request` - Rate limiting protection
- `[Instagram] @aktuarisindonesia has X total posts, got Y latest` - Successful fetch

### Troubleshooting

**If you see 429 errors:**
- Check if cookies are being cached properly
- Verify the cookie cache file exists at `data/instagram_cookies.json`
- Ensure the bot isn't restarting too frequently

**If Instagram checks don't run:**
- Verify the cron schedule is correct
- Check timezone settings on your VPS
- Ensure the bot is running continuously

**If posts aren't being sent:**
- Check if users have reminders enabled
- Verify the bot has permission to send messages
- Check Telegram bot token is valid

## Data Persistence

The bot creates and maintains these files:

- `data/seen_articles.json` - Tracks seen articles
- `data/instagram_cookies.json` - Cached Instagram cookies (auto-generated)
- `data/users.json` - User preferences and reminders

**Important:** These files are in `.gitignore` and will not be tracked in git. They are created automatically when the bot runs.

## Security Notes

- ⚠️ Never commit `.env` file to version control
- ⚠️ Never share your Telegram bot token
- ⚠️ The cookie cache file contains sensitive Instagram session data
- ⚠️ Ensure your VPS has proper firewall rules

## Performance Considerations

- Cookie caching reduces API calls to Instagram
- Request throttling prevents rate limiting
- Daily checks at 8 AM GMT+7 minimize API usage
- Automatic retry with exponential backoff handles temporary failures

## Next Steps

1. ✅ Test locally with `node test-instagram.js`
2. ✅ Deploy to VPS using Docker or PM2
3. ✅ Monitor logs for first few days
4. ✅ Verify Instagram checks run at 8 AM GMT+7
5. ✅ Confirm new posts are being sent to users

## Support

If you encounter issues:

1. Check the logs for error messages
2. Review the analysis in [`plans/instagram-rate-limit-analysis.md`](instagram-rate-limit-analysis.md)
3. Run the test script to isolate the issue
4. Verify environment variables are set correctly

## Success Metrics

Your deployment is successful if:
- ✅ Bot starts without errors
- ✅ Initial Instagram check sends latest post
- ✅ Daily checks run at 8 AM GMT+7
- ✅ New posts are sent to users
- ✅ No 429 errors in logs
- ✅ Cookie cache is being used
