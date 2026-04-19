const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function fetchShortcodesWithInstaloader(username) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-profile-'));
    
    try {
        console.log(`[Instagram] Fetching posts for @${username} using instaloader...`);
        
        execSync(
            `instaloader ${username} --dirname-pattern="${tmpDir}" --no-videos --no-video-thumbnails --no-profile-pic --no-compress-json --max-count=12 --metadata-json`,
            {
                timeout: 120000,
                stdio: ['pipe', 'pipe', 'pipe'],
            }
        );
        
        const files = fs.readdirSync(tmpDir);
        const jsonFile = files.find(f => f.endsWith('.json'));
        
        if (!jsonFile) {
            throw new Error('No metadata file found from instaloader');
        }
        
        const metadataPath = path.join(tmpDir, jsonFile);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        
        const posts = [];
        const postsData = metadata.GraphImages || metadata.edge_owner_to_timeline_media?.edges || [];
        
        for (const post of postsData) {
            if (post.node) {
                posts.push({
                    shortcode: post.node.shortcode || post.node.id,
                    id: post.node.id,
                    timestamp: post.node.taken_at_timestamp || Math.floor(Date.now() / 1000),
                });
            }
        }
        
        console.log(`[Instagram] @${username} has ${posts.length} posts fetched via instaloader`);
        
        return posts;
        
    } catch (error) {
        console.error('[Instagram] Instaloader error:', error.message);
        throw new Error(`Failed to fetch posts using instaloader: ${error.message}`);
    } finally {
        try {
            if (fs.existsSync(tmpDir)) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        } catch (e) {
            console.warn('[Instagram] Failed to cleanup temp dir:', e.message);
        }
    }
}

async function fetchShortcodesWithSession(username, sessionFile = null) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-profile-'));
    
    try {
        console.log(`[Instagram] Fetching posts for @${username} using instaloader with session...`);
        
        let command = `instaloader ${username} --dirname-pattern="${tmpDir}" --no-videos --no-video-thumbnails --no-profile-pic --no-compress-json --max-count=12 --metadata-json`;
        
        if (sessionFile && fs.existsSync(sessionFile)) {
            command += ` --sessionfile="${sessionFile}"`;
            console.log('[Instagram] Using authenticated session (better rate limits)');
        }
        
        execSync(command, {
            timeout: 120000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        
        const files = fs.readdirSync(tmpDir);
        const jsonFile = files.find(f => f.endsWith('.json'));
        
        if (!jsonFile) {
            throw new Error('No metadata file found from instaloader');
        }
        
        const metadataPath = path.join(tmpDir, jsonFile);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        
        const posts = [];
        const postsData = metadata.GraphImages || metadata.edge_owner_to_timeline_media?.edges || [];
        
        for (const post of postsData) {
            if (post.node) {
                posts.push({
                    shortcode: post.node.shortcode || post.node.id,
                    id: post.node.id,
                    timestamp: post.node.taken_at_timestamp || Math.floor(Date.now() / 1000),
                });
            }
        }
        
        console.log(`[Instagram] @${username} has ${posts.length} posts fetched via instaloader`);
        
        return posts;
        
    } catch (error) {
        console.error('[Instagram] Instaloader error:', error.message);
        throw new Error(`Failed to fetch posts using instaloader: ${error.message}`);
    } finally {
        try {
            if (fs.existsSync(tmpDir)) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        } catch (e) {
            console.warn('[Instagram] Failed to cleanup temp dir:', e.message);
        }
    }
}

module.exports = {
    fetchShortcodesWithInstaloader,
    fetchShortcodesWithSession,
};
