require('dotenv').config();

const cron = require('node-cron');
const { initBot, sendNewArticlesNotification, getBot, sendInstagramPost } = require('./telegram');
const { scrapeArticles } = require('./scraper');
const { checkRegistrationOpen, getSession } = require('./examMonitor');
const { fetchShortcodes } = require('./instagramMonitor');
const {
    loadSeenArticles,
    getNewArticles,
    markArticlesAsSeen,
    saveSeenArticles,
    getAllUsersWithReminders,
    getUserPreference,
    setUserPreference,
    getAllWatchedAccounts,
    getSeenPostsForUser,
    markPostsAsSeen,
} = require('./storage');

// Track last check time per user for interval-based scheduling
const userLastCheck = new Map();
// Track last known registration status to detect changes
let lastRegistrationOpen = false;

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
 * Checks registration status for all users with PAI credentials
 * Notifies if registration becomes available
 */
async function checkRegistrationForUsers() {
    const usersWithReminders = getAllUsersWithReminders();

    for (const user of usersWithReminders) {
        const email = getUserPreference(user.userId, 'paiEmail', null);
        const password = getUserPreference(user.userId, 'paiPassword', null);

        if (!email || !password) continue; // Skip users without PAI credentials

        try {
            const cookie = await getSession(user.userId, email, password);
            if (!cookie) continue;

            const result = await checkRegistrationOpen(cookie);

            // Notify user if registration just opened
            if (result.isOpen && !lastRegistrationOpen) {
                const bot = getBot();
                if (bot) {
                    let message = `🟢 *PAI Exam Registration is NOW OPEN!*\n\n`;
                    message += `*Available Periods:*\n`;
                    result.periods.forEach((p, i) => {
                        message += `${i + 1}. ${p.text}\n`;
                    });
                    message += `\n👉 [Register Now](https://www.aktuaris.or.id/exam/registration)`;

                    await bot.sendMessage(user.userId, message, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    console.log(`[${new Date().toISOString()}] Notified user ${user.userId} about registration opening`);
                }
            }

            lastRegistrationOpen = result.isOpen;
            break; // Only need to check once per cycle

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error checking registration:`, error.message);
        }
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
        // Also check registration on the same schedule
        await checkRegistrationForUsers();
    }
}

/**
 * Checks all watched Instagram accounts for new posts
 * @param {boolean} isFirstRun - If true, send latest post; otherwise notify only for new posts
 */
async function checkInstagramUpdates(isFirstRun = false) {
    const watchedAccounts = getAllWatchedAccounts();

    if (watchedAccounts.length === 0) {
        console.log(`[${new Date().toISOString()}] No Instagram accounts being watched.`);
        return;
    }

    console.log(`[${new Date().toISOString()}] Checking ${watchedAccounts.length} Instagram account(s)...`);
    const bot = getBot();
    if (!bot) return;

    for (const { username, watchers } of watchedAccounts) {
        try {
            // Notify watchers that we're checking
            if (!isFirstRun) {
                for (const userId of watchers) {
                    try {
                        await bot.sendMessage(userId, `🔍 Checking latest IG post from @${username}...`);
                    } catch (e) {
                        console.error(`[Instagram] Failed to send status to ${userId}:`, e.message);
                    }
                }
            }

            const posts = await fetchShortcodes(username);

            if (posts.length === 0) {
                console.log(`[${new Date().toISOString()}] No posts found for @${username}`);
                continue;
            }

            const seenPosts = getSeenPostsForUser(username);

            if (isFirstRun && seenPosts.size === 0) {
                // First run: send the latest post and mark all as seen
                console.log(`[${new Date().toISOString()}] First run for @${username} - sending latest post`);
                const latestPost = posts[0];

                for (const userId of watchers) {
                    try {
                        await sendInstagramPost(userId, username, latestPost.shortcode);
                    } catch (e) {
                        console.error(`[Instagram] Failed to send to ${userId}:`, e.message);
                    }
                }

                // Mark all current posts as seen
                markPostsAsSeen(username, posts.map(p => p.shortcode));
            } else {
                // Regular check: find new posts
                const newPosts = posts.filter(p => !seenPosts.has(p.shortcode));

                if (newPosts.length === 0) {
                    console.log(`[${new Date().toISOString()}] No new posts from @${username}`);
                    for (const userId of watchers) {
                        try {
                            await bot.sendMessage(userId, `✅ No new posts from @${username}.`);
                        } catch (e) {
                            console.error(`[Instagram] Failed to send to ${userId}:`, e.message);
                        }
                    }
                } else {
                    console.log(`[${new Date().toISOString()}] Found ${newPosts.length} new post(s) from @${username}!`);

                    // Send newest posts first (they're already sorted newest-first from API)
                    for (const post of newPosts) {
                        for (const userId of watchers) {
                            try {
                                await sendInstagramPost(userId, username, post.shortcode);
                            } catch (e) {
                                console.error(`[Instagram] Failed to send post ${post.shortcode} to ${userId}:`, e.message);
                            }
                        }
                    }

                    // Mark new posts as seen
                    markPostsAsSeen(username, newPosts.map(p => p.shortcode));
                }
            }

            // Small delay between accounts to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error checking @${username}:`, error.message);

            // Notify watchers of error
            for (const userId of watchers) {
                try {
                    await bot.sendMessage(userId, `⚠️ Error checking @${username}: ${error.message}`);
                } catch (e) {
                    // ignore
                }
            }
        }
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

    // Run initial Instagram check
    console.log('\n📸 Running initial Instagram check...');
    await checkInstagramUpdates(true);

    // Schedule per-user checks every minute (the function checks individual intervals)
    cron.schedule('* * * * *', async () => {
        await runPerUserChecks();
    });

    // Schedule Instagram checks daily at 8 AM
    cron.schedule('0 8 * * *', async () => {
        console.log(`\n[${new Date().toISOString()}] Running daily Instagram check...`);
        await checkInstagramUpdates(false);
    });

    console.log(`\n✅ Bot is running!`);
    console.log(`🔄 Per-user reminders enabled (users set their own intervals with /reminder)`);
    console.log(`📸 Instagram check scheduled daily at 8 AM`);
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

