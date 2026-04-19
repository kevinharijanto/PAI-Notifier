const axios = require('axios');
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const IG_APP_ID = '936619743392459';
const COOKIE_CACHE_FILE = path.join(__dirname, '../data/instagram_cookies.json');
const COOKIE_CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
const MIN_REQUEST_INTERVAL = 60 * 1000; // 1 minute between requests
const INSTAGRAM_FETCH_MODE = (process.env.INSTAGRAM_FETCH_MODE || 'auto').toLowerCase();

// Cookie cache state
let cachedCookies = null;
let cookieExpiry = null;
let lastRequestTime = 0;
let instaloaderAvailable = null;

/**
 * Gets cookies with caching support
 * @returns {Promise<Object>} Cookie object
 */
async function getCookies() {
    const now = Date.now();

    // Check if cached cookies are still valid
    if (cachedCookies && cookieExpiry && now < cookieExpiry) {
        const remainingSeconds = Math.round((cookieExpiry - now) / 1000);
        const remainingMinutes = Math.round(remainingSeconds / 60);
        console.log(`[Instagram] Using cached cookies (expires in ${remainingMinutes}m ${remainingSeconds % 60}s)`);
        return cachedCookies;
    }

    // Try to load from disk cache
    try {
        if (fs.existsSync(COOKIE_CACHE_FILE)) {
            const cacheData = JSON.parse(fs.readFileSync(COOKIE_CACHE_FILE, 'utf8'));
            if (cacheData.expiry && now < cacheData.expiry) {
                console.log('[Instagram] Loaded cookies from disk cache');
                cachedCookies = cacheData.cookies;
                cookieExpiry = cacheData.expiry;
                return cachedCookies;
            }
        }
    } catch (error) {
        console.warn('[Instagram] Failed to load cookies from cache:', error.message);
    }

    // Fetch fresh cookies
    console.log('[Instagram] Fetching fresh cookies...');
    const freshCookies = await refreshCookies();

    // Cache them with expiry
    cachedCookies = freshCookies;
    cookieExpiry = now + COOKIE_CACHE_DURATION;

    // Persist to disk
    try {
        const cacheDir = path.dirname(COOKIE_CACHE_FILE);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        fs.writeFileSync(COOKIE_CACHE_FILE, JSON.stringify({
            cookies: freshCookies,
            expiry: cookieExpiry
        }));
        console.log('[Instagram] Cookies cached for 2 hours');
    } catch (error) {
        console.warn('[Instagram] Failed to save cookies to cache:', error.message);
    }

    return freshCookies;
}

function clearCookieCache() {
    cachedCookies = null;
    cookieExpiry = null;

    try {
        if (fs.existsSync(COOKIE_CACHE_FILE)) {
            fs.unlinkSync(COOKIE_CACHE_FILE);
        }
    } catch (error) {
        console.warn('[Instagram] Failed to clear cookie cache:', error.message);
    }
}

/**
 * Fetches fresh anonymous cookies from instagram.com (fallback)
 * @returns {Promise<Object>} Cookie object with csrftoken, mid, datr, etc.
 */
async function refreshCookies() {
    console.log('[Instagram] Refreshing cookies...');

    // First request to get initial cookies
    const resp = await axios.get('https://www.instagram.com/', {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-GB,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0',
        },
        maxRedirects: 5,
        validateStatus: () => true,
    });

    const cookies = {};
    const setCookieHeaders = resp.headers['set-cookie'] || [];

    for (const header of setCookieHeaders) {
        const match = header.match(/^([^=]+)=([^;]*)/);
        if (match) {
            cookies[match[1].trim()] = match[2].trim();
        }
    }

    // Extract csrf_token from HTML if not in cookies
    if (!cookies.csrftoken) {
        const csrfMatch = resp.data && typeof resp.data === 'string'
            ? resp.data.match(/"csrf_token":"([^"]+)"/)
            : null;
        if (csrfMatch) {
            cookies.csrftoken = csrfMatch[1];
        }
    }

    // Extract additional cookies from HTML if needed
    if (resp.data && typeof resp.data === 'string') {
        // Try to find ig_did in the HTML
        const igDidMatch = resp.data.match(/"ig_did":"([^"]+)"/);
        if (igDidMatch && !cookies.ig_did) {
            cookies.ig_did = igDidMatch[1];
        }

        // Try to find mid in the HTML
        const midMatch = resp.data.match(/"mid":"([^"]+)"/);
        if (midMatch && !cookies.mid) {
            cookies.mid = midMatch[1];
        }
    }

    // Make a second request to a public profile to get more cookies
    try {
        const cookieString = Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');

        await axios.get('https://www.instagram.com/instagram/?hl=en', {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-GB,en;q=0.9',
                'Referer': 'https://www.instagram.com/',
                'Cookie': cookieString,
            },
            maxRedirects: 5,
            validateStatus: () => true,
        });
    } catch (error) {
        // Ignore errors on second request
        console.warn('[Instagram] Second cookie request failed:', error.message);
    }

    console.log(`[Instagram] Got cookies: ${Object.keys(cookies).join(', ')}`);
    return cookies;
}

/**
 * Helper: sleep for ms
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidInstagramUsername(username) {
    return typeof username === 'string' && /^[a-z0-9._]{1,30}$/i.test(username);
}

function shouldFallbackToInstaloader(error) {
    const message = String(error?.message || '');
    return /429|HTTP \d+|Instagram API returned HTTP|ECONNRESET|ETIMEDOUT|timeout|socket hang up/i.test(message);
}

function isInstaloaderAvailable() {
    if (instaloaderAvailable !== null) {
        return instaloaderAvailable;
    }

    try {
        const result = spawnSync('instaloader', ['--version'], {
            timeout: 10000,
            stdio: 'ignore',
        });
        instaloaderAvailable = result.status === 0;
    } catch (error) {
        instaloaderAvailable = false;
    }

    return instaloaderAvailable;
}

function walkJsonFiles(dirPath) {
    const jsonFiles = [];

    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            jsonFiles.push(...walkJsonFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            jsonFiles.push(fullPath);
        }
    }

    return jsonFiles;
}

function getTimestampFromMetadata(metadata) {
    if (typeof metadata?.taken_at_timestamp === 'number') {
        return metadata.taken_at_timestamp;
    }

    if (typeof metadata?.node?.taken_at_timestamp === 'number') {
        return metadata.node.taken_at_timestamp;
    }

    if (metadata?.date_utc) {
        const parsed = Date.parse(metadata.date_utc);
        if (!Number.isNaN(parsed)) {
            return Math.floor(parsed / 1000);
        }
    }

    return Math.floor(Date.now() / 1000);
}

function extractPostFromMetadata(metadata) {
    const candidate = metadata?.node || metadata;
    const shortcode = candidate?.shortcode;

    if (!shortcode) {
        return null;
    }

    return {
        shortcode,
        id: String(candidate.mediaid || candidate.id || shortcode),
        timestamp: getTimestampFromMetadata(metadata),
    };
}

async function fetchShortcodesWithInstaloader(username) {
    if (!isValidInstagramUsername(username)) {
        throw new Error(`Invalid Instagram username: ${username}`);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-profile-'));

    try {
        console.log(`[Instagram] Fetching posts for @${username} via instaloader...`);

        const args = [
            username,
            `--dirname-pattern=${tmpDir}`,
            '--filename-pattern={shortcode}',
            '--no-pictures',
            '--no-videos',
            '--no-video-thumbnails',
            '--no-profile-pic',
            '--no-captions',
            '--no-compress-json',
            '--fast-update',
            '--count=12',
        ];

        const result = spawnSync('instaloader', args, {
            encoding: 'utf8',
            timeout: 120000,
        });

        if (result.status !== 0) {
            const stderr = (result.stderr || '').trim();
            throw new Error(stderr || `instaloader exited with code ${result.status}`);
        }

        const posts = walkJsonFiles(tmpDir)
            .map(filePath => {
                try {
                    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
                } catch (error) {
                    return null;
                }
            })
            .map(extractPostFromMetadata)
            .filter(Boolean)
            .sort((a, b) => b.timestamp - a.timestamp);

        const uniquePosts = [];
        const seenShortcodes = new Set();

        for (const post of posts) {
            if (!seenShortcodes.has(post.shortcode)) {
                seenShortcodes.add(post.shortcode);
                uniquePosts.push(post);
            }
        }

        console.log(`[Instagram] @${username} has ${uniquePosts.length} posts fetched via instaloader`);
        return uniquePosts;
    } finally {
        cleanupTmpDir(tmpDir);
    }
}

/**
 * Fetches recent post shortcodes from a public Instagram profile
 * Includes retry logic with exponential backoff for rate limiting (429)
 * @param {string} username - Instagram username
 * @param {number} maxRetries - Maximum number of retries (default: 5)
 * @returns {Promise<Array<{shortcode: string, id: string, timestamp: number}>>}
 */
async function fetchShortcodesFromWeb(username, maxRetries = 5) {
    const retryDelays = [30000, 60000, 120000, 300000, 600000]; // 30s, 1m, 2m, 5m, 10m

    if (!isValidInstagramUsername(username)) {
        throw new Error(`Invalid Instagram username: ${username}`);
    }

    // Enforce minimum interval between requests to avoid rate limiting
    const timeSinceLastRequest = Date.now() - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        console.log(`[Instagram] Throttling: waiting ${waitTime / 1000}s before request`);
        await sleep(waitTime);
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Always use fresh cookies from cache or refresh
            const cookies = await getCookies();

            const cookieString = Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join('; ');

            // Random delay between cookie refresh and API call to look more human (2-5 seconds)
            const randomDelay = 2000 + Math.random() * 3000;
            console.log(`[Instagram] Waiting ${Math.round(randomDelay / 1000)}s before request...`);
            await sleep(randomDelay);

            const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}&hl=en`;

            console.log(`[Instagram] Fetching posts for @${username}... (attempt ${attempt + 1}/${maxRetries + 1})`);

            const resp = await axios.get(url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': '*/*',
                    'Accept-Language': 'en-GB,en;q=0.9',
                    'Referer': `https://www.instagram.com/${username}/?hl=en`,
                    'X-IG-App-ID': IG_APP_ID,
                    'X-IG-WWW-Claim': '0',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': cookies.csrftoken || '',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-origin',
                    'Cookie': cookieString,
                },
                validateStatus: () => true,
            });

            // Update last request time on successful request
            lastRequestTime = Date.now();

            if (resp.status === 429) {
                clearCookieCache();
                if (attempt < maxRetries) {
                    const delay = retryDelays[attempt] || 300000;
                    console.warn(`[Instagram] Rate limited (429). Retrying in ${delay / 1000}s...`);
                    await sleep(delay);
                    continue;
                }
                throw new Error(`Instagram rate limited (429) after ${maxRetries + 1} attempts. Try again later.`);
            }

            if (resp.status !== 200) {
                if (resp.status === 401 || resp.status === 403) {
                    clearCookieCache();
                }
                console.error(`[Instagram] HTTP ${resp.status} for @${username}`);
                throw new Error(`Instagram API returned HTTP ${resp.status}`);
            }

            const data = resp.data;
            const user = data?.data?.user;

            if (!user) {
                throw new Error(`Could not find user @${username}. Profile may be private or doesn't exist.`);
            }

            const edges = user.edge_owner_to_timeline_media?.edges || [];
            const totalPosts = user.edge_owner_to_timeline_media?.count || 0;

            console.log(`[Instagram] @${username} has ${totalPosts} total posts, got ${edges.length} latest`);

            return edges.map(edge => ({
                shortcode: edge.node.shortcode,
                id: edge.node.id,
                timestamp: edge.node.taken_at_timestamp,
            }));

        } catch (error) {
            // If it's a retry-able error and we have retries left, the loop handles it
            // Otherwise rethrow
            if (attempt >= maxRetries || !error.message.includes('429')) {
                throw error;
            }
        }
    }
}

async function fetchShortcodes(username, maxRetries = 5) {
    if (INSTAGRAM_FETCH_MODE === 'instaloader') {
        if (!isInstaloaderAvailable()) {
            throw new Error('INSTAGRAM_FETCH_MODE=instaloader but instaloader is not installed');
        }
        return fetchShortcodesWithInstaloader(username);
    }

    try {
        return await fetchShortcodesFromWeb(username, maxRetries);
    } catch (error) {
        if (INSTAGRAM_FETCH_MODE === 'web' || !shouldFallbackToInstaloader(error) || !isInstaloaderAvailable()) {
            throw error;
        }

        console.warn(`[Instagram] Web fetch failed for @${username}: ${error.message}`);
        console.warn('[Instagram] Falling back to instaloader...');
        return fetchShortcodesWithInstaloader(username);
    }
}

/**
 * Downloads a post's image and caption using instaloader
 * @param {string} shortcode - Instagram post shortcode
 * @returns {Promise<{shortcode: string, caption: string, imagePath: string, permalink: string}>}
 */
async function downloadPost(shortcode) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-'));
    const permalink = `https://www.instagram.com/p/${shortcode}/`;

    try {
        console.log(`[Instagram] Downloading post ${shortcode} via instaloader...`);

        // instaloader -- -<shortcode> downloads a single post by shortcode
        // --dirname-pattern puts files in our temp dir
        // --no-videos skips video content
        // --no-video-thumbnails skips video thumbnails
        // --no-profile-pic skips profile picture
        execSync(
            `instaloader -- -${shortcode} --dirname-pattern="${tmpDir}" --no-videos --no-video-thumbnails --no-profile-pic --no-compress-json`,
            {
                timeout: 60000,
                stdio: ['pipe', 'pipe', 'pipe'],
            }
        );

        // Find the downloaded image file (jpg/png)
        const files = fs.readdirSync(tmpDir);
        const imageFile = files.find(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
        const jsonFile = files.find(f => f.endsWith('.json'));

        if (!imageFile) {
            throw new Error(`No image found for post ${shortcode}`);
        }

        const imagePath = path.join(tmpDir, imageFile);

        // Read caption from JSON metadata if available
        let caption = '';
        if (jsonFile) {
            try {
                const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, jsonFile), 'utf8'));
                caption = meta.edge_media_to_caption?.edges?.[0]?.node?.text
                    || meta.caption?.text
                    || '';
            } catch (e) {
                console.warn('[Instagram] Could not parse metadata JSON:', e.message);
            }
        }

        // If no JSON or caption not found in JSON, try the txt file
        if (!caption) {
            const txtFile = files.find(f => f.endsWith('.txt'));
            if (txtFile) {
                caption = fs.readFileSync(path.join(tmpDir, txtFile), 'utf8').trim();
            }
        }

        return {
            shortcode,
            caption,
            imagePath,
            permalink,
            tmpDir, // caller must clean up
        };
    } catch (error) {
        // Clean up on error
        cleanupTmpDir(tmpDir);
        throw error;
    }
}

/**
 * Cleans up a temporary directory
 * @param {string} dirPath - Path to temp directory
 */
function cleanupTmpDir(dirPath) {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
    } catch (e) {
        console.warn('[Instagram] Failed to cleanup temp dir:', e.message);
    }
}

async function fetchPostsFromDolphinRadar(username) {
    const url = `https://www.dolphinradar.com/api/ins/story/story/search?media_name=${username}&type=post`;
    try {
        console.log(`[Instagram] Fetching posts for @${username} via DolphinRadar...`);
        const resp = await axios.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            },
            timeout: 10000
        });

        if (resp.status !== 200) {
            throw new Error(`DolphinRadar API returned HTTP ${resp.status}`);
        }

        const data = resp.data;
        if (data.code !== 0) {
            throw new Error(`DolphinRadar API returned error code ${data.code}`);
        }

        const posts = data.data?.post_list || [];
        
        return posts.map(post => {
            // Calculate timestamp from publish_time (adjusting for potential timezone issues, though it should be ordering-safe)
            const timestamp = post.publish_time ? new Date(post.publish_time).getTime() / 1000 : Math.floor(Date.now() / 1000);
            
            // Collect media
            let mediaUrls = [];
            if (post.media_list && post.media_list.length > 0) {
                 mediaUrls = post.media_list.map(m => m.media_url).filter(Boolean);
            } else if (post.cover_image) {
                 mediaUrls = [post.cover_image];
            }

            return {
                shortcode: post.code,
                id: post.code,
                timestamp: timestamp || Math.floor(Date.now() / 1000),
                caption: post.caption || '',
                permalink: `https://www.instagram.com/p/${post.code}/`,
                mediaUrls: mediaUrls,
                isDolphinRadar: true
            };
        });
    } catch (error) {
        console.warn(`[Instagram] DolphinRadar fetch failed for @${username}: ${error.message}`);
        throw error;
    }
}

async function fetchPosts(username, maxRetries = 5) {
    try {
        const drPosts = await fetchPostsFromDolphinRadar(username);
        // If it successfully returns a populated list, return it
        if (drPosts && drPosts.length > 0) {
            console.log(`[Instagram] Got ${drPosts.length} posts from DolphinRadar for @${username}`);
            return drPosts;
        } else {
            console.log(`[Instagram] DolphinRadar returned empty for @${username}, falling back to web fetch...`);
        }
    } catch (err) {
        console.warn(`[Instagram] DolphinRadar failed, falling back to legacy...`);
    }

    // fallback to legacy fetchShortcodes
    const shortcodes = await fetchShortcodes(username, maxRetries);
    return shortcodes.map(s => ({
        ...s,
        isLegacy: true
    }));
}

module.exports = {
    getCookies,
    refreshCookies,
    fetchShortcodes,
    fetchPostsFromDolphinRadar,
    fetchPosts,
    downloadPost,
    cleanupTmpDir,
};
