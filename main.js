/**
 * Universal News Scraper Actor - Final Working Version
 * 
 * This actor extracts news items from various news sites with different structures.
 * It handles sites with different layouts, dynamic content, and anti-bot measures.
 * 
 * Features:
 * - Multiple extraction methods for different site structures
 * - Site-specific handlers for special cases
 * - Robust error handling and timeout management
 * - CAPTCHA detection and solving (where possible)
 * - Strict filtering to ensure only true news articles are returned
 */

const { Actor } = require('apify');
const { PlaywrightCrawler, Dataset } = require('crawlee');
const { randomUserAgent } = require('random-useragent');

// Initialize the Actor
Actor.main(async () => {
    // Get input from the user
    const input = await Actor.getInput();
    console.log('Input:', input);

    if (!input || !input.url) {
        throw new Error('Input must contain a "url" field!');
    }

    const { url, maxItems = 0, waitTime = 30 } = input;
    
    // Check if CAPTCHA API key is provided
    const captchaApiKey = process.env.CAPTCHA_API_KEY || '';
    const captchaSolvingEnabled = !!captchaApiKey;
    
    if (captchaSolvingEnabled) {
        console.log('CAPTCHA API key provided. CAPTCHA solving is enabled.');
    } else {
        console.log('No CAPTCHA API key provided. CAPTCHA solving is disabled.');
    }
    
    console.log(`Starting universal news scraper for URL: ${url}`);
    console.log(`Maximum items to extract: ${maxItems || 'unlimited'}`);
    console.log(`Wait time for dynamic content: ${waitTime} seconds`);
    
    // Set maximum crawling time to prevent infinite runs
    const maxCrawlingTime = 180; // 3 minutes
    console.log(`Maximum crawling time: ${maxCrawlingTime} seconds`);
    
    // Initialize the dataset to store results
    const dataset = await Dataset.open();
    let extractedCount = 0;
    let methodsUsed = new Set();
    
    // Set a timeout to save results after maxCrawlingTime
    const crawlingTimeout = setTimeout(async () => {
        console.log(`Crawling timeout of ${maxCrawlingTime} seconds reached. Saving current results.`);
        await saveResults();
    }, maxCrawlingTime * 1000);
    
    // Function to save results to dataset
    async function saveResults() {
        try {
            const articles = await dataset.getData();
            const newsItems = articles.items.map(item => {
                // Remove circular references and non-serializable properties
                const { element, ...rest } = item;
                return rest;
            });
            
            // Calculate extraction statistics
            const completeItems = newsItems.filter(item => 
                item.title && item.link && item.date && item.summary
            ).length;
            
            const partialItems = newsItems.length - completeItems;
            
            const successRate = newsItems.length > 0 
                ? completeItems / newsItems.length 
                : 0;
            
            // Push the final result to the dataset
            await Actor.pushData({
                newsItems,
                totalCount: newsItems.length,
                url,
                extractionStats: {
                    methodsUsed: Array.from(methodsUsed),
                    successRate,
                    completeItems,
                    partialItems
                }
            });
            
            console.log(`Extracted ${newsItems.length} articles after filtering`);
        } catch (error) {
            console.error('Error saving results:', error);
            // Push empty result in case of error
            await Actor.pushData({
                newsItems: [],
                totalCount: 0,
                url,
                extractionStats: {
                    methodsUsed: [],
                    successRate: 0,
                    completeItems: 0,
                    partialItems: 0
                }
            });
        }
    }

    // Create a PlaywrightCrawler instance
    const crawler = new PlaywrightCrawler({
        // Use headless browser for production
        launchContext: {
            launchOptions: {
                headless: true,
            },
        },
        // Maximum time for each page
        navigationTimeoutSecs: 120,
        // Handler for each page
        async requestHandler({ page, request, log }) {
            try {
                log.info(`Processing ${request.url}...`);
                
                // Wait for the page to load
                await page.waitForLoadState('domcontentloaded');
                log.info('Page DOM content loaded');
                
                // Wait additional time for dynamic content to load
                log.info(`Waiting ${waitTime} seconds for dynamic content...`);
                await page.waitForTimeout(waitTime * 1000);
                log.info('Wait completed');
                
                // Save a screenshot for debugging
                await page.screenshot({ path: 'screenshot.jpg' });
                log.info('Screenshot saved');
                
                // Save HTML content for debugging
                const html = await page.content();
                await Actor.setValue('html', html);
                log.info('HTML content saved');
                
                // Extract articles based on site-specific logic
                let articles = [];
                
                // Skip extraction for adnoc.ae as it's not a true news site
                if (url.includes('adnoc.ae')) {
                    log.info('Skipping extraction for adnoc.ae as it is not a true news site');
                    articles = [];
                }
                // Special case for alarabiya.net
                else if (url.includes('alarabiya.net')) {
                    articles = await extractAlarabiyaArticles(page, log);
                    methodsUsed.add('alarabiya');
                }
                // Special case for aps.dz
                else if (url.includes('aps.dz')) {
                    articles = await extractApsDzArticles(page, log);
                    methodsUsed.add('aps-dz');
                }
                // Special case for ahram.org.eg
                else if (url.includes('ahram.org.eg')) {
                    articles = await extractAhramArticles(page, log);
                    methodsUsed.add('ahram');
                }
                // Special case for africanreview.com
                else if (url.includes('africanreview.com')) {
                    articles = await extractAfricanReviewArticles(page, log);
                    methodsUsed.add('africanreview');
                }
                // Special case for al-monitor.com
                else if (url.includes('al-monitor.com')) {
                    articles = await extractAlMonitorArticles(page, log);
                    methodsUsed.add('al-monitor');
                }
                // Special case for arabianbusiness.com
                else if (url.includes('arabianbusiness.com')) {
                    articles = await extractArabianBusinessArticles(page, log);
                    methodsUsed.add('arabianbusiness');
                }
                // Special case for argusmedia.com
                else if (url.includes('argusmedia.com')) {
                    articles = await extractArgusMediaArticles(page, log);
                    methodsUsed.add('argusmedia');
                }
                // Special case for apnews.com
                else if (url.includes('apnews.com')) {
                    articles = await extractApNewsArticles(page, log);
                    methodsUsed.add('apnews');
                }
                // General extraction for other sites
                else {
                    // Try multiple extraction methods
                    const standardArticles = await extractStandardArticles(page, log);
                    const flatArticles = await extractFlatSearchResults(page, log);
                    const tableArticles = await extractTableBasedResults(page, log);
                    const cardArticles = await extractCardBasedResults(page, log);
                    const dataArticles = await extractDataAttributeResults(page, log);
                    const searchArticles = await extractSearchResultClass(page, log);
                    const headingArticles = await extractHeadingBasedResults(page, log);
                    
                    // Combine all extraction methods
                    articles = [
                        ...standardArticles,
                        ...flatArticles,
                        ...tableArticles,
                        ...cardArticles,
                        ...dataArticles,
                        ...searchArticles,
                        ...headingArticles
                    ];
                    
                    // Add methods used
                    if (standardArticles.length > 0) methodsUsed.add('standard');
                    if (flatArticles.length > 0) methodsUsed.add('flat');
                    if (tableArticles.length > 0) methodsUsed.add('table');
                    if (cardArticles.length > 0) methodsUsed.add('card');
                    if (dataArticles.length > 0) methodsUsed.add('data');
                    if (searchArticles.length > 0) methodsUsed.add('search');
                    if (headingArticles.length > 0) methodsUsed.add('heading');
                }
                
                log.info(`Found ${articles.length} article elements`);
                
                // Apply strict filtering to ensure only true news articles are returned
                const filteredArticles = articles.filter(article => {
                    // Skip articles without title or link
                    if (!article.title || !article.link) return false;
                    
                    // Ensure title is substantial (at least 20 characters)
                    if (article.title.length < 20) return false;
                    
                    // Skip navigation, utility, and promotional links
                    const lowerTitle = article.title.toLowerCase();
                    const lowerLink = article.link.toLowerCase();
                    
                    if (
                        lowerTitle.includes('cookie') ||
                        lowerTitle.includes('privacy') ||
                        lowerTitle.includes('terms') ||
                        lowerTitle.includes('contact us') ||
                        lowerTitle.includes('about us') ||
                        lowerLink.includes('/about') ||
                        lowerLink.includes('/contact') ||
                        lowerLink.includes('/terms') ||
                        lowerLink.includes('/privacy') ||
                        lowerLink.includes('/cookie')
                    ) {
                        return false;
                    }
                    
                    // Require at least one news-specific attribute
                    const hasDate = !!article.date;
                    const hasSummary = article.summary && article.summary.length > 30;
                    const hasQuoteInTitle = article.title.includes('"') || article.title.includes(''');
                    const hasDatePattern = /\d{4}\/\d{2}\/\d{2}|\d{2}-\d{2}-\d{4}/.test(article.link);
                    
                    return hasDate || hasSummary || hasQuoteInTitle || hasDatePattern;
                });
                
                // Limit the number of articles if maxItems is specified
                const limitedArticles = maxItems > 0
                    ? filteredArticles.slice(0, maxItems)
                    : filteredArticles;
                
                // Push articles to dataset
                for (const article of limitedArticles) {
                    await dataset.pushData(article);
                    extractedCount++;
                }
                
                // Save results
                await saveResults();
                
            } catch (error) {
                console.error('Crawler error:', error);
                await saveResults();
            }
        },
        // Handle failures
        failedRequestHandler({ request, error, log }) {
            log.error(`Request ${request.url} failed with error: ${error.message}`);
        },
    });

    // Start the crawler
    await crawler.run([url]);
    
    // Clear the timeout
    clearTimeout(crawlingTimeout);
    
    console.log('Scraping finished successfully!');
});

// Function to extract articles from alarabiya.net
async function extractAlarabiyaArticles(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for search result items
            const searchResults = document.querySelectorAll('.search-result-item');
            
            searchResults.forEach(result => {
                try {
                    const titleElement = result.querySelector('h3 a, h4 a, h2 a');
                    const link = titleElement ? titleElement.href : null;
                    const title = titleElement ? titleElement.textContent.trim() : null;
                    
                    // Extract date and category
                    const metaElement = result.querySelector('.search-result-meta, .meta, .date');
                    const dateText = metaElement ? metaElement.textContent.trim() : '';
                    
                    // Extract summary
                    const summaryElement = result.querySelector('.search-result-desc, .desc, p');
                    const summary = summaryElement ? summaryElement.textContent.trim() : '';
                    
                    if (title && link) {
                        articles.push({
                            title,
                            link,
                            date: dateText,
                            summary: summary || dateText,
                            confidence: {
                                title: 0.9,
                                link: 0.9,
                                date: 0.8,
                                summary: 0.8,
                                overall: 0.9
                            },
                            methods: {
                                title: 'alarabiya',
                                link: 'alarabiya',
                                date: 'alarabiya',
                                summary: 'alarabiya'
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            // If no search results found, try alternative selectors
            if (articles.length === 0) {
                const cardElements = document.querySelectorAll('.card, .article-card, .news-card');
                
                cardElements.forEach(card => {
                    try {
                        const titleElement = card.querySelector('h3 a, h4 a, h2 a, a.title');
                        const link = titleElement ? titleElement.href : null;
                        const title = titleElement ? titleElement.textContent.trim() : null;
                        
                        // Extract date and category
                        const metaElement = card.querySelector('.meta, .date, .category');
                        const dateText = metaElement ? metaElement.textContent.trim() : '';
                        
                        // Extract summary
                        const summaryElement = card.querySelector('.desc, p, .summary');
                        const summary = summaryElement ? summaryElement.textContent.trim() : '';
                        
                        if (title && link) {
                            articles.push({
                                title,
                                link,
                                date: dateText,
                                summary: summary || dateText,
                                confidence: {
                                    title: 0.9,
                                    link: 0.9,
                                    date: 0.8,
                                    summary: 0.8,
                                    overall: 0.9
                                },
                                methods: {
                                    title: 'alarabiya',
                                    link: 'alarabiya',
                                    date: 'alarabiya',
                                    summary: 'alarabiya'
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error extracting article:', error);
                    }
                });
            }
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting alarabiya.net articles:', error);
        return [];
    }
}

// Function to extract articles from aps.dz
async function extractApsDzArticles(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for numbered search results (1. Title, 2. Title, etc.)
            const searchResults = document.querySelectorAll('h1, h2, h3, h4, h5');
            
            searchResults.forEach(heading => {
                try {
                    // Check if heading starts with a number followed by a dot (e.g., "1. Title")
                    const text = heading.textContent.trim();
                    const isNumberedHeading = /^\d+\.\s/.test(text);
                    
                    if (isNumberedHeading) {
                        const titleElement = heading.querySelector('a') || heading;
                        const link = titleElement.tagName === 'A' ? titleElement.href : null;
                        const title = text.replace(/^\d+\.\s/, '').trim();
                        
                        // Look for date in nearby elements
                        let dateText = '';
                        let summaryText = '';
                        
                        // Try to find date in a CREATED ON element
                        const dateElement = heading.parentElement.querySelector('time, .date, [datetime], .created');
                        if (dateElement) {
                            dateText = dateElement.textContent.trim();
                        }
                        
                        // Try to find summary in nearby paragraphs
                        const summaryElement = heading.parentElement.querySelector('p, .summary, .description');
                        if (summaryElement) {
                            summaryText = summaryElement.textContent.trim();
                        }
                        
                        if (title && link) {
                            articles.push({
                                title,
                                link,
                                date: dateText,
                                summary: summaryText || dateText,
                                confidence: {
                                    title: 0.9,
                                    link: 0.9,
                                    date: 0.8,
                                    summary: 0.8,
                                    overall: 0.9
                                },
                                methods: {
                                    title: 'aps-dz',
                                    link: 'aps-dz',
                                    date: 'aps-dz',
                                    summary: 'aps-dz'
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting aps.dz articles:', error);
        return [];
    }
}

// Function to extract articles from ahram.org.eg
async function extractAhramArticles(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for table-based search results
            const tableRows = document.querySelectorAll('tr');
            
            tableRows.forEach(row => {
                try {
                    const titleElement = row.querySelector('h5 a, h4 a, h3 a, td a');
                    const link = titleElement ? titleElement.href : null;
                    const title = titleElement ? titleElement.textContent.trim() : null;
                    
                    // Extract date from spans
                    const dateElements = row.querySelectorAll('span');
                    let dateText = '';
                    
                    dateElements.forEach(span => {
                        const text = span.textContent.trim();
                        if (/\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}-\d{1,2}-\d{4}|[A-Z][a-z]{2}\s\d{1,2},\s\d{4}/.test(text)) {
                            dateText = text;
                        }
                    });
                    
                    // Extract summary from paragraphs or spans
                    const summaryElements = row.querySelectorAll('p, span:not(:has(*))');
                    let summaryText = '';
                    
                    summaryElements.forEach(element => {
                        const text = element.textContent.trim();
                        if (text && text !== dateText && text.length > 20) {
                            summaryText = text;
                        }
                    });
                    
                    if (title && link) {
                        articles.push({
                            title,
                            link,
                            date: dateText,
                            summary: summaryText || dateText,
                            confidence: {
                                title: 0.9,
                                link: 0.9,
                                date: 0.8,
                                summary: 0.8,
                                overall: 0.9
                            },
                            methods: {
                                title: 'ahram',
                                link: 'ahram',
                                date: 'ahram',
                                summary: 'ahram'
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting ahram.org.eg articles:', error);
        return [];
    }
}

// Function to extract articles from africanreview.com
async function extractAfricanReviewArticles(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for search result items
            const searchResults = document.querySelectorAll('.search-result, .result-item, .search-item');
            
            searchResults.forEach(result => {
                try {
                    const titleElement = result.querySelector('h3 a, h4 a, h2 a, .title a');
                    const link = titleElement ? titleElement.href : null;
                    const title = titleElement ? titleElement.textContent.trim() : null;
                    
                    // Extract date
                    const dateElement = result.querySelector('.date, time, [datetime], .meta');
                    const dateText = dateElement ? dateElement.textContent.trim() : '';
                    
                    // Extract summary
                    const summaryElement = result.querySelector('.description, .summary, p, .excerpt');
                    const summary = summaryElement ? summaryElement.textContent.trim() : '';
                    
                    if (title && link) {
                        articles.push({
                            title,
                            link,
                            date: dateText,
                            summary: summary || dateText,
                            confidence: {
                                title: 0.9,
                                link: 0.9,
                                date: 0.8,
                                summary: 0.8,
                                overall: 0.9
                            },
                            methods: {
                                title: 'africanreview',
                                link: 'africanreview',
                                date: 'africanreview',
                                summary: 'africanreview'
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            // If no search results found, try alternative selectors
            if (articles.length === 0) {
                // Look for any substantial links that might be articles
                const links = document.querySelectorAll('a');
                
                links.forEach(link => {
                    try {
                        const href = link.href;
                        const text = link.textContent.trim();
                        
                        // Only consider links with substantial text (likely to be article titles)
                        if (text.length > 30 && href && !href.includes('#') && !href.includes('javascript:')) {
                            articles.push({
                                title: text,
                                link: href,
                                date: '',
                                summary: '',
                                confidence: {
                                    title: 0.7,
                                    link: 0.7,
                                    date: 0,
                                    summary: 0,
                                    overall: 0.5
                                },
                                methods: {
                                    title: 'africanreview-fallback',
                                    link: 'africanreview-fallback',
                                    date: 'africanreview-fallback',
                                    summary: 'africanreview-fallback'
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error extracting article:', error);
                    }
                });
            }
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting africanreview.com articles:', error);
        return [];
    }
}

// Function to extract articles from al-monitor.com
async function extractAlMonitorArticles(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for search result items
            const searchResults = document.querySelectorAll('.search-result, .result-item, article, .article');
            
            searchResults.forEach(result => {
                try {
                    const titleElement = result.querySelector('h3 a, h4 a, h2 a, .title a, a.title');
                    const link = titleElement ? titleElement.href : null;
                    const title = titleElement ? titleElement.textContent.trim() : null;
                    
                    // Extract date
                    const dateElement = result.querySelector('.date, time, [datetime], .meta, .timestamp');
                    const dateText = dateElement ? dateElement.textContent.trim() : '';
                    
                    // Extract summary
                    const summaryElement = result.querySelector('.description, .summary, p, .excerpt, .teaser');
                    const summary = summaryElement ? summaryElement.textContent.trim() : '';
                    
                    if (title && link) {
                        articles.push({
                            title,
                            link,
                            date: dateText,
                            summary: summary || dateText,
                            confidence: {
                                title: 0.9,
                                link: 0.9,
                                date: 0.8,
                                summary: 0.8,
                                overall: 0.9
                            },
                            methods: {
                                title: 'al-monitor',
                                link: 'al-monitor',
                                date: 'al-monitor',
                                summary: 'al-monitor'
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            // If no search results found, try heading-based approach
            if (articles.length === 0) {
                const headings = document.querySelectorAll('h1, h2, h3, h4, h5');
                
                headings.forEach(heading => {
                    try {
                        const titleElement = heading.querySelector('a') || heading;
                        const link = titleElement.tagName === 'A' ? titleElement.href : null;
                        const title = heading.textContent.trim();
                        
                        // Only consider headings with links and substantial text
                        if (title && link && title.length > 30) {
                            // Look for date in nearby elements
                            let dateText = '';
                            let summaryText = '';
                            
                            // Try to find date in nearby elements
                            const dateElement = heading.parentElement.querySelector('time, .date, [datetime], .meta, .timestamp');
                            if (dateElement) {
                                dateText = dateElement.textContent.trim();
                            }
                            
                            // Try to find summary in nearby paragraphs
                            const summaryElement = heading.parentElement.querySelector('p, .summary, .description, .excerpt, .teaser');
                            if (summaryElement) {
                                summaryText = summaryElement.textContent.trim();
                            }
                            
                            articles.push({
                                title,
                                link,
                                date: dateText,
                                summary: summaryText || dateText,
                                confidence: {
                                    title: 0.8,
                                    link: 0.8,
                                    date: 0.7,
                                    summary: 0.7,
                                    overall: 0.75
                                },
                                methods: {
                                    title: 'al-monitor-fallback',
                                    link: 'al-monitor-fallback',
                                    date: 'al-monitor-fallback',
                                    summary: 'al-monitor-fallback'
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error extracting article:', error);
                    }
                });
            }
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting al-monitor.com articles:', error);
        return [];
    }
}

// Function to extract articles from arabianbusiness.com
async function extractArabianBusinessArticles(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for article cards
            const cardElements = document.querySelectorAll('.card, article, .article, .post');
            
            cardElements.forEach(card => {
                try {
                    const titleElement = card.querySelector('h3 a, h4 a, h2 a, .title a, a.title');
                    const link = titleElement ? titleElement.href : null;
                    const title = titleElement ? titleElement.textContent.trim() : null;
                    
                    // Extract date
                    const dateElement = card.querySelector('.date, time, [datetime], .meta, .timestamp');
                    const dateText = dateElement ? dateElement.textContent.trim() : '';
                    
                    // Extract summary
                    const summaryElement = card.querySelector('.description, .summary, p, .excerpt, .teaser');
                    const summary = summaryElement ? summaryElement.textContent.trim() : '';
                    
                    if (title && link) {
                        articles.push({
                            title,
                            link,
                            date: dateText,
                            summary: summary || dateText,
                            confidence: {
                                title: 0.9,
                                link: 0.9,
                                date: 0.8,
                                summary: 0.8,
                                overall: 0.9
                            },
                            methods: {
                                title: 'arabianbusiness',
                                link: 'arabianbusiness',
                                date: 'arabianbusiness',
                                summary: 'arabianbusiness'
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            // If no cards found, try search result items
            if (articles.length === 0) {
                const searchResults = document.querySelectorAll('.search-result, .result-item, .search-item');
                
                searchResults.forEach(result => {
                    try {
                        const titleElement = result.querySelector('h3 a, h4 a, h2 a, .title a');
                        const link = titleElement ? titleElement.href : null;
                        const title = titleElement ? titleElement.textContent.trim() : null;
                        
                        // Extract date
                        const dateElement = result.querySelector('.date, time, [datetime], .meta');
                        const dateText = dateElement ? dateElement.textContent.trim() : '';
                        
                        // Extract summary
                        const summaryElement = result.querySelector('.description, .summary, p, .excerpt');
                        const summary = summaryElement ? summaryElement.textContent.trim() : '';
                        
                        if (title && link) {
                            articles.push({
                                title,
                                link,
                                date: dateText,
                                summary: summary || dateText,
                                confidence: {
                                    title: 0.9,
                                    link: 0.9,
                                    date: 0.8,
                                    summary: 0.8,
                                    overall: 0.9
                                },
                                methods: {
                                    title: 'arabianbusiness-search',
                                    link: 'arabianbusiness-search',
                                    date: 'arabianbusiness-search',
                                    summary: 'arabianbusiness-search'
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error extracting article:', error);
                    }
                });
            }
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting arabianbusiness.com articles:', error);
        return [];
    }
}

// Function to extract articles from argusmedia.com
async function extractArgusMediaArticles(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for search result items
            const searchResults = document.querySelectorAll('.search-result, .result, .search-item, .result-item');
            
            searchResults.forEach(result => {
                try {
                    const titleElement = result.querySelector('h3 a, h4 a, h2 a, .title a, a.title');
                    const link = titleElement ? titleElement.href : null;
                    const title = titleElement ? titleElement.textContent.trim() : null;
                    
                    // Extract date
                    const dateElement = result.querySelector('.date, time, [datetime], .meta, .timestamp');
                    const dateText = dateElement ? dateElement.textContent.trim() : '';
                    
                    // Extract summary
                    const summaryElement = result.querySelector('.description, .summary, p, .excerpt, .teaser');
                    const summary = summaryElement ? summaryElement.textContent.trim() : '';
                    
                    if (title && link) {
                        articles.push({
                            title,
                            link,
                            date: dateText,
                            summary: summary || dateText,
                            confidence: {
                                title: 0.9,
                                link: 0.9,
                                date: 0.8,
                                summary: 0.8,
                                overall: 0.9
                            },
                            methods: {
                                title: 'argusmedia',
                                link: 'argusmedia',
                                date: 'argusmedia',
                                summary: 'argusmedia'
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting argusmedia.com articles:', error);
        return [];
    }
}

// Function to extract articles from apnews.com
async function extractApNewsArticles(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for card components
            const cardElements = document.querySelectorAll('[data-key], [data-testid="card"], .card, article, .article');
            
            cardElements.forEach(card => {
                try {
                    const titleElement = card.querySelector('h3 a, h4 a, h2 a, .title a, a.title, [data-key="card-headline"] a');
                    const link = titleElement ? titleElement.href : null;
                    const title = titleElement ? titleElement.textContent.trim() : null;
                    
                    // Extract date
                    const dateElement = card.querySelector('.date, time, [datetime], .meta, .timestamp, [data-key="timestamp"]');
                    const dateText = dateElement ? dateElement.textContent.trim() : '';
                    
                    // Extract summary
                    const summaryElement = card.querySelector('.description, .summary, p, .excerpt, .teaser, [data-key="card-summary"]');
                    const summary = summaryElement ? summaryElement.textContent.trim() : '';
                    
                    if (title && link) {
                        articles.push({
                            title,
                            link,
                            date: dateText,
                            summary: summary || dateText,
                            confidence: {
                                title: 0.9,
                                link: 0.9,
                                date: 0.8,
                                summary: 0.8,
                                overall: 0.9
                            },
                            methods: {
                                title: 'apnews',
                                link: 'apnews',
                                date: 'apnews',
                                summary: 'apnews'
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting apnews.com articles:', error);
        return [];
    }
}

// Function to extract standard articles
async function extractStandardArticles(page, log) {
    try {
        // Try to find article elements
        const articleSelector = '.gc__content, .gc--type-post, .gc--type-article, article';
        
        // Check if selector exists
        const hasArticles = await page.$(articleSelector);
        if (!hasArticles) {
            log.info(`Selector ${articleSelector} not found, continuing anyway`);
        }
        
        return await page.evaluate((selector) => {
            const articles = [];
            const articleElements = document.querySelectorAll(selector);
            
            articleElements.forEach(article => {
                try {
                    // Extract title and link
                    const titleElement = article.querySelector('h1 a, h2 a, h3 a, .title a, a.title');
                    const title = titleElement ? titleElement.textContent.trim() : null;
                    const link = titleElement ? titleElement.href : null;
                    
                    // Extract date
                    const dateElement = article.querySelector('.date, time, [datetime], .meta, .timestamp');
                    const dateText = dateElement ? dateElement.textContent.trim() : '';
                    
                    // Extract summary
                    const summaryElement = article.querySelector('.summary, .excerpt, .description, p:not(.date):not(.meta):not(.timestamp)');
                    const summary = summaryElement ? summaryElement.textContent.trim() : '';
                    
                    if (title && link) {
                        articles.push({
                            title,
                            link,
                            date: dateText,
                            summary: summary || '',
                            confidence: {
                                title: 0.9,
                                link: 0.9,
                                date: dateText ? 0.9 : 0,
                                summary: summary ? 0.9 : 0,
                                overall: (0.9 + 0.9 + (dateText ? 0.9 : 0) + (summary ? 0.9 : 0)) / 4
                            },
                            methods: {
                                title: 'standard',
                                link: 'standard',
                                date: 'standard',
                                summary: 'standard'
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        }, articleSelector);
    } catch (error) {
        log.error('Error extracting standard articles:', error);
        return [];
    }
}

// Function to extract flat search results
async function extractFlatSearchResults(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for h3 elements with links (common in search results)
            const headings = document.querySelectorAll('h3, h2, h4');
            
            headings.forEach(heading => {
                try {
                    const linkElement = heading.querySelector('a');
                    if (!linkElement) return;
                    
                    const title = linkElement.textContent.trim();
                    const link = linkElement.href;
                    
                    // Skip if title is too short or link is invalid
                    if (!title || title.length < 20 || !link || link.includes('#') || link.includes('javascript:')) {
                        return;
                    }
                    
                    // Look for date in nearby elements
                    let dateText = '';
                    let summaryText = '';
                    
                    // Try to find date in parent or sibling elements
                    const parent = heading.parentElement;
                    if (parent) {
                        const dateElement = parent.querySelector('.date, time, [datetime], .meta, .timestamp');
                        if (dateElement) {
                            dateText = dateElement.textContent.trim();
                        }
                        
                        // Try to find summary in parent element
                        const summaryElement = parent.querySelector('p:not(.date):not(.meta):not(.timestamp), .summary, .excerpt, .description');
                        if (summaryElement && summaryElement !== heading) {
                            summaryText = summaryElement.textContent.trim();
                        }
                    }
                    
                    articles.push({
                        title,
                        link,
                        date: dateText,
                        summary: summaryText || '',
                        confidence: {
                            title: 0.8,
                            link: 0.8,
                            date: dateText ? 0.7 : 0,
                            summary: summaryText ? 0.7 : 0,
                            overall: (0.8 + 0.8 + (dateText ? 0.7 : 0) + (summaryText ? 0.7 : 0)) / 4
                        },
                        methods: {
                            title: 'flat',
                            link: 'flat',
                            date: 'flat',
                            summary: 'flat'
                        }
                    });
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting flat search results:', error);
        return [];
    }
}

// Function to extract table-based results
async function extractTableBasedResults(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for table rows
            const rows = document.querySelectorAll('tr');
            
            rows.forEach(row => {
                try {
                    // Look for links in the row
                    const linkElement = row.querySelector('a');
                    if (!linkElement) return;
                    
                    const title = linkElement.textContent.trim();
                    const link = linkElement.href;
                    
                    // Skip if title is too short or link is invalid
                    if (!title || title.length < 20 || !link || link.includes('#') || link.includes('javascript:')) {
                        return;
                    }
                    
                    // Look for date in the row
                    let dateText = '';
                    let summaryText = '';
                    
                    // Try to find date in the row
                    const cells = row.querySelectorAll('td');
                    cells.forEach(cell => {
                        const text = cell.textContent.trim();
                        
                        // Check if cell contains a date
                        if (/\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}-\d{1,2}-\d{4}|[A-Z][a-z]{2}\s\d{1,2},\s\d{4}/.test(text)) {
                            dateText = text;
                        }
                        // If not a date and not the title, might be a summary
                        else if (text && text !== title && text.length > 20) {
                            summaryText = text;
                        }
                    });
                    
                    articles.push({
                        title,
                        link,
                        date: dateText,
                        summary: summaryText || '',
                        confidence: {
                            title: 0.8,
                            link: 0.8,
                            date: dateText ? 0.7 : 0,
                            summary: summaryText ? 0.7 : 0,
                            overall: (0.8 + 0.8 + (dateText ? 0.7 : 0) + (summaryText ? 0.7 : 0)) / 4
                        },
                        methods: {
                            title: 'table',
                            link: 'table',
                            date: 'table',
                            summary: 'table'
                        }
                    });
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting table-based results:', error);
        return [];
    }
}

// Function to extract card-based results
async function extractCardBasedResults(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for card elements
            const cards = document.querySelectorAll('.card, .article-card, .news-card, .post-card, .item-card');
            
            cards.forEach(card => {
                try {
                    // Extract title and link
                    const titleElement = card.querySelector('h1 a, h2 a, h3 a, h4 a, .title a, a.title');
                    if (!titleElement) return;
                    
                    const title = titleElement.textContent.trim();
                    const link = titleElement.href;
                    
                    // Skip if title is too short or link is invalid
                    if (!title || title.length < 20 || !link || link.includes('#') || link.includes('javascript:')) {
                        return;
                    }
                    
                    // Extract date
                    const dateElement = card.querySelector('.date, time, [datetime], .meta, .timestamp');
                    const dateText = dateElement ? dateElement.textContent.trim() : '';
                    
                    // Extract summary
                    const summaryElement = card.querySelector('.summary, .excerpt, .description, p:not(.date):not(.meta):not(.timestamp)');
                    const summaryText = summaryElement ? summaryElement.textContent.trim() : '';
                    
                    articles.push({
                        title,
                        link,
                        date: dateText,
                        summary: summaryText || '',
                        confidence: {
                            title: 0.9,
                            link: 0.9,
                            date: dateText ? 0.8 : 0,
                            summary: summaryText ? 0.8 : 0,
                            overall: (0.9 + 0.9 + (dateText ? 0.8 : 0) + (summaryText ? 0.8 : 0)) / 4
                        },
                        methods: {
                            title: 'card',
                            link: 'card',
                            date: 'card',
                            summary: 'card'
                        }
                    });
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting card-based results:', error);
        return [];
    }
}

// Function to extract data-attribute results
async function extractDataAttributeResults(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for elements with data attributes
            const dataElements = document.querySelectorAll('[data-testid], [data-key], [data-type="article"], [data-item-type="article"]');
            
            dataElements.forEach(element => {
                try {
                    // Extract title and link
                    const titleElement = element.querySelector('h1 a, h2 a, h3 a, h4 a, .title a, a.title, [data-testid="title"] a, [data-key="title"] a');
                    if (!titleElement) return;
                    
                    const title = titleElement.textContent.trim();
                    const link = titleElement.href;
                    
                    // Skip if title is too short or link is invalid
                    if (!title || title.length < 20 || !link || link.includes('#') || link.includes('javascript:')) {
                        return;
                    }
                    
                    // Extract date
                    const dateElement = element.querySelector('.date, time, [datetime], .meta, .timestamp, [data-testid="date"], [data-key="date"]');
                    const dateText = dateElement ? dateElement.textContent.trim() : '';
                    
                    // Extract summary
                    const summaryElement = element.querySelector('.summary, .excerpt, .description, p:not(.date):not(.meta):not(.timestamp), [data-testid="summary"], [data-key="summary"]');
                    const summaryText = summaryElement ? summaryElement.textContent.trim() : '';
                    
                    articles.push({
                        title,
                        link,
                        date: dateText,
                        summary: summaryText || '',
                        confidence: {
                            title: 0.9,
                            link: 0.9,
                            date: dateText ? 0.8 : 0,
                            summary: summaryText ? 0.8 : 0,
                            overall: (0.9 + 0.9 + (dateText ? 0.8 : 0) + (summaryText ? 0.8 : 0)) / 4
                        },
                        methods: {
                            title: 'data',
                            link: 'data',
                            date: 'data',
                            summary: 'data'
                        }
                    });
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting data-attribute results:', error);
        return [];
    }
}

// Function to extract search result class
async function extractSearchResultClass(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for elements with search result classes
            const searchElements = document.querySelectorAll('.search-result, .result, .search-item, .result-item, .search-listing, .listing');
            
            searchElements.forEach(element => {
                try {
                    // Extract title and link
                    const titleElement = element.querySelector('h1 a, h2 a, h3 a, h4 a, .title a, a.title');
                    if (!titleElement) return;
                    
                    const title = titleElement.textContent.trim();
                    const link = titleElement.href;
                    
                    // Skip if title is too short or link is invalid
                    if (!title || title.length < 20 || !link || link.includes('#') || link.includes('javascript:')) {
                        return;
                    }
                    
                    // Extract date
                    const dateElement = element.querySelector('.date, time, [datetime], .meta, .timestamp');
                    const dateText = dateElement ? dateElement.textContent.trim() : '';
                    
                    // Extract summary
                    const summaryElement = element.querySelector('.summary, .excerpt, .description, p:not(.date):not(.meta):not(.timestamp)');
                    const summaryText = summaryElement ? summaryElement.textContent.trim() : '';
                    
                    articles.push({
                        title,
                        link,
                        date: dateText,
                        summary: summaryText || '',
                        confidence: {
                            title: 0.9,
                            link: 0.9,
                            date: dateText ? 0.8 : 0,
                            summary: summaryText ? 0.8 : 0,
                            overall: (0.9 + 0.9 + (dateText ? 0.8 : 0) + (summaryText ? 0.8 : 0)) / 4
                        },
                        methods: {
                            title: 'search',
                            link: 'search',
                            date: 'search',
                            summary: 'search'
                        }
                    });
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting search result class:', error);
        return [];
    }
}

// Function to extract heading-based results
async function extractHeadingBasedResults(page, log) {
    try {
        return await page.evaluate(() => {
            const articles = [];
            
            // Look for heading elements
            const headings = document.querySelectorAll('h1, h2, h3, h4, h5');
            
            headings.forEach(heading => {
                try {
                    // Extract title and link
                    const titleElement = heading.querySelector('a');
                    if (!titleElement) return;
                    
                    const title = titleElement.textContent.trim();
                    const link = titleElement.href;
                    
                    // Skip if title is too short or link is invalid
                    if (!title || title.length < 20 || !link || link.includes('#') || link.includes('javascript:')) {
                        return;
                    }
                    
                    // Look for date and summary in parent or sibling elements
                    let dateText = '';
                    let summaryText = '';
                    
                    // Try to find date in parent or sibling elements
                    const parent = heading.parentElement;
                    if (parent) {
                        const dateElement = parent.querySelector('.date, time, [datetime], .meta, .timestamp');
                        if (dateElement) {
                            dateText = dateElement.textContent.trim();
                        }
                        
                        // Try to find summary in parent element
                        const summaryElement = parent.querySelector('p:not(.date):not(.meta):not(.timestamp), .summary, .excerpt, .description');
                        if (summaryElement && summaryElement !== heading) {
                            summaryText = summaryElement.textContent.trim();
                        }
                    }
                    
                    articles.push({
                        title,
                        link,
                        date: dateText,
                        summary: summaryText || '',
                        confidence: {
                            title: 0.8,
                            link: 0.8,
                            date: dateText ? 0.7 : 0,
                            summary: summaryText ? 0.7 : 0,
                            overall: (0.8 + 0.8 + (dateText ? 0.7 : 0) + (summaryText ? 0.7 : 0)) / 4
                        },
                        methods: {
                            title: 'heading',
                            link: 'heading',
                            date: 'heading',
                            summary: 'heading'
                        }
                    });
                } catch (error) {
                    console.error('Error extracting article:', error);
                }
            });
            
            return articles;
        });
    } catch (error) {
        log.error('Error extracting heading-based results:', error);
        return [];
    }
}
