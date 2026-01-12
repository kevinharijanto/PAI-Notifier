const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.aktuaris.or.id/page/news_nextpage/';
const MAX_OFFSET = 260;  // Last page offset
const PAGE_STEP = 5;     // Offset increment per page

/**
 * Fetches the HTML content from a specific page
 * @param {number} offset - Page offset (0, 5, 10, ..., 260)
 * @returns {Promise<string>} HTML content of the page
 */
async function fetchNewsPage(offset = 0) {
    const url = offset === 0 ? BASE_URL : `${BASE_URL}${offset}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            timeout: 30000
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching page offset ${offset}:`, error.message);
        throw error;
    }
}

/**
 * Small delay to avoid overwhelming the server
 * @param {number} ms - Milliseconds to wait
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parses the HTML and extracts article information
 * 
 * How this works:
 * 1. The website lists news articles as links in the format:
 *    /page/news_detail/{ID}/{slug}
 * 2. We use Cheerio (jQuery-like library) to parse the HTML
 * 3. We find all anchor tags matching the news_detail pattern
 * 4. Extract the numeric ID, title, and full URL from each link
 * 5. Remove duplicates (same article may appear multiple times)
 * 
 * @param {string} html - HTML content to parse
 * @returns {Array} Array of article objects with id, title, url
 */
function parseArticles(html) {
    const $ = cheerio.load(html);
    const articles = new Map(); // Use Map to deduplicate by ID

    // Find all links matching the news_detail pattern
    $('a[href*="/page/news_detail/"]').each((index, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().trim();

        // Extract article ID from URL pattern: /page/news_detail/{ID}/{slug}
        const match = href.match(/\/page\/news_detail\/(\d+)\//);

        if (match && text) {
            const id = match[1];

            // Only add if we haven't seen this ID yet (keep first occurrence)
            if (!articles.has(id)) {
                articles.set(id, {
                    id: id,
                    title: text,
                    url: href.startsWith('http') ? href : `https://www.aktuaris.or.id${href}`
                });
            }
        }
    });

    // Convert Map to Array and sort by ID (descending - newest first)
    return Array.from(articles.values())
        .sort((a, b) => parseInt(b.id) - parseInt(a.id));
}

/**
 * Main function to fetch and parse articles from ALL pages
 * @param {boolean} allPages - If true, fetch all pages; if false, fetch only first page
 * @returns {Promise<Array>} Array of article objects
 */
async function scrapeArticles(allPages = false) {
    const allArticles = new Map(); // Use Map to deduplicate by ID

    if (allPages) {
        // Fetch ALL pages (for initial population)
        const totalPages = Math.floor(MAX_OFFSET / PAGE_STEP) + 1; // 53 pages
        console.log(`[${new Date().toISOString()}] Fetching ALL ${totalPages} pages...`);

        for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_STEP) {
            const pageNum = Math.floor(offset / PAGE_STEP) + 1;
            console.log(`[${new Date().toISOString()}] Fetching page ${pageNum}/${totalPages} (offset: ${offset})...`);

            try {
                const html = await fetchNewsPage(offset);
                const articles = parseArticles(html);

                // Add to Map (deduplicates automatically)
                articles.forEach(article => {
                    if (!allArticles.has(article.id)) {
                        allArticles.set(article.id, article);
                    }
                });

                // Small delay to be nice to the server
                if (offset < MAX_OFFSET) {
                    await delay(500);
                }
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Failed to fetch page ${pageNum}, skipping...`);
            }
        }
    } else {
        // Fetch only first page (for regular checks - new articles appear here)
        console.log(`[${new Date().toISOString()}] Fetching first page...`);
        const html = await fetchNewsPage(0);
        const articles = parseArticles(html);
        articles.forEach(article => allArticles.set(article.id, article));
    }

    // Convert Map to Array and sort by ID (descending - newest first)
    const result = Array.from(allArticles.values())
        .sort((a, b) => parseInt(b.id) - parseInt(a.id));

    console.log(`[${new Date().toISOString()}] Found ${result.length} total articles`);

    return result;
}

module.exports = {
    fetchNewsPage,
    parseArticles,
    scrapeArticles
};
