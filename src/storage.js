const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEEN_ARTICLES_FILE = path.join(DATA_DIR, 'seen_articles.json');
const ALLOWED_USERS_FILE = path.join(DATA_DIR, 'allowed_users.json');
const ACCESS_REQUESTS_FILE = path.join(DATA_DIR, 'access_requests.json');
const USER_PREFS_FILE = path.join(DATA_DIR, 'user_preferences.json');
const EXAM_RESULTS_FILE = path.join(DATA_DIR, 'exam_results.json');
const INSTAGRAM_SEEN_FILE = path.join(DATA_DIR, 'instagram_seen.json');
const INSTAGRAM_STATE_FILE = path.join(DATA_DIR, 'instagram_state.json');

/**
 * Ensures the data directory exists
 */
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * Loads previously seen article IDs from storage
 * @returns {Set<string>} Set of seen article IDs
 */
function loadSeenArticles() {
    ensureDataDir();

    if (!fs.existsSync(SEEN_ARTICLES_FILE)) {
        return new Set();
    }

    try {
        const data = fs.readFileSync(SEEN_ARTICLES_FILE, 'utf8');
        const parsed = JSON.parse(data);
        return new Set(parsed.articleIds || []);
    } catch (error) {
        console.error('Error loading seen articles:', error.message);
        return new Set();
    }
}

/**
 * Saves article IDs to storage
 * @param {Set<string>} articleIds - Set of article IDs to save
 */
function saveSeenArticles(articleIds) {
    ensureDataDir();

    const data = {
        articleIds: Array.from(articleIds),
        lastUpdated: new Date().toISOString()
    };

    try {
        fs.writeFileSync(SEEN_ARTICLES_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving seen articles:', error.message);
    }
}

/**
 * Finds new articles by comparing current articles with seen ones
 * @param {Array} currentArticles - Array of current article objects
 * @param {Set<string>} seenIds - Set of previously seen article IDs
 * @returns {Array} Array of new article objects
 */
function getNewArticles(currentArticles, seenIds) {
    return currentArticles.filter(article => !seenIds.has(article.id));
}

/**
 * Adds articles to the seen set and persists to storage
 * @param {Array} articles - Array of article objects to mark as seen
 * @param {Set<string>} seenIds - Set of seen article IDs
 */
function markArticlesAsSeen(articles, seenIds) {
    articles.forEach(article => seenIds.add(article.id));
    saveSeenArticles(seenIds);
}

// ==================== ALLOWED USERS ====================

/**
 * Loads allowed user IDs from storage
 * @returns {Set<string>} Set of allowed user IDs
 */
function loadAllowedUsers() {
    ensureDataDir();

    if (!fs.existsSync(ALLOWED_USERS_FILE)) {
        return new Set();
    }

    try {
        const data = fs.readFileSync(ALLOWED_USERS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        return new Set(parsed.userIds || []);
    } catch (error) {
        console.error('Error loading allowed users:', error.message);
        return new Set();
    }
}

/**
 * Saves allowed user IDs to storage
 * @param {Set<string>} userIds - Set of allowed user IDs
 */
function saveAllowedUsers(userIds) {
    ensureDataDir();

    const data = {
        userIds: Array.from(userIds),
        lastUpdated: new Date().toISOString()
    };

    try {
        fs.writeFileSync(ALLOWED_USERS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving allowed users:', error.message);
    }
}

/**
 * Checks if a user is allowed to use the bot
 * @param {string} userId - Telegram user ID
 * @returns {boolean} True if user is allowed
 */
function isUserAllowed(userId) {
    const allowedUsers = loadAllowedUsers();
    return allowedUsers.has(String(userId));
}

/**
 * Adds a user to the allowed list
 * @param {string} userId - Telegram user ID
 */
function addAllowedUser(userId) {
    const allowedUsers = loadAllowedUsers();
    allowedUsers.add(String(userId));
    saveAllowedUsers(allowedUsers);
}

/**
 * Removes a user from the allowed list
 * @param {string} userId - Telegram user ID
 */
function removeAllowedUser(userId) {
    const allowedUsers = loadAllowedUsers();
    allowedUsers.delete(String(userId));
    saveAllowedUsers(allowedUsers);
}

// ==================== ACCESS REQUESTS ====================

/**
 * Loads access requests from storage
 * @returns {Array} Array of access request objects
 */
function loadAccessRequests() {
    ensureDataDir();

    if (!fs.existsSync(ACCESS_REQUESTS_FILE)) {
        return [];
    }

    try {
        const data = fs.readFileSync(ACCESS_REQUESTS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        return parsed.requests || [];
    } catch (error) {
        console.error('Error loading access requests:', error.message);
        return [];
    }
}

/**
 * Saves access requests to storage
 * @param {Array} requests - Array of access request objects
 */
function saveAccessRequests(requests) {
    ensureDataDir();

    const data = {
        requests: requests,
        lastUpdated: new Date().toISOString()
    };

    try {
        fs.writeFileSync(ACCESS_REQUESTS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving access requests:', error.message);
    }
}

/**
 * Adds an access request (or updates existing)
 * @param {string} userId - Telegram user ID
 * @param {string} username - Telegram username
 * @param {string} name - User's display name
 */
function addAccessRequest(userId, username, name) {
    const requests = loadAccessRequests();
    const existingIndex = requests.findIndex(r => r.userId === String(userId));

    const request = {
        userId: String(userId),
        username: username || null,
        name: name || 'Unknown',
        requestedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
        // Update existing request
        requests[existingIndex] = request;
    } else {
        // Add new request
        requests.push(request);
    }

    saveAccessRequests(requests);
}

/**
 * Removes an access request
 * @param {string} userId - Telegram user ID
 */
function removeAccessRequest(userId) {
    const requests = loadAccessRequests();
    const filtered = requests.filter(r => r.userId !== String(userId));
    saveAccessRequests(filtered);
}

/**
 * Gets all access requests
 * @returns {Array} Array of access request objects
 */
function getAccessRequests() {
    return loadAccessRequests();
}

// ==================== USER PREFERENCES ====================

/**
 * Loads all user preferences from storage
 * @returns {Object} Object mapping userId to preferences
 */
function loadUserPreferences() {
    ensureDataDir();

    if (!fs.existsSync(USER_PREFS_FILE)) {
        return {};
    }

    try {
        const data = fs.readFileSync(USER_PREFS_FILE, 'utf8');
        return JSON.parse(data) || {};
    } catch (error) {
        console.error('Error loading user preferences:', error.message);
        return {};
    }
}

/**
 * Saves all user preferences to storage
 * @param {Object} prefs - Object mapping userId to preferences
 */
function saveUserPreferences(prefs) {
    ensureDataDir();

    try {
        fs.writeFileSync(USER_PREFS_FILE, JSON.stringify(prefs, null, 2));
    } catch (error) {
        console.error('Error saving user preferences:', error.message);
    }
}

/**
 * Gets a user's preference value
 * @param {string} userId - User ID
 * @param {string} key - Preference key
 * @param {any} defaultValue - Default value if not set
 * @returns {any} The preference value
 */
function getUserPreference(userId, key, defaultValue = null) {
    const prefs = loadUserPreferences();
    const userPrefs = prefs[String(userId)] || {};
    return userPrefs[key] !== undefined ? userPrefs[key] : defaultValue;
}

/**
 * Sets a user's preference value
 * @param {string} userId - User ID
 * @param {string} key - Preference key
 * @param {any} value - Value to set
 */
function setUserPreference(userId, key, value) {
    const prefs = loadUserPreferences();
    if (!prefs[String(userId)]) {
        prefs[String(userId)] = {};
    }
    prefs[String(userId)][key] = value;
    prefs[String(userId)].lastUpdated = new Date().toISOString();
    saveUserPreferences(prefs);
}

/**
 * Gets all users who have reminder enabled with their intervals
 * @returns {Array} Array of {userId, intervalMinutes}
 */
function getAllUsersWithReminders() {
    const prefs = loadUserPreferences();
    const users = [];

    for (const [userId, userPrefs] of Object.entries(prefs)) {
        if (userPrefs.reminderEnabled && userPrefs.reminderInterval) {
            users.push({
                userId: userId,
                intervalMinutes: userPrefs.reminderInterval
            });
        }
    }

    return users;
}

// ==================== EXAM RESULTS ====================

/**
 * Loads cached exam results from storage
 * @returns {Object} Object mapping examId to result data
 */
function loadExamResults() {
    ensureDataDir();

    if (!fs.existsSync(EXAM_RESULTS_FILE)) {
        return {};
    }

    try {
        const data = fs.readFileSync(EXAM_RESULTS_FILE, 'utf8');
        return JSON.parse(data) || {};
    } catch (error) {
        console.error('Error loading exam results:', error.message);
        return {};
    }
}

/**
 * Saves exam results to storage
 * @param {Object} results - Object mapping examId to result data
 */
function saveExamResults(results) {
    ensureDataDir();

    try {
        fs.writeFileSync(EXAM_RESULTS_FILE, JSON.stringify(results, null, 2));
    } catch (error) {
        console.error('Error saving exam results:', error.message);
    }
}

/**
 * Gets cached exam result for a specific exam
 * @param {string} examId - The exam code/ID
 * @returns {Object|null} Cached result or null if not cached
 */
function getCachedExamResult(examId) {
    const results = loadExamResults();
    return results[examId] || null;
}

/**
 * Saves an exam result to cache
 * @param {string} examId - The exam code/ID
 * @param {Object} result - The parsed exam result
 */
function cacheExamResult(examId, result) {
    const results = loadExamResults();
    results[examId] = {
        ...result,
        cachedAt: new Date().toISOString()
    };
    saveExamResults(results);
}

// ==================== INSTAGRAM ====================

/**
 * Loads seen Instagram post shortcodes from storage
 * @returns {Object} Object mapping username to array of seen shortcodes
 */
function loadSeenPosts() {
    ensureDataDir();

    if (!fs.existsSync(INSTAGRAM_SEEN_FILE)) {
        return {};
    }

    try {
        const data = fs.readFileSync(INSTAGRAM_SEEN_FILE, 'utf8');
        return JSON.parse(data) || {};
    } catch (error) {
        console.error('Error loading seen posts:', error.message);
        return {};
    }
}

/**
 * Saves seen Instagram post shortcodes to storage
 * @param {Object} seenPosts - Object mapping username to array of shortcodes
 */
function saveSeenPosts(seenPosts) {
    ensureDataDir();

    try {
        fs.writeFileSync(INSTAGRAM_SEEN_FILE, JSON.stringify(seenPosts, null, 2));
    } catch (error) {
        console.error('Error saving seen posts:', error.message);
    }
}

/**
 * Gets seen shortcodes for a username
 * @param {string} username - Instagram username
 * @returns {Set<string>} Set of seen shortcodes
 */
function getSeenPostsForUser(username) {
    const allSeen = loadSeenPosts();
    return new Set(allSeen[username] || []);
}

/**
 * Marks shortcodes as seen for a username
 * @param {string} username - Instagram username
 * @param {Array<string>} shortcodes - Shortcodes to mark as seen
 */
function markPostsAsSeen(username, shortcodes) {
    const allSeen = loadSeenPosts();
    const existing = new Set(allSeen[username] || []);
    shortcodes.forEach(sc => existing.add(sc));
    // Keep only last 200 shortcodes per user to avoid file bloat
    allSeen[username] = Array.from(existing).slice(-200);
    saveSeenPosts(allSeen);
}

/**
 * Gets watched Instagram accounts for a user
 * @param {string} userId - Telegram user ID
 * @returns {Array<string>} Array of Instagram usernames
 */
function getWatchedAccounts(userId) {
    return getUserPreference(userId, 'instaWatchList', []);
}

/**
 * Adds an Instagram account to a user's watchlist
 * @param {string} userId - Telegram user ID
 * @param {string} username - Instagram username
 * @returns {boolean} True if added, false if already watching
 */
function addWatchedAccount(userId, username) {
    const watchList = getWatchedAccounts(userId);
    const normalized = username.toLowerCase().replace(/^@/, '');
    if (watchList.includes(normalized)) return false;
    watchList.push(normalized);
    setUserPreference(userId, 'instaWatchList', watchList);
    return true;
}

/**
 * Removes an Instagram account from a user's watchlist
 * @param {string} userId - Telegram user ID
 * @param {string} username - Instagram username
 * @returns {boolean} True if removed, false if not found
 */
function removeWatchedAccount(userId, username) {
    const watchList = getWatchedAccounts(userId);
    const normalized = username.toLowerCase().replace(/^@/, '');
    const index = watchList.indexOf(normalized);
    if (index === -1) return false;
    watchList.splice(index, 1);
    setUserPreference(userId, 'instaWatchList', watchList);
    return true;
}

/**
 * Gets all unique watched Instagram accounts across all users with their watchers
 * @returns {Array<{username: string, watchers: string[]}>}
 */
function getAllWatchedAccounts() {
    const prefs = loadUserPreferences();
    const accountMap = {};

    for (const [userId, userPrefs] of Object.entries(prefs)) {
        const watchList = userPrefs.instaWatchList || [];
        for (const username of watchList) {
            if (!accountMap[username]) {
                accountMap[username] = [];
            }
            accountMap[username].push(userId);
        }
    }

    return Object.entries(accountMap).map(([username, watchers]) => ({
        username,
        watchers,
    }));
}

/**
 * Loads Instagram account state from storage
 * @returns {Object} Object mapping username to persisted state
 */
function loadInstagramState() {
    ensureDataDir();

    if (!fs.existsSync(INSTAGRAM_STATE_FILE)) {
        return {};
    }

    try {
        const data = fs.readFileSync(INSTAGRAM_STATE_FILE, 'utf8');
        return JSON.parse(data) || {};
    } catch (error) {
        console.error('Error loading Instagram state:', error.message);
        return {};
    }
}

/**
 * Saves Instagram account state to storage
 * @param {Object} state - Object mapping username to persisted state
 */
function saveInstagramState(state) {
    ensureDataDir();

    try {
        fs.writeFileSync(INSTAGRAM_STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving Instagram state:', error.message);
    }
}

/**
 * Gets persisted Instagram state for an account
 * @param {string} username - Instagram username
 * @returns {Object|null} Persisted state or null
 */
function getInstagramState(username) {
    const allState = loadInstagramState();
    return allState[username] || null;
}

/**
 * Updates persisted Instagram state for an account
 * @param {string} username - Instagram username
 * @param {Object} nextState - Partial state to merge
 * @returns {Object} Updated state
 */
function updateInstagramState(username, nextState) {
    const allState = loadInstagramState();
    const currentState = allState[username] || {};
    const updatedState = {
        ...currentState,
        ...nextState,
    };

    allState[username] = updatedState;
    saveInstagramState(allState);

    return updatedState;
}

module.exports = {
    loadSeenArticles,
    saveSeenArticles,
    getNewArticles,
    markArticlesAsSeen,
    // User management
    loadAllowedUsers,
    saveAllowedUsers,
    isUserAllowed,
    addAllowedUser,
    removeAllowedUser,
    // Access requests
    loadAccessRequests,
    saveAccessRequests,
    addAccessRequest,
    removeAccessRequest,
    getAccessRequests,
    // User preferences
    loadUserPreferences,
    saveUserPreferences,
    getUserPreference,
    setUserPreference,
    getAllUsersWithReminders,
    // Exam results
    loadExamResults,
    saveExamResults,
    getCachedExamResult,
    cacheExamResult,
    // Instagram
    loadSeenPosts,
    saveSeenPosts,
    getSeenPostsForUser,
    markPostsAsSeen,
    getWatchedAccounts,
    addWatchedAccount,
    removeWatchedAccount,
    getAllWatchedAccounts,
    getInstagramState,
    updateInstagramState,
};
