/**
 * Simple CORS Proxy Server for Jira API
 * 
 * This server acts as a middleman to bypass CORS restrictions
 * when accessing Jira from a local browser.
 * 
 * Usage:
 *   1. Install dependencies: npm install express cors
 *   2. Run server: node proxy-server.js
 *   3. Open jira-issue-viewer.html in browser
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Enable CORS for all origins
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Disable caching so the browser always gets the latest files
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// Serve the main page at root (must be before express.static to take priority)
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.sendFile(path.join(__dirname, 'jira-issue-viewer.html'), { 
        lastModified: false,
        headers: { 'Cache-Control': 'no-store' }
    });
});

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname), { etag: false, lastModified: false, maxAge: 0 }));

// Proxy endpoint for Jira API - supports both old and new routes
app.all(['/jira-proxy/search', '/api/jira-proxy'], async (req, res) => {
    try {
        // Get the actual Jira URL from the request
        const jiraUrl = req.query.url;
        
        if (!jiraUrl) {
            return res.status(400).json({ error: 'Missing url parameter' });
        }

        console.log(`[PROXY] ${req.method} ${jiraUrl}`);

        // Forward the request to Jira
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        // Forward authorization header
        if (req.headers.authorization) {
            headers['Authorization'] = req.headers.authorization;
        }

        const fetchOptions = {
            method: req.method,
            headers: headers
        };

        // Add body for POST/PUT requests
        if (req.method === 'POST' || req.method === 'PUT') {
            fetchOptions.body = JSON.stringify(req.body);
        }

        const response = await fetch(jiraUrl, fetchOptions);
        
        // Get response data
        const contentType = response.headers.get('content-type');
        let data;
        
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        // Forward status and data
        res.status(response.status);
        
        if (typeof data === 'object') {
            res.json(data);
        } else {
            res.send(data);
        }

    } catch (error) {
        console.error('[PROXY ERROR]', error.message);
        res.status(500).json({ 
            error: 'Proxy error', 
            message: error.message 
        });
    }
});

// Proxy endpoint for single Jira issue
app.get('/api/jira-single-issue', async (req, res) => {
    try {
        const { url: baseUrl, token, issueId } = req.query;
        
        if (!baseUrl || !token || !issueId) {
            return res.status(400).json({ error: 'Missing required parameters: url, token, issueId' });
        }

        // Extract the base domain from the URL and construct the REST API URL
        let jiraApiUrl;
        if (baseUrl.includes('/issue')) {
            // If base URL is like http://jira.lge.com/issue, extract the domain
            const domain = baseUrl.replace('/issue', '');
            jiraApiUrl = `${domain}/rest/api/2/issue/${issueId}`;
        } else {
            // If base URL is just the domain
            jiraApiUrl = `${baseUrl}/rest/api/2/issue/${issueId}`;
        }
        
        console.log(`[PROXY SINGLE] GET ${jiraApiUrl}`);

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        const response = await fetch(jiraApiUrl, {
            method: 'GET',
            headers: headers
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[PROXY SINGLE ERROR] ${response.status}: ${errorText}`);
            
            // Try alternate URL construction if the first fails
            if (response.status === 404) {
                console.log(`[PROXY SINGLE] Trying alternate URL construction...`);
                const alternateDomain = baseUrl.replace('/issue', '').replace('/browse', '');
                const alternateUrl = `${alternateDomain}/rest/api/2/issue/${issueId}`;
                console.log(`[PROXY SINGLE RETRY] GET ${alternateUrl}`);
                
                const retryResponse = await fetch(alternateUrl, {
                    method: 'GET',
                    headers: headers
                });
                
                if (retryResponse.ok) {
                    const retryData = await retryResponse.json();
                    return res.json(retryData);
                } else {
                    const retryErrorText = await retryResponse.text();
                    console.error(`[PROXY SINGLE RETRY ERROR] ${retryResponse.status}: ${retryErrorText}`);
                }
            }
            
            return res.status(response.status).json({ 
                error: `Failed to fetch issue ${issueId}`, 
                status: response.status,
                message: errorText
            });
        }

        const data = await response.json();
        res.json(data);

    } catch (error) {
        console.error('[PROXY SINGLE ERROR]', error.message);
        res.status(500).json({ 
            error: 'Proxy error', 
            message: error.message 
        });
    }
});

// Start server - bind to 0.0.0.0 so other machines can connect
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('===========================================');
    console.log('   Jira CORS Proxy Server Running');
    console.log('===========================================');
    console.log(`   Local:    http://localhost:${PORT}`);
    console.log(`   Network:  http://0.0.0.0:${PORT}`);
    console.log('');
    console.log('   Share this with your team:');
    console.log(`   http://<your-ip>:${PORT}`);
    console.log('');
    console.log('   Press Ctrl+C to stop');
    console.log('===========================================');
    console.log('');
});

// Keep server running and handle errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Try a different port.`);
    } else {
        console.error('Server error:', err);
    }
});

// Prevent process from exiting
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

// Keep alive
setInterval(() => {}, 1000);
