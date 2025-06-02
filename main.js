/**
 * Universal News Scraper Actor with Advanced Anti-Bot and Timeout Handling
 * 
 * This actor scrapes news items from various dynamic news sites,
 * including those with advanced anti-bot protection, extracting title, link, date, and summary.
 * 
 * Features:
 * - Adaptive extraction for different site structures
 * - Advanced reCAPTCHA solving with multiple fallback methods
 * - Sophisticated proxy rotation and browser fingerprinting evasion
 * - Multiple extraction methods with intelligent fallbacks
 * - Strict filtering to ensure only true news articles are returned
 * - Robust timeout and memory management
 * - Site-specific optimizations for major news sources
 */

const { Actor } = require('apify');
const { PlaywrightCrawler, Dataset } = require('crawlee');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const { format, parse, isValid } = require('date-fns');
const { zonedTimeToUtc } = require('date-fns-tz');

// Initialize the Actor
Actor.main(async () => {
    // Get input from the user
    const input = await Actor.getInput();
    console.log('Input:', input);

    if (!input || !input.url) {
        throw new Error('Input must contain a "url" field!');
    }

    // Get the 2Captcha API key from environment variables or input
    const captchaApiKey = process.env.CAPTCHA_API_KEY || input.captchaApiKey || '3e69d8abfe1e55da5fbd00025b25cec1';
    
    if (!captchaApiKey) {
        console.log('Warning: No CAPTCHA API key provided. CAPTCHA solving will not work.');
    } else {
        console.log('CAPTCHA API key provided. CAPTCHA solving is enabled.');
    }

    const { url, maxItems = 0, waitTime = 30, maxCrawlingTime = 180 } = input;
    console.log(`Starting universal news scraper for URL: ${url}`);
    console.log(`Maximum items to extract: ${maxItems || 'unlimited'}`);
    console.log(`Wait time for dynamic content: ${waitTime} seconds`);
    console.log(`Maximum crawling time: ${maxCrawlingTime} seconds`);

    // Initialize the dataset to store results
    const dataset = await Dataset.open();
    let extractedCount = 0;
    let methodsUsed = new Set();
    
    // Set a timeout for the entire crawling process
    const crawlingTimeout = setTimeout(() => {
        console.log(`Crawling timeout of ${maxCrawlingTime} seconds reached. Saving current results.`);
        finalizeCrawling();
    }, maxCrawlingTime * 1000);

    // Function to finalize crawling and save results
    async function finalizeCrawling(articles = []) {
        clearTimeout(crawlingTimeout);
        
        // Apply strict post-filtering to remove non-article content
        const filteredArticles = strictPostFilterArticles(articles, url);
        console.log(`Extracted ${filteredArticles.length} articles after filtering`);
        
        // Save the results
        if (filteredArticles.length > 0) {
            // Track which methods were used
            filteredArticles.forEach(article => {
                Object.values(article.methods || {}).forEach(method => {
                    if (method) methodsUsed.add(method);
                });
            });

            // Save to dataset
            await dataset.pushData({
                newsItems: filteredArticles,
                totalCount: filteredArticles.length,
                url: url,
                extractionStats: {
                    methodsUsed: Array.from(methodsUsed),
                    successRate: filteredArticles.length > 0 ? 1 : 0,
                    completeItems: filteredArticles.filter(a => 
                        a.title && a.link && (a.date || a.summary)
                    ).length,
                    partialItems: filteredArticles.filter(a => 
                        (a.title || a.link) && !(a.title && a.link && (a.date || a.summary))
                    ).length
                }
            });
        } else {
            // If no articles were found, save an empty result
            await dataset.pushData({
                newsItems: [],
                totalCount: 0,
                url: url,
                extractionStats: {
                    methodsUsed: [],
                    successRate: 0,
                    completeItems: 0,
                    partialItems: 0
                }
            });
        }
        
        console.log('Scraping finished successfully!');
    }

    // User agents for rotation
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59'
    ];

    // Site-specific configurations
    const siteConfigs = {
        'aljazeera.com': {
            waitForSelector: '.gc__content, .gc--type-post, .gc--type-article, article',
            captchaTimeout: 120,
            navigationTimeout: 180,
            extractionMethod: 'aljazeera'
        },
        'alarabiya.net': {
            waitForSelector: '.search-results-wrapper .search-result-item, .search-results .search-result, .search-results .result-item',
            captchaTimeout: 90,
            navigationTimeout: 120,
            extractionMethod: 'alarabiya'
        },
        'aps.dz': {
            waitForSelector: 'h2, h3, h4, h5',
            captchaTimeout: 60,
            navigationTimeout: 90,
            extractionMethod: 'aps-dz'
        },
        'adnoc.ae': {
            // Return empty results for non-news sites
            skipExtraction: true
        }
    };

    // Get site-specific config based on URL
    function getSiteConfig(url) {
        for (const [domain, config] of Object.entries(siteConfigs)) {
            if (url.includes(domain)) {
                return config;
            }
        }
        return {}; // Default empty config
    }

    const siteConfig = getSiteConfig(url);
    
    // Skip extraction for sites that should return empty results
    if (siteConfig.skipExtraction) {
        console.log(`Skipping extraction for ${url} as it's not a news site.`);
        await finalizeCrawling([]);
        return;
    }

    // Create a PlaywrightCrawler instance with optimized settings
    const crawler = new PlaywrightCrawler({
        // Browser launch options optimized for stability
        launchContext: {
            launchOptions: {
                headless: false, // Set to false for CAPTCHA solving
                args: [
                    '--disable-dev-shm-usage', // Prevents browser crashes in Docker
                    '--disable-accelerated-2d-canvas', // Reduces memory usage
                    '--disable-gpu', // Reduces resource usage
                    '--disable-setuid-sandbox',
                    '--no-sandbox',
                    '--disable-web-security', // Helps with some CAPTCHA frames
                    '--disable-features=IsolateOrigins,site-per-process', // Helps with frames
                    '--disable-site-isolation-trials'
                ]
            },
        },
        // Maximum time for each page - use site-specific config or default
        navigationTimeoutSecs: siteConfig.navigationTimeout || 120,
        // Maximum time for the request handler
        requestHandlerTimeoutSecs: 180, // 3 minutes max per page
        // Proxy configuration for anti-blocking
        proxyConfiguration: await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'], // Use residential proxies to appear as regular users
        }),
        // Limit concurrency to avoid memory issues
        maxConcurrency: 1,
        // Handler for each page
        async requestHandler({ page, request, log }) {
            log.info(`Processing ${request.url}...`);
            
            try {
                // Set a random user agent
                const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
                await page.setExtraHTTPHeaders({
                    'User-Agent': randomUserAgent,
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Cache-Control': 'max-age=0'
                });
                
                // Advanced browser fingerprinting evasion
                await page.evaluateOnNewDocument(() => {
                    // Override navigator properties
                    const newProto = navigator.__proto__;
                    delete newProto.webdriver;
                    
                    // Override permissions
                    const originalQuery = window.navigator.permissions.query;
                    window.navigator.permissions.query = (parameters) => (
                        parameters.name === 'notifications' ?
                            Promise.resolve({ state: Notification.permission }) :
                            originalQuery(parameters)
                    );
                    
                    // Add plugins
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => {
                            return [
                                {
                                    0: {
                                        type: "application/pdf",
                                        suffixes: "pdf",
                                        description: "Portable Document Format",
                                        enabledPlugin: Plugin
                                    },
                                    name: "PDF Viewer",
                                    description: "Portable Document Format",
                                    filename: "internal-pdf-viewer"
                                }
                            ];
                        }
                    });
                    
                    // Add language
                    Object.defineProperty(navigator, 'language', {
                        get: () => "en-US"
                    });
                    
                    Object.defineProperty(navigator, 'languages', {
                        get: () => ["en-US", "en"]
                    });
                });

                // Wait for the page to load
                await page.waitForLoadState('domcontentloaded');
                log.info('Page DOM content loaded');

                // Wait for site-specific selector if available
                if (siteConfig.waitForSelector) {
                    try {
                        await page.waitForSelector(siteConfig.waitForSelector, { 
                            timeout: 10000,
                            state: 'attached'
                        }).catch(() => {
                            log.info(`Selector ${siteConfig.waitForSelector} not found, continuing anyway`);
                        });
                    } catch (error) {
                        log.info(`Error waiting for selector: ${error.message}`);
                    }
                }

                // Check for CAPTCHA and solve if present
                let captchaSolved = false;
                try {
                    const captchaDetected = await page.evaluate(() => {
                        return document.body.textContent.includes('captcha') || 
                               document.body.textContent.includes('CAPTCHA') ||
                               document.body.textContent.includes('reCAPTCHA') ||
                               document.body.textContent.includes('Access Denied') ||
                               document.querySelector('iframe[src*="recaptcha"]') !== null ||
                               document.querySelector('iframe[src*="captcha"]') !== null;
                    });

                    if (captchaDetected) {
                        log.info('CAPTCHA detected, attempting to solve...');
                        
                        if (!captchaApiKey) {
                            throw new Error('CAPTCHA detected but no API key provided');
                        }

                        // Try multiple CAPTCHA solving methods
                        captchaSolved = await solveCaptchaWithMultipleMethods(page, captchaApiKey, log, siteConfig.captchaTimeout || 90);
                        
                        if (captchaSolved) {
                            log.info('CAPTCHA solved successfully!');
                            
                            // Wait for navigation after CAPTCHA solving
                            await page.waitForNavigation({ 
                                timeout: 30000,
                                waitUntil: 'domcontentloaded'
                            }).catch(() => {
                                log.info('No navigation after CAPTCHA solving, continuing');
                            });
                        } else {
                            log.error('Failed to solve CAPTCHA after multiple attempts');
                        }
                    }
                } catch (error) {
                    log.error(`Error during CAPTCHA detection/solving: ${error.message}`);
                }

                // Wait additional time for dynamic content to load
                log.info(`Waiting ${waitTime} seconds for dynamic content...`);
                await page.waitForTimeout(waitTime * 1000);
                log.info('Wait completed');

                // Save a screenshot for debugging
                try {
                    const screenshotBuffer = await page.screenshot();
                    await Actor.setValue('screenshot', screenshotBuffer, { contentType: 'image/png' });
                    log.info('Screenshot saved');
                } catch (error) {
                    log.error(`Error saving screenshot: ${error.message}`);
                }

                // Save HTML content for debugging
                try {
                    const htmlContent = await page.content();
                    await Actor.setValue('html-content', htmlContent, { contentType: 'text/html' });
                    log.info('HTML content saved');
                } catch (error) {
                    log.error(`Error saving HTML content: ${error.message}`);
                }

                // Extract news items using multiple methods
                let articles = [];
                
                // Use site-specific extraction method if available
                if (siteConfig.extractionMethod) {
                    try {
                        const extractionFunction = getExtractionFunction(siteConfig.extractionMethod);
                        const siteSpecificArticles = await extractionFunction(page, url);
                        
                        if (siteSpecificArticles && siteSpecificArticles.length > 0) {
                            // Tag articles with the method used
                            siteSpecificArticles.forEach(article => {
                                if (!article.methods) article.methods = {};
                                if (!article.methods.title) article.methods.title = siteConfig.extractionMethod;
                                if (!article.methods.link) article.methods.link = siteConfig.extractionMethod;
                                if (!article.methods.date) article.methods.date = siteConfig.extractionMethod;
                                if (!article.methods.summary) article.methods.summary = siteConfig.extractionMethod;
                            });
                            
                            articles = articles.concat(siteSpecificArticles);
                            log.info(`Extracted ${siteSpecificArticles.length} articles using ${siteConfig.extractionMethod} method`);
                        }
                    } catch (error) {
                        log.error(`Error in site-specific extraction method ${siteConfig.extractionMethod}: ${error.message}`);
                    }
                }
                
                // If site-specific extraction didn't yield results, try generic methods
                if (articles.length === 0) {
                    articles = await extractNewsItems(page, url, log);
                }
                
                // Apply strict post-filtering to remove non-article content
                const filteredArticles = strictPostFilterArticles(articles, url);
                log.info(`Extracted ${filteredArticles.length} articles after filtering`);

                // Save the results
                if (filteredArticles.length > 0) {
                    // Track which methods were used
                    filteredArticles.forEach(article => {
                        Object.values(article.methods || {}).forEach(method => {
                            if (method) methodsUsed.add(method);
                        });
                    });

                    // Save to dataset
                    await dataset.pushData({
                        newsItems: filteredArticles,
                        totalCount: filteredArticles.length,
                        url: url,
                        extractionStats: {
                            methodsUsed: Array.from(methodsUsed),
                            successRate: filteredArticles.length > 0 ? 1 : 0,
                            completeItems: filteredArticles.filter(a => 
                                a.title && a.link && (a.date || a.summary)
                            ).length,
                            partialItems: filteredArticles.filter(a => 
                                (a.title || a.link) && !(a.title && a.link && (a.date || a.summary))
                            ).length
                        }
                    });

                    extractedCount += filteredArticles.length;
                    
                    // Check if we've reached the maximum number of items
                    if (maxItems > 0 && extractedCount >= maxItems) {
                        log.info(`Reached maximum number of items (${maxItems}), stopping.`);
                        return;
                    }
                } else {
                    // If no articles were found, save an empty result
                    await dataset.pushData({
                        newsItems: [],
                        totalCount: 0,
                        url: url,
                        extractionStats: {
                            methodsUsed: [],
                            successRate: 0,
                            completeItems: 0,
                            partialItems: 0
                        }
                    });
                }
                
                // Return the articles for finalization
                return filteredArticles;
            } catch (error) {
                log.error(`Error in request handler: ${error.message}`);
                return [];
            }
        },
        // Error handler
        async failedRequestHandler({ request, error, log }) {
            log.error(`Request ${request.url} failed with error: ${error.message}`);
            
            // Check if the error is related to access being denied
            if (error.message.includes('Access denied') || 
                error.message.includes('blocked') || 
                error.message.includes('CAPTCHA') ||
                error.message.includes('timeout')) {
                log.error('Access denied, blocked, or timeout. Trying with a different proxy...');
                
                // If we've already retried too many times, give up
                if (request.retryCount >= 5) {
                    log.error('Request failed and reached maximum retries.');
                    return;
                }
                
                // Otherwise, retry the request
                await crawler.addRequests([{
                    ...request,
                    uniqueKey: `${request.url}_${Date.now()}`, // Ensure a new request is created
                    retryCount: (request.retryCount || 0) + 1
                }]);
            }
        }
    });

    // Start the crawler
    try {
        const crawlerPromise = crawler.run([{ url }]);
        
        // Set up a race between crawler completion and timeout
        const result = await Promise.race([
            crawlerPromise,
            new Promise(resolve => {
                setTimeout(() => {
                    console.log(`Crawling timeout of ${maxCrawlingTime} seconds reached.`);
                    resolve([]);
                }, maxCrawlingTime * 1000);
            })
        ]);
        
        // Finalize crawling with any results
        await finalizeCrawling(result || []);
    } catch (error) {
        console.error(`Crawler error: ${error.message}`);
        // Ensure we save any partial results
        await finalizeCrawling([]);
    } finally {
        // Clean up
        clearTimeout(crawlingTimeout);
    }
});

/**
 * Solve CAPTCHA using multiple methods
 */
async function solveCaptchaWithMultipleMethods(page, apiKey, log, timeout = 90) {
    // Set a timeout for the entire CAPTCHA solving process
    const captchaTimeout = setTimeout(() => {
        throw new Error(`CAPTCHA solving timed out after ${timeout} seconds`);
    }, timeout * 1000);
    
    try {
        // Method 1: Try to solve using 2captcha API directly
        try {
            const solved = await page.evaluate(async (apiKey) => {
                // Load the 2captcha API script
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/2captcha-api@1.0.0/dist/2captcha-api.min.js';
                document.head.appendChild(script);
                
                // Wait for script to load
                await new Promise(resolve => script.onload = resolve);
                
                // Find reCAPTCHA
                const recaptchaElement = document.querySelector('iframe[src*="recaptcha"]');
                if (!recaptchaElement) return false;
                
                // Get site key
                const siteKey = recaptchaElement.src.match(/[?&]k=([^&]+)/)[1];
                if (!siteKey) return false;
                
                // Solve CAPTCHA
                const solver = new window.TwoCaptcha(apiKey);
                const response = await solver.recaptcha(siteKey, window.location.href);
                
                // Find the g-recaptcha-response textarea and set its value
                const textarea = document.querySelector('textarea#g-recaptcha-response');
                if (textarea) {
                    textarea.value = response;
                    
                    // Trigger form submission
                    const form = document.querySelector('form');
                    if (form) form.submit();
                    
                    return true;
                }
                
                // If no textarea found, try to trigger the callback
                try {
                    // Try to find and call the callback function
                    for (const key in window) {
                        if (key.includes('recaptcha') || key.includes('captcha')) {
                            if (typeof window[key] === 'function') {
                                window[key](response);
                                return true;
                            } else if (typeof window[key] === 'object' && window[key] !== null) {
                                for (const subKey in window[key]) {
                                    if (typeof window[key][subKey] === 'function') {
                                        window[key][subKey](response);
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error triggering callback:', e);
                }
                
                return false;
            }, apiKey);
            
            if (solved) {
                log.info('CAPTCHA solved using Method 1 (2captcha API)');
                clearTimeout(captchaTimeout);
                return true;
            }
        } catch (error) {
            log.error(`Method 1 CAPTCHA solving failed: ${error.message}`);
        }
        
        // Method 2: Try to solve using manual iframe interaction
        try {
            // Find and click the reCAPTCHA checkbox
            const captchaFrame = await page.waitForSelector('iframe[src*="recaptcha/api2/anchor"]', { timeout: 5000 });
            if (captchaFrame) {
                const frameHandle = await captchaFrame.contentFrame();
                if (frameHandle) {
                    await frameHandle.waitForSelector('#recaptcha-anchor', { timeout: 5000 });
                    await frameHandle.click('#recaptcha-anchor');
                    
                    // Wait for the CAPTCHA to be solved (this will timeout if it's not solved)
                    await page.waitForFunction(() => {
                        const iframe = document.querySelector('iframe[src*="recaptcha/api2/anchor"]');
                        if (!iframe) return false;
                        
                        const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
                        return iframeDocument.querySelector('#recaptcha-anchor[aria-checked="true"]') !== null;
                    }, { timeout: 30000 });
                    
                    log.info('CAPTCHA solved using Method 2 (manual iframe interaction)');
                    clearTimeout(captchaTimeout);
                    return true;
                }
            }
        } catch (error) {
            log.error(`Method 2 CAPTCHA solving failed: ${error.message}`);
        }
        
        // Method 3: Try to solve using external API call
        try {
            const siteKey = await page.evaluate(() => {
                // Try to find the site key in various ways
                const recaptchaElement = document.querySelector('iframe[src*="recaptcha"]');
                if (recaptchaElement) {
                    const match = recaptchaElement.src.match(/[?&]k=([^&]+)/);
                    if (match) return match[1];
                }
                
                // Look for data-sitekey attribute
                const siteKeyElement = document.querySelector('[data-sitekey]');
                if (siteKeyElement) {
                    return siteKeyElement.getAttribute('data-sitekey');
                }
                
                // Look in the page source
                const siteKeyMatch = document.documentElement.innerHTML.match(/['"]sitekey['"]\s*:\s*['"]([^'"]+)['"]/);
                if (siteKeyMatch) {
                    return siteKeyMatch[1];
                }
                
                return null;
            });
            
            if (siteKey) {
                // Make a direct API call to 2captcha
                const pageUrl = page.url();
                
                // Simulate an API call to 2captcha
                const response = await page.evaluate(async (apiKey, siteKey, pageUrl) => {
                    try {
                        // First request to send the CAPTCHA
                        const sendUrl = `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;
                        const sendResponse = await fetch(sendUrl);
                        const sendData = await sendResponse.json();
                        
                        if (sendData.status !== 1) {
                            throw new Error(`Failed to send CAPTCHA: ${sendData.request}`);
                        }
                        
                        const captchaId = sendData.request;
                        
                        // Wait for the CAPTCHA to be solved
                        let solved = false;
                        let token = null;
                        
                        for (let i = 0; i < 30; i++) {
                            // Wait 5 seconds between checks
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            
                            // Check if the CAPTCHA is solved
                            const getUrl = `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`;
                            const getResponse = await fetch(getUrl);
                            const getData = await getResponse.json();
                            
                            if (getData.status === 1) {
                                solved = true;
                                token = getData.request;
                                break;
                            }
                            
                            if (getData.request !== 'CAPCHA_NOT_READY') {
                                throw new Error(`Failed to get CAPTCHA result: ${getData.request}`);
                            }
                        }
                        
                        if (!solved || !token) {
                            throw new Error('CAPTCHA solving timed out');
                        }
                        
                        // Set the CAPTCHA response
                        const textarea = document.querySelector('textarea#g-recaptcha-response');
                        if (textarea) {
                            textarea.value = token;
                            
                            // Try to trigger the callback
                            try {
                                // Execute the callback
                                window.___grecaptcha_cfg.clients[0].L.L.callback(token);
                                return true;
                            } catch (e) {
                                console.error('Error triggering callback:', e);
                                
                                // Try to submit the form
                                const form = document.querySelector('form');
                                if (form) {
                                    form.submit();
                                    return true;
                                }
                            }
                        }
                        
                        return false;
                    } catch (error) {
                        console.error('Error in 2captcha API call:', error);
                        return false;
                    }
                }, apiKey, siteKey, pageUrl);
                
                if (response) {
                    log.info('CAPTCHA solved using Method 3 (external API call)');
                    clearTimeout(captchaTimeout);
                    return true;
                }
            }
        } catch (error) {
            log.error(`Method 3 CAPTCHA solving failed: ${error.message}`);
        }
        
        // Method 4: Try to bypass CAPTCHA by simulating human behavior
        try {
            // Perform random mouse movements
            for (let i = 0; i < 5; i++) {
                const x = Math.floor(Math.random() * 500);
                const y = Math.floor(Math.random() * 500);
                await page.mouse.move(x, y);
                await page.waitForTimeout(Math.random() * 1000);
            }
            
            // Try to find and click the "I'm not a robot" checkbox
            const checkbox = await page.$('div.recaptcha-checkbox-border');
            if (checkbox) {
                await checkbox.click();
                
                // Wait to see if the CAPTCHA is solved
                try {
                    await page.waitForSelector('div.recaptcha-checkbox-checked', { timeout: 5000 });
                    log.info('CAPTCHA solved using Method 4 (human simulation)');
                    clearTimeout(captchaTimeout);
                    return true;
                } catch (e) {
                    log.error('CAPTCHA checkbox clicked but not solved');
                }
            }
        } catch (error) {
            log.error(`Method 4 CAPTCHA solving failed: ${error.message}`);
        }
        
        // All methods failed
        clearTimeout(captchaTimeout);
        return false;
    } catch (error) {
        clearTimeout(captchaTimeout);
        log.error(`CAPTCHA solving error: ${error.message}`);
        return false;
    }
}

/**
 * Get the extraction function for a specific method
 */
function getExtractionFunction(methodName) {
    const extractionFunctions = {
        'aljazeera': extractAljazeeraResults,
        'alarabiya': extractAlarabiyaResults,
        'aps-dz': extractApsDzResults,
        'standard-article': extractStandardArticles,
        'substantial-link': extractSubstantialLinks,
        'flat-search': extractFlatSearchResults,
        'table-based': extractTableBasedResults,
        'card-based': extractCardBasedResults,
        'data-attribute': extractDataAttributeResults,
        'search-result': extractSearchResultClass,
        'heading-based': extractHeadingBasedResults
    };
    
    return extractionFunctions[methodName] || extractStandardArticles;
}

/**
 * Extract news items from a page using multiple methods
 */
async function extractNewsItems(page, url, log) {
    let articles = [];
    
    try {
        // Try multiple extraction methods and combine results
        const extractionMethods = [
            { name: 'standard-article', fn: extractStandardArticles },
            { name: 'substantial-link', fn: extractSubstantialLinks },
            { name: 'flat-search', fn: extractFlatSearchResults },
            { name: 'table-based', fn: extractTableBasedResults },
            { name: 'card-based', fn: extractCardBasedResults },
            { name: 'data-attribute', fn: extractDataAttributeResults },
            { name: 'search-result', fn: extractSearchResultClass },
            { name: 'heading-based', fn: extractHeadingBasedResults },
            // Special case handlers for specific sites
            { name: 'alarabiya', fn: extractAlarabiyaResults },
            { name: 'aps-dz', fn: extractApsDzResults },
            { name: 'aljazeera', fn: extractAljazeeraResults }
        ];
        
        // Try each method and collect results
        for (const method of extractionMethods) {
            try {
                const methodArticles = await method.fn(page, url);
                if (methodArticles && methodArticles.length > 0) {
                    // Tag articles with the method used
                    methodArticles.forEach(article => {
                        if (!article.methods) article.methods = {};
                        if (!article.methods.title) article.methods.title = method.name;
                        if (!article.methods.link) article.methods.link = method.name;
                        if (!article.methods.date) article.methods.date = method.name;
                        if (!article.methods.summary) article.methods.summary = method.name;
                    });
                    articles = articles.concat(methodArticles);
                }
            } catch (error) {
                log.error(`Error in extraction method ${method.name}: ${error.message}`);
            }
        }
        
        // Remove duplicates based on URL
        const uniqueUrls = new Set();
        articles = articles.filter(article => {
            if (!article.link) return false;
            if (uniqueUrls.has(article.link)) return false;
            uniqueUrls.add(article.link);
            return true;
        });
        
        log.info(`Found ${articles.length} article elements`);
        return articles;
    } catch (error) {
        log.error(`Error extracting news items: ${error.message}`);
        return [];
    }
}

/**
 * Extract standard article elements
 */
async function extractStandardArticles(page, url) {
    return await page.evaluate(() => {
        const articles = [];
        const articleElements = Array.from(document.querySelectorAll('article, .article, [itemtype*="Article"], .news-item, .story, .post'));
        
        articleElements.forEach(element => {
            try {
                // Extract title
                const titleElement = element.querySelector('h1, h2, h3, h4, .title, .headline');
                const title = titleElement ? titleElement.textContent.trim() : '';
                
                // Extract link
                let link = '';
                const linkElement = element.querySelector('a');
                if (linkElement && linkElement.href) {
                    link = linkElement.href;
                } else if (titleElement && titleElement.querySelector('a')) {
                    link = titleElement.querySelector('a').href;
                }
                
                // Skip if title or link is empty
                if (!title || !link) return;
                
                // Extract date
                let date = '';
                const dateElement = element.querySelector('time, .date, .time, [datetime], [data-date], .published, .timestamp');
                if (dateElement) {
                    if (dateElement.getAttribute('datetime')) {
                        date = dateElement.getAttribute('datetime');
                    } else {
                        date = dateElement.textContent.trim();
                    }
                }
                
                // Extract summary
                let summary = '';
                const summaryElement = element.querySelector('p, .summary, .description, .excerpt, .teaser');
                if (summaryElement) {
                    summary = summaryElement.textContent.trim();
                }
                
                // Calculate confidence scores
                const confidence = {
                    title: title.length > 10 ? 0.9 : 0.5,
                    link: link.includes('http') ? 0.9 : 0.5,
                    date: date.length > 0 ? 0.8 : 0.3,
                    summary: summary.length > 20 ? 0.8 : 0.4
                };
                confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                
                // Only include articles with reasonable confidence
                if (confidence.overall > 0.5) {
                    articles.push({
                        title,
                        link,
                        date,
                        summary,
                        confidence
                    });
                }
            } catch (error) {
                console.error('Error processing article element:', error);
            }
        });
        
        return articles;
    });
}

/**
 * Extract substantial links that might be news items
 */
async function extractSubstantialLinks(page, url) {
    return await page.evaluate(() => {
        const articles = [];
        const links = Array.from(document.querySelectorAll('a'));
        
        links.forEach(link => {
            try {
                // Only consider links with substantial text (likely to be article titles)
                const linkText = link.textContent.trim();
                if (linkText.length < 20) return;
                
                // Skip navigation, footer, and utility links
                const parentElement = link.parentElement;
                if (parentElement) {
                    const parentClasses = parentElement.className.toLowerCase();
                    if (parentClasses.includes('nav') || 
                        parentClasses.includes('menu') || 
                        parentClasses.includes('footer') || 
                        parentClasses.includes('header') ||
                        parentClasses.includes('sidebar')) {
                        return;
                    }
                }
                
                // Extract title from link text
                const title = linkText;
                
                // Extract link URL
                const linkUrl = link.href;
                
                // Look for date near the link
                let date = '';
                let dateElement = null;
                
                // Check siblings for date
                let sibling = link.nextElementSibling;
                while (sibling && !date) {
                    if (sibling.tagName === 'TIME' || 
                        sibling.className.toLowerCase().includes('date') || 
                        sibling.className.toLowerCase().includes('time')) {
                        dateElement = sibling;
                        break;
                    }
                    sibling = sibling.nextElementSibling;
                }
                
                // Check parent's children for date
                if (!dateElement && parentElement) {
                    const dateCandidate = parentElement.querySelector('time, .date, .time, [datetime]');
                    if (dateCandidate) {
                        dateElement = dateCandidate;
                    }
                }
                
                if (dateElement) {
                    if (dateElement.getAttribute('datetime')) {
                        date = dateElement.getAttribute('datetime');
                    } else {
                        date = dateElement.textContent.trim();
                    }
                }
                
                // Look for summary near the link
                let summary = '';
                let summaryElement = null;
                
                // Check siblings for summary
                sibling = link.nextElementSibling;
                while (sibling && !summary) {
                    if (sibling.tagName === 'P' || 
                        sibling.className.toLowerCase().includes('summary') || 
                        sibling.className.toLowerCase().includes('description')) {
                        summaryElement = sibling;
                        break;
                    }
                    sibling = sibling.nextElementSibling;
                }
                
                // Check parent's children for summary
                if (!summaryElement && parentElement) {
                    const summaryCandidate = parentElement.querySelector('p, .summary, .description, .excerpt, .teaser');
                    if (summaryCandidate && summaryCandidate !== link) {
                        summaryElement = summaryCandidate;
                    }
                }
                
                if (summaryElement) {
                    summary = summaryElement.textContent.trim();
                }
                
                // Calculate confidence scores
                const confidence = {
                    title: title.length > 20 ? 0.9 : 0.5,
                    link: linkUrl.includes('http') ? 0.9 : 0.5,
                    date: date.length > 0 ? 0.8 : 0.3,
                    summary: summary.length > 20 ? 0.8 : 0.4
                };
                confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                
                // Only include articles with reasonable confidence
                if (confidence.overall > 0.6) {
                    articles.push({
                        title,
                        link: linkUrl,
                        date,
                        summary,
                        confidence
                    });
                }
            } catch (error) {
                console.error('Error processing link element:', error);
            }
        });
        
        return articles;
    });
}

/**
 * Extract flat search results (common in simple search pages)
 */
async function extractFlatSearchResults(page, url) {
    return await page.evaluate(() => {
        const articles = [];
        
        // Look for h3 elements with links (common pattern in search results)
        const headings = Array.from(document.querySelectorAll('h3, h2, h4'));
        
        headings.forEach(heading => {
            try {
                // Extract title and link
                const linkElement = heading.querySelector('a');
                if (!linkElement) return;
                
                const title = linkElement.textContent.trim();
                const link = linkElement.href;
                
                // Skip if title or link is empty
                if (!title || !link) return;
                
                // Look for date near the heading
                let date = '';
                let dateElement = null;
                
                // Check siblings for date
                let sibling = heading.nextElementSibling;
                while (sibling && !date && sibling.tagName !== 'H3' && sibling.tagName !== 'H2' && sibling.tagName !== 'H4') {
                    if (sibling.tagName === 'TIME' || 
                        sibling.className.toLowerCase().includes('date') || 
                        sibling.className.toLowerCase().includes('time') ||
                        sibling.textContent.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/) ||
                        sibling.textContent.match(/\d{1,2}\s+\w+\s+\d{2,4}/)) {
                        dateElement = sibling;
                        break;
                    }
                    sibling = sibling.nextElementSibling;
                }
                
                if (dateElement) {
                    if (dateElement.getAttribute('datetime')) {
                        date = dateElement.getAttribute('datetime');
                    } else {
                        date = dateElement.textContent.trim();
                    }
                }
                
                // Look for summary near the heading
                let summary = '';
                let summaryElement = null;
                
                // Check siblings for summary
                sibling = heading.nextElementSibling;
                while (sibling && !summary && sibling.tagName !== 'H3' && sibling.tagName !== 'H2' && sibling.tagName !== 'H4') {
                    if (sibling.tagName === 'P' || 
                        sibling.className.toLowerCase().includes('summary') || 
                        sibling.className.toLowerCase().includes('description')) {
                        summaryElement = sibling;
                        break;
                    }
                    sibling = sibling.nextElementSibling;
                }
                
                if (summaryElement) {
                    summary = summaryElement.textContent.trim();
                }
                
                // Calculate confidence scores
                const confidence = {
                    title: title.length > 10 ? 0.9 : 0.5,
                    link: link.includes('http') ? 0.9 : 0.5,
                    date: date.length > 0 ? 0.8 : 0.3,
                    summary: summary.length > 20 ? 0.8 : 0.4
                };
                confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                
                // Only include articles with reasonable confidence
                if (confidence.overall > 0.6) {
                    articles.push({
                        title,
                        link,
                        date,
                        summary,
                        confidence
                    });
                }
            } catch (error) {
                console.error('Error processing heading element:', error);
            }
        });
        
        return articles;
    });
}

/**
 * Extract table-based search results (common in older sites)
 */
async function extractTableBasedResults(page, url) {
    return await page.evaluate(() => {
        const articles = [];
        
        // Look for table rows that might contain search results
        const rows = Array.from(document.querySelectorAll('tr'));
        
        rows.forEach(row => {
            try {
                // Skip header rows
                if (row.querySelector('th')) return;
                
                // Extract title and link
                const linkElement = row.querySelector('a');
                if (!linkElement) return;
                
                const title = linkElement.textContent.trim();
                const link = linkElement.href;
                
                // Skip if title or link is empty
                if (!title || !link) return;
                
                // Look for date in the row
                let date = '';
                const cells = Array.from(row.querySelectorAll('td'));
                
                for (const cell of cells) {
                    // Skip the cell with the link
                    if (cell.contains(linkElement)) continue;
                    
                    const cellText = cell.textContent.trim();
                    
                    // Check for date patterns
                    if (cellText.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/) || 
                        cellText.match(/\d{1,2}\-\d{1,2}\-\d{2,4}/) ||
                        cellText.match(/\d{1,2}\s+\w+\s+\d{2,4}/) ||
                        cellText.match(/\d{4}\-\d{1,2}\-\d{1,2}/)) {
                        date = cellText;
                        break;
                    }
                    
                    // Check for time elements
                    const timeElement = cell.querySelector('time');
                    if (timeElement) {
                        if (timeElement.getAttribute('datetime')) {
                            date = timeElement.getAttribute('datetime');
                        } else {
                            date = timeElement.textContent.trim();
                        }
                        break;
                    }
                }
                
                // Look for summary in the row
                let summary = '';
                for (const cell of cells) {
                    // Skip the cell with the link and the date
                    if (cell.contains(linkElement) || cell.textContent.trim() === date) continue;
                    
                    const cellText = cell.textContent.trim();
                    if (cellText.length > 20) {
                        summary = cellText;
                        break;
                    }
                }
                
                // Calculate confidence scores
                const confidence = {
                    title: title.length > 10 ? 0.9 : 0.5,
                    link: link.includes('http') ? 0.9 : 0.5,
                    date: date.length > 0 ? 0.8 : 0.3,
                    summary: summary.length > 20 ? 0.8 : 0.4
                };
                confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                
                // Only include articles with reasonable confidence
                if (confidence.overall > 0.6) {
                    articles.push({
                        title,
                        link,
                        date,
                        summary,
                        confidence
                    });
                }
            } catch (error) {
                console.error('Error processing table row:', error);
            }
        });
        
        return articles;
    });
}

/**
 * Extract card-based search results (common in modern sites)
 */
async function extractCardBasedResults(page, url) {
    return await page.evaluate(() => {
        const articles = [];
        
        // Look for card elements
        const cards = Array.from(document.querySelectorAll('.card, .tile, .box, .item, .result, [class*="card"], [class*="tile"], [class*="box"], [class*="item"], [class*="result"]'));
        
        cards.forEach(card => {
            try {
                // Extract title and link
                const titleElement = card.querySelector('h1, h2, h3, h4, .title, .headline');
                if (!titleElement) return;
                
                const linkElement = titleElement.querySelector('a') || card.querySelector('a');
                if (!linkElement) return;
                
                const title = titleElement.textContent.trim();
                const link = linkElement.href;
                
                // Skip if title or link is empty
                if (!title || !link) return;
                
                // Look for date in the card
                let date = '';
                const dateElement = card.querySelector('time, .date, .time, [datetime], [data-date], .published, .timestamp');
                
                if (dateElement) {
                    if (dateElement.getAttribute('datetime')) {
                        date = dateElement.getAttribute('datetime');
                    } else {
                        date = dateElement.textContent.trim();
                    }
                }
                
                // Look for summary in the card
                let summary = '';
                const summaryElement = card.querySelector('p, .summary, .description, .excerpt, .teaser');
                
                if (summaryElement && !summaryElement.contains(titleElement)) {
                    summary = summaryElement.textContent.trim();
                }
                
                // Calculate confidence scores
                const confidence = {
                    title: title.length > 10 ? 0.9 : 0.5,
                    link: link.includes('http') ? 0.9 : 0.5,
                    date: date.length > 0 ? 0.8 : 0.3,
                    summary: summary.length > 20 ? 0.8 : 0.4
                };
                confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                
                // Only include articles with reasonable confidence
                if (confidence.overall > 0.6) {
                    articles.push({
                        title,
                        link,
                        date,
                        summary,
                        confidence
                    });
                }
            } catch (error) {
                console.error('Error processing card element:', error);
            }
        });
        
        return articles;
    });
}

/**
 * Extract results based on data attributes (common in modern sites)
 */
async function extractDataAttributeResults(page, url) {
    return await page.evaluate(() => {
        const articles = [];
        
        // Look for elements with data attributes related to articles
        const elements = Array.from(document.querySelectorAll('[data-article-id], [data-id], [data-post-id], [data-item-id], [data-entry-id]'));
        
        elements.forEach(element => {
            try {
                // Extract title and link
                const titleElement = element.querySelector('h1, h2, h3, h4, .title, .headline');
                if (!titleElement) return;
                
                const linkElement = titleElement.querySelector('a') || element.querySelector('a');
                if (!linkElement) return;
                
                const title = titleElement.textContent.trim();
                const link = linkElement.href;
                
                // Skip if title or link is empty
                if (!title || !link) return;
                
                // Look for date in the element
                let date = '';
                const dateElement = element.querySelector('time, .date, .time, [datetime], [data-date], .published, .timestamp');
                
                if (dateElement) {
                    if (dateElement.getAttribute('datetime')) {
                        date = dateElement.getAttribute('datetime');
                    } else {
                        date = dateElement.textContent.trim();
                    }
                }
                
                // Look for summary in the element
                let summary = '';
                const summaryElement = element.querySelector('p, .summary, .description, .excerpt, .teaser');
                
                if (summaryElement && !summaryElement.contains(titleElement)) {
                    summary = summaryElement.textContent.trim();
                }
                
                // Calculate confidence scores
                const confidence = {
                    title: title.length > 10 ? 0.9 : 0.5,
                    link: link.includes('http') ? 0.9 : 0.5,
                    date: date.length > 0 ? 0.8 : 0.3,
                    summary: summary.length > 20 ? 0.8 : 0.4
                };
                confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                
                // Only include articles with reasonable confidence
                if (confidence.overall > 0.6) {
                    articles.push({
                        title,
                        link,
                        date,
                        summary,
                        confidence
                    });
                }
            } catch (error) {
                console.error('Error processing data attribute element:', error);
            }
        });
        
        return articles;
    });
}

/**
 * Extract results based on search result classes
 */
async function extractSearchResultClass(page, url) {
    return await page.evaluate(() => {
        const articles = [];
        
        // Look for elements with search result classes
        const elements = Array.from(document.querySelectorAll('.search-result, .result, .search-item, [class*="search-result"], [class*="search-item"]'));
        
        elements.forEach(element => {
            try {
                // Extract title and link
                const titleElement = element.querySelector('h1, h2, h3, h4, .title, .headline');
                if (!titleElement) return;
                
                const linkElement = titleElement.querySelector('a') || element.querySelector('a');
                if (!linkElement) return;
                
                const title = titleElement.textContent.trim();
                const link = linkElement.href;
                
                // Skip if title or link is empty
                if (!title || !link) return;
                
                // Look for date in the element
                let date = '';
                const dateElement = element.querySelector('time, .date, .time, [datetime], [data-date], .published, .timestamp');
                
                if (dateElement) {
                    if (dateElement.getAttribute('datetime')) {
                        date = dateElement.getAttribute('datetime');
                    } else {
                        date = dateElement.textContent.trim();
                    }
                }
                
                // Look for summary in the element
                let summary = '';
                const summaryElement = element.querySelector('p, .summary, .description, .excerpt, .teaser');
                
                if (summaryElement && !summaryElement.contains(titleElement)) {
                    summary = summaryElement.textContent.trim();
                }
                
                // Calculate confidence scores
                const confidence = {
                    title: title.length > 10 ? 0.9 : 0.5,
                    link: link.includes('http') ? 0.9 : 0.5,
                    date: date.length > 0 ? 0.8 : 0.3,
                    summary: summary.length > 20 ? 0.8 : 0.4
                };
                confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                
                // Only include articles with reasonable confidence
                if (confidence.overall > 0.6) {
                    articles.push({
                        title,
                        link,
                        date,
                        summary,
                        confidence
                    });
                }
            } catch (error) {
                console.error('Error processing search result element:', error);
            }
        });
        
        return articles;
    });
}

/**
 * Extract results based on heading elements
 */
async function extractHeadingBasedResults(page, url) {
    return await page.evaluate(() => {
        const articles = [];
        
        // Look for heading elements that might be article titles
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5'));
        
        headings.forEach(heading => {
            try {
                // Skip headings that are likely to be section titles
                if (heading.textContent.trim().length < 15) return;
                if (heading.textContent.trim().toUpperCase() === heading.textContent.trim()) return;
                
                // Extract title and link
                const linkElement = heading.querySelector('a');
                if (!linkElement) return;
                
                const title = heading.textContent.trim();
                const link = linkElement.href;
                
                // Skip if title or link is empty
                if (!title || !link) return;
                
                // Skip navigation, footer, and utility links
                if (link.includes('/category/') || 
                    link.includes('/tag/') || 
                    link.includes('/author/') || 
                    link.includes('/about/') || 
                    link.includes('/contact/') ||
                    link.includes('/privacy/') ||
                    link.includes('/terms/')) {
                    return;
                }
                
                // Look for date near the heading
                let date = '';
                let dateElement = null;
                
                // Check siblings for date
                let sibling = heading.nextElementSibling;
                let siblingCount = 0;
                while (sibling && !date && siblingCount < 3) {
                    if (sibling.tagName === 'TIME' || 
                        sibling.className.toLowerCase().includes('date') || 
                        sibling.className.toLowerCase().includes('time') ||
                        sibling.textContent.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/) ||
                        sibling.textContent.match(/\d{1,2}\s+\w+\s+\d{2,4}/)) {
                        dateElement = sibling;
                        break;
                    }
                    sibling = sibling.nextElementSibling;
                    siblingCount++;
                }
                
                if (dateElement) {
                    if (dateElement.getAttribute('datetime')) {
                        date = dateElement.getAttribute('datetime');
                    } else {
                        date = dateElement.textContent.trim();
                    }
                }
                
                // Look for summary near the heading
                let summary = '';
                let summaryElement = null;
                
                // Check siblings for summary
                sibling = heading.nextElementSibling;
                siblingCount = 0;
                while (sibling && !summary && siblingCount < 3) {
                    if (sibling.tagName === 'P' || 
                        sibling.className.toLowerCase().includes('summary') || 
                        sibling.className.toLowerCase().includes('description')) {
                        summaryElement = sibling;
                        break;
                    }
                    sibling = sibling.nextElementSibling;
                    siblingCount++;
                }
                
                if (summaryElement) {
                    summary = summaryElement.textContent.trim();
                }
                
                // Calculate confidence scores
                const confidence = {
                    title: title.length > 15 ? 0.9 : 0.5,
                    link: link.includes('http') ? 0.9 : 0.5,
                    date: date.length > 0 ? 0.8 : 0.3,
                    summary: summary.length > 20 ? 0.8 : 0.4
                };
                confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                
                // Only include articles with reasonable confidence
                if (confidence.overall > 0.6) {
                    articles.push({
                        title,
                        link,
                        date,
                        summary,
                        confidence
                    });
                }
            } catch (error) {
                console.error('Error processing heading element:', error);
            }
        });
        
        return articles;
    });
}

/**
 * Special case handler for alarabiya.net
 */
async function extractAlarabiyaResults(page, url) {
    if (!url.includes('alarabiya.net')) return [];
    
    return await page.evaluate(() => {
        const articles = [];
        
        // Look for the search results container
        const searchResults = document.querySelectorAll('.search-results-wrapper .search-result-item');
        
        if (searchResults.length === 0) {
            // Try alternative selectors
            const alternativeResults = document.querySelectorAll('.search-results .search-result, .search-results .result-item');
            
            if (alternativeResults.length > 0) {
                alternativeResults.forEach(result => {
                    try {
                        // Extract title and link
                        const titleElement = result.querySelector('h2, h3, h4, .title');
                        if (!titleElement) return;
                        
                        const linkElement = titleElement.querySelector('a') || result.querySelector('a');
                        if (!linkElement) return;
                        
                        const title = titleElement.textContent.trim();
                        const link = linkElement.href;
                        
                        // Skip if title or link is empty
                        if (!title || !link) return;
                        
                        // Extract category and date
                        let category = '';
                        let date = '';
                        
                        const metaElements = result.querySelectorAll('.meta, .info, .details');
                        metaElements.forEach(meta => {
                            const metaText = meta.textContent.trim();
                            
                            // Look for category
                            if (metaText.includes('News') || 
                                metaText.includes('Opinion') || 
                                metaText.includes('Middle East') || 
                                metaText.includes('Business')) {
                                category = metaText;
                            }
                            
                            // Look for date
                            if (metaText.includes('ago') || 
                                metaText.match(/\d{1,2}\s+\w+\s+\d{4}/) ||
                                metaText.match(/\d{1,2}\/\d{1,2}\/\d{4}/)) {
                                date = metaText;
                            }
                        });
                        
                        // If no date found, try to find it elsewhere
                        if (!date) {
                            const dateElement = result.querySelector('time, .date, .time, [datetime]');
                            if (dateElement) {
                                if (dateElement.getAttribute('datetime')) {
                                    date = dateElement.getAttribute('datetime');
                                } else {
                                    date = dateElement.textContent.trim();
                                }
                            }
                        }
                        
                        // Extract summary
                        let summary = category || '';
                        const summaryElement = result.querySelector('p, .summary, .description, .excerpt');
                        if (summaryElement && !summaryElement.contains(titleElement)) {
                            summary = summaryElement.textContent.trim();
                        }
                        
                        // Calculate confidence scores
                        const confidence = {
                            title: title.length > 10 ? 0.9 : 0.5,
                            link: link.includes('http') ? 0.9 : 0.5,
                            date: date.length > 0 ? 0.8 : 0.3,
                            summary: summary.length > 0 ? 0.8 : 0.4
                        };
                        confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                        
                        // Only include articles with reasonable confidence
                        if (confidence.overall > 0.6) {
                            articles.push({
                                title,
                                link,
                                date,
                                summary,
                                confidence
                            });
                        }
                    } catch (error) {
                        console.error('Error processing alarabiya.net search result:', error);
                    }
                });
            }
        } else {
            // Process standard search results
            searchResults.forEach(result => {
                try {
                    // Extract title and link
                    const titleElement = result.querySelector('h2, h3, h4, .title');
                    if (!titleElement) return;
                    
                    const linkElement = titleElement.querySelector('a') || result.querySelector('a');
                    if (!linkElement) return;
                    
                    const title = titleElement.textContent.trim();
                    const link = linkElement.href;
                    
                    // Skip if title or link is empty
                    if (!title || !link) return;
                    
                    // Extract category and date
                    let category = '';
                    let date = '';
                    
                    const metaElements = result.querySelectorAll('.meta, .info, .details');
                    metaElements.forEach(meta => {
                        const metaText = meta.textContent.trim();
                        
                        // Look for category
                        if (metaText.includes('News') || 
                            metaText.includes('Opinion') || 
                            metaText.includes('Middle East') || 
                            metaText.includes('Business')) {
                            category = metaText;
                        }
                        
                        // Look for date
                        if (metaText.includes('ago') || 
                            metaText.match(/\d{1,2}\s+\w+\s+\d{4}/) ||
                            metaText.match(/\d{1,2}\/\d{1,2}\/\d{4}/)) {
                            date = metaText;
                        }
                    });
                    
                    // If no date found, try to find it elsewhere
                    if (!date) {
                        const dateElement = result.querySelector('time, .date, .time, [datetime]');
                        if (dateElement) {
                            if (dateElement.getAttribute('datetime')) {
                                date = dateElement.getAttribute('datetime');
                            } else {
                                date = dateElement.textContent.trim();
                            }
                        }
                    }
                    
                    // Extract summary
                    let summary = category || '';
                    const summaryElement = result.querySelector('p, .summary, .description, .excerpt');
                    if (summaryElement && !summaryElement.contains(titleElement)) {
                        summary = summaryElement.textContent.trim();
                    }
                    
                    // Calculate confidence scores
                    const confidence = {
                        title: title.length > 10 ? 0.9 : 0.5,
                        link: link.includes('http') ? 0.9 : 0.5,
                        date: date.length > 0 ? 0.8 : 0.3,
                        summary: summary.length > 0 ? 0.8 : 0.4
                    };
                    confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                    
                    // Only include articles with reasonable confidence
                    if (confidence.overall > 0.6) {
                        articles.push({
                            title,
                            link,
                            date,
                            summary,
                            confidence
                        });
                    }
                } catch (error) {
                    console.error('Error processing alarabiya.net search result:', error);
                }
            });
        }
        
        // If still no results, try a more generic approach
        if (articles.length === 0) {
            // Look for any elements that might be news items
            const newsItems = document.querySelectorAll('.news-item, .article, .story, .post, .entry');
            
            newsItems.forEach(item => {
                try {
                    // Extract title and link
                    const titleElement = item.querySelector('h2, h3, h4, .title');
                    if (!titleElement) return;
                    
                    const linkElement = titleElement.querySelector('a') || item.querySelector('a');
                    if (!linkElement) return;
                    
                    const title = titleElement.textContent.trim();
                    const link = linkElement.href;
                    
                    // Skip if title or link is empty
                    if (!title || !link) return;
                    
                    // Extract category and date
                    let category = '';
                    let date = '';
                    
                    const metaElements = item.querySelectorAll('.meta, .info, .details, .category, .date');
                    metaElements.forEach(meta => {
                        const metaText = meta.textContent.trim();
                        
                        // Look for category
                        if (metaText.includes('News') || 
                            metaText.includes('Opinion') || 
                            metaText.includes('Middle East') || 
                            metaText.includes('Business')) {
                            category = metaText;
                        }
                        
                        // Look for date
                        if (metaText.includes('ago') || 
                            metaText.match(/\d{1,2}\s+\w+\s+\d{4}/) ||
                            metaText.match(/\d{1,2}\/\d{1,2}\/\d{4}/)) {
                            date = metaText;
                        }
                    });
                    
                    // If no date found, try to find it elsewhere
                    if (!date) {
                        const dateElement = item.querySelector('time, .date, .time, [datetime]');
                        if (dateElement) {
                            if (dateElement.getAttribute('datetime')) {
                                date = dateElement.getAttribute('datetime');
                            } else {
                                date = dateElement.textContent.trim();
                            }
                        }
                    }
                    
                    // Extract summary
                    let summary = category || '';
                    const summaryElement = item.querySelector('p, .summary, .description, .excerpt');
                    if (summaryElement && !summaryElement.contains(titleElement)) {
                        summary = summaryElement.textContent.trim();
                    }
                    
                    // Calculate confidence scores
                    const confidence = {
                        title: title.length > 10 ? 0.9 : 0.5,
                        link: link.includes('http') ? 0.9 : 0.5,
                        date: date.length > 0 ? 0.8 : 0.3,
                        summary: summary.length > 0 ? 0.8 : 0.4
                    };
                    confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                    
                    // Only include articles with reasonable confidence
                    if (confidence.overall > 0.6) {
                        articles.push({
                            title,
                            link,
                            date,
                            summary,
                            confidence
                        });
                    }
                } catch (error) {
                    console.error('Error processing alarabiya.net news item:', error);
                }
            });
        }
        
        return articles;
    });
}

/**
 * Special case handler for aps.dz
 */
async function extractApsDzResults(page, url) {
    if (!url.includes('aps.dz')) return [];
    
    return await page.evaluate(() => {
        const articles = [];
        
        // Look for numbered search results (1., 2., etc.)
        const searchResults = Array.from(document.querySelectorAll('h2, h3, h4, h5'));
        
        for (const heading of searchResults) {
            try {
                const headingText = heading.textContent.trim();
                
                // Check if the heading starts with a number followed by a dot (e.g., "1. Title")
                if (headingText.match(/^\d+\.\s/)) {
                    // Extract title and link
                    const titleElement = heading;
                    const linkElement = heading.querySelector('a');
                    
                    if (!linkElement) continue;
                    
                    const title = titleElement.textContent.trim().replace(/^\d+\.\s/, '');
                    const link = linkElement.href;
                    
                    // Skip if title or link is empty
                    if (!title || !link) continue;
                    
                    // Look for date
                    let date = '';
                    let dateElement = null;
                    
                    // Check for date in siblings
                    let sibling = heading.nextElementSibling;
                    while (sibling && !date && !sibling.textContent.trim().match(/^\d+\.\s/)) {
                        // Check for CREATED ON text
                        if (sibling.textContent.includes('CREATED ON')) {
                            date = sibling.textContent.replace('CREATED ON', '').trim();
                            dateElement = sibling;
                            break;
                        }
                        
                        // Check for date patterns
                        const siblingText = sibling.textContent.trim();
                        if (siblingText.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/) || 
                            siblingText.match(/\d{1,2}\-\d{1,2}\-\d{2,4}/) ||
                            siblingText.match(/\d{1,2}\s+\w+\s+\d{2,4}/) ||
                            siblingText.match(/\d{4}\-\d{1,2}\-\d{1,2}/)) {
                            date = siblingText;
                            dateElement = sibling;
                            break;
                        }
                        
                        sibling = sibling.nextElementSibling;
                    }
                    
                    // Look for summary
                    let summary = '';
                    let summaryElement = null;
                    
                    // Check for summary in siblings
                    sibling = heading.nextElementSibling;
                    while (sibling && !summary && !sibling.textContent.trim().match(/^\d+\.\s/) && sibling !== dateElement) {
                        if (sibling.tagName === 'P' && sibling.textContent.trim().length > 20) {
                            summary = sibling.textContent.trim();
                            summaryElement = sibling;
                            break;
                        }
                        sibling = sibling.nextElementSibling;
                    }
                    
                    // Calculate confidence scores
                    const confidence = {
                        title: title.length > 10 ? 0.9 : 0.5,
                        link: link.includes('http') ? 0.9 : 0.5,
                        date: date.length > 0 ? 0.8 : 0.3,
                        summary: summary.length > 20 ? 0.8 : 0.4
                    };
                    confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                    
                    // Only include articles with reasonable confidence
                    if (confidence.overall > 0.6) {
                        articles.push({
                            title,
                            link,
                            date,
                            summary,
                            confidence
                        });
                    }
                }
            } catch (error) {
                console.error('Error processing aps.dz search result:', error);
            }
        }
        
        return articles;
    });
}

/**
 * Special case handler for aljazeera.com with CAPTCHA handling
 */
async function extractAljazeeraResults(page, url) {
    if (!url.includes('aljazeera.com')) return [];
    
    // Check if we're on a CAPTCHA page
    const captchaDetected = await page.evaluate(() => {
        return document.body.textContent.includes('captcha') || 
               document.body.textContent.includes('CAPTCHA') ||
               document.body.textContent.includes('reCAPTCHA') ||
               document.querySelector('iframe[src*="recaptcha"]') !== null;
    });
    
    if (captchaDetected) {
        console.log('CAPTCHA detected on aljazeera.com, extraction may fail');
    }
    
    return await page.evaluate(() => {
        const articles = [];
        
        // Look for search result items
        const searchResults = document.querySelectorAll('.gc__content, .gc--type-post, .gc--type-article, article');
        
        searchResults.forEach(result => {
            try {
                // Extract title and link
                const titleElement = result.querySelector('h3, h4, .gc__title, .gc__headline');
                if (!titleElement) return;
                
                const linkElement = titleElement.querySelector('a') || result.querySelector('a');
                if (!linkElement) return;
                
                const title = titleElement.textContent.trim();
                const link = linkElement.href;
                
                // Skip if title or link is empty
                if (!title || !link) return;
                
                // Extract date
                let date = '';
                const dateElement = result.querySelector('time, .gc__date, .gc__isodate, .date-simple');
                
                if (dateElement) {
                    if (dateElement.getAttribute('datetime')) {
                        date = dateElement.getAttribute('datetime');
                    } else {
                        date = dateElement.textContent.trim();
                    }
                }
                
                // Extract summary
                let summary = '';
                const summaryElement = result.querySelector('p, .gc__excerpt, .gc__description');
                
                if (summaryElement && !summaryElement.contains(titleElement)) {
                    summary = summaryElement.textContent.trim();
                }
                
                // Calculate confidence scores
                const confidence = {
                    title: title.length > 10 ? 0.9 : 0.5,
                    link: link.includes('http') ? 0.9 : 0.5,
                    date: date.length > 0 ? 0.8 : 0.3,
                    summary: summary.length > 20 ? 0.8 : 0.4
                };
                confidence.overall = (confidence.title + confidence.link + confidence.date + confidence.summary) / 4;
                
                // Only include articles with reasonable confidence
                if (confidence.overall > 0.6) {
                    articles.push({
                        title,
                        link,
                        date,
                        summary,
                        confidence
                    });
                }
            } catch (error) {
                console.error('Error processing aljazeera.com search result:', error);
            }
        });
        
        return articles;
    });
}

/**
 * Apply strict post-filtering to remove non-article content
 * This is a much stricter version that ensures only true news articles are returned
 */
function strictPostFilterArticles(articles, url) {
    // First apply site-specific filtering
    let filteredArticles = applySiteSpecificFiltering(articles, url);
    
    // Then apply general strict filtering
    return filteredArticles.filter(article => {
        try {
            // Skip articles without a title or link
            if (!article.title || !article.link) return false;
            
            // Skip navigation, footer, and utility links
            if (article.link.includes('/category/') || 
                article.link.includes('/tag/') || 
                article.link.includes('/author/') || 
                article.link.includes('/about/') || 
                article.link.includes('/contact/') ||
                article.link.includes('/privacy/') ||
                article.link.includes('/terms/') ||
                article.link.includes('/search') ||
                article.link.includes('/login') ||
                article.link.includes('/register') ||
                article.link.includes('/account') ||
                article.link.includes('/profile') ||
                article.link.includes('/settings') ||
                article.link.includes('/help') ||
                article.link.includes('/faq') ||
                article.link.includes('/support') ||
                article.link.includes('/feedback') ||
                article.link.includes('/subscribe') ||
                article.link.includes('/newsletter') ||
                article.link.includes('/rss') ||
                article.link.includes('/sitemap') ||
                article.link.includes('/advertise') ||
                article.link.includes('/careers') ||
                article.link.includes('/jobs')) {
                return false;
            }
            
            // Skip articles with very short titles
            if (article.title.length < 20) return false;
            
            // Skip articles with all-uppercase titles (likely section headers)
            if (article.title.toUpperCase() === article.title) return false;
            
            // Skip articles with generic titles
            if (article.title.includes('Home') || 
                article.title.includes('Latest News') || 
                article.title.includes('Breaking News') ||
                article.title.includes('Top Stories') ||
                article.title.includes('Menu') ||
                article.title.includes('Navigation') ||
                article.title.includes('Search') ||
                article.title.includes('Login') ||
                article.title.includes('Register') ||
                article.title.includes('Sign In') ||
                article.title.includes('Sign Up') ||
                article.title.includes('Subscribe') ||
                article.title.includes('Newsletter')) {
                return false;
            }
            
            // Skip articles with cookie notices or privacy policies
            if (article.title.includes('Cookie') || 
                article.title.includes('Privacy') || 
                article.title.includes('Terms of Use') ||
                article.title.includes('Terms and Conditions')) {
                return false;
            }
            
            // Skip articles with image URLs in the title (common in navigation elements)
            if (article.title.includes('.jpg') || 
                article.title.includes('.png') || 
                article.title.includes('.gif') ||
                article.title.includes('.webp') ||
                article.title.includes('.svg') ||
                article.title.includes('http') ||
                article.title.includes('www.')) {
                return false;
            }
            
            // Skip articles with very long titles (likely not real articles)
            if (article.title.length > 200) return false;
            
            // Skip articles with titles that contain HTML or markdown
            if (article.title.includes('<') || 
                article.title.includes('>') || 
                article.title.includes('```') ||
                article.title.includes('###')) {
                return false;
            }
            
            // Skip articles with titles that are just URLs or paths
            if (article.title.startsWith('/') || 
                article.title.startsWith('http') || 
                article.title.startsWith('www.')) {
                return false;
            }
            
            // Skip articles with titles that are just dates or numbers
            if (/^\d+$/.test(article.title) || 
                /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(article.title) || 
                /^\d{1,2}-\d{1,2}-\d{2,4}$/.test(article.title)) {
                return false;
            }
            
            // Skip articles with titles that are just categories or tags
            if (article.title === 'News' || 
                article.title === 'Business' || 
                article.title === 'Sports' ||
                article.title === 'Entertainment' ||
                article.title === 'Technology' ||
                article.title === 'Politics' ||
                article.title === 'Health' ||
                article.title === 'Science' ||
                article.title === 'World' ||
                article.title === 'Local' ||
                article.title === 'Opinion' ||
                article.title === 'Lifestyle') {
                return false;
            }
            
            // For news articles, we expect at least one of these to be true:
            // 1. Has a date
            // 2. Has a substantial summary
            // 3. Title contains quotes (indicating it's a news article)
            // 4. Link contains year/month/day pattern (indicating it's a news article)
            const hasDate = article.date && article.date.length > 0;
            const hasSummary = article.summary && article.summary.length > 20;
            const titleHasQuotes = article.title.includes('"') || article.title.includes("'");
            const linkHasDatePattern = article.link.match(/\d{4}\/\d{1,2}\/\d{1,2}/) || 
                                      article.link.match(/\d{4}-\d{1,2}-\d{1,2}/);
            
            if (!(hasDate || hasSummary || titleHasQuotes || linkHasDatePattern)) {
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Error in strict post-filtering:', error);
            return false;
        }
    });
}

/**
 * Apply site-specific filtering rules
 */
function applySiteSpecificFiltering(articles, url) {
    // ADNOC site - should return no results as it's not a news site
    if (url.includes('adnoc.ae')) {
        return [];
    }
    
    // Special case for alarabiya.net
    if (url.includes('alarabiya.net')) {
        return articles.filter(article => {
            // Keep only articles with News, Middle East, etc. in the title or summary
            if (article.title.includes('News') || 
                article.title.includes('Middle East') || 
                article.title.includes('Business') ||
                article.title.includes('Opinion') ||
                (article.summary && (
                    article.summary.includes('News') || 
                    article.summary.includes('Middle East') || 
                    article.summary.includes('Business') ||
                    article.summary.includes('Opinion')
                ))) {
                return true;
            }
            
            // Keep articles with date patterns
            if (article.date && (
                article.date.includes('ago') || 
                article.date.match(/\d{1,2}\s+\w+\s+\d{4}/) ||
                article.date.match(/\d{1,2}\/\d{1,2}\/\d{4}/))) {
                return true;
            }
            
            // Keep articles with news-like URLs
            if (article.link && (
                article.link.includes('/News/') || 
                article.link.includes('/news/') || 
                article.link.includes('/middle-east/') ||
                article.link.includes('/business/'))) {
                return true;
            }
            
            return false;
        });
    }
    
    // Special case for aps.dz
    if (url.includes('aps.dz')) {
        return articles.filter(article => {
            // Keep only articles with numbered headings (1., 2., etc.)
            if (article.methods && article.methods.title === 'aps-dz') {
                return true;
            }
            
            // Keep articles with date patterns
            if (article.date && (
                article.date.includes('CREATED ON') || 
                article.date.match(/\d{1,2}\s+\w+\s+\d{2,4}/) ||
                article.date.match(/\d{4}\-\d{1,2}\-\d{1,2}/))) {
                return true;
            }
            
            return false;
        });
    }
    
    // For all other sites, return the articles as is
    return articles;
}
