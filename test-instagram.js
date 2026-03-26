/**
 * Instagram Monitor Test Script
 * 
 * This script tests the Instagram monitoring functionality locally
 * without requiring the Telegram bot to be running.
 * 
 * Usage: node test-instagram.js
 */

const { fetchShortcodes, getCookies } = require('./src/instagramMonitor');

/**
 * Test 1: Cookie Refresh with Caching
 */
async function testCookieRefresh() {
    console.log('\n' + '='.repeat(60));
    console.log('TEST 1: Cookie Refresh with Caching');
    console.log('='.repeat(60));

    try {
        console.log('Fetching cookies (will use cache if available)...');
        const cookies = await getCookies();

        console.log('\n✅ Cookie fetch successful!');
        console.log('\nCookies received:');
        Object.keys(cookies).forEach(key => {
            const value = cookies[key];
            const displayValue = value.length > 30 ? value.substring(0, 30) + '...' : value;
            console.log(`  - ${key}: ${displayValue}`);
        });

        // Test cache by calling again
        console.log('\nTesting cache (calling getCookies again)...');
        const cachedCookies = await getCookies();
        console.log('✅ Cache working! Second call completed quickly.');

        return cookies;
    } catch (error) {
        console.error('\n❌ Cookie fetch failed:', error.message);
        return null;
    }
}

/**
 * Test 2: Fetch Shortcodes (Single Attempt)
 */
async function testFetchShortcodes(username) {
    console.log('\n' + '='.repeat(60));
    console.log(`TEST 2: Fetch Shortcodes for @${username}`);
    console.log('='.repeat(60));
    
    try {
        console.log(`Fetching posts for @${username}...`);
        const posts = await fetchShortcodes(username, 0); // 0 retries for testing
        
        console.log(`\n✅ Successfully fetched ${posts.length} post(s)!`);
        
        if (posts.length > 0) {
            console.log('\nLatest posts:');
            posts.slice(0, 5).forEach((post, index) => {
                const date = new Date(post.timestamp * 1000).toLocaleString();
                console.log(`\n${index + 1}. Shortcode: ${post.shortcode}`);
                console.log(`   ID: ${post.id}`);
                console.log(`   Posted: ${date}`);
                console.log(`   URL: https://www.instagram.com/p/${post.shortcode}/`);
            });
            
            if (posts.length > 5) {
                console.log(`\n... and ${posts.length - 5} more posts`);
            }
        }
        
        return posts;
    } catch (error) {
        console.error('\n❌ Failed to fetch shortcodes:', error.message);
        return null;
    }
}

/**
 * Test 3: Fetch Shortcodes with Retries
 */
async function testFetchWithRetries(username) {
    console.log('\n' + '='.repeat(60));
    console.log(`TEST 3: Fetch Shortcodes with Retries for @${username}`);
    console.log('='.repeat(60));
    
    try {
        console.log(`Fetching posts for @${username} with retry logic...`);
        console.log('This will test the full retry mechanism with exponential backoff.\n');
        
        const posts = await fetchShortcodes(username, 3); // 3 retries
        
        console.log(`\n✅ Successfully fetched ${posts.length} post(s) after retries!`);
        
        if (posts.length > 0) {
            console.log('\nLatest posts:');
            posts.slice(0, 3).forEach((post, index) => {
                const date = new Date(post.timestamp * 1000).toLocaleString();
                console.log(`\n${index + 1}. Shortcode: ${post.shortcode}`);
                console.log(`   Posted: ${date}`);
                console.log(`   URL: https://www.instagram.com/p/${post.shortcode}/`);
            });
        }
        
        return posts;
    } catch (error) {
        console.error('\n❌ Failed to fetch shortcodes even with retries:', error.message);
        return null;
    }
}

/**
 * Test 4: Multiple Sequential Requests (Tests Throttling)
 */
async function testMultipleRequests(username, count = 3) {
    console.log('\n' + '='.repeat(60));
    console.log(`TEST 4: Multiple Sequential Requests (${count} attempts)`);
    console.log('='.repeat(60));
    console.log('This test will verify the 30-second throttling between requests.\n');

    const results = [];

    for (let i = 1; i <= count; i++) {
        console.log(`\n--- Attempt ${i}/${count} ---`);

        try {
            const startTime = Date.now();
            const posts = await fetchShortcodes(username, 1); // 1 retry
            const duration = Date.now() - startTime;

            console.log(`✅ Success! Fetched ${posts.length} posts in ${duration}ms`);
            results.push({ attempt: i, success: true, duration, postCount: posts.length });

            // Note: The throttling is built into fetchShortcodes, so we don't need to wait here
            // The function will automatically wait 30 seconds if needed
        } catch (error) {
            console.error(`❌ Failed: ${error.message}`);
            results.push({ attempt: i, success: false, error: error.message });
        }
    }

    // Summary
    console.log('\n' + '-'.repeat(60));
    console.log('Summary:');
    const successCount = results.filter(r => r.success).length;
    console.log(`  Successful: ${successCount}/${count}`);
    console.log(`  Failed: ${count - successCount}/${count}`);

    if (successCount > 0) {
        const avgDuration = results
            .filter(r => r.success)
            .reduce((sum, r) => sum + r.duration, 0) / successCount;
        console.log(`  Average duration: ${Math.round(avgDuration)}ms`);
    }

    return results;
}

/**
 * Main Test Runner
 */
async function runTests() {
    console.log('\n' + '='.repeat(60));
    console.log('INSTAGRAM MONITOR TEST SUITE');
    console.log('='.repeat(60));
    console.log('This script will test the Instagram monitoring functionality');
    console.log('to diagnose rate limiting issues.\n');
    
    const username = 'aktuarisindonesia';
    
    // Run tests
    const cookies = await testCookieRefresh();
    
    if (cookies) {
        // Test 2: Single attempt
        await testFetchShortcodes(username);
        
        // Test 3: With retries
        await testFetchWithRetries(username);
        
        // Test 4: Multiple requests
        console.log('\n⚠️  Note: Test 4 will make multiple requests to Instagram.');
        console.log('This may trigger rate limiting. Continue? (Ctrl+C to cancel)');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        await testMultipleRequests(username, 3);
    }
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUITE COMPLETE');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('1. Review the results above');
    console.log('2. If you see 429 errors, the rate limiting issue is confirmed');
    console.log('3. Check the analysis in plans/instagram-rate-limit-analysis.md');
    console.log('4. Implement the recommended fixes');
    console.log('\nTo run this test again: node test-instagram.js\n');
}

// Run the tests
runTests().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});
