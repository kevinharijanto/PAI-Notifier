require('dotenv').config();

const cron = require('node-cron');
const { initBot, sendNewArticlesNotification, getBot, sendInstagramPost } = require('./telegram');
const { scrapeArticles } = require('./scraper');
const { checkRegistrationOpen, getSession } = require('./examMonitor');
const { fetchPosts } = require('./instagramMonitor');
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
    getInstagramState,
    updateInstagramState,
} = require('./storage');

// Track last check time per user for interval-based scheduling
const userLastCheck = new Map();
// Track last known registration status to detect changes
let lastRegistrationOpen = false;
const INSTAGRAM_USERNAME = 'aktuarisindonesia';
const INSTAGRAM_STARTUP_COOLDOWN_MINUTES = Number.parseInt(process.env.INSTAGRAM_STARTUP_COOLDOWN_MINUTES || '1200', 10);
const INSTAGRAM_STARTUP_COOLDOWN_MS = (
    Number.isFinite(INSTAGRAM_STARTUP_COOLDOWN_MINUTES) && INSTAGRAM_STARTUP_COOLDOWN_MINUTES > 0
        ? INSTAGRAM_STARTUP_COOLDOWN_MINUTES
        : 1200
) * 60 * 1000;

function formatElapsed(ms) {
    const minutes = Math.max(1, Math.round(ms / 60000));

    if (minutes < 60) {
        return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function getInstagramStartupSkipReason(username, seenPosts) {
    if (seenPosts.size === 0) {
        return null;
    }

    const state = getInstagramState(username);
    const lastSuccessAt = state?.lastSuccessAt ? Date.parse(state.lastSuccessAt) : Number.NaN;

    if (!Number.isFinite(lastSuccessAt)) {
        return null;
    }

    const elapsed = Date.now() - lastSuccessAt;
    if (elapsed < 0 || elapsed >= INSTAGRAM_STARTUP_COOLDOWN_MS) {
        return null;
    }

    return `last successful check was ${formatElapsed(elapsed)} ago`;
}

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
 * Checks the hardcoded Instagram account for new posts
 * Notifies all users who have reminders enabled
 * @param {boolean} isFirstRun - If true, send latest post; otherwise notify only for new posts
 */
async function legacyCheckInstagramUpdates(isFirstRun = false) {
    const username = 'aktuarisindonesia';

    console.log(`[${new Date().toISOString()}] Checking Instagram @${username}...`);
    const bot = getBot();
    if (!bot) return;

    // Notify all users with reminders enabled
    const usersWithReminders = getAllUsersWithReminders();
    const adminId = process.env.ADMIN_CHAT_ID;

    // Build recipient list: all users with reminders + admin
    const recipients = new Set(usersWithReminders.map(u => u.userId));
    if (adminId) recipients.add(adminId);

    if (recipients.size === 0) {
        console.log(`[${new Date().toISOString()}] No recipients for Instagram notifications.`);
        return;
    }

    try {
        // Notify recipients that we're checking
        if (!isFirstRun) {
            for (const userId of recipients) {
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
            return;
        }

        const seenPosts = getSeenPostsForUser(username);

        if (isFirstRun && seenPosts.size === 0) {
            // First run: send the latest post and mark all as seen
            console.log(`[${new Date().toISOString()}] First run for @${username} - sending latest post`);
            const latestPost = posts[0];

            for (const userId of recipients) {
                try {
                    await sendInstagramPost(userId, username, latestPost);
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
                for (const userId of recipients) {
                    try {
                        await bot.sendMessage(userId, `✅ No new posts from @${username}.`);
                    } catch (e) {
                        console.error(`[Instagram] Failed to send to ${userId}:`, e.message);
                    }
                }
            } else {
                console.log(`[${new Date().toISOString()}] Found ${newPosts.length} new post(s) from @${username}!`);

                for (const post of newPosts) {
                    for (const userId of recipients) {
                        try {
                            await sendInstagramPost(userId, username, post);
                        } catch (e) {
                            console.error(`[Instagram] Failed to send post ${post.shortcode} to ${userId}:`, e.message);
                        }
                    }
                }

                // Mark new posts as seen
                markPostsAsSeen(username, newPosts.map(p => p.shortcode));
            }
        }

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error checking @${username}:`, error.message);

        for (const userId of recipients) {
            try {
                await bot.sendMessage(userId, `⚠️ Error checking @${username}: ${error.message}`);
            } catch (e) {
                // ignore
            }
        }
    }
}

/**
 * Checks watched Instagram accounts for new posts.
 * This replaces the legacy hardcoded-account flow without forcing a risky full-file rewrite.
 * @param {boolean} isFirstRun - If true, send latest post; otherwise notify only for new posts
 */
async function runInstagramNotifierChecks(isFirstRun = false) {
    const bot = getBot();
    if (!bot) return;

    const accountWatch = getAllWatchedAccounts().find(account => account.username === INSTAGRAM_USERNAME);
    const adminId = process.env.ADMIN_CHAT_ID;

    if (!accountWatch) {
        console.log(`[${new Date().toISOString()}] No subscribers for Instagram @${INSTAGRAM_USERNAME}.`);
        return;
    }

    const username = INSTAGRAM_USERNAME;
    const recipients = new Set(accountWatch.watchers.map(userId => String(userId)));
    if (adminId) recipients.add(String(adminId));

    if (recipients.size === 0) {
        return;
    }

    const seenPosts = getSeenPostsForUser(username);
    if (isFirstRun) {
        const skipReason = getInstagramStartupSkipReason(username, seenPosts);
        if (skipReason) {
            console.log(`[${new Date().toISOString()}] Skipping startup Instagram check for @${username}: ${skipReason}.`);
            return;
        }
    }

    console.log(`[${new Date().toISOString()}] Checking Instagram @${username} for ${recipients.size} recipient(s)...`);
    updateInstagramState(username, {
        lastAttemptAt: new Date().toISOString(),
    });

    try {
        const posts = await fetchPosts(username);

        if (posts.length === 0) {
            console.log(`[${new Date().toISOString()}] No posts found for @${username}`);
            updateInstagramState(username, {
                lastSuccessAt: new Date().toISOString(),
                lastError: null,
                lastPostCount: 0,
            });
            return;
        }

        if (isFirstRun && seenPosts.size === 0) {
            console.log(`[${new Date().toISOString()}] First run for @${username} - sending 3 latest posts`);
            const latestPosts = posts.slice(0, 3); // Fetch 3 latest posts on first run

            for (const latestPost of latestPosts) {
                for (const userId of recipients) {
                    try {
                        await sendInstagramPost(userId, username, latestPost);
                    } catch (e) {
                        console.error(`[Instagram] Failed to send @${username} to ${userId}:`, e.message);
                    }
                }
            }

            markPostsAsSeen(username, posts.map(p => p.shortcode));
        } else {
            const newPosts = posts.filter(p => !seenPosts.has(p.shortcode));

            if (newPosts.length === 0) {
                console.log(`[${new Date().toISOString()}] No new posts from @${username}`);
            } else {
                console.log(`[${new Date().toISOString()}] Found ${newPosts.length} new post(s) from @${username}!`);

                for (const post of newPosts) {
                    for (const userId of recipients) {
                        try {
                            await sendInstagramPost(userId, username, post);
                        } catch (e) {
                            console.error(`[Instagram] Failed to send post ${post.shortcode} from @${username} to ${userId}:`, e.message);
                        }
                    }
                }

                markPostsAsSeen(username, newPosts.map(p => p.shortcode));
            }
        }

        updateInstagramState(username, {
            lastSuccessAt: new Date().toISOString(),
            lastError: null,
            lastPostCount: posts.length,
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error checking @${username}:`, error.message);
        updateInstagramState(username, {
            lastError: error.message,
        });

        for (const userId of recipients) {
            try {
                await bot.sendMessage(userId, `⚠️ Error checking @${username}: ${error.message}`);
            } catch (e) {
                // ignore
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

    // Run initial Instagram check when watched accounts exist and the last success is stale
    console.log('\n📸 Running initial Instagram check...');
    await runInstagramNotifierChecks(true);

    // Schedule per-user checks every minute (the function checks individual intervals)
    cron.schedule('* * * * *', async () => {
        await runPerUserChecks();
    });

    // Schedule Instagram checks daily at 8 AM Asia/Jakarta
    cron.schedule('0 8 * * *', async () => {
        console.log(`\n[${new Date().toISOString()}] Running daily Instagram check (8 AM GMT+7)...`);
        await runInstagramNotifierChecks(false);
    }, {
        timezone: 'Asia/Jakarta'
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

