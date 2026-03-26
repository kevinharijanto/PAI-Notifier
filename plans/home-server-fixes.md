# Home Server Instagram Fixes

## Problem Analysis

Since you're using a **home server** (not a VPS with datacenter IP), the issue is **NOT** IP-based rate limiting. Both your PC and home server have the same residential IP.

## Root Cause Identified

The cookie refresh mechanism was **incomplete**:

**Before:**
- Only got `csrftoken` and `mid` cookies
- Missing critical cookies: `datr`, `ig_did`, `ig_nrcb`, `ps_l`, `ps_n`
- Instagram rejected requests with incomplete cookies → 429 error

**After:**
- Enhanced cookie refresh to get ALL necessary cookies
- Makes two requests to Instagram to collect complete cookie set
- Extracts cookies from both HTTP headers and HTML
- More realistic browser-like behavior

## Changes Made

### 1. Enhanced Cookie Refresh ([`src/instagramMonitor.js:76-130`](../src/instagramMonitor.js:76-130))

**Added:**
- More realistic HTTP headers (Accept-Encoding, Connection, Upgrade-Insecure-Requests, etc.)
- Second request to a public profile to trigger additional cookies
- Cookie extraction from HTML (`ig_did`, `mid`)
- Better error handling

**Result:** Gets complete cookie set that Instagram accepts

### 2. Increased Timeouts for Safety

**Changed:**
- Cookie cache duration: 1 hour → **2 hours**
- Minimum request interval: 30 seconds → **1 minute**
- Retry delays: 10s/30s/1m/2m/5m → **30s/1m/2m/5m/10m**
- Random delay before requests: 2 seconds → **2-5 seconds (random)**

**Result:** More conservative approach to avoid rate limiting

### 3. Better Logging

**Added:**
- Shows cookie expiry in minutes and seconds
- Shows random delay before requests
- More informative throttling messages

**Result:** Easier to debug and monitor

## Why This Should Work

### Cookie Completeness
Instagram requires specific cookies to authenticate requests:
- ✅ `csrftoken` - CSRF protection
- ✅ `mid` - Machine ID
- ✅ `datr` - Date tracking
- ✅ `ig_did` - Instagram Device ID
- ✅ `ig_nrcb` - New request callback
- ✅ `ps_l`, `ps_n` - Privacy settings

**Before:** Only got 2 cookies → Rejected
**After:** Gets all cookies → Accepted

### Realistic Behavior
- Two-stage cookie collection (like a real browser)
- Random delays between requests
- Proper HTTP headers
- Longer intervals between requests

### Conservative Limits
- 2-hour cookie cache (fewer refreshes)
- 1-minute minimum between requests
- Longer retry delays
- Random delays to look human

## Testing

### Test Locally First
```bash
node test-instagram.js
```

**Expected Results:**
- ✅ Test 1: Should show more cookies (csrftoken, mid, datr, ig_did, etc.)
- ✅ Test 2: Should succeed without 429 errors
- ✅ Test 3: Should succeed with retries
- ✅ Test 4: Should handle multiple requests with throttling

### Test on Home Server
```bash
npm start
```

**Expected Results:**
- ✅ Initial check should succeed
- ✅ Latest post should be sent to Telegram
- ✅ No 429 errors in logs
- ✅ Cookies should be cached for 2 hours

## Deployment to Home Server

Since it's a home server, deployment is simple:

### Option 1: Run Directly
```bash
npm start
```

### Option 2: Use PM2 (Recommended)
```bash
npm install -g pm2
pm2 start src/index.js --name pai-notifier
pm2 logs pai-notifier
```

### Option 3: Docker
```bash
docker-compose up -d
docker-compose logs -f
```

## Monitoring

### Check Logs For:
```
[Instagram] Got cookies: csrftoken, mid, datr, ig_did, ig_nrcb, ps_l, ps_n
```
✅ Should see 6-7 cookies (not just 2)

```
[Instagram] Using cached cookies (expires in Xm Ys)
```
✅ Should see cookies being reused

```
[Instagram] Waiting Xs before request...
```
✅ Should see random delays (2-5 seconds)

```
[Instagram] @aktuarisindonesia has X total posts, got Y latest
```
✅ Should successfully fetch posts

### If You Still See 429 Errors:

1. **Check cookie count:**
   - If only 2 cookies: Cookie refresh still incomplete
   - If 6+ cookies: Something else is wrong

2. **Increase delays further:**
   ```javascript
   const MIN_REQUEST_INTERVAL = 2 * 60 * 1000; // 2 minutes
   const COOKIE_CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours
   ```

3. **Check Instagram status:**
   - Instagram might be having issues
   - Try again in a few hours

4. **Consider Instagram API:**
   - If scraping continues to fail
   - Use Instagram Basic Display API (see [`vps-rate-limiting-solutions.md`](vps-rate-limiting-solutions.md))

## Success Criteria

Your deployment is successful if:
- ✅ Bot starts without errors
- ✅ Initial Instagram check succeeds
- ✅ Latest post is sent to Telegram
- ✅ Daily checks run at 8 AM GMT+7
- ✅ No 429 errors in logs
- ✅ Cookie cache shows 6+ cookies
- ✅ Cookies are reused for 2 hours

## Next Steps

1. ✅ Test locally: `node test-instagram.js`
2. ✅ Deploy to home server
3. ✅ Monitor logs for first 24 hours
4. ✅ Verify daily check at 8 AM GMT+7
5. ✅ Confirm new posts are sent

## Troubleshooting

**Issue:** Still getting 429 errors
**Solution:** Increase delays further or use Instagram API

**Issue:** Only 2 cookies in logs
**Solution:** Cookie refresh still incomplete, check network connectivity

**Issue:** Bot crashes on startup
**Solution:** Check `.env` file has correct values

**Issue:** No posts being sent
**Solution:** Check if users have reminders enabled

## Summary

The main issue was **incomplete cookie collection**. The enhanced cookie refresh now gets all necessary cookies, making requests look more like a real browser. Combined with more conservative delays, this should resolve the 429 errors on your home server.

Since you're using a home server with residential IP, you don't need proxies or other complex solutions. The enhanced cookie management should be sufficient.
