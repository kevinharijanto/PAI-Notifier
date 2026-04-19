const puppeteerScraper = require('./instagramPuppeteer');

/**
 * Main switch to fetch posts using Puppeteer (No Fallbacks)
 * @param {string} username - Instagram username
 * @returns {Promise<Array<{shortcode: string, id: string, timestamp: number, thumbnail: string, caption: string}>>}
 */
async function fetchPosts(username) {
    console.log(`[InstagramMonitor] Initiating Puppeteer fetch for @${username}`);
    return await puppeteerScraper.fetchPosts(username);
}

/**
 * Downloads a post's image and caption
 * @param {string} shortcode - Instagram post shortcode
 * @returns {Promise<{shortcode: string, caption: string, imagePath: string, permalink: string, tmpDir: string}>}
 */
async function downloadPost(shortcode) {
    return await puppeteerScraper.downloadPost(shortcode);
}

/**
 * Cleans up a temporary directory
 * @param {string} dirPath - Path to temp directory
 */
function cleanupTmpDir(dirPath) {
    puppeteerScraper.cleanupTmpDir(dirPath);
}

module.exports = {
    fetchPosts,
    downloadPost,
    cleanupTmpDir,
};
