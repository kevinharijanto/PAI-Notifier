# VPS Instagram Rate Limiting Solutions

## Problem Analysis

**Why it works on your PC but not VPS:**
- ✅ **Local PC (Residential IP)**: Instagram allows more requests from residential IPs
- ❌ **VPS (Datacenter IP)**: Instagram has stricter rate limits for datacenter IPs
- Instagram's rate limiting is **IP-based**, not just cookie-based

## Solutions (Ranked by Effectiveness)

### Solution 1: Use a Residential Proxy (Recommended)

**Best for:** Production deployment with reliable access

**How it works:**
- Route Instagram requests through a residential proxy
- Instagram sees requests coming from a residential IP
- Much higher rate limits than datacenter IPs

**Implementation:**

1. **Get a Residential Proxy**
   - Services: Bright Data, Smartproxy, Oxylabs, IPRoyal
   - Cost: ~$50-100/month for residential proxies
   - Look for "rotating residential proxies"

2. **Update [`src/instagramMonitor.js`](../src/instagramMonitor.js)**

Add proxy configuration:
```javascript
// Add at the top of the file
const PROXY_URL = process.env.IG_PROXY_URL || null;

// Update axios calls to use proxy
const axiosConfig = {
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
};

// Add proxy if configured
if (PROXY_URL) {
    axiosConfig.proxy = {
        host: PROXY_URL.split('://')[1].split(':')[0],
        port: parseInt(PROXY_URL.split(':')[2]),
        protocol: PROXY_URL.split('://')[0]
    };
}

const resp = await axios.get(url, axiosConfig);
```

3. **Add to `.env` file:**
```
IG_PROXY_URL=http://username:password@proxy-host:port
```

**Pros:**
- ✅ Most reliable solution
- ✅ High rate limits
- ✅ Works consistently

**Cons:**
- ❌ Additional cost ($50-100/month)
- ❌ Requires proxy service setup

---

### Solution 2: Use Instagram Basic Display API (Free)

**Best for:** Long-term, free solution

**How it works:**
- Use Instagram's official API instead of scraping
- Requires app registration and user authentication
- Free but has rate limits (200 requests/hour)

**Implementation:**

1. **Register Instagram App**
   - Go to: https://developers.facebook.com/
   - Create a new app
   - Add "Instagram Basic Display" product
   - Get access token

2. **Install Instagram API client**
```bash
npm install instagram-basic-display
```

3. **Create new file [`src/instagramApi.js`](../src/instagramApi.js)**
```javascript
const Instagram = require('instagram-basic-display');

const instagram = new Instagram({
    accessToken: process.env.IG_ACCESS_TOKEN
});

async function fetchInstagramPosts(username) {
    try {
        // Get user ID from username
        const users = await instagram.searchUser(username);
        if (!users || users.length === 0) {
            throw new Error(`User @${username} not found`);
        }

        const userId = users[0].id;

        // Get user's media
        const media = await instagram.getUserMedia(userId, { limit: 10 });

        return media.data.map(item => ({
            shortcode: item.id,
            id: item.id,
            timestamp: new Date(item.timestamp).getTime() / 1000,
            caption: item.caption,
            media_url: item.media_url,
            permalink: item.permalink
        }));
    } catch (error) {
        console.error('[Instagram API] Error:', error.message);
        throw error;
    }
}

module.exports = { fetchInstagramPosts };
```

4. **Update [`src/index.js`](../src/index.js)**
```javascript
// Replace this import:
// const { fetchShortcodes } = require('./instagramMonitor');

// With:
const { fetchInstagramPosts } = require('./instagramApi');

// Update checkInstagramUpdates function:
const posts = await fetchInstagramPosts(username);
```

5. **Add to `.env` file:**
```
IG_ACCESS_TOKEN=your_access_token_here
```

**Pros:**
- ✅ Free
- ✅ Official API (won't break)
- ✅ No rate limiting issues
- ✅ Reliable

**Cons:**
- ❌ Requires app registration
- ❌ Rate limited to 200 requests/hour
- ❌ Requires user authentication

---

### Solution 3: Increase Delays Dramatically (Free but Unreliable)

**Best for:** Testing only, not recommended for production

**How it works:**
- Increase delays between requests to 5-10 minutes
- Only check Instagram once per day
- May still get rate limited

**Implementation:**

Update [`src/instagramMonitor.js`](../src/instagramMonitor.js):
```javascript
// Change these values:
const MIN_REQUEST_INTERVAL = 5 * 60 * 1000; // 5 minutes instead of 30 seconds
const COOKIE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours instead of 1 hour

// In fetchShortcodes, change retry delays:
const retryDelays = [60000, 300000, 600000, 1800000, 3600000]; // 1m, 5m, 10m, 30m, 1h
```

**Pros:**
- ✅ Free
- ✅ No additional services

**Cons:**
- ❌ Very unreliable
- ❌ May still get rate limited
- ❌ Slow response times
- ❌ Not suitable for production

---

### Solution 4: Use a Residential VPS (Moderate Cost)

**Best for:** Long-term solution without proxies

**How it works:**
- Use a VPS provider that offers residential IPs
- Examples: Contabo, Hetzner (some locations), DigitalOcean (some regions)

**Implementation:**
1. Sign up for a VPS with residential IP
2. Deploy your bot there
3. No code changes needed

**Pros:**
- ✅ No code changes
- ✅ Reliable
- ✅ Moderate cost ($5-15/month)

**Cons:**
- ❌ Need to migrate VPS
- ❌ Limited providers
- ❌ May still have some rate limiting

---

### Solution 5: Use Third-Party Instagram Data Service (Paid)

**Best for:** Enterprise solutions

**How it works:**
- Use services like CrowdTangle, RapidAPI Instagram scrapers
- They handle rate limiting and provide APIs

**Services:**
- CrowdTangle (free for journalists)
- RapidAPI Instagram scrapers
- Apify Instagram scraper

**Pros:**
- ✅ Reliable
- ✅ No rate limiting issues
- ✅ Easy integration

**Cons:**
- ❌ Cost varies
- ❌ Dependency on third-party
- ❌ May have usage limits

---

## Recommended Solution for You

### For Testing/Development:
**Use Solution 3** (Increase delays dramatically)
- Quick to implement
- Free
- Good enough for testing

### For Production:
**Use Solution 1** (Residential Proxy) OR **Solution 2** (Instagram API)

**Choose Solution 1 if:**
- You want to keep scraping approach
- You have budget for proxy ($50-100/month)
- You need high reliability

**Choose Solution 2 if:**
- You want a free solution
- You're okay with rate limits (200/hour is plenty for daily checks)
- You want to use official API

## Quick Fix for Now

If you want to deploy immediately with minimal changes, implement **Solution 3**:

```javascript
// In src/instagramMonitor.js, change:
const MIN_REQUEST_INTERVAL = 5 * 60 * 1000; // 5 minutes
const COOKIE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const retryDelays = [60000, 300000, 600000, 1800000, 3600000]; // 1m, 5m, 10m, 30m, 1h
```

This will reduce the chance of rate limiting but won't guarantee it works on VPS.

## Long-Term Recommendation

**Implement Solution 2 (Instagram Basic Display API)** because:
- ✅ It's free
- ✅ It's official and won't break
- ✅ 200 requests/hour is more than enough for daily checks
- ✅ No IP-based rate limiting
- ✅ Reliable and maintainable

Would you like me to implement Solution 2 (Instagram API) for you?
