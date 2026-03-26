# Instagram Rate Limiting Issue Analysis

## Problem Summary
The application consistently encounters HTTP 429 (rate limit) errors when checking Instagram posts for `@aktuarisindonesia`, even after 4 retry attempts with exponential backoff.

## Root Causes Identified

### 1. **Stale Hardcoded Cookies** (Critical)
- **Location**: [`src/instagramMonitor.js:11-19`](../src/instagramMonitor.js:11-19)
- **Issue**: Hardcoded cookies (`csrftoken`, `datr`, `ig_did`, `mid`) are static and likely expired
- **Impact**: Instagram rejects requests with expired cookies, triggering rate limiting
- **Evidence**: The code uses these cookies on the first attempt, only refreshing on retries

### 2. **Insufficient Cookie Refresh Strategy**
- **Location**: [`src/instagramMonitor.js:96`](../src/instagramMonitor.js:96)
- **Issue**: Cookie refresh only happens on retry attempts (after first failure)
- **Impact**: First attempt always uses potentially stale cookies
- **Current Logic**: `attempt === 0 ? await getCookies() : await refreshCookies()`

### 3. **No Cookie Persistence**
- **Issue**: Fresh cookies obtained during retries are not saved for future use
- **Impact**: Every check cycle starts with the same stale hardcoded cookies
- **Missing Feature**: No mechanism to cache valid cookies between runs

### 4. **Aggressive Request Pattern**
- **Location**: [`src/index.js:339-342`](../src/index.js:339-342)
- **Issue**: Instagram checks run daily at 8 AM, but the initial check runs on startup
- **Impact**: If the bot restarts frequently, it may trigger rate limiting
- **Current Schedule**: Daily at 8 AM + initial check on startup

### 5. **Limited Retry Strategy**
- **Location**: [`src/instagramMonitor.js:90-168`](../src/instagramMonitor.js:90-168)
- **Issue**: Only 3 retries with fixed delays (10s, 30s, 60s)
- **Impact**: May not be sufficient for Instagram's rate limit recovery time
- **Current Delays**: 10s → 30s → 60s (total ~100s)

## Recommended Solutions

### Priority 1: Implement Dynamic Cookie Management

**Solution A: Cookie Caching System**
```javascript
// Add to instagramMonitor.js
const COOKIE_CACHE_FILE = path.join(__dirname, '../data/instagram_cookies.json');
let cachedCookies = null;
let cookieExpiry = null;

async function getCookies() {
    // Check if cached cookies are still valid (e.g., within 1 hour)
    if (cachedCookies && cookieExpiry && Date.now() < cookieExpiry) {
        console.log('[Instagram] Using cached cookies');
        return cachedCookies;
    }
    
    // Refresh cookies
    const freshCookies = await refreshCookies();
    
    // Cache them with expiry
    cachedCookies = freshCookies;
    cookieExpiry = Date.now() + (60 * 60 * 1000); // 1 hour
    
    // Persist to disk
    fs.writeFileSync(COOKIE_CACHE_FILE, JSON.stringify({
        cookies: freshCookies,
        expiry: cookieExpiry
    }));
    
    return freshCookies;
}
```

**Solution B: Remove Hardcoded Cookies**
- Delete the `HARDCODED_COOKIES` object entirely
- Always fetch fresh cookies from Instagram
- This ensures cookies are always current

### Priority 2: Improve Retry Logic

**Enhanced Retry Strategy:**
```javascript
async function fetchShortcodes(username, maxRetries = 5) {
    const retryDelays = [10000, 30000, 60000, 120000, 300000]; // 10s, 30s, 1m, 2m, 5m
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Always use fresh cookies
            const cookies = await getCookies();
            
            // ... existing request logic ...
            
            if (resp.status === 429) {
                if (attempt < maxRetries) {
                    const delay = retryDelays[attempt] || 300000;
                    console.warn(`[Instagram] Rate limited (429). Retrying in ${delay / 1000}s...`);
                    await sleep(delay);
                    continue;
                }
                throw new Error(`Instagram rate limited (429) after ${maxRetries + 1} attempts. Try again later.`);
            }
            
            // ... rest of logic ...
        } catch (error) {
            // ... error handling ...
        }
    }
}
```

### Priority 3: Add Request Throttling

**Implement Rate Limiting:**
```javascript
// Add to instagramMonitor.js
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 30000; // 30 seconds between requests

async function fetchShortcodes(username, maxRetries = 5) {
    // Enforce minimum interval between requests
    const timeSinceLastRequest = Date.now() - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        console.log(`[Instagram] Throttling: waiting ${waitTime / 1000}s before request`);
        await sleep(waitTime);
    }
    
    lastRequestTime = Date.now();
    
    // ... rest of function ...
}
```

### Priority 4: Add Health Monitoring

**Cookie Validation:**
```javascript
async function validateCookies(cookies) {
    try {
        const testUrl = 'https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram';
        const resp = await axios.get(testUrl, {
            headers: {
                'User-Agent': USER_AGENT,
                'X-IG-App-ID': IG_APP_ID,
                'Cookie': Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
            },
            validateStatus: () => true,
        });
        
        return resp.status === 200;
    } catch (error) {
        return false;
    }
}
```

## Implementation Plan

### Phase 1: Quick Fix (Immediate)
1. Remove hardcoded cookies from [`instagramMonitor.js`](../src/instagramMonitor.js:11-19)
2. Always call `refreshCookies()` on first attempt
3. Increase retry count to 5 with longer delays

### Phase 2: Robust Solution (Recommended)
1. Implement cookie caching system with expiry
2. Add cookie validation before use
3. Implement request throttling
4. Add persistent cookie storage

### Phase 3: Monitoring & Optimization
1. Add logging for cookie refresh events
2. Track success/failure rates
3. Implement adaptive retry delays based on response patterns
4. Consider using a proxy service if rate limiting persists

## Additional Considerations

### Instagram API Limitations
- Instagram's public API has undocumented rate limits
- Anonymous requests are more likely to be rate-limited
- Consider using official Instagram Basic Display API if available

### Alternative Approaches
1. **RSS Feed**: Check if `@aktuarisindonesia` has an RSS feed
2. **Webhook**: Use a service that provides Instagram webhooks
3. **Official API**: Apply for Instagram Basic Display API access
4. **Third-party Services**: Use services like CrowdTangle or similar

## Testing Strategy

1. **Unit Tests**: Test cookie refresh logic independently
2. **Integration Tests**: Test full flow with mock Instagram responses
3. **Load Testing**: Simulate multiple requests to verify throttling
4. **Manual Testing**: Monitor logs during actual Instagram checks

## Success Metrics

- ✅ No 429 errors for at least 7 consecutive days
- ✅ Successful Instagram checks on scheduled runs
- ✅ Reduced retry attempts (ideally 0-1 retries needed)
- ✅ Consistent cookie refresh without manual intervention
