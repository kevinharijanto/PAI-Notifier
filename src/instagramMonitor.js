const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const IG_APP_ID = '936619743392459';

/**
 * Fetches fresh anonymous cookies from instagram.com
 * @returns {Promise<Object>} Cookie object with csrftoken, mid, datr, etc.
 */
async function refreshCookies() {
    console.log('[Instagram] Refreshing cookies...');

    const resp = await axios.get('https://www.instagram.com/', {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-GB,en;q=0.9',
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

    if (!cookies.csrftoken) {
        // Try to extract csrftoken from HTML as fallback
        const csrfMatch = resp.data && typeof resp.data === 'string'
            ? resp.data.match(/"csrf_token":"([^"]+)"/)
            : null;
        if (csrfMatch) {
            cookies.csrftoken = csrfMatch[1];
        }
    }

    console.log(`[Instagram] Got cookies: ${Object.keys(cookies).join(', ')}`);
    return cookies;
}

/**
 * Fetches recent post shortcodes from a public Instagram profile
 * @param {string} username - Instagram username
 * @returns {Promise<Array<{shortcode: string, id: string, timestamp: number}>>}
 */
async function fetchShortcodes(username) {
    const cookies = await refreshCookies();

    const cookieString = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}&hl=en`;

    console.log(`[Instagram] Fetching posts for @${username}...`);

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

    if (resp.status !== 200) {
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

module.exports = {
    refreshCookies,
    fetchShortcodes,
    downloadPost,
    cleanupTmpDir,
};
