const axios = require('axios');
const cheerio = require('cheerio');
const pdfParseModule = require('pdf-parse');
const pdfParse = pdfParseModule.default || pdfParseModule;

const BASE_URL = 'https://www.aktuaris.or.id';
const LOGIN_URL = `${BASE_URL}/page/login_validation`;
const EXAM_URL = `${BASE_URL}/exam/index`;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Per-user session storage: Map<userId, {cookie, expiry}>
const userSessions = new Map();

/**
 * Logs in to the PAI website
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<{cookie: string, expiry: number}|null>} Session info or null if failed
 */
async function login(email, password) {
    console.log(`[${new Date().toISOString()}] Logging in to PAI website...`);

    try {
        const response = await axios.post(LOGIN_URL,
            new URLSearchParams({
                email: email,
                password: password
            }).toString(),
            {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Origin': BASE_URL,
                    'Referer': `${BASE_URL}/page/login`
                },
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400
            }
        );

        return extractSessionFromResponse(response);

    } catch (error) {
        // Handle redirect (302) which might contain the cookie
        if (error.response) {
            const session = extractSessionFromResponse(error.response);
            if (session) return session;
        }

        console.error(`[${new Date().toISOString()}] Login error:`, error.message);
        return null;
    }
}

/**
 * Extracts session cookie from response headers
 */
function extractSessionFromResponse(response) {
    const cookies = response.headers['set-cookie'];
    if (cookies) {
        for (const cookie of cookies) {
            if (cookie.startsWith('ci_session=')) {
                const match = cookie.match(/ci_session=([^;]+)/);
                if (match) {
                    console.log(`[${new Date().toISOString()}] Login successful, session obtained`);
                    return {
                        cookie: match[1],
                        expiry: Date.now() + (36000 * 1000) // ~10 hours
                    };
                }
            }
        }
    }
    console.log(`[${new Date().toISOString()}] Login failed - no session cookie received`);
    return null;
}

/**
 * Checks if a user's session is still valid
 * @param {string} userId - User ID
 * @returns {boolean} True if session is valid
 */
function isSessionValid(userId) {
    const session = userSessions.get(String(userId));
    if (!session) return false;
    // Add 5 minute buffer before expiry
    return Date.now() < (session.expiry - 5 * 60 * 1000);
}

/**
 * Gets or refreshes a user's session cookie
 * @param {string} userId - User ID
 * @param {string} email - PAI email
 * @param {string} password - PAI password
 * @returns {Promise<string|null>} Valid session cookie or null
 */
async function getSession(userId, email, password) {
    const uid = String(userId);

    // Check if existing session is valid
    if (isSessionValid(uid)) {
        return userSessions.get(uid).cookie;
    }

    // Login and get new session
    const session = await login(email, password);
    if (session) {
        userSessions.set(uid, session);
        return session.cookie;
    }

    return null;
}

/**
 * Clears a user's session (for re-login)
 * @param {string} userId - User ID
 */
function clearSession(userId) {
    userSessions.delete(String(userId));
}

/**
 * Fetches the exam page HTML
 * @param {string} cookie - Session cookie
 * @returns {Promise<string|null>} HTML content or null
 */
async function fetchExamPage(cookie) {
    console.log(`[${new Date().toISOString()}] Fetching exam page...`);

    try {
        const response = await axios.get(EXAM_URL, {
            headers: {
                'User-Agent': USER_AGENT,
                'Cookie': `ci_session=${cookie}`,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            maxRedirects: 5
        });

        // Check if we were redirected to login page
        if (response.request.res.responseUrl &&
            response.request.res.responseUrl.includes('/page/login')) {
            console.log(`[${new Date().toISOString()}] Session expired, redirected to login`);
            return null;
        }

        return response.data;

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching exam page:`, error.message);
        return null;
    }
}

/**
 * Parses the exam table from HTML
 * @param {string} html - HTML content
 * @returns {Array} Array of exam objects
 */
function parseExamTable(html) {
    const $ = cheerio.load(html);
    const exams = [];

    const table = $('table.table').first();

    if (table.length === 0) {
        console.log(`[${new Date().toISOString()}] No exam table found`);
        return exams;
    }

    table.find('tbody tr, tr').each((index, row) => {
        const cells = $(row).find('td');

        if (cells.length >= 6) {
            const exam = {
                kode: $(cells[0]).text().trim(),
                periode: $(cells[1]).text().trim(),
                kota: $(cells[2]).text().trim(),
                hasilUjian: {
                    text: $(cells[3]).text().trim(),
                    link: $(cells[3]).find('a').attr('href') || null
                },
                status: $(cells[4]).text().trim(),
                actions: [],
                result: null // Will be populated from PDF
            };

            // Filter actions - only keep relevant ones
            const excludeActions = ['detail', 'cetak undangan', 'cetak kartu ujian'];
            $(cells[5]).find('a').each((i, link) => {
                const text = $(link).text().trim();
                const lowerText = text.toLowerCase();
                if (!excludeActions.some(ex => lowerText.includes(ex))) {
                    exam.actions.push({
                        text: text,
                        link: $(link).attr('href')
                    });
                }
            });

            if (exam.kode && exam.kode !== 'KODE') {
                exams.push(exam);
            }
        }
    });

    console.log(`[${new Date().toISOString()}] Parsed ${exams.length} exams`);
    return exams;
}

/**
 * Main function to fetch exam list for a specific user
 * @param {string} userId - Telegram user ID
 * @param {string} email - PAI email
 * @param {string} password - PAI password
 * @returns {Promise<Array|null>} Array of exams or null on error
 */
async function fetchExamListForUser(userId, email, password) {
    const cookie = await getSession(userId, email, password);

    if (!cookie) {
        return null;
    }

    const html = await fetchExamPage(cookie);

    if (!html) {
        // Session expired, try re-login once
        clearSession(userId);
        const newCookie = await getSession(userId, email, password);

        if (!newCookie) {
            return null;
        }

        const retryHtml = await fetchExamPage(newCookie);
        if (!retryHtml) {
            return null;
        }

        return parseExamTable(retryHtml);
    }

    return parseExamTable(html);
}

/**
 * Test function - logs in and fetches exam list
 */
async function testExamFetch() {
    console.log('='.repeat(50));
    console.log('Testing Exam Status Fetch');
    console.log('='.repeat(50));

    const email = process.env.PAI_EMAIL;
    const password = process.env.PAI_PASSWORD;

    if (!email || !password) {
        console.log('\n❌ PAI_EMAIL and PAI_PASSWORD must be set in .env');
        return null;
    }

    const exams = await fetchExamListForUser('test-user', email, password);

    if (!exams) {
        console.log('\n❌ Failed to fetch exams');
        return null;
    }

    if (exams.length === 0) {
        console.log('\n📭 No exams found');
        return [];
    }

    console.log(`\n📋 Found ${exams.length} exam(s):\n`);

    exams.forEach((exam, index) => {
        console.log(`${index + 1}. [${exam.kode}] ${exam.periode}`);
        console.log(`   Kota: ${exam.kota}`);
        console.log(`   Status: ${exam.status}`);
        console.log(`   Actions: ${exam.actions.map(a => a.text).join(', ') || 'None'}`);
        console.log('');
    });

    return exams;
}

if (require.main === module) {
    require('dotenv').config();
    testExamFetch().then(() => process.exit(0));
}

module.exports = {
    login,
    isSessionValid,
    getSession,
    clearSession,
    fetchExamPage,
    parseExamTable,
    fetchExamListForUser,
    fetchExamResultPdf,
    testExamFetch
};

/**
 * Fetches and parses exam result PDF
 * @param {string} pdfUrl - Full URL or relative path to the PDF
 * @param {string} cookie - Session cookie
 * @returns {Promise<Object|null>} Parsed result or null
 */
async function fetchExamResultPdf(pdfUrl, cookie) {
    // Ensure absolute URL
    const fullUrl = pdfUrl.startsWith('http') ? pdfUrl : `${BASE_URL}${pdfUrl}`;
    console.log(`[${new Date().toISOString()}] Fetching PDF result from ${fullUrl}`);

    try {
        const response = await axios.get(fullUrl, {
            headers: {
                'User-Agent': USER_AGENT,
                'Cookie': `ci_session=${cookie}`,
                'Accept': 'application/pdf',
            },
            responseType: 'arraybuffer',
            maxRedirects: 5,
        });

        const dataBuffer = Buffer.from(response.data);
        const pdfData = await pdfParse(dataBuffer);
        const text = pdfData.text;

        // Parse the PDF text to extract exam result
        // Format: "CF2-Probabilitas dan Statistika (CF2) = 70.00"
        const result = {
            rawText: text,
            subject: null,
            subjectCode: null,
            score: null,
            passed: null,
            periode: null
        };

        // Extract subject and score: "SubjectName (CODE) = XX.XX"
        const scoreMatch = text.match(/([\w\-]+[\w\s\-]+)\s*\(([A-Z0-9]+)\)\s*=\s*([\d.]+)/i);
        if (scoreMatch) {
            result.subject = scoreMatch[1].trim();
            result.subjectCode = scoreMatch[2].trim();
            result.score = parseFloat(scoreMatch[3]);
            result.passed = result.score >= 70; // Passing grade is 70
        }

        // Extract periode: "Periode III Tahun 2025" or similar
        const periodeMatch = text.match(/Periode\s+([IVX]+)\s+Tahun\s+(\d{4})/i);
        if (periodeMatch) {
            result.periode = `Periode ${periodeMatch[1]} ${periodeMatch[2]}`;
        }

        console.log(`[${new Date().toISOString()}] PDF parsed: ${result.subjectCode} = ${result.score}`);
        return result;

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching/parsing PDF:`, error.message);
        return null;
    }
}
