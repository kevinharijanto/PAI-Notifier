require('dotenv').config();
const { fetchPosts, downloadPost, closeBrowser } = require('./src/instagramPuppeteer');

async function runTest() {
    console.log('Testing Puppeteer Instagram Scraper...');
    
    // Make sure we have credentials
    if (!process.env.IG_DUMMY_USERNAME || !process.env.IG_DUMMY_PASSWORD) {
        console.warn('⚠️ WARNING: IG_DUMMY_USERNAME or IG_DUMMY_PASSWORD is not set in .env');
        console.warn('The scraper will attempt to fetch anonymously, which may be blocked by Instagram login wall.');
    } else {
        console.log(`Using dummy account: ${process.env.IG_DUMMY_USERNAME}`);
    }

    try {
        const username = 'aktuarisindonesia'; // target profile
        console.log(`\n1. Fetching posts for @${username}...`);
        
        const posts = await fetchPosts(username);
        
        console.log(`\nFound ${posts.length} posts.`);
        if (posts.length > 0) {
            const latest = posts[0];
            console.log('\nLatest Post Info:', {
                shortcode: latest.shortcode,
                timestamp: new Date(latest.timestamp * 1000).toLocaleString(),
                captionPreview: latest.caption.substring(0, 50) + '...',
                thumbnail: latest.thumbnail ? 'YES' : 'NO'
            });
            
            console.log(`\n2. Downloading latest post (${latest.shortcode})...`);
            const downloaded = await downloadPost(latest.shortcode);
            
            console.log('\n✅ Download successful!');
            console.log('Image Path:', downloaded.imagePath);
            console.log('Caption Length:', downloaded.caption.length);
        } else {
            console.log('No posts found to download.');
        }

    } catch (e) {
        console.error('\n❌ Test failed with error:', e);
    } finally {
        await closeBrowser();
        console.log('\nBrowser closed. Test finished.');
        process.exit(0);
    }
}

runTest();
