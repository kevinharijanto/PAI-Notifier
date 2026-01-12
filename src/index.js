require('dotenv').config();

const cron = require('node-cron');
const { initBot, sendNewArticlesNotification } = require('./telegram');
const { scrapeArticles } = require('./scraper');
const {
    loadSeenArticles,
    getNewArticles,
    markArticlesAsSeen,
    saveSeenArticles,
    getAllUsersWithReminders,
    getUserPreference,
    setUserPreference
} = require('./storage');

// Track last check time per user for interval-based scheduling
const userLastCheck = new Map();

/**
 * Main check function - scrapes website and notifies if new articles found
 * @param {boolean} isFirstRun - If true, scrape all pages for initial population
 * @param {string|null} userId - If provided, notify this specific user
 */
async function checkForUpdates(isFirstRun = false, userId = null) {
    console.log(`\n[${new Date().toISOString()}] Running ${isFirstRun ? 'INITIAL FULL' : 'scheduled'} check...`);

    try {
        // Load previously seen article IDs
        const seenIds = loadSeenArticles();

        // On first run with empty database, scrape ALL pages
        const shouldScrapeAll = isFirstRun && seenIds.size === 0;

        // Fetch current articles from website
        const articles = await scrapeArticles(shouldScrapeAll);

        // Find articles we haven't seen before
        const newArticles = getNewArticles(articles, seenIds);

        if (newArticles.length > 0) {
            console.log(`[${new Date().toISOString()}] Found ${newArticles.length} new article(s)!`);

            if (shouldScrapeAll) {
                // On initial population, just save to database without notification
                console.log(`[${new Date().toISOString()}] Initial population - saving all articles to database...`);
                markArticlesAsSeen(newArticles, seenIds);
                console.log(`[${new Date().toISOString()}] Saved ${newArticles.length} articles. Future checks will notify for new ones.`);
            } else {
                // Notify users who have reminders enabled
                const usersWithReminders = getAllUsersWithReminders();

                if (usersWithReminders.length > 0) {
                    console.log(`[${new Date().toISOString()}] Notifying ${usersWithReminders.length} user(s)...`);

                    for (const user of usersWithReminders) {
                        try {
                            await sendNewArticlesNotification(user.userId, newArticles);
                            console.log(`[${new Date().toISOString()}] Notified user ${user.userId}`);
                        } catch (error) {
                            console.error(`[${new Date().toISOString()}] Failed to notify user ${user.userId}:`, error.message);
                        }
                    }
                }

                // Mark articles as seen
                markArticlesAsSeen(newArticles, seenIds);
                console.log(`[${new Date().toISOString()}] Articles marked as seen.`);
            }
        } else {
            console.log(`[${new Date().toISOString()}] No new articles found.`);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error during check:`, error.message);
    }
}

/**
 * Checks if it's time to run a check based on per-user intervals
 */
async function runPerUserChecks() {
    const usersWithReminders = getAllUsersWithReminders();
    const now = Date.now();

    // Find the minimum interval to determine if we need to check
    let needsCheck = false;

    for (const user of usersWithReminders) {
        const lastCheck = userLastCheck.get(user.userId) || 0;
        const intervalMs = user.intervalMinutes * 60 * 1000;

        if (now - lastCheck >= intervalMs) {
            needsCheck = true;
            userLastCheck.set(user.userId, now);
        }
    }

    if (needsCheck) {
        await checkForUpdates(false);
    }
}

/**
 * Test mode - runs scraper once and shows results without sending notifications
 */
async function runTestMode() {
    console.log('='.repeat(50));
    console.log('PAI Notifier - TEST MODE');
    console.log('='.repeat(50));
    console.log('\nTesting scraper functionality...\n');

    try {
        const articles = await scrapeArticles();

        console.log('\n📰 Articles found on the website:');
        console.log('-'.repeat(50));

        articles.slice(0, 10).forEach((article, index) => {
            console.log(`${index + 1}. [ID: ${article.id}] ${article.title}`);
            console.log(`   URL: ${article.url}\n`);
        });

        if (articles.length > 10) {
            console.log(`... and ${articles.length - 10} more articles`);
        }

        console.log('-'.repeat(50));
        console.log('\n✅ Scraper test completed successfully!');
        console.log('\nTo run the bot:');
        console.log('1. Create a .env file from .env.example');
        console.log('2. Add your Telegram bot token and chat ID');
        console.log('3. Run: npm start');

    } catch (error) {
        console.error('\n❌ Scraper test failed:', error.message);
        process.exit(1);
    }

    process.exit(0);
}

/**
 * Initialize and start the bot
 */
async function main() {
    // Check for test mode
    if (process.argv.includes('--test')) {
        await runTestMode();
        return;
    }

    console.log('='.repeat(50));
    console.log('PAI Notifier - Starting...');
    console.log('='.repeat(50));

    // Validate required environment variables
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.error('❌ TELEGRAM_BOT_TOKEN is not set!');
        console.error('   Please create a .env file with your bot token.');
        process.exit(1);
    }

    // Initialize Telegram bot
    initBot();

    // Run initial check on startup (with isFirstRun=true to populate database if empty)
    console.log('\n📡 Running initial check...');
    await checkForUpdates(true);

    // Schedule per-user checks every minute (the function checks individual intervals)
    cron.schedule('* * * * *', async () => {
        await runPerUserChecks();
    });

    console.log(`\n✅ Bot is running!`);
    console.log(`🔄 Per-user reminders enabled (users set their own intervals with /reminder)`);
    console.log(`💬 Send /start to your bot to get started\n`);

    // Graceful shutdown handling
    process.on('SIGINT', () => {
        console.log('\n\nShutting down gracefully...');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n\nReceived SIGTERM. Shutting down...');
        process.exit(0);
    });
}

// Run the bot
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

