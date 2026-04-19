const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');

const SESSION_FILE = path.join(__dirname, '../data/ig_session.json');

let browser = null;

async function getBrowser() {
    if (browser) return browser;
    console.log('[Puppeteer] Launching browser...');
    const options = {
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-notifications',
            '--lang=en-US,en'
        ],
        defaultViewport: { width: 1280, height: 800 }
    };

    // If running in Alpine via Docker, use the pre-installed chromium
    if (process.env.NODE_ENV === 'production') {
        options.executablePath = '/usr/bin/chromium-browser';
    }

    browser = await puppeteer.launch(options);
    return browser;
}

async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
    }
}

async function setupPage() {
    const b = await getBrowser();
    const page = await b.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Load session if exists
    if (fs.existsSync(SESSION_FILE)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
            if (cookies && cookies.length > 0) {
                await page.setCookie(...cookies);
            }
        } catch (e) {
            console.warn('[Puppeteer] Failed to load cookies:', e.message);
        }
    }
    return page;
}

async function saveSession(page) {
    const cookies = await page.cookies();
    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
    console.log('[Puppeteer] Session saved.');
}

async function ensureLogin(page) {
    const username = process.env.IG_DUMMY_USERNAME;
    const password = process.env.IG_DUMMY_PASSWORD;

    if (!username || !password) {
        console.warn('[Puppeteer] Missing IG_DUMMY_USERNAME or IG_DUMMY_PASSWORD. Scraper may be rate limited.');
        return false;
    }

    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
    
    // Check if logged in by looking for login form or common logged-in elements
    const loginForm = await page.$('input[name="username"]');
    if (!loginForm) {
        console.log('[Puppeteer] Already logged in (reused session).');
        return true;
    }

    console.log('[Puppeteer] Not logged in. Attempting to log in as', username);
    await page.waitForSelector('input[name="username"]');
    await page.type('input[name="username"]', username, { delay: 50 });
    await page.type('input[name="password"]', password, { delay: 50 });
    
    // Wait a moment and click login
    await new Promise(r => setTimeout(r, 1000));
    await page.click('button[type="submit"]');

    // Wait for the login to complete
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        await saveSession(page);
        console.log('[Puppeteer] Logged in successfully.');
        return true;
    } catch (e) {
        console.warn('[Puppeteer] Login navigate timeout or failed. Could be 2FA or suspicious attempt prompt.', e.message);
        // Let's take a screenshot for debugging locally if needed
        await page.screenshot({ path: path.join(__dirname, '../data/login_error.png') });
        return false;
    }
}

async function fetchPosts(username) {
    const page = await setupPage();
    let posts = [];
    try {
        await ensureLogin(page);

        console.log(`[Puppeteer] Fetching @${username}...`);
        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle2' });

        // Grab posts from the page state using an injected evaluate
        // Or if simple approach: we extract graph data from window
        posts = await page.evaluate(async (usr) => {
            try {
                // Try to use GraphQL fetch injected using app's headers
                const req = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${usr}&hl=en`, {
                    headers: {
                        'X-IG-App-ID': '936619743392459',
                        'X-Requested-With': 'XMLHttpRequest',
                    }
                });
                const data = await req.json();
                const edges = data?.data?.user?.edge_owner_to_timeline_media?.edges || [];
                return edges.map(e => {
                    const node = e.node;
                    return {
                        shortcode: node.shortcode,
                        id: node.id,
                        timestamp: node.taken_at_timestamp,
                        thumbnail: node.display_url,
                        caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || ''
                    };
                });
            } catch(e) {
                // Fallback to DOM extraction if fetch fails
                const links = Array.from(document.querySelectorAll('a[href^="/p/"]'));
                return links.map(a => {
                    const pic = a.querySelector('img');
                    return {
                        shortcode: a.getAttribute('href').replace('/p/', '').replace('/', ''),
                        id: a.getAttribute('href'), // fallback ID
                        timestamp: Math.floor(Date.now() / 1000), // fallback timestamp
                        thumbnail: pic ? pic.src : '',
                        caption: pic ? pic.alt : ''
                    };
                }).filter(p => !!p.shortcode);
            }
        }, username);

    } catch (e) {
        console.error('[Puppeteer] Error fetching posts:', e.message);
    } finally {
        await page.close();
    }

    // Sort by timestamp desc and de-duplicate
    const unique = [];
    const seen = new Set();
    for (const p of posts) {
        if (!seen.has(p.shortcode)) {
            seen.add(p.shortcode);
            unique.push(p);
        }
    }
    return unique.sort((a,b) => b.timestamp - a.timestamp);
}

/**
 * Download a post using Puppeteer. We fetch the post page and grab the media + caption.
 */
async function downloadPost(shortcode) {
    const page = await setupPage();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-pup-'));
    
    try {
        console.log(`[Puppeteer] Downloading post ${shortcode}...`);
        await ensureLogin(page);
        
        await page.goto(`https://www.instagram.com/p/${shortcode}/`, { waitUntil: 'load', timeout: 30000 });
        
        // Extract high-res image and caption
        const postData = await page.evaluate(() => {
            // Priority: Try to grab main image from presentation/article
            let imgUrl = '';
            const images = document.querySelectorAll('img[style*="object-fit: cover"]');
            if (images.length > 0) {
                // For carousel, find the currently visible one or just the first
                imgUrl = images[images.length > 1 ? 1 : 0].src || images[0].src;
            } else {
                // Fallback: og:image
                const og = document.querySelector('meta[property="og:image"]');
                if (og) imgUrl = og.content;
            }

            // Caption: find h1
            let caption = '';
            const h1s = document.querySelectorAll('h1');
            if (h1s.length > 0) {
                for (const h1 of Array.from(h1s)) {
                    if (h1.textContent && h1.textContent.trim().length > 0) {
                        caption = h1.textContent.trim();
                        break;
                    }
                }
            } else {
                const title = document.querySelector('title');
                if (title) caption = title.textContent;
            }

            return { imgUrl, caption };
        });

        if (!postData.imgUrl) {
            throw new Error(`Could not find image url for post ${shortcode}`);
        }

        const ext = 'jpg';
        const imagePath = path.join(tmpDir, `${shortcode}.${ext}`);
        
        console.log(`[Puppeteer] Downloading image from ${postData.imgUrl}`);
        const response = await axios({
            url: postData.imgUrl,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(imagePath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        return {
            shortcode,
            caption: postData.caption,
            imagePath,
            permalink: `https://www.instagram.com/p/${shortcode}/`,
            tmpDir
        };
    } catch (error) {
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        throw error;
    } finally {
        await page.close();
    }
}

function cleanupTmpDir(dirPath) {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
    } catch (e) {
        console.warn('[Puppeteer] Failed to cleanup temp dir:', e.message);
    }
}

module.exports = {
    fetchPosts,
    downloadPost,
    cleanupTmpDir,
    closeBrowser
};
