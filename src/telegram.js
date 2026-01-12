const TelegramBot = require('node-telegram-bot-api');
const { scrapeArticles } = require('./scraper');
const { fetchExamListForUser } = require('./examMonitor');
const {
    loadSeenArticles,
    getNewArticles,
    markArticlesAsSeen,
    isUserAllowed,
    addAllowedUser,
    removeAllowedUser,
    addAccessRequest,
    removeAccessRequest,
    getAccessRequests,
    loadAllowedUsers,
    getUserPreference,
    setUserPreference,
    getAllUsersWithReminders
} = require('./storage');

let bot = null;

/**
 * Gets the admin chat ID from environment
 * @returns {string|null} Admin chat ID or null
 */
function getAdminChatId() {
    return process.env.ADMIN_CHAT_ID || null;
}

/**
 * Checks if a user is the admin
 * @param {string} userId - User ID to check
 * @returns {boolean} True if user is admin
 */
function isAdmin(userId) {
    const adminId = getAdminChatId();
    return adminId && String(userId) === String(adminId);
}

/**
 * Checks if a user can use the bot (admin or allowed user)
 * @param {string} userId - User ID to check
 * @returns {boolean} True if user can use the bot
 */
function canUseBot(userId) {
    return isAdmin(userId) || isUserAllowed(userId);
}

/**
 * Initializes the Telegram bot
 * @returns {TelegramBot} The bot instance
 */
function initBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
    }

    bot = new TelegramBot(token, { polling: true });

    // Handle /start command - shows welcome or access denied
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const username = msg.from.username;
        const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();

        if (canUseBot(userId)) {
            // User is allowed
            let message = `👋 *Welcome to PAI News Notifier!*

Your Chat ID is: \`${chatId}\`

*Available Commands:*
/check - Check for new articles now
/latest - Show the 5 latest articles
/status - Bot status info
/help - Show this help message`;

            if (isAdmin(userId)) {
                message += `

*Admin:*
/admin - Open admin panel`;
            }

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } else {
            // User is not allowed - log request and deny
            addAccessRequest(userId, username, name);
            console.log(`[ACCESS REQUEST] User ${userId} (@${username || 'no_username'}) - ${name}`);

            const message = `🔒 *Access Denied*

Your request has been logged. An admin will review your access request.

Your User ID: \`${userId}\``;

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    });

    // Handle /help command (authorized users only)
    bot.onText(/\/help/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!canUseBot(userId)) {
            bot.sendMessage(chatId, '🔒 Access denied. Send /start to request access.');
            return;
        }

        let message = `*PAI News Notifier Commands:*

/check - Manually check for new articles
/latest - Show the 5 latest articles on the website
/status - Show bot status and last check time
/help - Show this help message

The bot automatically checks for updates every ${process.env.CHECK_INTERVAL_MINUTES || 30} minutes.`;

        if (isAdmin(userId)) {
            message += `

*Admin:*
/admin - Open admin panel`;
        }

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    // Handle /check command - manual check for updates (authorized users only)
    bot.onText(/\/check/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!canUseBot(userId)) {
            bot.sendMessage(chatId, '🔒 Access denied. Send /start to request access.');
            return;
        }

        try {
            bot.sendMessage(chatId, '🔍 Checking for new articles...');

            const articles = await scrapeArticles();
            const seenIds = loadSeenArticles();
            const newArticles = getNewArticles(articles, seenIds);

            if (newArticles.length > 0) {
                await sendNewArticlesNotification(chatId, newArticles);
                markArticlesAsSeen(newArticles, seenIds);
            } else {
                bot.sendMessage(chatId, '✅ No new articles found. You\'re all caught up!');
            }
        } catch (error) {
            console.error('Error during manual check:', error);
            bot.sendMessage(chatId, `❌ Error checking for updates: ${error.message}`);
        }
    });

    // Handle /latest command - show latest articles (authorized users only)
    bot.onText(/\/latest/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!canUseBot(userId)) {
            bot.sendMessage(chatId, '🔒 Access denied. Send /start to request access.');
            return;
        }

        try {
            bot.sendMessage(chatId, '📰 Fetching latest articles...');

            const articles = await scrapeArticles();
            const latestArticles = articles.slice(0, 5);

            let message = '*📰 Latest 5 Articles:*\n\n';
            latestArticles.forEach((article, index) => {
                message += `${index + 1}. [${escapeMarkdown(article.title)}](${article.url})\n\n`;
            });

            bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        } catch (error) {
            console.error('Error fetching latest:', error);
            bot.sendMessage(chatId, `❌ Error fetching articles: ${error.message}`);
        }
    });

    // Handle /status command (authorized users only)
    bot.onText(/\/status/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!canUseBot(userId)) {
            bot.sendMessage(chatId, '🔒 Access denied. Send /start to request access.');
            return;
        }

        const seenIds = loadSeenArticles();
        const allowedUsers = loadAllowedUsers();
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);

        let message = `*🤖 Bot Status*

✅ Bot is running
⏱ Uptime: ${hours}h ${minutes}m
📊 Articles tracked: ${seenIds.size}
🔄 Check interval: ${process.env.CHECK_INTERVAL_MINUTES || 30} minutes
🌐 Target: aktuaris.or.id`;

        if (isAdmin(userId)) {
            message += `
👥 Allowed users: ${allowedUsers.size}
📋 Pending requests: ${getAccessRequests().length}`;
        }

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    // ==================== EXAM COMMANDS ====================

    // Handle /setpai command - start PAI credentials setup flow
    bot.onText(/\/setpai(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const args = match[1] ? match[1].trim() : null;

        if (!canUseBot(userId)) {
            bot.sendMessage(chatId, '\ud83d\udd12 Access denied. Send /start to request access.');
            return;
        }

        // Handle clear command
        if (args && args.toLowerCase() === 'clear') {
            setUserPreference(userId, 'paiEmail', null);
            setUserPreference(userId, 'paiPassword', null);
            setUserPreference(userId, 'paiLoginStep', null);
            bot.sendMessage(chatId, '\ud83d\uddd1 PAI credentials removed.');
            return;
        }

        // Check current credentials status
        const currentEmail = getUserPreference(userId, 'paiEmail', null);

        if (currentEmail && !args) {
            // Already has credentials, show options
            bot.sendMessage(chatId,
                `\u2705 *PAI Credentials*\n\nEmail: \`${currentEmail}\`\n\n` +
                `\u2022 Send /setpai again to update\n` +
                `\u2022 Send \`/setpai clear\` to remove`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Start the login flow - ask for email
        setUserPreference(userId, 'paiLoginStep', 'email');
        bot.sendMessage(chatId, '\ud83d\udce7 *PAI Login Setup*\n\nPlease enter your *email*:', { parse_mode: 'Markdown' });
    });

    // Handle text messages for PAI login flow
    bot.on('message', async (msg) => {
        // Skip commands and non-text messages
        if (!msg.text || msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text.trim();

        const loginStep = getUserPreference(userId, 'paiLoginStep', null);

        if (!loginStep) return; // Not in login flow

        if (loginStep === 'email') {
            // User sent email
            setUserPreference(userId, 'paiTempEmail', text);
            setUserPreference(userId, 'paiLoginStep', 'password');
            bot.sendMessage(chatId, `\ud83d\udd10 Email: \`${text}\`\n\nNow enter your *password*:\n\n_\u26a0\ufe0f Your message will be deleted for security_`, { parse_mode: 'Markdown' });

        } else if (loginStep === 'password') {
            // User sent password - delete message immediately
            try {
                await bot.deleteMessage(chatId, msg.message_id);
            } catch (e) {
                // May fail if bot doesn't have delete permission
            }

            const email = getUserPreference(userId, 'paiTempEmail', null);

            if (!email) {
                setUserPreference(userId, 'paiLoginStep', null);
                bot.sendMessage(chatId, '\u274c Something went wrong. Please start again with /setpai');
                return;
            }

            // Save credentials
            setUserPreference(userId, 'paiEmail', email);
            setUserPreference(userId, 'paiPassword', text);
            setUserPreference(userId, 'paiTempEmail', null);
            setUserPreference(userId, 'paiLoginStep', null);

            bot.sendMessage(chatId,
                `\u2705 *PAI Credentials Saved*\n\n` +
                `Email: \`${email}\`\n\n` +
                `Use /examstatus to check your exams.`,
                { parse_mode: 'Markdown' }
            );
        }
    });

    // Handle /examstatus command - fetch and display exam status
    bot.onText(/\/examstatus/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!canUseBot(userId)) {
            bot.sendMessage(chatId, '🔒 Access denied. Send /start to request access.');
            return;
        }

        const email = getUserPreference(userId, 'paiEmail', null);
        const password = getUserPreference(userId, 'paiPassword', null);

        if (!email || !password) {
            bot.sendMessage(chatId, '❌ PAI credentials not set.\n\nUse `/setpai email password` to set your credentials first.', { parse_mode: 'Markdown' });
            return;
        }

        try {
            bot.sendMessage(chatId, '📝 Logging in and fetching exam status...');

            const exams = await fetchExamListForUser(userId, email, password);

            if (!exams) {
                bot.sendMessage(chatId, '❌ Failed to fetch exams. Check your credentials with /setpai or try again later.');
                return;
            }

            if (exams.length === 0) {
                bot.sendMessage(chatId, '📭 No exams found.');
                return;
            }

            let message = `*📋 Exam Status (${exams.length}):*\n\n`;

            exams.forEach((exam, index) => {
                message += `*${index + 1}. ${escapeMarkdown(exam.kode)}*\n`;
                message += `📅 ${escapeMarkdown(exam.periode)}\n`;
                message += `📍 ${escapeMarkdown(exam.kota)}\n`;
                message += `✅ ${escapeMarkdown(exam.status)}\n`;
                if (exam.actions.length > 0) {
                    message += `🔗 ${exam.actions.map(a => escapeMarkdown(a.text)).join(', ')}\n`;
                }
                message += `\n`;
            });

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Error fetching exam status:', error);
            bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    // ==================== ADMIN COMMANDS ====================

    // Handle /requests command - show pending access requests (admin only)
    bot.onText(/\/requests/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!isAdmin(userId)) {
            bot.sendMessage(chatId, '🔒 This command is for admins only.');
            return;
        }

        const requests = getAccessRequests();

        if (requests.length === 0) {
            bot.sendMessage(chatId, '📭 No pending access requests.');
            return;
        }

        let message = `*📋 Pending Access Requests (${requests.length}):*\n\n`;
        requests.forEach((req, index) => {
            const username = req.username ? `@${req.username}` : 'no username';
            message += `${index + 1}. *${escapeMarkdown(req.name)}*\n`;
            message += `   ID: \`${req.userId}\`\n`;
            message += `   Username: ${escapeMarkdown(username)}\n`;
            message += `   Requested: ${new Date(req.requestedAt).toLocaleString()}\n\n`;
        });

        message += `_Use /grant <user_id> to approve_`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    // Handle /grant command - grant access to a user (admin only)
    bot.onText(/\/grant\s+(\d+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const targetUserId = match[1];

        if (!isAdmin(userId)) {
            bot.sendMessage(chatId, '🔒 This command is for admins only.');
            return;
        }

        addAllowedUser(targetUserId);
        removeAccessRequest(targetUserId);

        bot.sendMessage(chatId, `✅ User \`${targetUserId}\` has been granted access.`, { parse_mode: 'Markdown' });

        // Notify the user if possible
        try {
            bot.sendMessage(targetUserId, '🎉 Your access request has been approved! You can now use the bot.\n\nSend /start to get started.');
        } catch (e) {
            // User may have blocked the bot or never started it
        }
    });

    // Handle /revoke command - revoke access from a user (admin only)
    bot.onText(/\/revoke\s+(\d+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const targetUserId = match[1];

        if (!isAdmin(userId)) {
            bot.sendMessage(chatId, '🔒 This command is for admins only.');
            return;
        }

        removeAllowedUser(targetUserId);

        bot.sendMessage(chatId, `✅ User \`${targetUserId}\` access has been revoked.`, { parse_mode: 'Markdown' });
    });

    // Handle /users command - list all allowed users (admin only)
    bot.onText(/\/users/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!isAdmin(userId)) {
            bot.sendMessage(chatId, '🔒 This command is for admins only.');
            return;
        }

        const allowedUsers = loadAllowedUsers();

        if (allowedUsers.size === 0) {
            bot.sendMessage(chatId, '📭 No allowed users (except admin).');
            return;
        }

        let message = `*👥 Allowed Users (${allowedUsers.size}):*\n\n`;
        Array.from(allowedUsers).forEach((uid, index) => {
            message += `${index + 1}. \`${uid}\`\n`;
        });

        message += `\n_Use /revoke <user_id> to remove_`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    // Handle /reminder command - set notification interval (authorized users only)
    bot.onText(/\/reminder(?:\s+(.+))?/, (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const arg = match[1] ? match[1].trim() : null;

        if (!canUseBot(userId)) {
            bot.sendMessage(chatId, '🔒 Access denied. Send /start to request access.');
            return;
        }

        const currentInterval = getUserPreference(userId, 'reminderInterval', null);
        const isEnabled = getUserPreference(userId, 'reminderEnabled', false);

        if (!arg) {
            // Show current setting
            let message = '*⏰ Reminder Settings*\n\n';

            if (isEnabled && currentInterval) {
                message += `✅ Notifications: *Enabled*\n`;
                message += `⏱ Interval: Every *${currentInterval} minutes*\n\n`;
            } else {
                message += `❌ Notifications: *Disabled*\n\n`;
            }

            message += `*To change:*\n`;
            message += `• \`/reminder 30\` - Check every 30 minutes\n`;
            message += `• \`/reminder 60\` - Check every hour\n`;
            message += `• \`/reminder off\` - Turn off notifications`;

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return;
        }

        if (arg.toLowerCase() === 'off') {
            // Disable notifications
            setUserPreference(userId, 'reminderEnabled', false);
            bot.sendMessage(chatId, '🔕 Notifications disabled. You can still use /check manually.');
            return;
        }

        const minutes = parseInt(arg);
        if (isNaN(minutes) || minutes < 10 || minutes > 1440) {
            bot.sendMessage(chatId, '❌ Please enter a number between 10 and 1440 minutes (24 hours).\n\nExample: `/reminder 30`', { parse_mode: 'Markdown' });
            return;
        }

        // Set the interval
        setUserPreference(userId, 'reminderInterval', minutes);
        setUserPreference(userId, 'reminderEnabled', true);

        bot.sendMessage(chatId, `✅ Notifications set to every *${minutes} minutes*.\n\nI'll notify you when new articles are published.`, { parse_mode: 'Markdown' });
    });

    // ==================== ADMIN PANEL WITH INLINE KEYBOARDS ====================

    // Handle /admin command - shows admin panel with inline buttons
    bot.onText(/\/admin/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!isAdmin(userId)) {
            bot.sendMessage(chatId, '🔒 This command is for admins only.');
            return;
        }

        showAdminPanel(chatId);
    });

    /**
     * Shows the main admin panel
     */
    function showAdminPanel(chatId, messageId = null) {
        const requests = getAccessRequests();
        const allowedUsers = loadAllowedUsers();

        const message = `🔐 *Admin Panel*

📊 *Stats:*
• Allowed users: ${allowedUsers.size}
• Pending requests: ${requests.length}

What would you like to do?`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '👥 View Access Requests', callback_data: 'admin_requests' }],
                [{ text: '✅ View Allowed Users', callback_data: 'admin_users' }],
                [{ text: '❌ Exit Admin', callback_data: 'admin_exit' }]
            ]
        };

        if (messageId) {
            bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
            bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    }

    /**
     * Shows the access requests list
     */
    function showAccessRequests(chatId, messageId) {
        const requests = getAccessRequests();

        if (requests.length === 0) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '« Back to Admin', callback_data: 'admin_back' }]
                ]
            };

            bot.editMessageText('📭 No pending access requests.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard
            });
            return;
        }

        let message = `👥 *Access Requests (${requests.length}):*\n\n`;

        requests.forEach((req, index) => {
            const username = req.username ? `@${req.username}` : 'no username';
            const date = new Date(req.requestedAt).toLocaleString();
            message += `🆔 \`${req.userId}\`\n`;
            message += `👤 ${escapeMarkdown(req.name)} (${escapeMarkdown(username)})\n`;
            message += `📅 ${date}\n\n`;
        });

        // Create buttons for each request
        const buttons = requests.map(req => [{
            text: `➕ Add ${req.userId}`,
            callback_data: `admin_grant_${req.userId}`
        }]);

        buttons.push([{ text: '« Back to Admin', callback_data: 'admin_back' }]);

        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    }

    /**
     * Shows the allowed users list
     */
    function showAllowedUsers(chatId, messageId) {
        const allowedUsers = loadAllowedUsers();

        if (allowedUsers.size === 0) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '« Back to Admin', callback_data: 'admin_back' }]
                ]
            };

            bot.editMessageText('📭 No allowed users (except admin).', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard
            });
            return;
        }

        let message = `✅ *Allowed Users (${allowedUsers.size}):*\n\n`;

        Array.from(allowedUsers).forEach((uid, index) => {
            message += `${index + 1}. \`${uid}\`\n`;
        });

        // Create buttons for each user
        const buttons = Array.from(allowedUsers).map(uid => [{
            text: `➖ Remove ${uid}`,
            callback_data: `admin_revoke_${uid}`
        }]);

        buttons.push([{ text: '« Back to Admin', callback_data: 'admin_back' }]);

        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    }

    // Handle callback queries (button clicks)
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const userId = query.from.id;
        const data = query.data;

        // Only admin can use admin panel
        if (data.startsWith('admin_') && !isAdmin(userId)) {
            bot.answerCallbackQuery(query.id, { text: '🔒 Admin only' });
            return;
        }

        // Handle different callback actions
        if (data === 'admin_requests') {
            showAccessRequests(chatId, messageId);
            bot.answerCallbackQuery(query.id);
        }
        else if (data === 'admin_users') {
            showAllowedUsers(chatId, messageId);
            bot.answerCallbackQuery(query.id);
        }
        else if (data === 'admin_back') {
            showAdminPanel(chatId, messageId);
            bot.answerCallbackQuery(query.id);
        }
        else if (data === 'admin_exit') {
            bot.deleteMessage(chatId, messageId);
            bot.answerCallbackQuery(query.id, { text: 'Admin panel closed' });
        }
        else if (data.startsWith('admin_grant_')) {
            const targetUserId = data.replace('admin_grant_', '');
            addAllowedUser(targetUserId);
            removeAccessRequest(targetUserId);

            bot.answerCallbackQuery(query.id, { text: `✅ User ${targetUserId} granted access` });

            // Notify the user
            try {
                bot.sendMessage(targetUserId, '🎉 Your access request has been approved! You can now use the bot.\n\nSend /start to get started.');
            } catch (e) {
                // User may have blocked the bot
            }

            // Refresh the requests view
            showAccessRequests(chatId, messageId);
        }
        else if (data.startsWith('admin_revoke_')) {
            const targetUserId = data.replace('admin_revoke_', '');
            removeAllowedUser(targetUserId);

            bot.answerCallbackQuery(query.id, { text: `✅ User ${targetUserId} access revoked` });

            // Refresh the users view
            showAllowedUsers(chatId, messageId);
        }
    });

    // Register bot menu commands
    bot.setMyCommands([
        { command: 'start', description: 'Start the bot / Request access' },
        { command: 'check', description: 'Check for new articles now' },
        { command: 'latest', description: 'Show the 5 latest articles' },
        { command: 'reminder', description: 'Set your notification interval' },
        { command: 'status', description: 'Bot status info' },
        { command: 'help', description: 'Show help message' }
    ]).then(() => {
        console.log('Bot menu commands registered.');
    }).catch(err => {
        console.error('Failed to set bot commands:', err.message);
    });

    console.log('Telegram bot initialized and listening for commands...');
    return bot;
}

/**
 * Escapes special markdown characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeMarkdown(text) {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Sends notification about new articles to the configured chat
 * @param {string} chatId - Telegram chat ID
 * @param {Array} articles - Array of new article objects
 */
async function sendNewArticlesNotification(chatId, articles) {
    let message = `🔔 *${articles.length} New Article${articles.length > 1 ? 's' : ''} on PAI Website!*\n\n`;

    articles.forEach((article, index) => {
        message += `${index + 1}. [${escapeMarkdown(article.title)}](${article.url})\n\n`;
    });

    message += `_Check it out on aktuaris.or.id_`;

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    });
}

/**
 * Sends notification to the configured chat ID from environment
 * @param {Array} articles - Array of new article objects
 */
async function notifyConfiguredChat(articles) {
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!chatId) {
        console.warn('TELEGRAM_CHAT_ID not set. Skipping notification.');
        return;
    }

    await sendNewArticlesNotification(chatId, articles);
}

/**
 * Gets the bot instance
 * @returns {TelegramBot} The bot instance
 */
function getBot() {
    return bot;
}

module.exports = {
    initBot,
    getBot,
    notifyConfiguredChat,
    sendNewArticlesNotification
};
